import {useEffect,useRef,useState,type DragEvent} from 'react';
import {FolderOpen,GripVertical,Music2,RefreshCw,SquareArrowOutUpRight} from 'lucide-react';
import './audio-playback.css';
import {AudioPreparation,type AudioPreparationBridge} from './AudioPreparation';

export type PreparedAudioFile={id:string;filename:string;bytes:number;sha256:string;existing:boolean};
export type AudioFileSelection={canceled?:boolean;state:'ready-to-import'|'not-ready';files:PreparedAudioFile[];failures:{filename:string;error:string}[];imported:false};
export type AudioPlaybackStatus={state:'ready-to-import'|'needs-playlist';playlist:{id:string;name:string}|null;focused?:boolean;imported:false;instructions:string};
export type AudioPlaybackBridge={chooseAudioFiles:()=>Promise<AudioFileSelection>;audioPlaybackStatus:()=>Promise<AudioPlaybackStatus>;focusAudioPlayback:()=>Promise<AudioPlaybackStatus>;dragAudioFiles:(ids:string[])=>void;revealAudioFile:(id:string)=>Promise<unknown>;onAudioError:(callback:(error:unknown)=>void)=>(()=>void)}&Partial<AudioPreparationBridge>;
type Operation={epoch:number;kind:'choose'|'check'|'focus'|'reveal'};
const missingPlaylist='Create an Audio playlist named Playback in ProPresenter, then drag these files into it.';
function message(error:unknown){return error instanceof Error?error.message:typeof error==='string'?error:error&&typeof error==='object'&&'message'in error?String(error.message):'The audio action could not be completed. Show its folder and drag the MP3 files from there.';}

