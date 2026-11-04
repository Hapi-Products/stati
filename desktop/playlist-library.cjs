const fs=require('node:fs/promises'),{constants}=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {walk}=require('./library.cjs'),{idFor}=require('./song-catalog.cjs'),{decode}=require('./presentation.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function savedPresentation(root,file,expectedHash){
 const actual=await fs.realpath(file);if(!actual.startsWith(root+path.sep)||path.extname(actual).toLowerCase()!=='.pro')throw Error('A service song cannot be opened safely.');
 const handle=await fs.open(actual,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const before=await handle.stat();if(!before.isFile()||before.size>50*1024*1024)throw Error('A service song cannot be opened safely.');
  // Bound bytes even if another process grows the file after stat(). Read from
  // the opened inode and reject a path/inode change before publishing its ID.
  const buffer=Buffer.alloc(before.size+1);let length=0;
  while(length<buffer.length){const read=await handle.read(buffer,length,buffer.length-length,length);if(!read.bytesRead)break;length+=read.bytesRead;}
  const after=await handle.stat(),current=await fs.stat(file),resolved=await fs.realpath(file);
  if(length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||current.dev!==before.dev||current.ino!==before.ino||resolved!==actual)throw Error('A service song changed while it was being opened. Retry after saving it.');
  const bytes=buffer.subarray(0,length),contentHash=crypto.createHash('sha256').update(bytes).digest('hex');if(expectedHash&&expectedHash!==contentHash)throw Error('A service song changed. Refresh its reference before syncing.');
  const doc=decode(bytes),uuid=doc.uuid?.string;if(typeof uuid!=='string'||!UUID.test(uuid))throw Error('A service song has no valid ProPresenter identity.');
  return{bytes,contentHash,uuid,name:doc.name||path.basename(actual,'.pro'),actual};
 }finally{await handle.close();}
}
// Resolve the saved bytes, never a title guess. Runs in the conversion worker.
async function playlistReferences(directory,songs,{allowUnavailable=false}={}){
 if(!Array.isArray(songs)||songs.length>1000)throw Error('Use up to 1,000 songs per service.');
 // Validate every requested version before a partial read can skip a file.
 // Otherwise a stale first appearance could borrow a later current UUID.
 const versions=new Map();for(const song of songs){
  if(!song||! /^[a-f0-9]{64}$/.test(song.songId)||! /^[a-f0-9]{64}$/.test(song.contentHash))throw Error('Invalid saved service song.');
  if(versions.has(song.songId)&&versions.get(song.songId)!==song.contentHash)throw Error('A repeated service song has a different saved version. Refresh its reference.');
  versions.set(song.songId,song.contentHash);
 }
 const root=await fs.realpath(directory),files=await walk(root),locations=new Map(files.map(file=>[idFor(path.relative(root,file),root),file])),result=[],seen=new Map();let total=0;
 for(const song of songs){
  if(!song||! /^[a-f0-9]{64}$/.test(song.songId)||! /^[a-f0-9]{64}$/.test(song.contentHash))throw Error('Invalid saved service song.');
  if(seen.has(song.songId)){const prior=seen.get(song.songId);if(prior.contentHash!==song.contentHash)throw Error('A repeated service song has a different saved version. Refresh its reference.');result.push(prior.item);continue;}
  let saved;
  try{
   const file=locations.get(song.songId);if(!file)throw Error('A service song is no longer in Lyrics.');
   if(path.extname(file).toLowerCase()!=='.pro')throw Error('Save service songs as ProPresenter files in Lyrics before syncing.');
   saved=await savedPresentation(root,file,song.contentHash);
  }catch(error){if(!allowUnavailable)throw error;continue;}
  const {bytes,uuid,name}=saved;total+=bytes.length;if(total>500*1024*1024)throw Error('This service contains too much presentation data.');
  const item={songId:song.songId,uuid,name};seen.set(song.songId,{contentHash:song.contentHash,item});result.push(item);
 }
 return result;
}
async function playlistAttachmentReferences(directory,paths){
 if(!Array.isArray(paths)||paths.length>1000||paths.some(file=>typeof file!=='string'||!path.isAbsolute(file)||file.length>32768))throw Error('Choose up to 1,000 saved ProPresenter files.');
 const root=await fs.realpath(directory),files=new Set((await walk(root)).filter(file=>path.extname(file).toLowerCase()==='.pro')),result=[],seen=new Set();let total=0;
 for(const input of paths){
  // Exporting elsewhere is valid, but it must not become an implicit Lyrics
  // reference. No filename/title fallback or file copying is performed here.
  let actual;try{actual=await fs.realpath(input);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(!actual.startsWith(root+path.sep)||!files.has(actual)||seen.has(actual))continue;
  const saved=await savedPresentation(root,actual);total+=saved.bytes.length;if(total>500*1024*1024)throw Error('This batch contains too much presentation data.');seen.add(actual);
  result.push({songId:idFor(path.relative(root,actual),root),contentHash:saved.contentHash,title:String(saved.name).slice(0,300),filename:path.basename(actual)});
 }
 return result;
}
module.exports={playlistReferences,playlistAttachmentReferences};
