'use strict';
// Native-only conversion relationships. An existing file can be linked for
// deduplication, but only files created by this module gain replacement rights.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {fingerprint,physical,nativePath,pathId,inside,covers,checkpoint,MAX_BYTES,DEFAULTS}=require('./presentation-scan.cjs');
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9-]{36}$/i,MAX_STATE=16*1024*1024,MAX_SOURCES=10000,MAX_LINKS=20000,MAX_EVENTS=2000;
const locks=new Map(),digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fail(message){throw Error(message);}
function direction(value){if(!['to-pro','to-pptx'].includes(value))fail('Choose a supported conversion direction.');return value;}
function filename(value,kind){if(typeof value!=='string'||!value||value.length>180||value!==path.basename(value)||/[<>:"/\\|?*\x00-\x1f\x7f]/.test(value)||value.startsWith('.')||/[. ]$/.test(value)||path.extname(value).toLowerCase()!==(kind==='to-pro'?'.pro':'.pptx')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))fail('Choose a valid presentation filename.');return value;}
async function serial(key,work){const previous=locks.get(key)||Promise.resolve();let release;const gate=new Promise(resolve=>{release=resolve;});const next=previous.catch(()=>{}).then(()=>gate);locks.set(key,next);await previous.catch(()=>{});try{return await work();}finally{release();if(locks.get(key)===next)locks.delete(key);}}
async function exists(file){try{return await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function openPresentationLedger({directory,sourceRoots,outputRoots,checkActive,validateReplacement,diskReserve=require('./disk-reserve.cjs').downloadDiskReserve}={}){
 if(typeof checkActive!=='function')fail('A native authorization check is required.');
 const check=signal=>checkpoint(checkActive,signal),root=nativePath(directory),parent=await physical(path.dirname(root));check();
 if(!parent.stat.isDirectory())fail('The private presentation history folder is unavailable.');
 try{await fs.mkdir(root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const store=await physical(root);if(!store.stat.isDirectory())fail('The private presentation history folder is unavailable.');
 async function checkedRoots(values){if(!Array.isArray(values)||!values.length||values.length>64)fail('Choose native presentation folders first.');const approved=[];for(const value of values){const info=await physical(value);check();if(!info.stat.isDirectory())fail('Choose native presentation folders first.');approved.push(info.path);}return approved;}
 const sourcesAllowed=await checkedRoots(sourceRoots),targetsAllowed=await checkedRoots(outputRoots),stateFile=path.join(root,'relationships.json');
 const allowed=(file,roots)=>roots.some(folder=>inside(folder,file));
 const empty=()=>({version:1,sources:{},links:{},events:[],pending:[]});
 function event(state,kind,source,extra={}){state.events.push({id:crypto.randomUUID(),kind,sourceId:source.id,name:path.basename(source.path),format:path.extname(source.path).toLowerCase(),time:Date.now(),...extra});if(state.events.length>MAX_EVENTS)state.events.splice(0,state.events.length-MAX_EVENTS);}
 function validate(state){
  if(!state||state.version!==1||!state.sources||!state.links||!Array.isArray(state.events)||!Array.isArray(state.pending)||Object.keys(state.sources).length>MAX_SOURCES||Object.keys(state.links).length>MAX_LINKS||state.events.length>MAX_EVENTS||state.pending.length>1)fail('Presentation history could not be verified. Existing files were kept.');
  for(const [id,item] of Object.entries(state.sources))if(!item||id!==item.id||!HASH.test(id)||nativePath(item.path)!==item.path||pathId(item.path)!==id||!HASH.test(item.sha256))fail('Presentation history contains an invalid source. Existing files were kept.');
  for(const [id,item] of Object.entries(state.links))if(!item||id!==item.id||!UUID.test(id)||!state.sources[item.sourceId]||!HASH.test(item.sourceHash)||!HASH.test(item.targetHash)||nativePath(item.targetPath)!==item.targetPath||!['to-pro','to-pptx'].includes(item.direction)||typeof item.owned!=='boolean'||item.twoWay!==undefined&&typeof item.twoWay!=='boolean'||item.twoWay===true&&(!Number.isSafeInteger(item.consentAt)||item.consentAt<=0))fail('Presentation history contains an invalid relationship. Existing files were kept.');
  for(const item of state.pending)if(!item||!UUID.test(item.id)||!state.sources[item.sourceId]||!item.link||item.link.id!==item.id||item.link.sourceId!==item.sourceId||item.link.twoWay!==undefined&&typeof item.link.twoWay!=='boolean'||item.link.twoWay===true&&(!Number.isSafeInteger(item.link.consentAt)||item.link.consentAt<=0)||!HASH.test(item.link.targetHash)||!HASH.test(item.link.sourceHash)||(!item.link.owned&&item.link.twoWay!==true)||!['to-pro','to-pptx'].includes(item.link.direction)||nativePath(item.link.targetPath)!==item.link.targetPath||path.dirname(item.temporary)!==path.dirname(item.side==='source'?state.sources[item.sourceId].path:item.link.targetPath)||!/^\.stati-sync-[a-f0-9-]{36}\.tmp$/.test(path.basename(item.temporary)))fail('Presentation recovery data could not be verified. Existing files were kept.');
  return state;
 }
 async function load(){if(!await exists(stateFile))return empty();const saved=await fingerprint(stateFile,{checkActive,maxBytes:MAX_STATE,includeBytes:true});return validate(JSON.parse(saved.data.toString('utf8')));}
 async function save(state){
  const json=Buffer.from(JSON.stringify(validate(state)));if(json.length>MAX_STATE)fail('Presentation history is full. Existing files were kept.');
  const current=await physical(root);if(!current.stat.isDirectory()||current.stat.dev!==store.stat.dev||current.stat.ino!==store.stat.ino)fail('The presentation history folder changed.');
  const temporary=path.join(root,'.state-'+crypto.randomUUID()+'.tmp');let handle;
  const lease=await diskReserve.acquire(root,json.length);try{handle=await fs.open(temporary,'wx',0o600);await lease.write(json.length,()=>handle.writeFile(json));await handle.sync();await lease.check();await handle.close();handle=null;await fs.rename(temporary,stateFile);}finally{await handle?.close();await fs.unlink(temporary).catch(()=>{});await lease.release();}
 }
 async function inspect(file,signal,includeBytes=false){return fingerprint(file,{checkActive,signal,includeBytes});}
 async function tidyPending(state,signal){
  if(!state.pending.length)return false;const pending=state.pending[0],source=state.sources[pending.sourceId],link=pending.link,destination=pending.side==='source'?source.path:link.targetPath,expected=pending.side==='source'?link.sourceHash:link.targetHash;
  // Recovery reconciles an already committed write; it never resumes a write
  // after a canceled/interrupted job or acquires authority from a stored path.
  if(!allowed(destination,pending.side==='source'?sourcesAllowed:targetsAllowed))fail('Choose the previous output folder to recover this interrupted conversion.');
  let target;try{target=await inspect(destination,signal);}catch(error){check(signal);if(error.code!=='ENOENT')throw error;}
  if(target?.sha256===expected&&target.identity.dev===pending.tempIdentity?.dev&&target.identity.ino===pending.tempIdentity?.ino){state.links[link.id]=link;if(pending.side){const latestSource=pending.side==='source'?target:await inspect(source.path,signal);Object.assign(source,{sha256:latestSource.sha256,bytes:latestSource.bytes,modifiedAt:latestSource.modifiedAt,missing:false,unreadable:false});}event(state,'recovered',source,{linkId:link.id,targetName:path.basename(link.targetPath)});}
  else event(state,target&&target.sha256!==pending.previousHash?'conflict':'interrupted',source,{linkId:link.id,targetName:path.basename(link.targetPath)});
  const temp=await exists(pending.temporary);if(temp&&!temp.isSymbolicLink()&&temp.isFile()&&temp.dev===pending.tempIdentity?.dev&&temp.ino===pending.tempIdentity?.ino)await fs.unlink(pending.temporary);
  state.pending=[];await save(state);return true;
 }
 async function run(signal,work){check(signal);return serial(root,async()=>{check(signal);const state=await load();await tidyPending(state,signal);check(signal);return work(state);});}
 async function sourceFor(state,id,expectedHash,kind,signal){
  if(!HASH.test(id||'')||!HASH.test(expectedHash||''))fail('Choose a current scanned presentation.');const source=state.sources[id];if(!source||!allowed(source.path,sourcesAllowed))fail('This presentation is outside the native scan folders.');
  const ext=path.extname(source.path).toLowerCase();if(kind==='to-pro'&&!['.ppt','.pptx'].includes(ext)||kind==='to-pptx'&&!['.pro','.pro6'].includes(ext))fail('This source does not match the conversion direction.');
  const current=await inspect(source.path,signal);check(signal);if(current.sha256!==expectedHash||source.sha256!==expectedHash)fail('This source changed. Scan again before converting it.');return{source,current};
 }
 async function observe({files,completedRoots=[],extensions=['.ppt','.pptx'],signal}={}){return run(signal,async state=>{
  if(!Array.isArray(files)||files.length>MAX_SOURCES||!Array.isArray(completedRoots)||completedRoots.some(folder=>!sourcesAllowed.some(root=>inside(root,nativePath(folder))))||!Array.isArray(extensions)||extensions.some(ext=>!['.ppt','.pptx','.pro','.pro6'].includes(ext)))fail('Use the native presentation scanner before updating history.');
  const seen=new Set();for(const file of files){check(signal);if(!file||!HASH.test(file.sha256||'')||!HASH.test(file.id||'')||file.id!==pathId(file.path)||!allowed(file.path,sourcesAllowed)||!['.ppt','.pptx','.pro','.pro6'].includes(path.extname(file.path).toLowerCase()))fail('Use the native presentation scanner before updating history.');
   const live=await physical(file.path);check(signal);if(!live.stat.isFile()||live.stat.size!==file.bytes||live.stat.mtimeMs!==file.modifiedAt||live.stat.dev!==file.identity?.dev||live.stat.ino!==file.identity?.ino||live.stat.ctimeMs!==file.identity?.ctimeMs)fail('A scanned presentation changed. Scan again before updating history.');
   seen.add(file.id);const previous=state.sources[file.id];if(!previous&&Object.keys(state.sources).length>=MAX_SOURCES)fail('Presentation history has reached its source limit.');
   const source={id:file.id,path:file.path,sha256:file.sha256,bytes:file.bytes,modifiedAt:file.modifiedAt,seenAt:Date.now(),missing:false};
   if(!previous)event(state,'found',source,{hash:file.sha256});else if(previous.sha256!==file.sha256)event(state,'source-changed',source,{previousHash:previous.sha256,hash:file.sha256});else if(previous.missing)event(state,'source-returned',source,{hash:file.sha256});state.sources[file.id]=source;
  }
  for(const source of Object.values(state.sources))if(!source.missing&&!seen.has(source.id)&&extensions.includes(path.extname(source.path).toLowerCase())&&completedRoots.some(root=>covers(root,source.path))){source.missing=true;event(state,'source-missing',source);}
  check(signal);await save(state);check(signal);return{scanned:files.length,sources:Object.keys(state.sources).length};
 });}
 async function changes({offset=0,limit=50,signal}={}){return run(signal,async state=>{if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)fail('Choose a valid history page.');check(signal);return{total:state.events.length,items:state.events.slice().reverse().slice(offset,offset+limit).map(item=>({...item}))};});}
 async function refreshSources({signal,onProgress=()=>{},limits={}}={}){return run(signal,async state=>{
  const bound={maxFiles:DEFAULTS.maxFiles,maxTotalBytes:DEFAULTS.maxTotalBytes,maxDurationMs:DEFAULTS.maxDurationMs,...limits};for(const name of Object.keys(bound))if(!['maxFiles','maxTotalBytes','maxDurationMs'].includes(name)||!Number.isSafeInteger(bound[name])||bound[name]<1||bound[name]>DEFAULTS[name])fail('Choose bounded source refresh limits.');
  const started=Date.now(),result={scanned:0,changed:0,missing:0,unreadable:0,unavailable:0,complete:true,reason:null};let bytes=0;
  for(const source of Object.values(state.sources)){
   check(signal);if(!allowed(source.path,sourcesAllowed)){result.unavailable++;continue;}
   if(result.scanned>=bound.maxFiles||Date.now()-started>=bound.maxDurationMs){result.complete=false;result.reason=result.scanned>=bound.maxFiles?'file-limit':'time-limit';break;}
   try{
    const visible=await physical(source.path);check(signal);if(bytes+visible.stat.size>bound.maxTotalBytes){result.complete=false;result.reason='byte-limit';break;}
    const current=await inspect(source.path,signal);bytes+=current.bytes;result.scanned++;
    if(source.sha256!==current.sha256){event(state,'source-changed',source,{previousHash:source.sha256,hash:current.sha256});result.changed++;}
    else if(source.missing)event(state,'source-returned',source,{hash:current.sha256});else if(source.unreadable)event(state,'source-readable',source,{hash:current.sha256});
    Object.assign(source,{sha256:current.sha256,bytes:current.bytes,modifiedAt:current.modifiedAt,seenAt:Date.now(),missing:false,unreadable:false});
   }catch(error){
    check(signal);result.scanned++;const missing=error.code==='ENOENT',kind=missing?'source-missing':'source-unreadable';if(missing){result.missing++;if(!source.missing)event(state,kind,source);source.missing=true;source.unreadable=false;}
    else{result.unreadable++;if(!source.unreadable)event(state,kind,source);source.unreadable=true;source.missing=false;}
   }
   try{onProgress({...result,name:path.basename(source.path)});}catch{}
  }
  check(signal);await save(state);check(signal);return result;
 });}
 async function resolveSource(id,{signal}={}){return run(signal,async state=>{if(!HASH.test(id||''))fail('Choose a scanned presentation.');const source=state.sources[id];if(!source||!allowed(source.path,sourcesAllowed))fail('This presentation is outside the native scan folders.');const current=await inspect(source.path,signal);check(signal);if(source.sha256!==current.sha256)fail('This source changed. Scan again before converting it.');return{...current};});}
 async function linkExisting({sourceId,expectedSourceHash,targetPath,expectedTargetHash,direction:kind,recipeHash=null,signal}={}){return run(signal,async state=>{
  direction(kind);const {source}=await sourceFor(state,sourceId,expectedSourceHash,kind,signal),target=await inspect(nativePath(targetPath),signal);if(!allowed(target.path,targetsAllowed)||!HASH.test(expectedTargetHash||'')||target.sha256!==expectedTargetHash||path.extname(target.path).toLowerCase()!==(kind==='to-pro'?'.pro':'.pptx')||recipeHash!==null&&!HASH.test(recipeHash))fail('The matching presentation changed. Existing files were kept.');
  const prior=Object.values(state.links).find(link=>link.sourceId===sourceId&&link.targetPath===target.path&&link.direction===kind);if(prior){if(prior.targetHash!==expectedTargetHash)fail('This relationship already contains a different output version. Existing files were kept.');if(prior.sourceHash!==expectedSourceHash){prior.sourceHash=expectedSourceHash;prior.updatedAt=Date.now();event(state,'linked',source,{linkId:prior.id,targetName:path.basename(target.path)});check(signal);await save(state);check(signal);}return{id:prior.id,status:'unchanged',name:path.basename(target.path)};}
  if(Object.keys(state.links).length>=MAX_LINKS)fail('Presentation history has reached its relationship limit.');const link={id:crypto.randomUUID(),sourceId,sourceHash:expectedSourceHash,targetPath:target.path,targetHash:expectedTargetHash,direction:kind,recipeHash,owned:false,createdAt:Date.now(),updatedAt:Date.now()};state.links[link.id]=link;event(state,'linked',source,{linkId:link.id,targetName:path.basename(target.path)});check(signal);await save(state);check(signal);return{id:link.id,status:'linked',name:path.basename(target.path)};
 });}
 async function backup(link,original){
  const backups=path.join(root,'backups');try{await fs.mkdir(backups,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}const info=await physical(backups);if(!info.stat.isDirectory())fail('The recovery folder is unavailable.');
  const target=path.join(backups,pathId(link.targetPath)+'-'+original.sha256+'.bin');
  if(await exists(target)){const verified=await inspect(target);if(verified.sha256!==original.sha256)fail('The recovery copy could not be verified. Existing files were kept.');return target;}
  const lease=await diskReserve.acquire(backups,original.data.length);let handle,created,complete=false;
  try{handle=await fs.open(target,'wx',0o600);created=await handle.stat();await lease.write(original.data.length,()=>handle.writeFile(original.data));await handle.sync();await lease.check();await handle.close();handle=null;const verified=await inspect(target);if(verified.sha256!==original.sha256)fail('The recovery copy could not be verified.');complete=true;return target;}
  finally{await handle?.close();if(created&&!complete){const current=await exists(target);if(current&&!current.isSymbolicLink()&&current.dev===created.dev&&current.ino===created.ino)await fs.unlink(target).catch(()=>{});}await lease.release();}
 }
 async function writeConversion({sourceId,expectedSourceHash,outputRoot,filename:requested,bytes,direction:kind,recipeHash=null,signal}={}){return run(signal,async state=>{
  direction(kind);filename(requested,kind);if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_BYTES||recipeHash!==null&&!HASH.test(recipeHash))fail('The generated presentation is invalid or too large.');
  const {source}=await sourceFor(state,sourceId,expectedSourceHash,kind,signal),chosen=await physical(nativePath(outputRoot));if(!chosen.stat.isDirectory()||!targetsAllowed.includes(chosen.path))fail('Choose a native output folder for this conversion.');
  const links=Object.values(state.links).filter(link=>link.sourceId===sourceId&&link.direction===kind&&path.dirname(link.targetPath)===chosen.path);if(links.length>1)fail('This source has multiple output relationships. Choose one explicitly before resyncing.');
  const previous=links[0];let old,targetPath=previous?.targetPath,temporary,tempIdentity,journaled=false,committed=false,writeLease;
  async function conflict(message){event(state,'conflict',source,{...(previous?{linkId:previous.id,targetName:path.basename(previous.targetPath)}:{}),message});check(signal);await save(state);check(signal);return{id:previous?.id,status:'conflict',name:previous?path.basename(previous.targetPath):requested,error:message};}
  if(previous){
   try{old=await inspect(previous.targetPath,signal,true);}catch(error){check(signal);if(error.code==='ENOENT')return conflict('The linked output is missing. It was not recreated automatically.');throw error;}
   if(old.sha256!==previous.targetHash)return conflict('The output was edited outside this conversion. Its changes were kept.');
   if(previous.sourceHash===expectedSourceHash&&previous.recipeHash===recipeHash)return{id:previous.id,status:'unchanged',name:path.basename(previous.targetPath),path:previous.targetPath,sha256:previous.targetHash};
   if(previous.twoWay)return conflict('This pair uses two-way text synchronization. Check linked files instead; its existing layout was kept.');
   if(!previous.owned||Object.values(state.links).some(link=>link.id!==previous.id&&link.targetPath===previous.targetPath))return conflict('This existing output is shared or was not created by this conversion. It was kept.');
   if(kind==='to-pro'&&typeof validateReplacement!=='function')return conflict('ProPresenter identity validation is required before replacing this song.');
   if(typeof validateReplacement==='function'){await validateReplacement({direction:kind,oldBytes:old.data,newBytes:bytes});check(signal);}
  }
  if(!previous&&Object.keys(state.links).length>=MAX_LINKS)fail('Presentation history has reached its relationship limit.');
  try{
   writeLease=await diskReserve.acquire(chosen.path,bytes.length);temporary=path.join(chosen.path,'.stati-sync-'+crypto.randomUUID()+'.tmp');writeLease=writeLease||await diskReserve.acquire(path.dirname(temporary),bytes.length);const handle=await fs.open(temporary,'wx',0o600);try{const info=await handle.stat();tempIdentity={dev:info.dev,ino:info.ino};await writeLease.write(bytes.length,()=>handle.writeFile(bytes));await handle.sync();await writeLease.check();}finally{await handle.close();}check(signal);
   const staged=await inspect(temporary,signal);if(staged.sha256!==digest(bytes))fail('The generated presentation changed while preparing it.');
   if(!targetPath){const names=await fs.readdir(chosen.path);if(names.length>20000)fail('Choose an output folder with fewer than 20,000 files.');const taken=new Set(names.map(name=>name.normalize('NFC').toLowerCase())),parsed=path.parse(requested);for(let suffix=0;suffix<10000;suffix++){const name=suffix?parsed.name+' ('+(suffix+1)+')'+parsed.ext:requested;if(!taken.has(name.normalize('NFC').toLowerCase())){targetPath=path.join(chosen.path,name);break;}}if(!targetPath)fail('Could not choose a new output filename. Existing files were kept.');}
   const kept=previous?await backup(previous,old):null;check(signal);
   const link={id:previous?.id||crypto.randomUUID(),sourceId,sourceHash:expectedSourceHash,targetPath,targetHash:staged.sha256,direction:kind,recipeHash,owned:true,createdAt:previous?.createdAt||Date.now(),updatedAt:Date.now()};
   state.pending=[{id:link.id,sourceId,link,temporary,tempIdentity,previousHash:previous?.targetHash||null,backup:kept}];check(signal);await save(state);journaled=true;
   // Rehash both endpoints after all worker, backup and journal awaits. There
   // is no renderer path authority and no title-based overwrite fallback.
   const sourceNow=await inspect(source.path,signal);if(sourceNow.sha256!==expectedSourceHash)fail('The source changed during conversion. Existing files were kept.');
   const folderNow=await physical(chosen.path);if(folderNow.stat.dev!==chosen.stat.dev||folderNow.stat.ino!==chosen.stat.ino)fail('The output folder changed during conversion.');
   if(previous){const latest=await inspect(targetPath,signal);if(latest.sha256!==previous.targetHash||latest.identity.dev!==old.identity.dev||latest.identity.ino!==old.identity.ino)fail('The output changed during conversion. Its changes were kept.');check(signal);await fs.rename(temporary,targetPath);committed=true;temporary=null;}
   else{check(signal);await fs.link(temporary,targetPath);committed=true;await fs.unlink(temporary);temporary=null;}
   state.links[link.id]=link;state.pending=[];event(state,previous?'resynced':'converted',source,{linkId:link.id,targetName:path.basename(targetPath),previousHash:previous?.targetHash||null,hash:link.targetHash});
   // Metadata completes an accepted filesystem commit even if authority ends
   // immediately afterward. The caller's late response remains fenced below.
   await save(state);journaled=false;check(signal);return{id:link.id,status:previous?'resynced':'created',name:path.basename(targetPath),path:targetPath,sha256:link.targetHash,...(kept?{backup:kept}:{})};
  }catch(error){if(journaled&&!committed){state.pending=[];await save(state);journaled=false;}throw error;}
  finally{if(temporary&&!journaled){const current=await exists(temporary);if(current&&!current.isSymbolicLink()&&current.dev===tempIdentity?.dev&&current.ino===tempIdentity?.ino)await fs.unlink(temporary).catch(()=>{});}await writeLease?.release();}
 });}
 async function inspectOutputs({signal}={}){return run(signal,async state=>{
  let count=0;for(const link of Object.values(state.links)){check(signal);if(!allowed(link.targetPath,targetsAllowed))continue;const source=state.sources[link.sourceId];let status='ready',hash=null;try{const target=await inspect(link.targetPath,signal);hash=target.sha256;if(hash!==link.targetHash)status='changed';}catch(error){check(signal);if(error.code==='ENOENT')status='missing';else status='unreadable';}
   if(status!=='ready'&&(link.observedStatus!==status||link.observedHash!==hash)){event(state,'output-'+status,source,{linkId:link.id,targetName:path.basename(link.targetPath),hash});count++;}link.observedStatus=status;link.observedHash=hash;
  }check(signal);await save(state);check(signal);return{changes:count};
 });}
 async function resync({id,build,signal,recipeHash}={}){
  if(!UUID.test(id||'')||typeof build!=='function')fail('Choose a linked conversion to resync.');
  // Worker/extraction runs outside the serialization lock. Both endpoints are
  // checked again by writeConversion after it returns, including source bytes.
  const selected=await run(signal,async state=>{const link=state.links[id];if(!link)fail('This conversion relationship is unavailable.');const current=await sourceFor(state,link.sourceId,state.sources[link.sourceId].sha256,link.direction,signal);return{link:{...link},source:{...current.current}};});
  const generated=await build({source:selected.source,direction:selected.link.direction,targetPath:selected.link.targetPath});check(signal);
  return writeConversion({sourceId:selected.link.sourceId,expectedSourceHash:selected.source.sha256,outputRoot:path.dirname(selected.link.targetPath),filename:path.basename(selected.link.targetPath),bytes:generated,direction:selected.link.direction,recipeHash:recipeHash??selected.link.recipeHash,signal});
 }
 async function pairFiles(state,link,signal){
  const source=state.sources[link.sourceId];if(!source||!allowed(source.path,sourcesAllowed)||!allowed(link.targetPath,targetsAllowed))return{status:'unavailable',error:'A linked presentation folder is unavailable. No files were changed.'};
  const references=Object.values(state.links).filter(other=>other.id!==link.id&&[state.sources[other.sourceId].path,other.targetPath].some(file=>file===source.path||file===link.targetPath));
  if(references.length)return{status:'conflict',error:'These files have another conversion relationship. Review the links before enabling two-way updates.'};
  const values={};for(const [side,file]of [['source',source.path],['target',link.targetPath]])try{values[side]=await inspect(file,signal,true);}catch(error){check(signal);return{status:error.code==='ENOENT'?'missing':'unavailable',error:error.code==='ENOENT'?(path.extname(file).toLowerCase()==='.pro'?'Missing song in the ProPresenter library: ':'Linked PowerPoint is missing: ')+path.basename(file)+'. It was not recreated.':'A linked file cannot be read: '+path.basename(file)+'. Both files were kept.'};}
  return values;
 }
 async function enableTwoWay({id,consent=false,signal}={}){return run(signal,async state=>{
  if(!UUID.test(id||'')||!consent)fail('Confirm the native two-way synchronization prompt first.');const link=state.links[id];if(!link)fail('This conversion relationship is unavailable.');
  const pair=await pairFiles(state,link,signal);if(pair.status)fail(pair.error);
  if(!['.pptx','.pro'].includes(path.extname(pair.source.path).toLowerCase())||!['.pptx','.pro'].includes(path.extname(pair.target.path).toLowerCase()))fail('Two-way sync supports editable .pptx and .pro pairs. Keep legacy files and convert copies first.');
  if(pair.source.sha256!==link.sourceHash&&pair.target.sha256!==link.targetHash)fail('Both linked files changed. Review them manually before enabling two-way updates.');
  await backup({...link,targetPath:pair.source.path},pair.source);await backup(link,pair.target);check(signal);
  if((await inspect(pair.source.path,signal)).sha256!==pair.source.sha256||(await inspect(pair.target.path,signal)).sha256!==pair.target.sha256)fail('A linked file changed while confirming. Both files were kept.');
  link.twoWay=true;link.consentAt=Date.now();event(state,'two-way-enabled',state.sources[link.sourceId],{linkId:id,targetName:path.basename(link.targetPath)});await save(state);check(signal);return{id,status:'enabled'};
 });}
 async function disableTwoWay({id,signal}={}){return run(signal,async state=>{
  if(!UUID.test(id||''))fail('Choose a linked pair.');const link=state.links[id];if(!link)fail('This conversion relationship is unavailable.');link.twoWay=false;event(state,'two-way-disabled',state.sources[link.sourceId],{linkId:id,targetName:path.basename(link.targetPath)});await save(state);check(signal);return{id,disabled:true};
 });}
 async function synchronize({id,build,signal}={}){
  if(!UUID.test(id||'')||typeof build!=='function')fail('Choose a linked pair to synchronize.');
  const selected=await run(signal,async state=>{const link=state.links[id];if(!link||!link.twoWay)fail('Enable two-way sync for this pair first.');const pair=await pairFiles(state,link,signal);if(pair.status)return pair;const sourceChanged=pair.source.sha256!==link.sourceHash,targetChanged=pair.target.sha256!==link.targetHash;
   if(sourceChanged&&targetChanged)return{status:'conflict',error:'Both linked files were edited. Neither file was overwritten; review the changes manually.'};
   if(!sourceChanged&&!targetChanged)return{status:'unchanged'};return{link:{...link},...pair,side:sourceChanged?'target':'source',direction:sourceChanged?link.direction:link.direction==='to-pro'?'to-pptx':'to-pro'};});
  if(selected.status)return{id,...selected};
  const from=selected.side==='target'?selected.source:selected.target,to=selected.side==='target'?selected.target:selected.source;
  const bytes=await build({source:from,target:to,direction:selected.direction});check(signal);if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_BYTES)fail('The synchronized presentation is invalid or too large.');
  if(typeof validateReplacement==='function'){await validateReplacement({direction:selected.direction,oldBytes:to.data,newBytes:bytes});check(signal);}
  return run(signal,async state=>{
   const link=state.links[id];if(!link?.twoWay||link.sourceHash!==selected.link.sourceHash||link.targetHash!==selected.link.targetHash)fail('This pair changed during synchronization. Check it again.');const live=await pairFiles(state,link,signal);if(live.status)return{id,...live};
   if(live.source.sha256!==selected.source.sha256||live.target.sha256!==selected.target.sha256||live.source.identity.ino!==selected.source.identity.ino||live.target.identity.ino!==selected.target.identity.ino)fail('A linked file changed during synchronization. Neither file was overwritten.');
   const original=selected.side==='source'?live.source:live.target,folder=await physical(path.dirname(original.path)),kept=await backup({...link,targetPath:original.path},original);check(signal);
   let temporary=path.join(folder.path,'.stati-sync-'+crypto.randomUUID()+'.tmp'),tempIdentity,journaled=false,committed=false,writeLease;
   try{
    writeLease=writeLease||await diskReserve.acquire(path.dirname(temporary),bytes.length);const handle=await fs.open(temporary,'wx',0o600);try{const info=await handle.stat();tempIdentity={dev:info.dev,ino:info.ino};await writeLease.write(bytes.length,()=>handle.writeFile(bytes));await handle.sync();await writeLease.check();}finally{await handle.close();}check(signal);
    const staged=await inspect(temporary,signal);if(staged.sha256!==digest(bytes))fail('The synchronized bytes changed while staging.');
    const next={...link,sourceHash:selected.side==='source'?staged.sha256:live.source.sha256,targetHash:selected.side==='target'?staged.sha256:live.target.sha256,observedStatus:'ready',observedHash:selected.side==='target'?staged.sha256:live.target.sha256,updatedAt:Date.now()};
    state.pending=[{id,sourceId:link.sourceId,link:next,side:selected.side,temporary,tempIdentity,previousHash:original.sha256,backup:kept}];await save(state);journaled=true;check(signal);
    const final=await pairFiles(state,link,signal);if(final.status)fail(final.error);if(final.source.sha256!==live.source.sha256||final.target.sha256!==live.target.sha256||final.source.identity.ino!==live.source.identity.ino||final.target.identity.ino!==live.target.identity.ino)fail('A linked file changed at commit. Its changes were kept.');
    const currentFolder=await physical(folder.path);if(currentFolder.stat.dev!==folder.stat.dev||currentFolder.stat.ino!==folder.stat.ino)fail('The linked folder changed. Both files were kept.');check(signal);try{await fs.rename(temporary,original.path);}catch(error){if(['EBUSY','EPERM','EACCES'].includes(error.code))throw Error('A presentation app has the linked file open. Save and close it, then check again. Its existing contents and recovery copy were kept.');throw error;}committed=true;temporary=null;
    const current=await inspect(state.sources[link.sourceId].path,signal);Object.assign(state.sources[link.sourceId],{sha256:current.sha256,bytes:current.bytes,modifiedAt:current.modifiedAt,missing:false,unreadable:false});state.links[id]=next;state.pending=[];event(state,'resynced',state.sources[link.sourceId],{linkId:id,targetName:path.basename(original.path),fromName:path.basename(from.path),direction:selected.direction});await save(state);journaled=false;check(signal);return{id,status:'resynced',path:original.path,backup:kept,direction:selected.direction};
   }catch(error){if(journaled&&!committed){state.pending=[];await save(state);journaled=false;}throw error;}
   finally{if(temporary&&!journaled){const visible=await exists(temporary);if(visible&&!visible.isSymbolicLink()&&visible.dev===tempIdentity?.dev&&visible.ino===tempIdentity?.ino)await fs.unlink(temporary).catch(()=>{});}await writeLease?.release();}
  });
 }
 async function listLinks({signal}={}){return run(signal,async state=>{check(signal);const links=Object.values(state.links),references=new Map();for(const link of links)references.set(link.targetPath,(references.get(link.targetPath)||0)+1);return{items:links.map(link=>({id:link.id,sourceId:link.sourceId,name:path.basename(state.sources[link.sourceId].path),targetName:path.basename(link.targetPath),direction:link.direction,owned:link.owned,twoWay:link.twoWay===true,canEnableTwoWay:['.pro','.pptx'].includes(path.extname(state.sources[link.sourceId].path).toLowerCase()),shared:references.get(link.targetPath)>1,sourceChanged:state.sources[link.sourceId].sha256!==link.sourceHash,sourceMissing:state.sources[link.sourceId].missing,sourceUnreadable:!!state.sources[link.sourceId].unreadable,sourceUnavailable:!allowed(state.sources[link.sourceId].path,sourcesAllowed),outputStatus:allowed(link.targetPath,targetsAllowed)?(link.observedStatus||'unchecked'):'unavailable',updatedAt:link.updatedAt}))};});}
 return{observe,changes,resolveSource,refreshSources,linkExisting,writeConversion,inspectOutputs,resync,listLinks,enableTwoWay,disableTwoWay,synchronize,pairSnapshot:({id,signal}={})=>run(signal,async state=>{const link=state.links[id];if(!link)fail('Choose a linked pair.');const pair=await pairFiles(state,link,signal);if(pair.status)fail(pair.error);return{link:{...link},...pair};})};
}
module.exports={openPresentationLedger};
