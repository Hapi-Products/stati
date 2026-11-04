'use strict';
// Managed copies pin the exact reviewed native bytes. Never rewrite a library
// presentation or resolve a service appearance by its display name.
const fs=require('node:fs/promises'),{constants}=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const protobuf=require('protobufjs/light'),schema=require('../src/shared/propresenter-schema.json');
const Presentation=protobuf.Root.fromJSON(schema).lookupType('rv.data.Presentation');
const {walk,rtfPlain}=require('./library.cjs'),{idFor}=require('./song-catalog.cjs'),{playlistReferences}=require('./playlist-library.cjs');
const {validateServiceArrangement}=require('../src/shared/service-arrangement.js');
const DIRECTORY='Stați Service Copies',HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,MAX_FILE=50*1024*1024;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),queues=new Map();
const identity=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
function derivedUuid(key){const bytes=crypto.createHash('sha256').update(key).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|0x50;bytes[8]=(bytes[8]&63)|0x80;const h=bytes.toString('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
const unsupported=()=>Error('This service copy requires plain native lyric slides. Media, macros, timings and other presentation actions need review in ProPresenter. The original was kept.');
function only(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw unsupported();}
function nativeCopy(bytes,key,arrangement){
 const original=Presentation.toObject(Presentation.decode(bytes),{bytes:String});
 only(original,['applicationInfo','uuid','name','lastDateUsed','lastModifiedDate','category','notes','cueGroups','cues','ccli','musicKey','contentDestination']);
 if(!UUID.test(original.uuid?.string||'')||!Array.isArray(original.cues)||!original.cues.length||original.cues.length>500)throw unsupported();
 let ending;
 for(const cue of original.cues){
  only(cue,['uuid','name','actions','isEnabled']);if(!Array.isArray(cue.actions)||cue.actions.length!==1)throw unsupported();
  const action=cue.actions[0];only(action,['uuid','name','label','isEnabled','type','slide']);if(action.type!==11)throw unsupported();
  only(action.slide,['presentation']);only(action.slide.presentation,['baseSlide','notes','templateGuidelines']);
  const slide=action.slide.presentation.baseSlide;only(slide,['elements','drawsBackgroundColor','backgroundColor','size','uuid','guidelines']);
  if(!Array.isArray(slide.elements)||!slide.elements.length||slide.elements.length>100)throw unsupported();let words=false;
  for(const wrapper of slide.elements){only(wrapper,['element']);const element=wrapper.element;
   only(element,['uuid','name','bounds','opacity','path','fill','text','rotation','locked','hidden']);
   if(!element.text?.rtfData)throw unsupported();only(element.text,['attributes','shadow','rtfData','verticalAlignment','scaleBehavior','margins','isSuperscriptStandardized','transform','transformDelimiter']);if(element.text.attributes)only(element.text.attributes,['font','capitalization','underlineStyle','underlineColor','paragraphStyle','kerning','superscript','strikethroughStyle','strikethroughColor','strokeWidth','strokeColor','backgroundColor','textSolidFill','textGradientFill']);if(element.fill)only(element.fill,['color','enable']);
   const rtf=Buffer.from(element.text.rtfData,'base64').toString('latin1');if(/\\(?:object|objdata|field|pict)\b/i.test(rtf))throw unsupported();
   const text=rtfPlain(rtf).trim();if(element.name==='Song ending'){if(!/^(Amen|Amin)$/i.test(text))throw unsupported();ending=structuredClone(wrapper);}else if(text)words=true;
  }
  if(!words)throw unsupported();
 }
 const selected=validateServiceArrangement(arrangement),sequence=selected?selected.slides:original.cues.map((_,i)=>i+1);
 if(sequence.some(index=>index>original.cues.length))throw Error('This arrangement refers to an unavailable native lyric slide. Review its source song.');
 const cues=sequence.map(index=>structuredClone(original.cues[index-1]));
 for(const cue of cues)cue.actions[0].slide.presentation.baseSlide.elements=cue.actions[0].slide.presentation.baseSlide.elements.filter(item=>item.element.name!=='Song ending');
 if(ending)cues.at(-1).actions[0].slide.presentation.baseSlide.elements.push(ending);
 const replaceIds=(value,at)=>{if(!value||typeof value!=='object')return;for(const [field,child]of Object.entries(value)){if(field==='uuid'&&child&&UUID.test(child.string||''))value[field]={string:derivedUuid(key+':'+at+':'+field)};else replaceIds(child,at+':'+field);}};
 const groups=[];
 cues.forEach((cue,index)=>{replaceIds(cue,'cue:'+index);cue.name=String(index+1);const label=cue.actions[0].label,section=String(label?.text||'Verse').slice(0,100);let group=groups.at(-1);if(!group||group.group.name!==section){group={group:{uuid:{string:derivedUuid(key+':group:'+groups.length)},name:section,...(label?.color?{color:label.color}:{})},cueIdentifiers:[]};groups.push(group);}group.cueIdentifiers.push(cue.uuid);});
 const output={...original,uuid:{string:derivedUuid(key)},cues,cueGroups:groups};delete output.lastDateUsed;delete output.lastModifiedDate;
 const result=Buffer.from(Presentation.encode(Presentation.fromObject(output)).finish());if(result.length>MAX_FILE)throw Error('This service copy is too large.');return {bytes:result,uuid:output.uuid.string,name:String(output.name||'Service lyrics').slice(0,300)};
}
async function readChecked(file,check,{expectedHash,root,managed=false}={}){
 await check();const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||!before.size||before.size>MAX_FILE)throw Error('A service file cannot be read safely.');
 const actual=await fs.realpath(file);if(root&&!actual.startsWith(root+path.sep))throw Error('A service file moved outside its library.');const input=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const opened=await input.stat();if(identity(opened)!==identity(before))throw Error('A service file changed while opening.');const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){await check();const {bytesRead}=await input.read(bytes,offset,Math.min(65536,bytes.length-offset),offset);if(!bytesRead)throw Error('A service file ended early.');offset+=bytesRead;}
  const extra=Buffer.alloc(1);if((await input.read(extra,0,1,offset)).bytesRead)throw Error('A service file grew while opening.');await check();const current=await fs.lstat(file);if(current.isSymbolicLink()||identity(opened)!==identity(await input.stat())||identity(opened)!==identity(current)||actual!==await fs.realpath(file))throw Error('A service file changed while opening.');
  if(expectedHash&&digest(bytes)!==expectedHash)throw Object.assign(Error('A saved service copy or source changed. It was preserved for review.'),{code:managed?'SERVICE_COPY_CHANGED':'SERVICE_SOURCE_CHANGED'});return bytes;
 }finally{await input.close();}
}
async function exclusive(file,bytes,check){
 await check();try{const existing=await readChecked(file,check);if(digest(existing)!==digest(bytes))throw Object.assign(Error('A managed service copy changed. It was preserved for review.'),{code:'SERVICE_COPY_CHANGED'});return;}catch(error){if(error.code!=='ENOENT')throw Object.assign(error,{code:error.code==='ABORTED'?'ABORTED':'SERVICE_COPY_CHANGED'});}
 const temporary=file+'.'+crypto.randomUUID()+'.tmp';let owned;
 try{const out=await fs.open(temporary,'wx',0o600);try{await out.writeFile(bytes);await out.sync();owned=await out.stat();}finally{await out.close();}await check();
  try{await fs.link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw Error('This disk cannot safely publish an exclusive service copy. The original was kept.',{cause:error});}
  await check();await readChecked(file,check,{expectedHash:digest(bytes),managed:true});
 }catch(error){const current=await fs.lstat(file).catch(()=>null);if(owned&&current?.dev===owned.dev&&current?.ino===owned.ino)await fs.unlink(file).catch(()=>{});throw error;}
 finally{const current=await fs.lstat(temporary).catch(()=>null);if(owned&&current?.dev===owned.dev&&current?.ino===owned.ino)await fs.unlink(temporary).catch(()=>{});}
}
async function references(directory,plan,{checkActive=()=>{},signal,allowUnavailable=false}={}){
 let authorityError,managedIdentity;
 const check=async()=>{if(authorityError)throw authorityError;if(signal?.aborted)throw Object.assign(Error('Service output preparation canceled.'),{code:'ABORTED'});try{await checkActive();}catch(error){authorityError=error;throw error;}if(signal?.aborted)throw Object.assign(Error('Service output preparation canceled.'),{code:'ABORTED'});if(managedIdentity){const current=await fs.lstat(managedIdentity.path);if(!current.isDirectory()||current.isSymbolicLink()||current.dev!==managedIdentity.dev||current.ino!==managedIdentity.ino||await fs.realpath(managedIdentity.path)!==managedIdentity.path)throw Error('The managed service folder changed. Existing files were kept.');}};
 if(!plan||!UUID.test(plan.id||'')||plan.approvedVersionId!==undefined&&!UUID.test(plan.approvedVersionId)||!Array.isArray(plan.songs)||plan.songs.length>1000)throw Error('Choose a valid service for native output.');
 const appearances=new Set();for(const song of plan.songs){if(!song||!UUID.test(song.id||'')||appearances.has(song.id)||!HASH.test(song.songId||'')||!HASH.test(song.contentHash||''))throw Error('Choose valid service song appearances.');appearances.add(song.id);validateServiceArrangement(song.arrangement);}
 await check();const root=await fs.realpath(directory),copied=plan.songs.filter(song=>plan.approvedVersionId||song.arrangement),plain=plan.songs.filter(song=>!plan.approvedVersionId&&!song.arrangement),result=[];
 if(plain.length){const native=await playlistReferences(root,plain,{allowUnavailable});await check();for(const song of plain){const reference=native.find(item=>item.songId===song.songId);if(reference)result.push({...reference,appearanceId:song.id});}}
 if(!copied.length)return result;
 const managed=path.join(root,DIRECTORY);await fs.mkdir(managed,{recursive:true,mode:0o700});const state=await fs.lstat(managed);if(!state.isDirectory()||state.isSymbolicLink()||await fs.realpath(managed)!==managed)throw Error('The managed service folder cannot be used safely.');managedIdentity={path:managed,dev:state.dev,ino:state.ino};
 const locations=new Map((await walk(root)).map(file=>[idFor(path.relative(root,file),root),file]));await check();let total=0;
 for(const song of copied){await check();try{
  const sourceFile=path.join(managed,song.contentHash+'.source');let bytes;
  try{bytes=await readChecked(sourceFile,check,{expectedHash:song.contentHash,root,managed:true});}catch(error){if(error.code!=='ENOENT'){if(error!==authorityError&&error.code!=='ABORTED')error.code='SERVICE_COPY_CHANGED';throw error;}const original=locations.get(song.songId);if(!original||path.extname(original).toLowerCase()!=='.pro')throw Error('Save this service song as a plain native ProPresenter presentation before syncing.');bytes=await readChecked(original,check,{expectedHash:song.contentHash,root});}
  total+=bytes.length;if(total>500*1024*1024)throw Error('This service contains too much native presentation data.');
  const key=digest(JSON.stringify({format:1,serviceId:plan.id,versionId:plan.approvedVersionId||null,appearanceId:song.id,contentHash:song.contentHash,arrangement:song.arrangement||null})),output=nativeCopy(bytes,key,song.arrangement);
  await exclusive(sourceFile,bytes,check);await exclusive(path.join(managed,key+'.pro'),output.bytes,check);await check();result.push({songId:song.songId,appearanceId:song.id,uuid:output.uuid,name:output.name});
 }catch(error){if(signal?.aborted||error.code==='ABORTED'||error.code==='SERVICE_COPY_CHANGED')throw error;await check();if(!allowUnavailable)throw error;}}
 await check();return result;
}
function serviceOutputReferences(directory,plan,options){const key=path.resolve(directory),task=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(()=>references(directory,plan,options));queues.set(key,task);return task.finally(()=>{if(queues.get(key)===task)queues.delete(key);});}
module.exports={serviceOutputReferences,DIRECTORY};