export function AudioPlayback({active,disabled,bridge}:{active:boolean;disabled:boolean;bridge?:Partial<AudioPlaybackBridge>}){
 const source=bridge||(window.stati as unknown as Partial<AudioPlaybackBridge>),epoch=useRef(0),operation=useRef<Operation|null>(null),previousSource=useRef(source);
 const [files,setFiles]=useState<PreparedAudioFile[]>([]),[failures,setFailures]=useState<AudioFileSelection['failures']>([]),[connection,setConnection]=useState<AudioPlaybackStatus|null>(null),[working,setWorking]=useState<Operation['kind']|null>(null),[error,setError]=useState('');
 const current=(task:Operation)=>epoch.current===task.epoch&&operation.current===task;
 function start(kind:Operation['kind']){if(!active||disabled||operation.current)return null;const task={epoch:epoch.current,kind};operation.current=task;setWorking(kind);setError('');return task;}
 function finish(task:Operation){if(current(task)){operation.current=null;setWorking(null);}}
 async function check(){if(!source.audioPlaybackStatus)return;const task=start('check');if(!task)return;try{const result=await source.audioPlaybackStatus();if(current(task))setConnection(result);}catch(failure){if(current(task))setError(message(failure));}finally{finish(task);}}
 useEffect(()=>{
  epoch.current++;operation.current=null;setWorking(null);setError('');
  if(previousSource.current!==source||disabled){setFiles([]);setFailures([]);setConnection(null);}previousSource.current=source;
  let unsubscribe:(()=>void)|undefined;
  if(active&&!disabled){const scope=epoch.current;unsubscribe=source.onAudioError?.(failure=>{if(scope===epoch.current)setError(message(failure));});void check();}
  return()=>{epoch.current++;operation.current=null;unsubscribe?.();};
 },[active,disabled,source]);
 async function choose(){if(!source.chooseAudioFiles){setError('Update Stați on this computer to prepare MP3 files.');return;}const task=start('choose');if(!task)return;try{const result=await source.chooseAudioFiles();if(current(task)&&!result.canceled){setFiles([...new Map(result.files.map(file=>[file.id,file])).values()]);setFailures(result.failures);}}catch(failure){if(current(task))setError(message(failure));}finally{finish(task);}}
 async function focus(){if(!source.focusAudioPlayback||!connection?.playlist)return;const task=start('focus');if(!task)return;try{const result=await source.focusAudioPlayback();if(current(task))setConnection(result);}catch(failure){if(current(task))setError(message(failure));}finally{finish(task);}}
 async function reveal(id:string){if(!source.revealAudioFile)return;const task=start('reveal');if(!task)return;try{await source.revealAudioFile(id);}catch(failure){if(current(task))setError(message(failure));}finally{finish(task);}}
 const locked=disabled||!active||working!==null,canDrag=!locked&&!!source.dragAudioFiles;
 // Electron must receive the native drag in this same trusted gesture. Do not
 // await a request or defer this call to a promise or timer.
 function drag(event:DragEvent,ids:string[]){event.preventDefault();if(!canDrag||!ids.length)return;setError('');try{source.dragAudioFiles!(ids);}catch(failure){setError(message(failure));}}
 const instructions=connection?.state==='needs-playlist'?missingPlaylist:connection?.instructions?.trim()||'Open ProPresenter and drag the prepared MP3 files into its Playback audio playlist.';
 return <><section className="panel audio-playback" aria-labelledby="audio-playback-title">
  <div className="audio-playback-heading"><div><h2 id="audio-playback-title"><Music2 size={20} aria-hidden="true"/>Audio / Playback</h2><p>MP3 files already work in ProPresenter. Your original files stay saved.</p></div><button type="button" className="button primary" disabled={locked} onClick={()=>void choose()}><FolderOpen size={17} aria-hidden="true"/>{working==='choose'?'Preparing…':'Choose MP3s'}</button></div>
  <div className="audio-playback-connection"><p role="status">{instructions}</p><div className="audio-playback-actions">{source.audioPlaybackStatus&&<button type="button" className="button" disabled={locked} onClick={()=>void check()}><RefreshCw size={16} aria-hidden="true"/>{working==='check'?'Checking…':'Check connection'}</button>}{source.focusAudioPlayback&&<button type="button" className="button" disabled={locked||!connection?.playlist} onClick={()=>void focus()}><SquareArrowOutUpRight size={16} aria-hidden="true"/>Open Playback</button>}</div></div>
  {error&&<p className="inline-error audio-playback-error" role="alert">{error}</p>}
  {files.length>0?<><div className="audio-playback-ready"><strong role="status">Ready to import · {files.length} MP3{files.length===1?'':'s'}</strong><button type="button" className="button audio-playback-drag" title="Drag all MP3 files into Playback in ProPresenter" draggable={canDrag} disabled={!canDrag} onDragStart={event=>drag(event,files.map(file=>file.id))}><GripVertical size={17} aria-hidden="true"/>Drag all</button></div><ul className="audio-playback-files" aria-label="Prepared MP3 files">{files.map(file=><li key={file.id} className="audio-playback-file" draggable={canDrag} onDragStart={event=>drag(event,[file.id])}><Music2 size={22} aria-hidden="true"/><div><strong>{file.filename}</strong><small>{(file.bytes/1024/1024).toFixed(1)} MB</small></div><button type="button" className="button audio-playback-folder" title={'Show in folder: '+file.filename} aria-label={'Show in folder: '+file.filename} disabled={locked||!source.revealAudioFile} onClick={()=>void reveal(file.id)}><FolderOpen size={17} aria-hidden="true"/></button></li>)}</ul><p className="audio-playback-hint">Drag a file or Drag all into Playback. You choose when to play it in ProPresenter.</p></>:<p className="audio-playback-empty">Choose the MP3 files you want in Playback.</p>}
  {failures.length>0&&<details className="audio-playback-failures"><summary>{failures.length} file{failures.length===1?'':'s'} could not be prepared</summary><ul>{failures.map((failure,index)=><li key={failure.filename+':'+index}><strong>{failure.filename}</strong><span>{failure.error}</span></li>)}</ul></details>}
 </section><AudioPreparation active={active} disabled={disabled} bridge={source}/></>;
}
