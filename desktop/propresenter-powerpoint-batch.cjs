'use strict';
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const signature=s=>['dev','ino','size','mtimeNs','ctimeNs'].map(key=>String(s[key])).join(':');
async function readPowerPointSource(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0')||!['.pro','.pro6'].includes(path.extname(file).toLowerCase()))throw Error('Choose a ProPresenter song file.');
 const before=await fs.lstat(file,{bigint:true});if(before.isSymbolicLink()||!before.isFile()||before.size>50n*1024n*1024n)throw Error('Choose a regular ProPresenter song up to 50 MB.');
 const song=await require('./song-catalog.cjs').readSong(path.dirname(file),file),after=await fs.lstat(file,{bigint:true});if(signature(before)!==signature(after))throw Error('This ProPresenter song changed while opening. Try it again.');
 if(!song.text.trim())throw Error('This presentation has no editable lyrics. Image-only slides cannot become editable PowerPoint lyrics.');
 const slides=song.text.split(/\n\s*\n/).map(text=>({section:'Lyrics',text:text.trim()})).filter(slide=>slide.text);if(slides.length>500)throw Error('Choose a song with 500 slides or fewer.');
 return{sourceHash:song.contentHash,signature:signature(after),data:{title:song.title,songName:song.title.slice(0,100),slides,linesPerSlide:Math.min(8,Math.max(2,...slides.map(slide=>slide.text.split('\n').length))),fontSize:song.fontSize,amenFontSize:song.amenFontSize,language:'auto'}};
}
async function exportProPresenterFiles({files,directory,checkActive=()=>{},signal,onProgress=()=>{},writeOutput}={}){
 if(!Array.isArray(files)||!files.length||files.length>500||files.some(file=>typeof file!=='string'||!path.isAbsolute(file)))throw Error('Choose between 1 and 500 ProPresenter song files.');
 const results=[],selected=[...new Set(files)],work=require('./conversion-work.cjs');let stopped=false;
 for(const file of selected){
  if(signal?.aborted){stopped=true;break;}checkActive();const name=path.basename(file),fileSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(45000)]);
  try{
   onProgress({completed:results.length,total:selected.length,name,phase:'reading',message:'Reading editable ProPresenter lyrics',results:[...results]});
   const source=await work.withSignal('pro-powerpoint-source',fileSignal,file);checkActive();fileSignal.throwIfAborted();
   const check=()=>{checkActive();fileSignal.throwIfAborted();const current=sync.lstatSync(file,{bigint:true});if(current.isSymbolicLink()||signature(current)!==source.signature)throw Error('The ProPresenter source changed during conversion. Its original was kept.');};check();
   onProgress({completed:results.length,total:selected.length,name,phase:'building',message:'Building editable PowerPoint lyrics',results:[...results]});
   if(writeOutput){const bytes=await work.withSignal('pptx-build',fileSignal,source.data);check();const saved=await writeOutput({source:file,sourceHash:source.sourceHash,data:source.data,bytes,signal:fileSignal,checkActive:check});check();if(!saved?.path)throw Error(saved?.error||'The linked PowerPoint could not be saved.');results.push({...saved,name,status:saved.status==='unchanged'?'skipped':saved.status==='resynced'?'resynced':'converted'});}
   else{const exported=await require('./powerpoint-export-batch.cjs').exportPowerPointBatch({items:[{id:crypto.randomUUID(),name,data:source.data}],directory,checkActive:check,signal:fileSignal});checkActive();const result=exported.results[0];if(!result||result.status!=='saved')throw Error(result?.error||'This song could not be exported.');results.push({...result,name,status:'converted'});}
  }catch(error){if(signal?.aborted){stopped=true;break;}checkActive();results.push({name,status:'failed',error:error?.name==='TimeoutError'?'Conversion timed out. This original was kept.':error.message});}
  onProgress({completed:results.length,total:selected.length,name,phase:'finished',results:[...results]});
 }
 return{directory,results,total:selected.length,stopped};
}
module.exports={readPowerPointSource,exportProPresenterFiles};
