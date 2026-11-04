'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {validate}=require('./presentation.cjs'),{songTitle}=require('./library.cjs');
const {safeTransferFilename}=require('../src/shared/file-name.js');
const work=require('./conversion-work.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_ITEMS=20,MAX_TEXT=2*1024*1024,MAX_BYTES=50*1024*1024;
function checkedItems(items){
 if(!Array.isArray(items)||!items.length||items.length>MAX_ITEMS)throw Error('Export between 1 and 20 songs at a time.');
 const ids=new Set();let characters=0;
 for(const item of items){
  if(!item||!UUID.test(item.id||'')||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>255)throw Error('Choose unique songs for this PowerPoint batch.');ids.add(item.id);
  if(Array.isArray(item.data?.slides)){if(item.data.slides.length>500)throw Error('Choose songs with 500 slides or fewer.');for(const slide of item.data.slides)if(typeof slide?.text==='string')characters+=slide.text.length;}
  if(characters>MAX_TEXT)throw Error('This batch contains too much lyric text. Export fewer songs at a time.');
 }
 // Only recognized presentation fields enter the worker. Ignore arbitrary
 // renderer metadata, paths and nested data instead of cloning an unbounded object.
 return items.map(item=>{const data=item.data&&typeof item.data==='object'?{title:item.data.title,songName:item.data.songName,language:item.data.language,fontSize:item.data.fontSize,linesPerSlide:item.data.linesPerSlide,amenFontSize:item.data.amenFontSize,slides:Array.isArray(item.data.slides)?item.data.slides.map(slide=>slide&&typeof slide==='object'?{section:slide.section,text:slide.text}:null):item.data.slides}:null;return{id:item.id,name:item.name,data};});
}
const identity=info=>({dev:info.dev,ino:info.ino});
const owned=(info,created)=>info&&!info.isSymbolicLink()&&info.dev===created.dev&&info.ino===created.ino;
function baseFilename(title){return safeTransferFilename(title.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/,'').slice(0,100).replace(/[\uD800-\uDBFF]$/,'')+'.pptx');}
async function saveNew(root,requested,bytes,check,signal){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_BYTES)throw Error('The generated PowerPoint file is invalid or too large.');
 const names=await fs.readdir(root);if(names.length>10000)throw Error('Choose an output folder with fewer than 10,000 files.');
 const reserved=new Set(names.map(name=>name.normalize('NFC').toLocaleLowerCase('en-US'))),stem=requested.slice(0,-5);
 for(let suffix=0;suffix<10000;suffix++){
  await check();const filename=suffix?stem+' ('+(suffix+1)+').pptx':requested;
  if(reserved.has(filename.normalize('NFC').toLocaleLowerCase('en-US')))continue;
  const target=path.join(root,filename);let handle,created;
  try{
   handle=await fs.open(target,'wx',0o600);created=identity(await handle.stat());await check();
   await handle.writeFile(bytes);await handle.sync();await check();const after=await fs.lstat(target);
   if(!owned(after,created)||after.size!==bytes.length)throw Error('The exported PowerPoint file changed before it could be confirmed.');
   await handle.close();handle=null;
   const expected=crypto.createHash('sha256').update(bytes).digest('hex');
   const verified=await require('./preview-bytes.cjs').readLocalPreview(target,{expectedChecksum:expected,checkActive:check,signal});await check();
   if(verified.sha256!==expected)throw Error('The exported PowerPoint bytes could not be verified.');
   return{path:target,filename,bytes:bytes.length,sha256:expected};
  }catch(error){
   await handle?.close().catch(()=>{});handle=null;
   if(created){const current=await fs.lstat(target).catch(()=>null);if(owned(current,created))await fs.unlink(target).catch(()=>{});}
   if(error.code==='EEXIST'){reserved.add(filename.normalize('NFC').toLocaleLowerCase('en-US'));continue;}
   throw error;
  }finally{await handle?.close().catch(()=>{});}
 }
 throw Error('Could not choose a new PowerPoint filename. Existing files were preserved.');
}
/** Trusted native folder plus lyric data; no source or output paths from a renderer. */
async function exportPowerPointBatch({items,directory,checkActive=()=>{},signal,onProgress=()=>{}}={}){
 const selected=checkedItems(items),results=[];
 if(typeof directory!=='string'||!path.isAbsolute(directory)||directory.includes('\0'))throw Error('Choose an output folder for these PowerPoint files.');
 let authorityError;
 const check=()=>{if(authorityError)throw authorityError;signal?.throwIfAborted();try{checkActive();}catch(error){authorityError=error;throw error;}signal?.throwIfAborted();};await check();
 const root=await fs.realpath(directory),stat=await fs.stat(root);if(!stat.isDirectory())throw Error('Choose an output folder for these PowerPoint files.');await check();
 const notify=()=>{try{onProgress({completed:results.length,total:selected.length,results:results.map(result=>({...result}))});}catch{}};
 let stopped=false;
 for(const item of selected){
  try{
   await check();validate(item.data);const title=songTitle(item.data.slides,item.data.songName||''),data={...item.data,title};
   const bytes=await work.withSignal('pptx-build',signal,data);await check();
   const file=await saveNew(root,baseFilename(title),bytes,check,signal);results.push({id:item.id,name:item.name,status:'saved',...file});notify();
  }catch(error){
   if(signal?.aborted||error?.name==='AbortError'){stopped=true;break;}
   // A lost identity is never treated as one bad song followed by more work.
   await check();results.push({id:item.id,name:item.name,status:'failed',error:error instanceof Error?error.message:'This song could not be exported.'});notify();
  }
 }
 if(stopped){const done=new Set(results.map(result=>result.id));for(const item of selected)if(!done.has(item.id))results.push({id:item.id,name:item.name,status:'stopped',error:'Export stopped. Completed PowerPoint files were kept.'});notify();}
 return{stopped,directoryName:path.basename(root),results,total:selected.length};
}
module.exports={exportPowerPointBatch};
