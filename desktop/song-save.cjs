const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {catalogFile,readSong}=require('./song-catalog.cjs');
const work=require('./conversion-work.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const saves=new Set();
const HASH=/^[a-f0-9]{64}$/,MAX_BYTES=50*1024*1024;
async function recoveryDirectory(directory,id,create=false){
 const history=path.join(directory,'.stati-history',id);
 for(const folder of [path.dirname(history),history]){
  if(create)await fs.mkdir(folder,{recursive:true,mode:0o700});
  try{const info=await fs.lstat(folder);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Song recovery storage is unavailable. The original has been kept.');}
  catch(error){if(!create&&error.code==='ENOENT')return null;throw error;}
 }
 return history;
}
async function recoveryBytes(file,expectedHash){
 const constants=require('node:fs').constants;
 let handle;
 try{
  handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  const info=await handle.stat(),visible=await fs.lstat(file);
  if(!info.isFile()||visible.isSymbolicLink()||info.size<=0||info.size>MAX_BYTES||info.dev!==visible.dev||info.ino!==visible.ino)throw Error('This saved version is unavailable. The current song has been kept.');
  const bytes=await handle.readFile(),after=await handle.stat();
  if(bytes.length!==info.size||info.size!==after.size||info.mtimeMs!==after.mtimeMs||hash(bytes)!==expectedHash)throw Error('This saved version could not be verified. The current song has been kept.');
  return{bytes,savedAt:info.mtimeMs};
 }finally{await handle?.close();}
}
async function keepRecovery(directory,id,expectedHash,original,addedAt){
 const history=await recoveryDirectory(directory,id,true),backup=path.join(history,expectedHash+'.bin');
 try{const output=await fs.open(backup,'wx',0o600);try{await output.writeFile(original);await output.sync();}finally{await output.close();}}
 catch(error){if(error.code!=='EEXIST')throw error;}
 await recoveryBytes(backup,expectedHash);
 const metadata=path.join(history,'added.json');try{await fs.writeFile(metadata,JSON.stringify({addedAt}),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
 return history;
}
function recoveryText(bytes,extension){
 if(extension==='.txt')return bytes.toString('utf8');
 const doc=require('./presentation.cjs').decode(bytes),slides=[];
 for(const cue of doc.cues||[]){const words=[];for(const action of cue.actions||[])for(const item of action.slide?.presentation?.baseSlide?.elements||[]){const element=item.element;if(element?.name==='Song ending')continue;const data=element?.text?.rtfData;if(data){const plain=require('./rtf-text.cjs').rtfPlain(Buffer.from(data,'base64').toString('latin1'));if(plain)words.push(plain);}}if(words.length)slides.push(words.join('\n'));}
 return slides.join('\n\n');
}
async function selectedSong(directory,id,expectedHash,assertCurrent){
 assertCurrent();const root=await fs.realpath(directory),file=await catalogFile(root,id),song=await readSong(root,file),stat=await fs.lstat(file);
 if(stat.isSymbolicLink()||!stat.isFile()||!['.pro','.txt'].includes(path.extname(file).toLowerCase()))throw Error('Choose a saved .pro or text song before opening version history.');
 if(expectedHash!==undefined&&(!HASH.test(expectedHash)||song.contentHash!==expectedHash))throw Error('This song changed. Refresh Library and open its history again.');
 const original=await fs.readFile(file);if(original.length>MAX_BYTES||hash(original)!==song.contentHash)throw Error('This song changed. Refresh Library and open its history again.');
 assertCurrent();return{root,file,song,stat,original};
}
async function listSongVersions(directory,id,assertCurrent=()=>{}){
 const {root,song}=await selectedSong(directory,id,undefined,assertCurrent),history=await recoveryDirectory(root,id),versions=[];
 if(history){const entries=await fs.readdir(history,{withFileTypes:true});if(entries.length>10000)throw Error('There are too many saved versions to open safely. The history has been kept.');
  for(const entry of entries){if(!/^[a-f0-9]{64}\.bin$/.test(entry.name)||!entry.isFile())continue;const versionHash=entry.name.slice(0,-4);if(versionHash===song.contentHash)continue;const info=await fs.lstat(path.join(history,entry.name));if(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=MAX_BYTES)versions.push({hash:versionHash,savedAt:info.mtimeMs,bytes:info.size});}
 }
 assertCurrent();versions.sort((a,b)=>b.savedAt-a.savedAt||a.hash.localeCompare(b.hash));
 return{songId:id,title:song.title,currentHash:song.contentHash,currentText:song.text,versions:versions.slice(0,100),truncated:versions.length>100};
}
async function previewSongVersion(directory,id,expectedHash,versionHash,assertCurrent=()=>{}){
 if(!HASH.test(versionHash||''))throw Error('Choose a saved song version.');
 const {root,file,song}=await selectedSong(directory,id,expectedHash,assertCurrent),history=await recoveryDirectory(root,id);
 if(!history)throw Error('This song has no saved versions yet.');
 const saved=await recoveryBytes(path.join(history,versionHash+'.bin'),versionHash),text=recoveryText(saved.bytes,path.extname(file).toLowerCase());
 if(text.length>100000)throw Error('This saved version has too much text to preview.');
 assertCurrent();return{songId:id,title:song.title,currentHash:song.contentHash,currentText:song.text,version:{hash:versionHash,savedAt:saved.savedAt,bytes:saved.bytes.length,text}};
}
async function restoreSongVersion(directory,id,expectedHash,versionHash,assertCurrent=()=>{}){
 if(!HASH.test(expectedHash||'')||!HASH.test(versionHash||''))throw Error('Open this song version before restoring it.');
 const root=await fs.realpath(directory),key=root+'\0'+id;if(saves.has(key))throw Error('This song is already being saved.');saves.add(key);let temporary;
 try{
  const {file,song,stat,original}=await selectedSong(root,id,expectedHash,assertCurrent),history=await recoveryDirectory(root,id);
  if(!history)throw Error('This song has no saved versions yet.');
  const {bytes}=await recoveryBytes(path.join(history,versionHash+'.bin'),versionHash),extension=path.extname(file).toLowerCase();
  if(recoveryText(bytes,extension).length>100000)throw Error('This saved version has too much text to restore.');
  if(extension==='.pro'){const decode=require('./presentation.cjs').decode,current=decode(original),saved=decode(bytes);if(JSON.stringify(current.uuid)!==JSON.stringify(saved.uuid)||current.name!==saved.name)throw Error('This saved version belongs to a different presentation identity or title. The current song has been kept.');}
  if(expectedHash===versionHash)return{path:file,title:song.title,contentHash:expectedHash};
  assertCurrent();await keepRecovery(root,id,expectedHash,original,song.addedAt);
  temporary=path.join(path.dirname(file),'.stati-restore-'+crypto.randomUUID()+'.tmp');const output=await fs.open(temporary,'wx',stat.mode&0o777);try{await output.writeFile(bytes);await output.sync();}finally{await output.close();}
  assertCurrent();const latest=await fs.lstat(file);if(latest.isSymbolicLink()||latest.dev!==stat.dev||latest.ino!==stat.ino||hash(await fs.readFile(file))!==expectedHash)throw Error('This song changed while restoring. The current file and recovery copies have been kept.');
  assertCurrent();try{await fs.rename(temporary,file);}catch(error){if(['EACCES','EPERM','EBUSY'].includes(error.code))throw Error('Another app has this song open. Close the song there, then restore again.');throw error;}temporary=null;
  return{path:file,title:song.title,contentHash:versionHash};
 }finally{if(temporary)await fs.unlink(temporary).catch(()=>{});saves.delete(key);}
}
async function saveLibrarySong(directory,id,expectedHash,data,assertCurrent=()=>{}){
 if(!/^[a-f0-9]{64}$/.test(expectedHash||''))throw Error('Open this song from Library before saving it.');
 const root=await fs.realpath(directory),key=root+'\0'+id;if(saves.has(key))throw Error('This song is already being saved.');saves.add(key);
 let temporary;
 try{
  const file=await catalogFile(directory,id),song=await readSong(directory,file),stat=await fs.lstat(file);
  if(stat.isSymbolicLink()||!stat.isFile())throw Error('The song file changed. Refresh Library and open it again.');
  if(song.contentHash!==expectedHash)throw Error('This song changed after you opened it. Refresh Library before saving. Your draft has been kept.');
  const original=await fs.readFile(file);if(hash(original)!==expectedHash)throw Error('This song changed. Open it again before saving.');
  const extension=path.extname(file).toLowerCase();
  if(!['.pro','.txt'].includes(extension))throw Error('Save this older presentation as a .pro file in ProPresenter first, then open it in Stați. Your draft has been kept.');
  require('./presentation.cjs').validate(data);
  const bytes=extension==='.pro'?await work('revise-build',original,{...data,title:song.title}):Buffer.from(data.slides.map(slide=>slide.text).join('\n\n'),'utf8');
  assertCurrent();
  // Recovery copies are private implementation files, not additional songs.
  await keepRecovery(directory,id,expectedHash,original,song.addedAt);
  temporary=path.join(path.dirname(file),'.stati-save-'+crypto.randomUUID()+'.tmp');
  const output=await fs.open(temporary,'wx',stat.mode&0o777);try{await output.writeFile(bytes);await output.sync();}finally{await output.close();}
  assertCurrent();const latest=await fs.lstat(file);
  if(latest.isSymbolicLink()||latest.dev!==stat.dev||latest.ino!==stat.ino||hash(await fs.readFile(file))!==expectedHash)throw Error('This song changed while saving. Your draft and the original have been kept.');
  assertCurrent();try{await fs.rename(temporary,file);}catch(error){if(['EACCES','EPERM','EBUSY'].includes(error.code))throw Error('Another app has this song open. Close the song there, then save again. Your draft and the original have been kept.');throw error;}temporary=null;
  return {path:file,title:song.title,contentHash:hash(bytes)};
 }finally{if(temporary)await fs.unlink(temporary).catch(()=>{});saves.delete(key);}
}
async function cloneLibrarySong(directory,id,expectedHash,groupName,assertCurrent=()=>{}){
 if(!HASH.test(expectedHash||''))throw Error('Open this song before creating a group version.');
 const {groupLabel,variantsDirectory,readVariant}=require('./song-variants.cjs'),label=groupLabel(groupName);
 const {root,file,song,original}=await selectedSong(directory,id,expectedHash,assertCurrent);
 const previous=await readVariant(root,id),baseTitle=previous?.baseTitle||song.title,sourceSongId=previous?.sourceSongId||id;
 const title=(baseTitle.slice(0,210)+' — '+label).slice(0,300),extension=path.extname(file).toLowerCase();
 const bytes=extension==='.pro'?await work('clone-build',original,title):original;
 const metadataDirectory=await variantsDirectory(root,true),filename=raw=>raw.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,150)||'Song version';
 const stem=filename(title),parent=path.dirname(file);
 for(let index=0;index<10000;index++){
  assertCurrent();
  const destination=path.join(parent,stem+(index?' ('+index+')':'')+extension),cloneId=require('./song-catalog.cjs').idFor(path.relative(root,destination),root),metadataFile=path.join(metadataDirectory,cloneId+'.json');
  let output,metadata,created,createdMetadata,complete=false;
  try{
   output=await fs.open(destination,'wx',0o600);created=await output.stat();
   metadata=await fs.open(metadataFile,'wx',0o600);createdMetadata=await metadata.stat();
   await output.writeFile(bytes);await output.sync();
   await metadata.writeFile(JSON.stringify({version:1,songId:cloneId,sourceSongId,groupName:label,baseTitle}));await metadata.sync();
   assertCurrent();
   if(hash(await fs.readFile(file))!==expectedHash)throw Error('The source song changed while creating the group version. Refresh and try again.');
   const saved=await readSong(root,destination);assertCurrent();complete=true;
   return{path:destination,id:saved.id,title:saved.title,contentHash:saved.contentHash,groupName:label,sourceSongId};
  }catch(error){if(error.code!=='EEXIST')throw error;}
  finally{
   await output?.close();await metadata?.close();
   if(!complete)for(const [target,owned] of [[destination,created],[metadataFile,createdMetadata]])if(owned)try{const current=await fs.lstat(target);if(!current.isSymbolicLink()&&current.dev===owned.dev&&current.ino===owned.ino)await fs.unlink(target);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
 }
 throw Error('Could not choose a new filename for this group version. Existing songs have been kept.');
}
module.exports={saveLibrarySong,listSongVersions,previewSongVersion,restoreSongVersion,cloneLibrarySong};
