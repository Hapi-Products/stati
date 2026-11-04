'use strict';
// Native-only filesystem discovery. Callers supply OS/native-picker roots, never
// paths from an IPC payload. Discovery does not grant edit permission.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const constants=require('node:fs').constants;
const execFile=require('node:util').promisify(require('node:child_process').execFile);
const MAX_BYTES=50*1024*1024;
const OMIT=new Set(['windows','program files','program files (x86)','programdata','$recycle.bin','system volume information','system','library','applications','private','dev','proc','sys','bin','sbin','usr','etc','node_modules','.git','.svn','.hg','.stati-history','.stati-service-copies','.stati-presentation-sync']);
const DEFAULTS=Object.freeze({maxEntries:250000,maxDirectories:50000,maxFiles:10000,maxDepth:32,maxBytes:MAX_BYTES,maxTotalBytes:2*1024*1024*1024,maxDurationMs:5*60*1000});
function checkpoint(checkActive,signal){signal?.throwIfAborted();const result=checkActive();if(result&&typeof result.then==='function'){result.catch?.(()=>{});throw Error('Use a synchronous native authorization check for filesystem jobs.');}signal?.throwIfAborted();}
function nativePath(value){if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))throw Error('Choose a native folder before scanning.');return path.resolve(value);}
function key(file){const normalized=path.resolve(file).normalize('NFC');return process.platform==='win32'?normalized.toLowerCase():normalized;}
function inside(root,file){return key(root)===key(file)||key(file).startsWith(key(root)+path.sep);}
function covers(root,file){return inside(root,file)&&!path.relative(root,file).split(path.sep).some(name=>OMIT.has(name.toLowerCase())||name.toLowerCase().startsWith('.stati-'));}
function pathId(file){return crypto.createHash('sha256').update(key(file)).digest('hex');}
function same(a,b){return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;}
async function physical(file){
 const resolved=nativePath(file),actual=await fs.realpath(resolved);
 // realpath resolving an ancestor link/junction is intentionally rejected.
 if(key(actual)!==key(resolved))throw Error('Linked folders and files are excluded from this scan.');
 const stat=await fs.lstat(resolved);if(stat.isSymbolicLink())throw Error('Linked folders and files are excluded from this scan.');return{path:actual,stat};
}
async function readFingerprint(file,{checkActive,signal,maxBytes=MAX_BYTES,includeBytes=false}={}){
 if(typeof checkActive!=='function')throw Error('A native authorization check is required.');
 checkpoint(checkActive,signal);const selected=await physical(file);checkpoint(checkActive,signal);
 if(!selected.stat.isFile()||selected.stat.size<=0||selected.stat.size>maxBytes)throw Error('Choose a readable presentation up to 50 MB.');
 let handle;try{
  handle=await fs.open(selected.path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));checkpoint(checkActive,signal);const before=await handle.stat();
  if(!same(selected.stat,before))throw Error('This presentation changed while opening it.');
  const hash=crypto.createHash('sha256'),chunks=[];let offset=0;
  while(offset<before.size){checkpoint(checkActive,signal);const block=Buffer.allocUnsafe(Math.min(256*1024,before.size-offset)),read=await handle.read(block,0,block.length,offset);if(!read.bytesRead)throw Error('This presentation changed while reading it.');const bytes=block.subarray(0,read.bytesRead);hash.update(bytes);if(includeBytes)chunks.push(bytes);offset+=read.bytesRead;}
  const after=await handle.stat(),visible=await physical(selected.path);checkpoint(checkActive,signal);
  if(!same(before,after)||!same(after,visible.stat))throw Error('This presentation changed while reading it.');
  return{id:pathId(selected.path),path:selected.path,sha256:hash.digest('hex'),bytes:offset,modifiedAt:before.mtimeMs,identity:{dev:before.dev,ino:before.ino,size:before.size,mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs},...(includeBytes?{data:Buffer.concat(chunks)}:{})};
 }finally{if(signal?.aborted)void handle?.close().catch(()=>{});else await handle?.close();}
}
async function fingerprint(file,{checkActive,signal,maxDurationMs=45000,...options}={}){
 if(!Number.isInteger(maxDurationMs)||maxDurationMs<1||maxDurationMs>45000)throw Error('Choose a bounded presentation read timeout.');
 const deadline=new AbortController(),combined=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;let timer,onAbort;
 const interrupted=new Promise((resolve,reject)=>{onAbort=()=>reject(combined.reason);combined.addEventListener('abort',onAbort,{once:true});if(combined.aborted)onAbort();timer=setTimeout(()=>{const failure=Error('Reading this presentation timed out. It was skipped; the original was kept.');failure.code='FILE_TIMEOUT';deadline.abort(failure);},maxDurationMs);});
 try{return await Promise.race([readFingerprint(file,{checkActive,signal:combined,...options}),interrupted]);}
 finally{clearTimeout(timer);combined.removeEventListener('abort',onAbort);}
}
function bounds(input={}){const result={...DEFAULTS,...input};for(const name of Object.keys(DEFAULTS))if(!Number.isSafeInteger(result[name])||result[name]<1||result[name]>DEFAULTS[name])throw Error('Choose bounded presentation scan limits.');return result;}
/** Result paths remain in native memory. Expose names/opaque ids to renderers. */
async function scanPresentations({roots,extensions=['.ppt','.pptx'],limits,onProgress=()=>{},checkActive,signal,shouldSkipFile=async()=>false}={}){
 if(typeof checkActive!=='function')throw Error('A native authorization check is required.');
 if(!Array.isArray(roots)||!roots.length||roots.length>64)throw Error('Choose between 1 and 64 native scan folders.');
 if(!Array.isArray(extensions)||!extensions.length||extensions.some(ext=>!['.ppt','.pptx','.pro','.pro6'].includes(ext)))throw Error('Choose supported presentation file types.');
 const limit=bounds(limits),started=Date.now(),files=[],issues=[],completedRoots=[],seenDirectories=new Set(),seenFiles=new Set(),pending=[];
 const counts={entries:0,directories:0,matched:0,unreadable:0,excluded:0,bytes:0};let reason=null,lastProgress=0;
 const progress=force=>{if(force||Date.now()-lastProgress>=100){lastProgress=Date.now();try{onProgress({...counts,elapsedMs:Date.now()-started,complete:force&&!reason,reason});}catch{}}};
 const check=()=>{checkpoint(checkActive,signal);if(Date.now()-started>=limit.maxDurationMs)reason='time-limit';return !reason;};
 const issue=(name,error)=>{counts.unreadable++;if(issues.length<100)issues.push({name,error:String(error?.message||'Could not read this folder or file.').slice(0,300)});};
 const selected=[];
 for(const supplied of roots){if(!check())break;try{const root=await physical(supplied);if(!root.stat.isDirectory())throw Error('Choose a folder to scan.');if(OMIT.has(path.basename(root.path).toLowerCase())){counts.excluded++;continue;}if(!selected.some(other=>covers(other,root.path)))selected.push(root.path);}catch(error){checkpoint(checkActive,signal);issue(path.basename(String(supplied)),error);}}
 // Sort ancestor roots first so overlapping selections are traversed once.
 selected.sort((a,b)=>a.length-b.length);const unique=selected.filter((root,index)=>!selected.slice(0,index).some(other=>covers(other,root)));
 for(const root of unique){
  if(!check())break;let rootIncomplete=false;pending.push({directory:root,depth:0});
  while(pending.length&&check()){
   const next=pending.pop();let iterator;
   try{
    const folder=await physical(next.directory);if(!folder.stat.isDirectory()||!inside(root,folder.path))throw Error('This folder changed while scanning.');const token=folder.stat.dev+':'+folder.stat.ino;if(seenDirectories.has(token))continue;seenDirectories.add(token);
    if(counts.directories>=limit.maxDirectories){reason='directory-limit';break;}counts.directories++;iterator=await fs.opendir(folder.path);
    for await(const entry of iterator){
     if(!check())break;if(counts.entries>=limit.maxEntries){reason='entry-limit';break;}counts.entries++;progress(false);
     const file=path.join(folder.path,entry.name),name=entry.name.toLowerCase();
     if(entry.isSymbolicLink()||OMIT.has(name)||name.startsWith('.stati-')){counts.excluded++;continue;}
     if(entry.isDirectory()){if(next.depth>=limit.maxDepth){counts.excluded++;rootIncomplete=true;}else pending.push({directory:file,depth:next.depth+1});continue;}
     if(!entry.isFile()||!extensions.includes(path.extname(name)))continue;
     if(name.startsWith('~$')){counts.excluded++;continue;}
     if(files.length>=limit.maxFiles){reason='file-limit';break;}
     try{
      const info=await physical(file);if(!info.stat.isFile())throw Error('This presentation changed while scanning.');const token=info.stat.dev+':'+info.stat.ino;if(seenFiles.has(token)){counts.excluded++;continue;}seenFiles.add(token);
      if(info.stat.size>limit.maxBytes||info.stat.size<=0){counts.excluded++;rootIncomplete=true;continue;}
      // Main may exclude offline/cloud placeholders and unsupported volumes
      // using native file attributes before any file bytes are opened.
      if(await shouldSkipFile(file,info.stat)){checkpoint(checkActive,signal);counts.excluded++;rootIncomplete=true;continue;}
      if(counts.bytes+info.stat.size>limit.maxTotalBytes){reason='byte-limit';break;}
      const found=await fingerprint(file,{checkActive,signal,maxBytes:limit.maxBytes,maxDurationMs:Math.max(1,Math.min(45000,limit.maxDurationMs-(Date.now()-started)))});files.push(found);counts.bytes+=found.bytes;counts.matched++;
     }catch(error){checkpoint(checkActive,signal);rootIncomplete=true;issue(entry.name,error);}
    }
   }catch(error){checkpoint(checkActive,signal);rootIncomplete=true;issue(path.basename(next.directory),error);}
  }
  if(!reason&&!rootIncomplete&&!pending.length)completedRoots.push(root);
  if(reason)break;
 }
 checkpoint(checkActive,signal);if(!reason&&completedRoots.length!==unique.length)reason='unreadable-or-excluded';if(!unique.length&&!reason)reason='no-readable-folders';progress(true);
 return{files,counts,issues,completedRoots,extensions:[...extensions],complete:!reason,reason,elapsedMs:Date.now()-started};
}
async function localVolumes(platform,{signal,checkActive}={}){
 if(platform==='win32'){
  const {stdout}=await execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command','@(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3 } | ForEach-Object { $_.DeviceID + "\\" }) | ConvertTo-Json -Compress'],{timeout:8000,maxBuffer:64*1024,windowsHide:true,signal});
  const parsed=JSON.parse(stdout.trim()||'[]');return typeof parsed==='string'?[parsed]:Array.isArray(parsed)?parsed:[];
 }
 if(platform==='darwin'){
  const entries=await fs.readdir('/Volumes',{withFileTypes:true}),volumes=[],started=Date.now();let partial=entries.length>64;
  for(const entry of entries.slice(0,64)){
   checkpoint(checkActive,signal);if(Date.now()-started>=8000){partial=true;break;}
   if(!entry.isDirectory()||entry.isSymbolicLink())continue;const volume=path.join('/Volumes',entry.name);
   try{const {stdout}=await execFile('/usr/sbin/diskutil',['info','-plist',volume],{timeout:3000,maxBuffer:128*1024,signal});
    // diskutil rejects network mounts. Require a local device node and mounted
    // filesystem; no shell parsing of arbitrary volume names is involved.
    if(/<key>DeviceNode<\/key>\s*<string>\/dev\/disk[^<]+<\/string>/.test(stdout)&&/<key>Mounted<\/key>\s*<true\s*\/>/.test(stdout))volumes.push(volume);
   }catch{checkpoint(checkActive,signal);}
  }return{paths:volumes,partial};
 }
 return[];
}
/** Home and native local/removable volumes only; no elevation/network mounts. */
async function computerRoots({home,platform=process.platform,listVolumes=localVolumes,checkActive,signal}={}){
 if(typeof checkActive!=='function')throw Error('A native authorization check is required.');checkpoint(checkActive,signal);
 const roots=[],issues=[];let supplied=[];
 try{supplied=await listVolumes(platform,{signal,checkActive});checkpoint(checkActive,signal);if(!Array.isArray(supplied)&&Array.isArray(supplied?.paths)){if(supplied.partial)issues.push({name:'Local volumes',error:'Some local volumes could not be listed; the home folder is still available.'});supplied=supplied.paths;}}catch(error){checkpoint(checkActive,signal);issues.push({name:'Local volumes',error:'Some local volumes could not be listed; the home folder is still available.'});}
 if(!Array.isArray(supplied)||supplied.length>64)throw Error('The native volume list is invalid.');
 // The OS home path may itself contain the platform /var alias. Resolve that
 // trusted OS value once; discovered descendants still cannot follow links.
 const canonicalHome=await fs.realpath(nativePath(home));
 const extra=[];if(platform==='darwin')for(const value of [path.join(canonicalHome,'Library','Mobile Documents'),'/Users']){try{await fs.access(value,constants.R_OK);const selected=await physical(value);if(selected.stat.isDirectory())extra.push(selected.path);}catch{checkpoint(checkActive,signal);}}
 for(const value of [canonicalHome,...extra,...supplied]){checkpoint(checkActive,signal);try{const selected=await physical(value);if(selected.stat.isDirectory()&&!roots.some(root=>key(root)===key(selected.path)))roots.push(selected.path);}catch(error){checkpoint(checkActive,signal);issues.push({name:path.basename(String(value)),error:'This local folder is unavailable or linked.'});}}
 return{roots,issues};
}
module.exports={scanPresentations,computerRoots,fingerprint,physical,nativePath,pathId,inside,covers,checkpoint,MAX_BYTES,DEFAULTS};
