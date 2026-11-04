import {useEffect,useRef,useState} from 'react';
import {Check,Upload,X,ArrowRight} from 'lucide-react';
import {api,ApiError} from './api';
import {abortable,useConnectionPresence,useVisiblePolling} from './useConnectionPresence';
import {createUploadBatch} from './upload-batch';
import type {UploadEntry} from './upload-batch';
import {useSenderReceipts} from './sender-deliveries';
import {UPLOAD_ACCEPT} from '../shared/media-formats.js';
type Info={deviceId:string;uploadProtocol?:string;sendingAllowed?:boolean;name:string;expiresAt:number;maxBytes:number;connection:{status:string}|null;approver:string};
export function Receive({token,userId}:{token:string;userId:string}){
 const [info,setInfo]=useState<Info|null>(null),[file,setFile]=useState<File|null>(null),[entry,setEntry]=useState<UploadEntry|null>(null),[error,setError]=useState(''),[connectionError,setConnectionError]=useState(''),[progress,setProgress]=useState<number|null>(null),[retry,setRetry]=useState(''),[seconds,setSeconds]=useState(0);
 const [resolvedToken,setResolvedToken]=useState<string|null>(null);
 const input=useRef<HTMLInputElement>(null),upload=useRef<AbortController|null>(null),accessRequest=useRef<AbortController|null>(null),statusRevision=useRef(0),ledger=useRef(createUploadBatch());
 useVisiblePolling(async signal=>{if(accessRequest.current)return;const revision=++statusRevision.current;try{const value=await api<Info>('/receive/'+token,{signal});if(signal.aborted||revision!==statusRevision.current)return;setInfo(value);setResolvedToken(token);setConnectionError('');if(value.connection?.status==='denied')upload.current?.abort();}catch(error){if(signal.aborted||revision!==statusRevision.current)return;setInfo(null);setResolvedToken(null);setConnectionError((error as Error).message);if(error instanceof ApiError&&[401,403,410].includes(error.status))upload.current?.abort();if(error instanceof ApiError&&[401,403].includes(error.status))return false;}},[token]);
 useEffect(()=>{const hidden=()=>{if(document.visibilityState!=='visible')accessRequest.current?.abort();};document.addEventListener('visibilitychange',hidden);return()=>{statusRevision.current++;upload.current?.abort();accessRequest.current?.abort();document.removeEventListener('visibilitychange',hidden);};},[token]);
 useConnectionPresence(resolvedToken===token&&info?.connection?.status==='approved'&&info.sendingAllowed!==false&&info.expiresAt>Math.floor(Date.now()/1000)?[info.deviceId]:[]);
 useEffect(()=>{if(!info){setSeconds(0);return;}const tick=()=>setSeconds(Math.max(0,info.expiresAt-Math.floor(Date.now()/1000)));tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);},[info]);
 async function requestAccess(){
  if(accessRequest.current||document.visibilityState!=='visible')return;
  const controller=new AbortController(),revision=++statusRevision.current;accessRequest.current=controller;const timeout=setTimeout(()=>controller.abort(),8000);
  try{await abortable(async()=>{await api('/connections/'+token,{method:'POST',body:'{}',signal:controller.signal});if(controller.signal.aborted)throw new DOMException('Request stopped.','AbortError');const value=await api<Info>('/receive/'+token,{signal:controller.signal});if(controller.signal.aborted||revision!==statusRevision.current)return;setInfo(value);setResolvedToken(token);},controller.signal);}catch(error){if(!controller.signal.aborted)setError((error as Error).message);}finally{clearTimeout(timeout);if(accessRequest.current===controller)accessRequest.current=null;}
 }
 function choose(next:File|null){if(upload.current)return;setFile(next);setEntry(null);setError('');}
 async function send(again=false){
  if(upload.current||!file||(!entry&&!info))return;
  if(!file.size||file.size>50*1024*1024){setError('Choose a non-empty file up to 50 MB.');return;}
  const controller=new AbortController();upload.current=controller;setError('');setRetry('');setProgress(0);
  try{
   if(again&&entry)ledger.current.again([entry]);
   const tasks=ledger.current.select([file],[entry?.deviceId||info!.deviceId]),current=tasks[0];setEntry({...current});
   await ledger.current.run(tasks,{signal:controller.signal,target:()=>token,onChange:()=>setEntry({...current}),onProgress:value=>{setRetry('');setProgress(Math.floor(value.loaded/value.total*100));},onRetry:(_entry,value)=>setRetry('Connection interrupted. Retrying in '+value.delayMs/1000+' seconds…')});
  }catch(e){setError((e as Error).message);}finally{upload.current=null;setProgress(null);setRetry('');}
 }
 const receipt=useSenderReceipts(userId,[entry?.receipt])[0],canStart=!!info&&info.uploadProtocol==='stati-upload-v1'&&info.sendingAllowed!==false&&info.connection?.status==='approved'&&seconds>0,canRetry=!!entry&&!receipt&&entry.state!=='ready';
 const title=receipt?.status==='delivered'?'File saved':receipt?.status==='rejected'?'File rejected':receipt?.status==='expired'?'File expired':receipt?'File sent':'Send a file';
 return <><h1>{title}</h1><p className="subtitle">{info?.name||'Computer receiver'}</p><section className="card receiver">{receipt?<div className="empty">
  {receipt.status==='rejected'||receipt.status==='expired'?<X size={38}/>:<Check size={38}/>}
  <h2>{receipt.status==='delivered'?'Saved on the computer':receipt.status==='rejected'?'The computer rejected this file':receipt.status==='expired'?'This send expired':'Queued for the computer'}</h2>
  <p>{receipt.status==='rejected'?receipt.rejectionReason||'Ask the operator before sending it again.':receipt.status==='expired'?'Start a new send if you still need this file.':receipt.status==='delivered'?'The file is saved in Downloads.':'The PC will save it to Downloads.'}</p>
  {(receipt.status==='rejected'||receipt.status==='expired')&&<button className="button" disabled={!canStart} onClick={()=>void send(true)}>Send this file again</button>}
  <button className="button" onClick={()=>choose(null)}>Send another file</button>
 </div>:<>
  {info?.sendingAllowed===false&&<div className="alert">Member sending opens two hours before service and closes two hours after. Admins can send anytime.</div>}
  {info&&info.connection?.status!=='approved'&&<div className="alert">{info.connection?.status==='pending'?`Waiting for ${info.approver==='admin'?'an administrator':'the computer operator'} to approve.`:info.connection?.status==='denied'?'Access denied.':<button className="button primary" onClick={()=>void requestAccess()}>Request access</button>}</div>}
  <div className="receiver-time">{info?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} left`:'Receiver unavailable'}</div>
  <input hidden ref={input} type="file" accept={UPLOAD_ACCEPT} onChange={e=>choose(e.target.files?.[0]||null)}/>
  <button className="choose-file" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(info&&progress===null)choose(e.dataTransfer.files[0]||null);}} disabled={!info||progress!==null} onClick={()=>input.current?.click()}><Upload size={32}/><strong>{file?file.name:'Choose a file'}</strong><span>{file?`${(file.size/1024/1024).toFixed(1)} MB`:'Documents, photos, audio, or video · 50 MB max'}</span></button>
  {(error||entry?.error||connectionError)&&<div className="alert error" role="alert">{error||entry?.error||connectionError}</div>}
  {info&&info.connection?.status==='approved'&&!info.uploadProtocol&&<p className="hint">Update Stați before sending with upload recovery.</p>}
  {file&&file.size>10*1024*1024&&<p className="hint">Sending this large file may use cellular data.</p>}
  {progress!==null&&<div className="upload-progress" role="status"><progress value={progress} max={100}/><span>{progress}% · checking the send</span>{retry&&<span>{retry}</span>}<button type="button" className="button" onClick={()=>upload.current?.abort()}>Stop sending</button></div>}
  <button className="button primary full" disabled={!file||progress!==null||(!canStart&&!canRetry)} onClick={()=>void send()}>{progress!==null?'Sending…':canRetry?'Retry send':'Send file'}<ArrowRight size={17}/></button>
 </>}</section></>;
}
