import {useCallback,useEffect,useMemo,useRef,useState,type KeyboardEvent} from 'react';
import {ChevronLeft,ChevronRight,Music2,RefreshCw,X} from 'lucide-react';
import {lyricFontSize} from '../shared/lyric-layout.js';
import {songEndingSize} from '../shared/song-ending-style.js';
import './rehearsal.css';

export type RehearsalSlide={section:string;text:string;ending?:string;endingFontSize?:number};
export type RehearsalSong={id:string;songId:string;title:string;reviewed:boolean;status:'ready'|'missing'|'changed'|'unreadable';message:string;fontSize:number;slides:RehearsalSlide[]};
export type RehearsalSnapshot={id:string;title:string;date:string;time:string;notes:string;revision:number;ready:boolean;songs:RehearsalSong[]};
export type RehearsalAudio={canceled?:boolean;filename?:string;contentType?:'audio/mpeg';bytes?:ArrayBuffer|Uint8Array};
export type RehearsalBridge={loadServiceRehearsal:(id:string)=>Promise<RehearsalSnapshot>;chooseRehearsalAudio:()=>Promise<RehearsalAudio>;onIdentityRequired?:(callback:(value?:unknown)=>void)=>(()=>void)};
type Props={serviceId:string;title:string;active:boolean;disabled:boolean;onClose:()=>void;bridge?:Partial<RehearsalBridge>};
const failureMessage=(error:unknown)=>error instanceof Error?error.message:'The rehearsal could not be opened. Try again.';
type AudioLoop={start:string;end:string;duration:number|null;enabled:boolean;error:string};
const emptyLoop=(duration:number|null=null):AudioLoop=>({start:'0',end:duration===null?'':String(duration),duration,enabled:false,error:''});
function loopRange(value:AudioLoop):{error:string}|{start:number;end:number}{
 if(value.duration===null||!Number.isFinite(value.duration)||value.duration<=0)return{error:'Wait for the MP3 duration before setting a loop.'};
 if(!value.start.trim()||!value.end.trim())return{error:'Set both the start (A) and end (B) in seconds.'};
 const start=Number(value.start),end=Number(value.end);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>value.duration)return{error:'Use 0 ≤ start (A) < end (B) ≤ the MP3 duration.'};
 return{start,end};
}

