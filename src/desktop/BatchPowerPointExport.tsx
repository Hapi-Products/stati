import {useEffect,useMemo,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Files,FolderOpen,Square,Trash2} from 'lucide-react';
import {extractFile} from './conversion';
import {splitLyrics,type Slide} from '../shared/slides';
import {layoutLyricSlides,lyricFontSize,lyricQualityIssues} from '../shared/lyric-layout.js';
import {songEnding} from '../shared/song-language.js';
import './batch-powerpoint-export.css';

export type BatchPowerPointData={title:string;songName?:string;slides:Slide[];language?:'auto'|'eng'|'ron';fontSize?:number;linesPerSlide?:number;amenFontSize?:number};
export type BatchPowerPointItem={id:string;name:string;data:BatchPowerPointData};
export type BatchPowerPointFileResult={id:string;name:string;status:'saved'|'failed'|'stopped';filename?:string;path?:string;error?:string;bytes?:number;sha256?:string};
export type BatchPowerPointResult={canceled?:boolean;stopped?:boolean;directoryName?:string;results?:BatchPowerPointFileResult[];total?:number};
export type BatchPowerPointBridge={exportPowerPointBatch:(input:{operationId:string;items:BatchPowerPointItem[]})=>Promise<BatchPowerPointResult>;cancelPowerPointBatch:(operationId:string)=>Promise<{stopping:boolean}>;onIdentityRequired?:(callback:()=>void)=>(()=>void)};
type Entry={id:string;file:File;state:'waiting'|'reading'|'ready'|'failed'|'stopped';text:string;songName:string;warning:string;error:string};
type Reader=(file:File,onProgress:(message:string)=>void,language:'eng'|'ron'|'both',onWarning:(message:string)=>void)=>Promise<string>;
type Props={active:boolean;disabled:boolean;fontSize:number;linesPerSlide:number;songLang:'auto'|'eng'|'ron';recognitionLanguage:'eng'|'ron'|'both';amenFontSize?:number;bridge?:Partial<BatchPowerPointBridge>;onBusy?:(value:boolean)=>void;readFile?:Reader};
const accepted='.txt,.pdf,.pptx,.docx,.jpg,.jpeg,.png,.webp';
const errorText=(error:unknown)=>error instanceof Error?error.message:'This file could not be converted.';
const identity=()=>{if(typeof crypto==='undefined'||typeof crypto.randomUUID!=='function')throw Error('Secure batch conversion is unavailable. Update Stați before continuing.');return crypto.randomUUID();};

