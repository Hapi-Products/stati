'use strict';
// A passphrase-protected, read-only export. It never grants an online identity
// or contains account proofs, access tokens, roles or server capabilities.
const fs=require('node:fs/promises'),{constants}=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt),MAGIC=Buffer.from('STATIOF1'),MAX=80*1024*1024,MAX_AUDIO=50*1024*1024,TTL=72*3600000,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,SHA=/^[a-f0-9]{64}$/;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function password(value){if(typeof value!=='string'||value.length<10||value.length>200)throw Error('Use an offline-copy passphrase from 10 to 200 characters.');return value;}
function object(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
function text(value,max,min=0){return typeof value==='string'&&value.length>=min&&value.length<=max;}
function integer(value,min,max=Number.MAX_SAFE_INTEGER){return Number.isSafeInteger(value)&&value>=min&&value<=max;}
function snapshotValue(value){
 const invalid=()=>{throw Error('The protected service copy is invalid.');};
 if(!object(value)||value.format!=='stati-offline-service'||value.version!==1||!integer(value.createdAt,0)||!integer(value.expiresAt,0)||value.expiresAt-value.createdAt!==TTL||!object(value.snapshot)||!object(value.approval)||!Array.isArray(value.audio)||value.audio.length>8)invalid();
 const saved=value.snapshot,approved=value.approval;
 if(!UUID.test(saved.id)||!text(saved.title,80,1)||!text(saved.date,10)||!/^\d{4}-\d{2}-\d{2}$/.test(saved.date)||!text(saved.time,5)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(saved.time)||!text(saved.notes,10000)||!integer(saved.revision,1)||saved.ready!==true||!Array.isArray(saved.songs)||saved.songs.length>1000)invalid();
 if(!UUID.test(approved.id)||!integer(approved.serviceRevision,1)||saved.revision!==approved.serviceRevision||!integer(approved.approvedAt,0)||!text(approved.approvedByLabel,200,1)||!SHA.test(approved.contentHash))invalid();
 const appearanceIds=new Set();let totalText=0,totalSlides=0;
 const songs=saved.songs.map(song=>{
  if(!object(song)||!UUID.test(song.id)||appearanceIds.has(song.id)||!SHA.test(song.songId)||!text(song.title,300,1)||typeof song.reviewed!=='boolean'||song.status!=='ready'||!text(song.message,600)||!Number.isFinite(song.fontSize)||song.fontSize<32||song.fontSize>160||!Array.isArray(song.slides)||!song.slides.length||song.slides.length>500)invalid();
  appearanceIds.add(song.id);totalSlides+=song.slides.length;if(totalSlides>10000)invalid();
  const slides=song.slides.map(slide=>{if(!object(slide)||!text(slide.section,300)||!text(slide.text,10000))invalid();totalText+=slide.text.length;if(totalText>2*1024*1024)invalid();const clean={section:slide.section,text:slide.text};if(slide.ending!==undefined){if(!/^(Amen|Amin)$/i.test(slide.ending)||!Number.isFinite(slide.endingFontSize)||slide.endingFontSize<16||slide.endingFontSize>96)invalid();clean.ending=slide.ending;clean.endingFontSize=slide.endingFontSize;}return clean;});
  return{id:song.id,songId:song.songId,title:song.title,reviewed:song.reviewed,status:'ready',message:song.message,fontSize:song.fontSize,slides};
 });
 let size=0;const ids=new Set(),audio=value.audio.map(file=>{
  if(!object(file)||!UUID.test(file.id)||ids.has(file.id)||!text(file.filename,255,1)||path.basename(file.filename)!==file.filename||/[\\/\x00-\x1f]/.test(file.filename)||!file.filename.toLowerCase().endsWith('.mp3')||!text(file.base64,Math.ceil(MAX_AUDIO/3)*4,4)||file.base64.length%4!==0||/[^A-Za-z0-9+/=]/.test(file.base64)||!SHA.test(file.sha256))invalid();
  ids.add(file.id);const bytes=Buffer.from(file.base64,'base64');try{size+=bytes.length;if(size>MAX_AUDIO||!bytes.length||bytes.toString('base64')!==file.base64||hash(bytes)!==file.sha256)throw Error('The protected audio bytes could not be verified.');}finally{bytes.fill(0);}return{id:file.id,filename:file.filename,sha256:file.sha256,base64:file.base64};
 });
 // Return only safe presentation fields, including when reading a crafted file.
 return{format:'stati-offline-service',version:1,createdAt:value.createdAt,expiresAt:value.expiresAt,snapshot:{id:saved.id,title:saved.title,date:saved.date,time:saved.time,notes:saved.notes,revision:saved.revision,ready:true,songs},approval:{id:approved.id,serviceRevision:approved.serviceRevision,approvedAt:approved.approvedAt,approvedByLabel:approved.approvedByLabel,contentHash:approved.contentHash},audio};
}
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
async function unlinkOwned(file,identity){try{const current=await fs.lstat(file);if(identity&&sameFile(current,identity)&&!current.isSymbolicLink())await fs.unlink(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
async function checkedBytes(file,maximum=MAX){
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<52||stat.size>maximum)throw Error('Choose a regular protected service copy within its size limit.');
 const actual=await fs.realpath(file),handle=await fs.open(actual,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const before=await handle.stat();if(!sameFile(before,stat)||before.size!==stat.size||before.mtimeMs!==stat.mtimeMs)throw Error('The copy changed while opening.');const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const part=await handle.read(bytes,offset,bytes.length-offset,offset);if(!part.bytesRead)throw Error('The copy changed while opening.');offset+=part.bytesRead;}const extra=Buffer.alloc(1),end=await handle.read(extra,0,1,bytes.length),after=await handle.stat(),current=await fs.lstat(file);if(end.bytesRead||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||!sameFile(current,stat)||current.mtimeMs!==stat.mtimeMs||current.ctimeMs!==stat.ctimeMs||current.isSymbolicLink()||await fs.realpath(file)!==actual)throw Error('The copy changed while opening.');return bytes;}finally{await handle.close();}
}
function createOfflineServiceStore({directory,clock=Date.now}={}){
 let generation=0,opened=new Map(),sessions=new Map(),failures=[];
 const guard=(options={},scope=generation)=>()=>{if(scope!==generation)throw Error('The offline desk was locked.');options.signal?.throwIfAborted();options.checkActive?.();};
 function clearOpened(){for(const bytes of opened.values())bytes.fill(0);opened.clear();}
 function clearSessions(){for(const value of sessions.values())for(const file of value.audio)file.bytes.fill(0);sessions.clear();}
 async function prepare({snapshot,approval,audio=[]},passphrase,options={}){
  password(passphrase);const scope=generation,check=guard(options,scope);check();const createdAt=clock();
  if(!object(snapshot)||snapshot.ready!==true)throw Error('Resolve missing or changed songs before preparing an offline copy.');
  if(!Array.isArray(audio)||audio.length>8)throw Error('Use up to eight MP3s in a protected copy.');
  let audioSize=0;const audioRecords=audio.map(file=>{if(!object(file)||!(Buffer.isBuffer(file.bytes)||file.bytes instanceof Uint8Array)||!file.bytes.byteLength)throw Error('Choose MP3s with verified source bytes.');audioSize+=file.bytes.byteLength;if(audioSize>MAX_AUDIO)throw Error('Use up to 50 MB of MP3s in a protected copy.');return{id:crypto.randomUUID(),filename:file.filename,sha256:hash(file.bytes),base64:Buffer.from(file.bytes).toString('base64')};});
  const payload=snapshotValue({format:'stati-offline-service',version:1,createdAt,expiresAt:createdAt+TTL,snapshot,approval,audio:audioRecords}),plain=Buffer.from(JSON.stringify(payload));
  let key,encrypted,temp,target,identity,published=false;
  try{
   if(plain.length>MAX-52)throw Error('Use fewer MP3s; the protected copy must fit within 80 MB.');
   const salt=crypto.randomBytes(16),nonce=crypto.randomBytes(12);key=await scrypt(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});check();
   const cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(MAGIC);encrypted=Buffer.concat([MAGIC,salt,nonce,cipher.update(plain),cipher.final(),cipher.getAuthTag()]);key.fill(0);key=undefined;plain.fill(0);
   check();await fs.mkdir(directory,{recursive:true,mode:0o700});check();const root=await fs.realpath(directory),name='service-'+payload.snapshot.date+'-'+crypto.randomUUID()+'.statiservice';target=path.join(root,name);temp=target+'.tmp';
   const out=await fs.open(temp,'wx',0o600);try{identity=await out.stat();await out.writeFile(encrypted);await out.sync();}finally{await out.close();}
   check();await fs.link(temp,target);published=true;check();const bytes=await checkedBytes(target);try{if(hash(bytes)!==hash(encrypted))throw Error('The protected copy could not be confirmed.');}finally{bytes.fill(0);}check();return{path:target,filename:name,bytes:encrypted.length,sha256:hash(encrypted),createdAt,expiresAt:payload.expiresAt};
  }catch(error){if(published)await unlinkOwned(target,identity).catch(()=>{});throw error;}finally{key?.fill(0);plain.fill(0);if(temp)await unlinkOwned(temp,identity).catch(()=>{});encrypted?.fill(0);}
 }
 async function choose(file,options={}){const check=guard(options),bytes=await checkedBytes(file);try{check();if(!bytes.subarray(0,8).equals(MAGIC))throw Error('Choose a Stați protected service copy.');const id=crypto.randomUUID();generation++;clearOpened();clearSessions();opened.set(id,bytes);return{id,filename:path.basename(file)};}catch(error){bytes.fill(0);throw error;}}
 async function unlock(id,passphrase,options={}){
  password(passphrase);const scope=generation,check=guard(options,scope);check();failures=failures.filter(at=>clock()-at<60000);if(failures.length>=5)throw Error('Wait one minute before trying another offline passphrase.');const bytes=opened.get(id);if(!bytes)throw Error('Choose the protected copy again.');let key,plain;
  try{const salt=bytes.subarray(8,24),nonce=bytes.subarray(24,36);key=await scrypt(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});check();const decipher=crypto.createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(MAGIC);decipher.setAuthTag(bytes.subarray(-16));try{plain=Buffer.concat([decipher.update(bytes.subarray(36,-16)),decipher.final()]);}catch{failures.push(clock());throw Error('The passphrase is incorrect or this copy was damaged.');}check();const value=snapshotValue(JSON.parse(plain.toString('utf8')));if(clock()<value.createdAt-300000||clock()>=value.expiresAt)throw Error('This offline copy expired. Prepare a new copy while connected.');check();const sessionId=crypto.randomUUID();clearSessions();sessions.set(sessionId,{...value,audio:value.audio.map(file=>({...file,bytes:Buffer.from(file.base64,'base64'),base64:undefined}))});return{sessionId,snapshot:value.snapshot,approval:value.approval,createdAt:value.createdAt,expiresAt:value.expiresAt,audio:value.audio.map(file=>({id:file.id,filename:file.filename,bytes:Buffer.byteLength(file.base64,'base64')}))};}finally{key?.fill(0);plain?.fill(0);}
 }
 function audio({sessionId,id,offset},options={}){const check=guard(options);check();const value=sessions.get(sessionId);if(!value||clock()<value.createdAt-300000||clock()>=value.expiresAt){clearSessions();throw Error('Unlock a current offline copy first.');}const file=value.audio.find(file=>file.id===id);if(!file||!Number.isSafeInteger(offset)||offset<0)throw Error('Choose audio saved inside this copy.');if(offset>file.bytes.length)throw Error('Invalid audio position.');const part=file.bytes.subarray(offset,offset+1024*1024);check();return{offset,total:file.bytes.length,bytes:part.buffer.slice(part.byteOffset,part.byteOffset+part.byteLength)};}
 function lock(){generation++;clearOpened();clearSessions();}
 return{prepare,choose,unlock,audio,lock};
}
module.exports={createOfflineServiceStore};
