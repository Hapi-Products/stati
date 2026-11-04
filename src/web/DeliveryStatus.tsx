import {useCallback,useEffect,useRef,useState} from 'react';
import {X,Check,Clock,Folder,Trash2} from 'lucide-react';
import {post} from './api';
import {useSenderDeliveryPolling} from './sender-deliveries';

export function DeliveryStatus({userId,showHistory=true}:{userId:string;showHistory?:boolean}){
 const {files,pending,dismiss:markSeen}=useSenderDeliveryPolling(userId),rejected=pending[0]||null,close=useRef<HTMLButtonElement>(null);
 const [clearing,setClearing]=useState(false),[hidden,setHidden]=useState<Set<string>>(()=>new Set()),[historyError,setHistoryError]=useState('');
 const visibleFiles=files.filter(file=>file.status==='queued'||!file.history_hidden_at&&!hidden.has(file.id));
 async function clearHistory(){if(clearing)return;const completed=files.filter(file=>file.status!=='queued');if(!completed.length)return;setClearing(true);setHistoryError('');try{await post('/transfers/clear-history');setHidden(current=>new Set([...current,...completed.map(file=>file.id)]));}catch(error){setHistoryError((error as Error).message);}finally{setClearing(false);}}
 const id=rejected?.id;
 const dismiss=useCallback(()=>{if(id)markSeen(id);},[id,markSeen]);
 useEffect(()=>{
  if(!id)return;
  const previous=document.activeElement as HTMLElement|null;close.current?.focus();
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape')dismiss();if(event.key==='Tab'){event.preventDefault();close.current?.focus();}};
  document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('keydown',key);previous?.focus();};
 },[id,dismiss]);
 return <>{showHistory&&visibleFiles.length>0&&<details className="card delivery-status"><summary><Folder size={20}/>Recent uploads <span className="hint">{visibleFiles.length}</span></summary>{visibleFiles.some(file=>file.status!=='queued')&&<div className="delivery-history-actions"><button type="button" className="link" disabled={clearing} onClick={()=>void clearHistory()}><Trash2 size={15}/>{clearing?'Clearing…':'Clear completed'}</button></div>}{historyError&&<p className="inline-error" role="alert">{historyError}</p>}{visibleFiles.map(f=><div className={'delivery-status-row '+f.status} key={f.id}>{f.status==='rejected'?<X size={20}/>:f.status==='delivered'?<Check size={20}/>:<Clock size={20}/>}<div><strong>{f.filename}</strong><small>{f.computer_name} · {f.status==='queued'?'Waiting for computer':f.status==='delivered'?'Saved on computer':f.status==='rejected'?'Rejected':'Expired'}</small>{f.rejection_reason&&<p>{f.rejection_reason}</p>}</div></div>)}</details>}{rejected&&<div className="shade"><section className={"modal rejection-modal "+(rejected.status==='delivered'?'delivery-saved':'')} role="alertdialog" aria-modal="true" aria-labelledby="rejected-title" aria-describedby="rejected-reason">{rejected.status==='rejected'?<X size={80} strokeWidth={2.5}/>:<Check size={80} strokeWidth={2.5}/>}<h2 id="rejected-title">{rejected.status==='rejected'?'File rejected':'File saved'}</h2><p>{rejected.filename}</p><p id="rejected-reason">{rejected.status==='delivered'?'Saved on '+rejected.computer_name+'.':rejected.rejection_reason||'The computer operator rejected this file.'}</p><button ref={close} className="button primary full" onClick={dismiss}>OK</button></section></div>}</>;}