/** Batch conversion stays separate from the current single-song editor and never sends source file paths. */
export function BatchPowerPointExport({active,disabled,fontSize,linesPerSlide,songLang,recognitionLanguage,amenFontSize=36,bridge:providedBridge,onBusy,readFile=extractFile}:Props){
 const bridge=providedBridge||(window.stati as unknown as Partial<BatchPowerPointBridge>),input=useRef<HTMLInputElement>(null),epoch=useRef(0),alive=useRef(true),working=useRef<'reading'|'exporting'|null>(null),stopRead=useRef(false),exportId=useRef<string|null>(null),canceling=useRef<string|null>(null);
 const [entries,setEntries]=useState<Entry[]>([]),[selected,setSelected]=useState(''),[phase,setPhase]=useState<'reading'|'exporting'|null>(null),[message,setMessage]=useState(''),[error,setError]=useState(''),[results,setResults]=useState<BatchPowerPointResult|null>(null),[slideIndex,setSlideIndex]=useState(0),[stopRequested,setStopRequested]=useState(false);
 const entry=entries.find(entry=>entry.id===selected)||entries[0];
 const snapshot=(item:Entry):BatchPowerPointItem=>({id:item.id,name:item.file.name,data:{title:(splitLyrics(item.text,linesPerSlide)[0]?.text.split('\n')[0]||'Presentation').slice(0,180).replace(/[\uD800-\uDBFF]$/,''),songName:item.songName.trim(),slides:splitLyrics(item.text,linesPerSlide),language:songLang,fontSize,linesPerSlide,amenFontSize}});
 const problems=(item:Entry)=>lyricQualityIssues(layoutLyricSlides(splitLyrics(item.text,linesPerSlide),fontSize,linesPerSlide),fontSize);
 const eligible=entries.filter(entry=>entry.state==='ready'&&splitLyrics(entry.text,linesPerSlide).length>0&&!problems(entry).length);
 const slides=useMemo(()=>entry?layoutLyricSlides(splitLyrics(entry.text,linesPerSlide),fontSize,linesPerSlide):[],[entry?.text,fontSize,linesPerSlide]),currentIndex=Math.max(0,Math.min(slideIndex,slides.length-1)),issues=entry?problems(entry):[];
 const locked=disabled||!active||phase!==null;
 function cancelExport(){const id=exportId.current,token=epoch.current;if(!id||canceling.current===id||!bridge.cancelPowerPointBatch)return;canceling.current=id;setStopRequested(true);void bridge.cancelPowerPointBatch(id).catch(failure=>{if(alive.current&&token===epoch.current)setError(errorText(failure));}).finally(()=>{if(canceling.current===id)canceling.current=null;});}
 function stop(){stopRead.current=true;setStopRequested(true);if(working.current==='exporting')cancelExport();}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;stopRead.current=true;const id=exportId.current;if(id)void bridge.cancelPowerPointBatch?.(id).catch(()=>{});};},[bridge]);
 useEffect(()=>{onBusy?.(phase!==null);return()=>{onBusy?.(false);};},[phase,onBusy]);
 useEffect(()=>{if(!active||disabled){epoch.current++;stopRead.current=true;if(working.current==='exporting')cancelExport();}},[active,disabled]);
 useEffect(()=>{let live=true;const unsubscribe=bridge.onIdentityRequired?.(()=>{if(!live)return;epoch.current++;stop();setEntries([]);setSelected('');setResults(null);setError('');setMessage('');});return()=>{live=false;unsubscribe?.();};},[bridge]);
 useEffect(()=>{setResults(null);setSlideIndex(0);},[fontSize,linesPerSlide,songLang,amenFontSize]);
 function revise(patch:Partial<Entry>){if(!entry||locked)return;setEntries(previous=>previous.map(item=>item.id===entry.id?{...item,...patch}:item));setResults(null);setSlideIndex(0);}
 async function readEntries(queue:Entry[]){
  if(!active||disabled||working.current)return;const token=epoch.current;working.current='reading';stopRead.current=false;setStopRequested(false);setPhase('reading');setError('');setResults(null);
  try{for(const item of queue){
   if(stopRead.current||token!==epoch.current)break;
   setEntries(previous=>previous.map(entry=>entry.id===item.id?{...entry,state:'reading',error:'',warning:''}:entry));setMessage('Reading '+item.file.name+'…');
   let warning='';
   try{const text=await readFile(item.file,value=>{if(token===epoch.current)setMessage(value);},recognitionLanguage,value=>{warning=value;});
    if(token!==epoch.current)break;if(!text.trim())throw Error('No lyric text was found. Paste lyrics for this file.');if(text.length>100000)throw Error('This file contains too much text. Convert it in smaller parts.');
    setEntries(previous=>previous.map(entry=>entry.id===item.id?{...entry,state:'ready',text,error:'',warning}:entry));
   }catch(failure){if(token!==epoch.current)break;setEntries(previous=>previous.map(entry=>entry.id===item.id?{...entry,state:'failed',error:errorText(failure)}:entry));}
  }}finally{
   working.current=null;
   if(alive.current){setEntries(previous=>previous.map(entry=>entry.state==='waiting'||entry.state==='reading'?{...entry,state:'stopped'}:entry));setPhase(null);setMessage('');setStopRequested(false);}
  }
 }
 async function select(files:File[]){
  if(locked||working.current)return;
  if(!files.length)return;if(files.length>20||files.some(file=>!file.size||file.size>50*1024*1024||!(/\.(txt|pdf|pptx|docx|jpe?g|png|webp)$/i.test(file.name)))){setError('Choose up to 20 supported files, each non-empty and up to 50 MB.');return;}
  try{const next=files.map(file=>({id:identity(),file,state:'waiting' as const,text:'',songName:'',warning:'',error:''}));setEntries(next);setSelected(next[0].id);setSlideIndex(0);await readEntries(next);}catch(failure){setError(errorText(failure));}
 }
 async function exportSongs(){
  if(locked||working.current||!eligible.length||!bridge.exportPowerPointBatch)return;const token=epoch.current;
  try{const operationId=identity();exportId.current=operationId;working.current='exporting';setPhase('exporting');setStopRequested(false);setError('');setResults(null);
   const result=await bridge.exportPowerPointBatch({operationId,items:eligible.map(snapshot)});if(token===epoch.current&&!result.canceled)setResults(result);
  }catch(failure){if(token===epoch.current)setError(errorText(failure));}
  finally{exportId.current=null;working.current=null;if(alive.current){setPhase(null);setStopRequested(false);}}
 }
 if(!bridge.exportPowerPointBatch)return null;
 return <details className="batch-pptx"><summary><Files size={16}/>Batch PowerPoint lyrics</summary>
  <p>Import up to 20 songs, then export their PowerPoint files to one folder. Your current editor draft stays open.</p>
  <div className="batch-pptx-actions"><button type="button" className="button" disabled={locked} onClick={()=>input.current?.click()}><FolderOpen size={16}/>Choose lyric files</button>{entries.some(entry=>['stopped','failed'].includes(entry.state))&&<button type="button" className="button" disabled={locked} onClick={()=>void readEntries(entries.filter(entry=>['stopped','failed'].includes(entry.state)))}>Read remaining files</button>}{phase&&<button type="button" className="button" disabled={stopRequested} onClick={stop}><Square size={14}/>{stopRequested?'Stopping…':phase==='reading'?'Stop after this file':'Stop export'}</button>}</div>
  <input ref={input} type="file" multiple hidden accept={accepted} aria-label="Choose batch lyric files" onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';void select(files);}}/>
  {message&&<p role="status">{message}</p>}{phase==='exporting'&&<p role="status">Exporting {eligible.length} song{eligible.length===1?'':'s'}… Choose the output folder in the native dialog.</p>}{error&&<p className="inline-error" role="alert">{error}</p>}
  {entries.length>0&&<><div className="batch-pptx-layout"><nav aria-label="Songs in batch" className="batch-pptx-list">{entries.map(item=><button type="button" className="button" key={item.id} disabled={locked} aria-current={item.id===entry?.id?'step':undefined} onClick={()=>{setSelected(item.id);setSlideIndex(0);}}><span>{item.file.name}</span><small>{item.state==='ready'?'Ready':item.state==='reading'?'Reading…':item.state==='failed'?'Needs attention':item.state==='stopped'?'Not read':'Waiting'}</small></button>)}</nav>
   {entry&&<section className="batch-pptx-review" aria-label={'Lyrics for '+entry.file.name}>
    <label>Song name optional<input value={entry.songName} maxLength={100} disabled={locked} onChange={event=>revise({songName:event.target.value})}/></label>
    <label>Lyrics<textarea rows={7} value={entry.text} maxLength={100000} disabled={locked} onChange={event=>revise({text:event.target.value,state:'ready',error:''})}/></label>
    {entry.warning&&<p className="batch-pptx-warning" role="status">{entry.warning}</p>}{entry.error&&<p className="inline-error" role="alert">{entry.error}</p>}
    {issues.map((issue,index)=><p className="inline-error" key={issue.code+index} role="alert">{issue.message}</p>)}
    {!!slides.length&&<><div className="batch-pptx-slide" style={{containerType:'inline-size'}} aria-label="Batch PowerPoint lyric preview"><p style={{fontSize:`${lyricFontSize(slides[currentIndex].text,fontSize)/19.2}cqw`}}>{slides[currentIndex].text}</p>{currentIndex===slides.length-1&&<span style={{fontSize:`${amenFontSize/19.2}cqw`}}>{songEnding(entry.text,songLang)}</span>}</div><div className="batch-pptx-pages"><button type="button" className="button small" aria-label="Previous batch preview slide" disabled={locked||currentIndex===0} onClick={()=>setSlideIndex(value=>Math.max(0,value-1))}><ChevronLeft size={16}/></button><span>{currentIndex+1} / {slides.length}</span><button type="button" className="button small" aria-label="Next batch preview slide" disabled={locked||currentIndex>=slides.length-1} onClick={()=>setSlideIndex(value=>Math.min(slides.length-1,value+1))}><ChevronRight size={16}/></button></div></>}
    <button type="button" className="button small" disabled={locked} onClick={()=>{setEntries(previous=>previous.filter(item=>item.id!==entry.id));setSelected('');setSlideIndex(0);setResults(null);}}><Trash2 size={15}/>Remove from batch</button>
   </section>}
  </div><button type="button" className="button" disabled={locked||!eligible.length} onClick={()=>void exportSongs()}><Files size={16}/>Export songs ({eligible.length})</button><p className="muted caption">Lyrics and slide settings are checked automatically. Existing PowerPoint files are kept; new filenames are chosen for conflicts.</p></>}
  {results?.results&&<div className="batch-pptx-results" role="status"><strong>{results.stopped?'Batch stopped; completed files were kept.':'PowerPoint batch finished.'}</strong><ul>{results.results.map(result=><li key={result.id}><strong>{result.name}</strong><span>{result.status==='saved'?'Saved: '+result.filename:result.error||'Not exported'}</span></li>)}</ul></div>}
 </details>;
}