export function Rehearsal({serviceId,title,active,disabled,onClose,bridge}:Props){
 const source=bridge||(window.stati as unknown as Partial<RehearsalBridge>),epoch=useRef(0),onCloseLatest=useRef(onClose),audioElement=useRef<HTMLAudioElement|null>(null),retainedAudio=useRef<HTMLAudioElement|null>(null),audioUrl=useRef<string|null>(null),closeButton=useRef<HTMLButtonElement>(null),choosing=useRef(false),didClose=useRef(false);
 // React clears object refs before passive cleanup. Keep the last media node
 // until we have explicitly stopped it, including on unmount/identity changes.
 const bindAudio=useCallback((element:HTMLAudioElement|null)=>{audioElement.current=element;if(element)retainedAudio.current=element;},[]);
 onCloseLatest.current=onClose;
 const [snapshot,setSnapshot]=useState<RehearsalSnapshot|null>(null),[index,setIndex]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState(''),[audio,setAudio]=useState<{filename:string;url:string}|null>(null),[audioBusy,setAudioBusy]=useState(false),[closed,setClosed]=useState(false),[reload,setReload]=useState(0);
 const [loop,setLoop]=useState<AudioLoop>(emptyLoop),loopLatest=useRef<AudioLoop>(emptyLoop()),userPlaying=useRef(false);
 function updateLoop(value:AudioLoop){loopLatest.current=value;setLoop(value);}
 const ownsAudio=(element:HTMLAudioElement,url:string)=>active&&!disabled&&!didClose.current&&audioElement.current===element&&audioUrl.current===url&&element.getAttribute('src')===url;
 const steps=useMemo(()=>snapshot?.songs.flatMap(song=>song.status==='ready'?song.slides.map((slide,slideIndex)=>({song,slide,slideIndex})):[])||[],[snapshot]),current=steps[Math.min(index,Math.max(0,steps.length-1))];
 function stopAudio(){
  userPlaying.current=false;loopLatest.current=emptyLoop();
  const element=audioElement.current||retainedAudio.current;if(element){try{element.loop=false;element.pause();element.removeAttribute('src');element.load();}catch{}}retainedAudio.current=null;
  if(audioUrl.current){URL.revokeObjectURL(audioUrl.current);audioUrl.current=null;}
 }
 function close(){if(didClose.current)return;didClose.current=true;epoch.current++;choosing.current=false;stopAudio();setLoop(emptyLoop());setAudio(null);setSnapshot(null);setError('');setClosed(true);onCloseLatest.current();}
 useEffect(()=>{
  const scope=++epoch.current;choosing.current=false;stopAudio();setLoop(emptyLoop());setAudio(null);setAudioBusy(false);setSnapshot(null);setIndex(0);setError('');
  if(!active||disabled){didClose.current=true;setLoading(false);return;}
  didClose.current=false;setClosed(false);setLoading(true);
  const hidden=()=>{if(document.visibilityState!=='visible')close();};document.addEventListener('visibilitychange',hidden);
  const unsubscribe=source.onIdentityRequired?.(()=>{if(scope===epoch.current)close();});
  void(async()=>{try{
   if(!source.loadServiceRehearsal)throw Error('Update Stați on this computer to open rehearsal.');
   const value=await source.loadServiceRehearsal(serviceId);if(scope!==epoch.current)return;
   if(value.id!==serviceId||!Array.isArray(value.songs)||value.songs.length>1000)throw Error('The saved rehearsal could not be verified.');setSnapshot(value);
  }catch(error){if(scope===epoch.current)setError(failureMessage(error));}finally{if(scope===epoch.current)setLoading(false);}})();
  return()=>{epoch.current++;choosing.current=false;stopAudio();unsubscribe?.();document.removeEventListener('visibilitychange',hidden);};
 },[serviceId,active,disabled,source,reload]);
 useEffect(()=>{if(active&&!disabled&&!closed)closeButton.current?.focus();},[active,disabled,closed]);
 async function chooseAudio(){
  if(!active||disabled||closed||choosing.current)return;const scope=epoch.current;choosing.current=true;setAudioBusy(true);setError('');
  try{
   if(!source.chooseRehearsalAudio)throw Error('Update Stați to choose local rehearsal audio.');
   const selected=await source.chooseRehearsalAudio();if(scope!==epoch.current||selected.canceled)return;
   if(typeof selected.filename!=='string'||selected.filename.length>255||selected.contentType!=='audio/mpeg'||!(selected.bytes instanceof ArrayBuffer||ArrayBuffer.isView(selected.bytes))||selected.bytes.byteLength<=0||selected.bytes.byteLength>50*1024*1024)throw Error('The selected rehearsal audio could not be verified.');
   stopAudio();setLoop(emptyLoop());const bytes=selected.bytes instanceof ArrayBuffer?selected.bytes:Uint8Array.from(selected.bytes).buffer,url=URL.createObjectURL(new Blob([bytes],{type:'audio/mpeg'}));audioUrl.current=url;setAudio({filename:selected.filename,url});
  }catch(error){if(scope===epoch.current)setError(failureMessage(error));}finally{if(scope===epoch.current){choosing.current=false;setAudioBusy(false);}}
 }
 function metadata(element:HTMLAudioElement,url:string){
  if(!ownsAudio(element,url))return;const duration=element.duration;
  if(!Number.isFinite(duration)||duration<=0){element.loop=false;updateLoop({...emptyLoop(),error:'The MP3 duration is unavailable. Try choosing the file again.'});return;}
  const previous=loopLatest.current;if(previous.duration===duration)return;
  element.loop=false;updateLoop(emptyLoop(duration));
 }
 function editLoop(field:'start'|'end',value:string){const element=audioElement.current;if(element)element.loop=false;updateLoop({...loopLatest.current,[field]:value,enabled:false,error:''});}
 function markLoop(field:'start'|'end'){
  const element=audioElement.current;if(!element||!audio||!ownsAudio(element,audio.url))return;
  if(!Number.isFinite(element.currentTime)){updateLoop({...loopLatest.current,enabled:false,error:'The current audio position is unavailable.'});return;}
  editLoop(field,String(Math.floor(Math.max(0,element.currentTime)*1000)/1000));
 }
 function toggleLoop(){
  const previous=loopLatest.current,element=audioElement.current;if(!element||!audio||!ownsAudio(element,audio.url))return;
  if(previous.enabled){element.loop=false;updateLoop({...previous,enabled:false,error:''});return;}
  const range=loopRange(previous);if('error'in range){element.loop=false;updateLoop({...previous,enabled:false,error:range.error});return;}
  // Native looping covers B at the exact duration; timeupdate narrows it to A/B.
  // Enabling only changes loop state. Initial playback always uses manual Play.
  element.loop=true;updateLoop({...previous,enabled:true,error:''});
 }
 function enforceLoop(element:HTMLAudioElement,url:string,ended=false){
  if(!ownsAudio(element,url)||!userPlaying.current||!loopLatest.current.enabled||!ended&&element.paused)return;
  const range=loopRange(loopLatest.current);if('error'in range){element.loop=false;updateLoop({...loopLatest.current,enabled:false,error:range.error});return;}
  const time=element.currentTime;if(!Number.isFinite(time))return;
  if(ended||time>=range.end||time<range.start){try{element.currentTime=range.start;}catch{element.loop=false;updateLoop({...loopLatest.current,enabled:false,error:'This MP3 could not seek to the loop start. Choose it again.'});}}
 }
 function paused(element:HTMLAudioElement,url:string){
  if(!ownsAudio(element,url))return;userPlaying.current=false;element.loop=false;updateLoop(emptyLoop(loopLatest.current.duration));
 }
 function keys(event:KeyboardEvent){
  if(event.key==='Escape'){event.preventDefault();close();return;}
  if(event.altKey||event.ctrlKey||event.metaKey||(event.target as HTMLElement).closest?.('audio,input,textarea,select'))return;
  if(event.key==='ArrowRight'||event.key==='PageDown'){event.preventDefault();setIndex(value=>Math.min(Math.max(0,steps.length-1),value+1));}
  else if(event.key==='ArrowLeft'||event.key==='PageUp'){event.preventDefault();setIndex(value=>Math.max(0,value-1));}
  else if(event.key==='Home'){event.preventDefault();setIndex(0);}
  else if(event.key==='End'){event.preventDefault();setIndex(Math.max(0,steps.length-1));}
  else if(event.key==='Tab'){
   const container=event.currentTarget,controls=[...container.querySelectorAll<HTMLElement>('button:not([disabled]),audio[controls],a[href],input,select,textarea,[tabindex="0"]')].filter(element=>!element.hasAttribute('hidden'));
   if(!controls.length)return;const first=controls[0],last=controls.at(-1)!;
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
 }
 if(!active||disabled||closed)return null;
 return <div className="rehearsal-shade"><section className="rehearsal-dialog" role="dialog" aria-modal="true" aria-labelledby="rehearsal-title" onKeyDown={keys}>
  <header className="rehearsal-heading"><div><h2 id="rehearsal-title">Rehearse · {snapshot?.title||title}</h2><p>Local lyrics preview. ProPresenter’s live output stays unchanged.</p></div><button ref={closeButton} type="button" className="button" aria-label="Close rehearsal" onClick={close}><X size={19}/></button></header>
  {error&&<p role="alert" className="inline-error">{error}</p>}
  {loading?<p role="status">Opening saved service lyrics…</p>:snapshot?<>
   <div className="rehearsal-content"><nav className="rehearsal-setlist" aria-label="Rehearsal songs">{snapshot.songs.length?snapshot.songs.map((song,position)=><button key={song.id} type="button" disabled={song.status!=='ready'} aria-current={current?.song.id===song.id?'step':undefined} onClick={()=>setIndex(Math.max(0,steps.findIndex(step=>step.song.id===song.id)))}><strong>{position+1}. {song.title}</strong><small>{song.status==='ready'?song.slides.length+' slides':song.message}</small></button>):<p>This service has no saved songs.</p>}</nav>
    <div className="rehearsal-view"><div className="rehearsal-slide" style={{containerType:'inline-size'}} aria-label="Rehearsal lyric slide">{current?<><p style={{fontSize:`${lyricFontSize(current.slide.text,current.song.fontSize)/19.2}cqw`}}>{current.slide.text}</p>{current.slide.ending&&<span className="rehearsal-ending" style={{fontSize:`${songEndingSize(current.slide.endingFontSize)/19.2}cqw`}}>{current.slide.ending}</span>}</>:<p className="rehearsal-empty">{snapshot.songs.length?'No verified lyrics are available. Refresh the affected service references.':'Add songs to this service to preview its lyrics.'}</p>}</div>
     <div className="rehearsal-navigation"><button type="button" className="button" aria-label="Previous rehearsal slide" disabled={!current||index===0} onClick={()=>setIndex(value=>Math.max(0,value-1))}><ChevronLeft size={18}/>Previous</button><p role="status">{current?`${current.song.title} · slide ${current.slideIndex+1} of ${current.song.slides.length} · ${index+1} of ${steps.length}`:'No slides'}</p><button type="button" className="button" aria-label="Next rehearsal slide" disabled={!current||index>=steps.length-1} onClick={()=>setIndex(value=>Math.min(steps.length-1,value+1))}>Next<ChevronRight size={18}/></button></div>
    </div></div>
   {!snapshot.ready&&<p role="status" className="rehearsal-warning">Some songs are missing, changed or unreadable. Available lyrics remain in service order.</p>}
   {snapshot.notes&&<details className="rehearsal-notes"><summary>Service notes</summary><p>{snapshot.notes}</p></details>}
  </>:null}
  <footer className="rehearsal-audio"><div><button type="button" className="button" disabled={audioBusy||!source.chooseRehearsalAudio} onClick={()=>void chooseAudio()}><Music2 size={17}/>{audioBusy?'Opening audio…':'Choose rehearsal MP3'}</button><button type="button" className="button" disabled={loading} onClick={()=>setReload(value=>value+1)}><RefreshCw size={16}/>Reload lyrics</button></div>{audio&&<>
   <div className="rehearsal-audio-player"><strong>{audio.filename}</strong><audio key={audio.url} ref={bindAudio} src={audio.url} controls loop={loop.enabled} preload="metadata" aria-label="Local rehearsal audio" onLoadedMetadata={event=>metadata(event.currentTarget,audio.url)} onDurationChange={event=>metadata(event.currentTarget,audio.url)} onPlay={event=>{if(ownsAudio(event.currentTarget,audio.url)){userPlaying.current=true;enforceLoop(event.currentTarget,audio.url);}}} onPause={event=>paused(event.currentTarget,audio.url)} onTimeUpdate={event=>enforceLoop(event.currentTarget,audio.url)} onEnded={event=>enforceLoop(event.currentTarget,audio.url,true)} onError={event=>{if(ownsAudio(event.currentTarget,audio.url)){userPlaying.current=false;event.currentTarget.loop=false;updateLoop({...emptyLoop(),error:'This MP3 could not be played. Choose another original MP3.'});}}}/><button type="button" className="button" onClick={()=>{stopAudio();setLoop(emptyLoop());setAudio(null);}}>Remove audio</button></div>
   <fieldset className="rehearsal-loop"><legend>A/B audio loop</legend><div className="rehearsal-loop-fields"><label>Start (A), seconds<input aria-label="Loop start (A), seconds" type="number" min={0} max={loop.duration??undefined} step="0.1" value={loop.start} onChange={event=>editLoop('start',event.target.value)}/></label><button type="button" className="button" disabled={loop.duration===null} onClick={()=>markLoop('start')}>Mark A at current time</button><label>End (B), seconds<input aria-label="Loop end (B), seconds" type="number" min={0} max={loop.duration??undefined} step="0.1" value={loop.end} onChange={event=>editLoop('end',event.target.value)}/></label><button type="button" className="button" disabled={loop.duration===null} onClick={()=>markLoop('end')}>Mark B at current time</button></div><div className="rehearsal-loop-actions"><button type="button" className="button" aria-pressed={loop.enabled} onClick={toggleLoop}>{loop.enabled?'Disable A/B loop':'Enable A/B loop'}</button><button type="button" className="button" onClick={()=>{if(audioElement.current)audioElement.current.loop=false;updateLoop(emptyLoop(loopLatest.current.duration));}}>Clear loop</button><p role="status">{loop.enabled?`Looping ${loop.start}s → ${loop.end}s`:loop.duration===null?'Waiting for MP3 duration…':`MP3 duration: ${loop.duration.toFixed(1)} seconds`}</p></div>{loop.error&&<p role="alert" className="inline-error">{loop.error}</p>}<p className="rehearsal-loop-hint">Set A and B, enable the loop, then press Play. Pause clears the loop.</p></fieldset>
  </>}<p>Audio plays here only when you press Play. Closing rehearsal or leaving this screen stops it.</p></footer>
 </section></div>;
}
