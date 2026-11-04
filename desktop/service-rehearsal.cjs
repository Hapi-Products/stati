'use strict';
// Rehearsal reads a snapshot of verified local lyrics. It has no connection to
// ProPresenter and never changes service plans, presentation files or live output.
const fs=require('node:fs/promises'),constants=require('node:fs').constants,path=require('node:path'),crypto=require('node:crypto');
const {walk,songText,rtfPlain}=require('./library.cjs'),{idFor}=require('./song-catalog.cjs'),{decode}=require('./presentation.cjs');
const {layoutLyricSlides}=require('../src/shared/lyric-layout.js'),{songEnding}=require('../src/shared/song-language.js'),{lyricSection,cleanLyricLine}=require('../src/shared/lyric-labels.js');
const {songEndingSize}=require('../src/shared/song-ending-style.js');
const {applyServiceArrangement,validateServiceArrangement}=require('../src/shared/service-arrangement.js');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HASH=/^[a-f0-9]{64}$/;
const MAX_FILE=50*1024*1024,MAX_BYTES=500*1024*1024,MAX_TEXT=2*1024*1024,MAX_SLIDES=5000;
function aborted(){return Object.assign(Error('Rehearsal closed or the selected profile changed.'),{name:'AbortError'});}
const unchanged=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
function validate(plan){
 if(!plan||!UUID.test(plan.id||'')||typeof plan.title!=='string'||plan.title.length>80||typeof plan.date!=='string'||plan.date.length>10||typeof plan.time!=='string'||plan.time.length>5||typeof plan.notes!=='string'||plan.notes.length>10000||!Array.isArray(plan.songs)||plan.songs.length>1000)throw Error('Choose a saved service to rehearse.');
 const ids=new Set();for(const song of plan.songs){if(!song||!UUID.test(song.id||'')||ids.has(song.id)||!HASH.test(song.songId||'')||!HASH.test(song.contentHash||'')||typeof song.title!=='string'||song.title.length>300||typeof song.reviewed!=='boolean')throw Error('Choose valid saved service songs.');if(song.arrangement!==undefined)validateServiceArrangement(song.arrangement);ids.add(song.id);}
}
function textSlides(text){
 const slides=[];let section='Verse',lines=[];
 const flush=()=>{for(let n=0;n<lines.length;n+=4)slides.push({section,text:lines.slice(n,n+4).join('\n')});lines=[];};
 for(const line of text.replace(/\r\n?/g,'\n').split('\n')){if(!line.trim()){flush();continue;}const heading=lyricSection(line);if(heading){flush();section=heading;continue;}const value=cleanLyricLine(line);if(value)lines.push(value);}flush();
 return layoutLyricSlides(slides,96,4);
}
function nativeSlides(bytes){
 const doc=decode(bytes),slides=[];let fontSize=96,foundFont=false,ending,endingFontSize=36;
 for(const cue of doc.cues||[]){const words=[];let section='Verse';for(const action of cue.actions||[]){if(typeof action.label?.text==='string')section=action.label.text.slice(0,100);for(const item of action.slide?.presentation?.baseSlide?.elements||[]){
  const element=item.element,data=element?.text?.rtfData;if(!data)continue;const rtf=Buffer.from(data,'base64').toString('latin1'),plain=rtfPlain(rtf);
  if(element.name==='Song ending'){if(/^(?:Amen|Amin)$/i.test(plain.trim()))ending=plain.trim();const size=rtf.match(/\\fs(\d+)/);if(size)endingFontSize=songEndingSize(Number(size[1])/2);continue;}
  if(plain.trim())words.push(plain);
  for(const match of rtf.matchAll(/\\fs(\d+)/g)){const size=Math.min(160,Math.max(32,Number(match[1])/2));fontSize=foundFont?Math.max(fontSize,size):size;foundFont=true;}
 }}if(words.length)slides.push({section,text:words.join('\n')});}
 return {slides,fontSize,ending,endingFontSize};
}
async function verifiedBytes(root,file,check){
 const initial=await fs.lstat(file);if(!initial.isFile()||initial.isSymbolicLink()||initial.size<=0||initial.size>MAX_FILE)throw Error('This song cannot be read safely.');
 const actual=await fs.realpath(file);if(!actual.startsWith(root+path.sep))throw Error('This song is outside Lyrics.');await check();
 const handle=await fs.open(actual,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const before=await handle.stat();if(!unchanged(initial,before))throw Error('This song changed while opening.');
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){await check();const result=await handle.read(bytes,offset,Math.min(65536,bytes.length-offset),offset);if(!result.bytesRead)throw Error('This song could not be read completely.');offset+=result.bytesRead;}
  const extra=Buffer.alloc(1);if((await handle.read(extra,0,1,offset)).bytesRead)throw Error('This song changed while opening.');
  const after=await handle.stat(),current=await fs.lstat(file);await check();if(current.isSymbolicLink()||!unchanged(before,after)||!unchanged(before,current)||await fs.realpath(file)!==actual)throw Error('This song changed while opening.');return bytes;
 }finally{await handle.close();}
}
async function readServiceRehearsal(directory,source,{checkActive=()=>{},signal}={}){
 validate(source);const plan=structuredClone(source);let authorityError;const check=async()=>{if(authorityError)throw authorityError;if(signal?.aborted)throw aborted();try{await checkActive();}catch(error){authorityError=error;throw error;}if(signal?.aborted)throw aborted();};await check();
 if(!plan.songs.length)return{id:plan.id,title:plan.title,date:plan.date,time:plan.time,notes:plan.notes,revision:plan.revision||0,ready:true,songs:[]};
 const root=await fs.realpath(directory),files=await walk(root);await check();const locations=new Map(files.map(file=>[idFor(path.relative(root,file),root),file])),cache=new Map(),songs=[];let totalBytes=0,totalText=0,totalSlides=0;
 for(const reference of plan.songs){
  await check();const base={id:reference.id,songId:reference.songId,title:reference.title,reviewed:reference.reviewed,fontSize:96,slides:[]};let saved=cache.get(reference.songId);
  if(!saved){const file=locations.get(reference.songId);if(!file)saved={status:'missing',message:'This song is no longer in Lyrics.'};else try{
   const bytes=await verifiedBytes(root,file,check);totalBytes+=bytes.length;if(totalBytes>MAX_BYTES)throw Object.assign(Error('This service contains too much presentation data. Rehearse it in smaller parts.'),{code:'LIMIT'});
   const contentHash=crypto.createHash('sha256').update(bytes).digest('hex'),extension=path.extname(file).toLowerCase(),data=extension==='.pro'?nativeSlides(bytes):{slides:textSlides(songText(bytes,extension).text),fontSize:96};
   const text=data.slides.map(slide=>slide.text).join('\n');if(text.length>100000||data.slides.length>500||!text.trim())throw Error('This presentation has no supported rehearsal lyrics. Open its original in ProPresenter.');
   if(data.slides.some(slide=>slide.text.length>10000))throw Error('This presentation has too much text on one slide.');
   data.slides.at(-1).ending=data.ending||songEnding(text);data.slides.at(-1).endingFontSize=songEndingSize(data.endingFontSize);saved={status:'available',contentHash,fontSize:data.fontSize,slides:data.slides};
  }catch(error){if(signal?.aborted)throw aborted();await check();if(error.code==='LIMIT')throw error;saved={status:'unreadable',message:'This song could not be opened for rehearsal. Refresh its saved reference and try again.'};}cache.set(reference.songId,saved);}
  if(saved.status!=='available'){songs.push({...base,status:saved.status,message:saved.message});continue;}
  if(saved.contentHash!==reference.contentHash){songs.push({...base,status:'changed',message:'This song changed after it was added. Refresh its service reference before rehearsal.'});continue;}
  const arranged=applyServiceArrangement(saved.slides,reference.arrangement);totalText+=arranged.reduce((sum,slide)=>sum+slide.text.length,0);totalSlides+=arranged.length;if(totalText>MAX_TEXT||totalSlides>MAX_SLIDES)throw Error('This rehearsal is too large. Rehearse the service in smaller parts.');
  songs.push({...base,status:'ready',message:'Lyrics loaded.',fontSize:saved.fontSize,slides:arranged});
 }
 await check();return{id:plan.id,title:plan.title,date:plan.date,time:plan.time,notes:plan.notes,revision:plan.revision||0,ready:songs.every(song=>song.status==='ready'),songs};
}
module.exports={readServiceRehearsal};
