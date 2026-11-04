'use strict';
const fs=require('node:fs/promises'),syncFs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Transform}=require('node:stream'),{pipeline}=require('node:stream/promises'),JSZip=require('jszip');
const {walk}=require('./library.cjs'),{idFor}=require('./song-catalog.cjs');
const {validateServiceArrangement}=require('../src/shared/service-arrangement.js');
const HASH=/^[a-f0-9]{64}$/,MAX_FILE=50*1024*1024,MAX_TOTAL=500*1024*1024;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
const stopped=()=>Object.assign(Error('Service package export stopped. Your existing files were kept.'),{code:'ABORTED'});
function safeName(value){let name=String(value).normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/g,'').slice(0,130).replace(/[\uD800-\uDBFF]$/,'');if(!name)name='File';if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))name='_'+name;return name;}
function safeFile(value){const ext=path.extname(value).toLowerCase();return safeName(path.basename(value,ext))+ext;}
function resourceWarning(bytes,extension){
 if(extension==='.txt')return false;
 if(extension!=='.pro')return true;
 // Preserve native bytes exactly; a linked-media presentation needs its
 // resources imported separately on the other PC. Never label that ZIP complete.
 try{const pending=[require('./presentation.cjs').decode(bytes)];let visited=0;
  while(pending.length){const value=pending.pop();if(++visited>200000)return true;if(!value||typeof value!=='object')continue;
   if(typeof value.absoluteString==='string'&&value.absoluteString||typeof value.relativePath==='string'&&value.relativePath||value.local&&typeof value.local.path==='string'&&value.local.path||value.external&&typeof value.external.path==='string'&&value.external.path)return true;
   for(const entry of Object.values(value))if(entry&&typeof entry==='object')pending.push(entry);
  }return false;
 }catch{return true;}
}
function checkedPlan(plan){
 if(!plan||typeof plan.title!=='string'||!plan.title.trim()||plan.title.length>80||!/^\d{4}-\d{2}-\d{2}$/.test(plan.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.time)||typeof plan.notes!=='string'||plan.notes.length>5000||!Array.isArray(plan.songs)||plan.songs.length>1000||!Array.isArray(plan.tasks)||plan.tasks.length>50)throw Error('Choose a valid saved service before exporting.');
 for(const song of plan.songs)if(!song||!HASH.test(song.songId)||!HASH.test(song.contentHash)||typeof song.title!=='string'||song.title.length>300||typeof song.filename!=='string'||song.filename.length>255)throw Error('The saved service contains an invalid song reference.');
 for(const song of plan.songs)validateServiceArrangement(song.arrangement);
 for(const task of plan.tasks)if(!task||typeof task.text!=='string'||task.text.length>120||typeof task.done!=='boolean')throw Error('The saved service checklist is invalid.');
 const day=new Date(plan.date+'T00:00:00Z');if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==plan.date)throw Error('Choose a valid service date.');
 return {title:plan.title,date:plan.date,time:plan.time,notes:plan.notes,tasks:plan.tasks.map(({text,done})=>({text,done})),songs:plan.songs.map(({songId,contentHash,title,filename,reviewed,arrangement})=>({songId,contentHash,title,filename,reviewed:reviewed===true,...(arrangement?{arrangement:validateServiceArrangement(arrangement)}:{})}))};
}
async function readOriginal(file,check,root){
 await check();const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.size<=0||before.size>MAX_FILE)throw Error('Choose a non-empty regular file up to 50 MB.');
 const actual=await fs.realpath(file);if(root&&(!actual.startsWith(root+path.sep)||actual!==path.resolve(file)))throw Error('The song location changed or is outside Lyrics.');
 const input=await fs.open(actual,syncFs.constants.O_RDONLY|(syncFs.constants.O_NOFOLLOW||0));
 try{
  const opened=await input.stat();if(!same(before,opened))throw Error('The selected file changed.');
  const chunks=[];let total=0;const buffer=Buffer.allocUnsafe(64*1024);
  while(true){await check();const result=await input.read(buffer,0,buffer.length,total);if(!result.bytesRead)break;total+=result.bytesRead;if(total>MAX_FILE)throw Error('The selected file is too large.');chunks.push(Buffer.from(buffer.subarray(0,result.bytesRead)));}
  await check();if(total!==before.size||!same(before,await input.stat())||!same(before,await fs.lstat(file))||await fs.realpath(file)!==actual)throw Error('The selected file changed while being read.');
  return Buffer.concat(chunks,total);
 }finally{await input.close();}
}
async function exportServicePackage({plan,directory,audioPaths=[],destination,checkActive=()=>{},signal}={}){
 const service=checkedPlan(plan),check=async()=>{if(signal?.aborted)throw stopped();try{await checkActive();}catch(cause){throw Object.assign(stopped(),{cause});}if(signal?.aborted)throw stopped();};
 if(typeof destination!=='string'||!path.isAbsolute(destination)||destination.includes('\0')||path.extname(destination).toLowerCase()!=='.zip')throw Error('Choose a ZIP destination for this service package.');
 if(!Array.isArray(audioPaths)||audioPaths.length>100||audioPaths.some(file=>typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0')||path.extname(file).toLowerCase()!=='.mp3'))throw Error('Choose up to 100 original MP3 files for this export.');
 await check();const parent=await fs.realpath(path.dirname(destination));destination=path.join(parent,path.basename(destination));
 if(await fs.lstat(destination).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw Error('A file already exists here. Choose a new filename to preserve it.');
 const zip=new JSZip(),missing=[],songs=[],audio=[],warnings=[],files=new Map();let totalBytes=0;
 const add=(name,bytes)=>{totalBytes+=bytes.length;if(totalBytes>MAX_TOTAL)throw Error('Export up to 500 MB of songs and MP3s at a time.');zip.file(name,bytes,{binary:true,date:new Date('2000-01-01T00:00:00Z')});};
 let root,locations=new Map();
 if(service.songs.length){try{root=await fs.realpath(directory);locations=new Map((await walk(root)).map(file=>[idFor(path.relative(root,file),root),file]));}catch(error){await check();warnings.push('The Lyrics library could not be opened; song files are listed as missing.');}}
 for(const [index,song]of service.songs.entries()){
  await check();const position=index+1,file=locations.get(song.songId),key=song.songId+':'+song.contentHash,entry={position,title:song.title,filename:song.filename,reviewed:song.reviewed,sha256:song.contentHash,...(song.arrangement?{arrangement:structuredClone(song.arrangement)}:{})};
  if(files.has(key)){songs.push({...entry,path:files.get(key)});continue;}
  if(!file){const absent={position,title:song.title,filename:song.filename,reason:'The saved song is unavailable in Lyrics.'};missing.push(absent);songs.push({...entry,path:null,missing:absent.reason});continue;}
  try{
   const bytes=await readOriginal(file,check,root);if(digest(bytes)!==song.contentHash)throw Error('The song changed since it was added to this service. Refresh its reference before exporting.');
   const name='Songs/'+String(position).padStart(3,'0')+'-'+safeFile(file);add(name,bytes);files.set(key,name);songs.push({...entry,path:name});
   if(resourceWarning(bytes,path.extname(file).toLowerCase()))warnings.push(song.title+': linked media or legacy presentation resources could not be packaged. Import the original resources separately and verify this presentation on the other computer.');
  }catch(error){if(error.code==='ABORTED')throw error;await check();if(totalBytes>MAX_TOTAL)throw error;const absent={position,title:song.title,filename:song.filename,reason:error.message||'The saved song could not be read.'};missing.push(absent);songs.push({...entry,path:null,missing:absent.reason});}
 }
 const seenAudio=new Set();
 for(const file of audioPaths){
  await check();const actual=await fs.realpath(file);if(seenAudio.has(actual))continue;const bytes=await readOriginal(file,check);const detected=await (await import('file-type')).fileTypeFromBuffer(bytes.subarray(0,4100));await check();if(detected?.ext!=='mp3')throw Error('“'+path.basename(file)+'” is not a supported MP3. Choose its original MP3 file.');
  seenAudio.add(actual);const name='Audio/'+String(audio.length+1).padStart(3,'0')+'-'+safeFile(file);add(name,bytes);audio.push({position:audio.length+1,filename:path.basename(file),path:name,bytes:bytes.length,sha256:digest(bytes)});
 }
 const manifest={format:'stati-service-package',version:1,service:{title:service.title,date:service.date,time:service.time,notes:service.notes,tasks:service.tasks},songs,audio,missing,warnings,complete:missing.length===0&&warnings.length===0};
 zip.file('service.json',JSON.stringify(manifest,null,2)+'\n');
 zip.file('Service order.txt',service.title+'\n'+service.date+' '+service.time+'\n\n'+songs.map(song=>song.position+'. '+song.title+'\n   '+(song.path||'MISSING: '+song.missing)).join('\n')+'\n\nNOTES\n'+service.notes+'\n');
 zip.file('README.txt','Stați portable service package\n\nExtract this ZIP before opening its files. Songs contains byte-identical saved presentations/lyrics in service order. Audio contains only the MP3s chosen for this export; they are not automatically matched to songs. service.json records order, service-only arrangements, notes, hashes and missing-file warnings. Original song files retain their library order; Stați restores each service arrangement when importing this package.\n\nImport .pro songs into the appropriate ProPresenter library. Import Audio MP3s manually into Audio → Playback. Text lyrics need review/conversion. This package does not create a ProPresenter playlist, run macros, import automatically or start playback.\n\nMissing songs: '+missing.length+'. Check service.json before using this package. A complete file package does not establish that the service or display outputs have been reviewed.\n\nAccount credentials, device settings and private recovery history are excluded.\n');
 const temporary=path.join(parent,'.stati-service-package-'+crypto.randomUUID()+'.tmp');let targetIdentity=null,published=false,archiveBytes=0;const hash=crypto.createHash('sha256');
 try{
  await check();const gate=new Transform({transform(chunk,_encoding,done){check().then(()=>{archiveBytes+=chunk.length;if(archiveBytes>MAX_TOTAL+10*1024*1024)throw Error('The service package is too large.');hash.update(chunk);done(null,chunk);}).catch(done);}});
  await pipeline(zip.generateNodeStream({type:'nodebuffer',streamFiles:true,compression:'STORE'}),gate,syncFs.createWriteStream(temporary,{flags:'wx',mode:0o600}));
  const staged=await fs.open(temporary,'r+');try{await staged.sync();}finally{await staged.close();}await check();
  try{await fs.link(temporary,destination);targetIdentity=await fs.lstat(temporary);published=true;}
  catch(error){if(error.code==='EEXIST')throw Error('A file already exists here. Choose a new filename to preserve it.');if(!['ENOTSUP','EOPNOTSUPP','EPERM','EXDEV'].includes(error.code))throw error;
   await check();let copied;try{copied=await fs.open(destination,'wx',0o600);}catch(copyError){if(copyError.code==='EEXIST')throw Error('A file already exists here. Choose a new filename to preserve it.');throw copyError;}
   targetIdentity=await copied.stat();published=true;let original;
   try{original=await fs.open(temporary,'r');let position=0;const buffer=Buffer.allocUnsafe(64*1024);while(true){await check();const {bytesRead}=await original.read(buffer,0,buffer.length,position);if(!bytesRead)break;let written=0;while(written<bytesRead){const output=await copied.write(buffer,written,bytesRead-written,position+written);if(!output.bytesWritten)throw Error('The exported package could not be copied.');written+=output.bytesWritten;}position+=bytesRead;}if(position!==archiveBytes)throw Error('The staged package changed.');await copied.sync();}finally{await original?.close();await copied.close();}
  }
  await check();const end=await fs.lstat(destination);if(!end.isFile()||end.isSymbolicLink()||end.dev!==targetIdentity.dev||end.ino!==targetIdentity.ino||end.size!==archiveBytes)throw Error('The exported package changed before it could be confirmed.');
  return{path:destination,filename:path.basename(destination),bytes:archiveBytes,songCount:files.size,audioCount:audio.length,missing,warnings,complete:manifest.complete,sha256:hash.digest('hex')};
 }catch(error){if(published&&targetIdentity){const current=await fs.lstat(destination).catch(()=>null);if(current?.dev===targetIdentity.dev&&current?.ino===targetIdentity.ino)await fs.unlink(destination).catch(()=>{});}throw error;}
 finally{await fs.unlink(temporary).catch(()=>{});}
}
module.exports={exportServicePackage,safeName};
