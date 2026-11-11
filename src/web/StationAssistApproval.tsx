import {useEffect,useState} from 'react';
import {startAuthentication, type PublicKeyCredentialRequestOptionsJSON} from '@simplewebauthn/browser';
import {api,post} from './api';

type RequestDetails={name:string;person:string;options:PublicKeyCredentialRequestOptionsJSON};

export function StationAssistApproval({token}:{token:string}) {
 const endpoint='/operator-unlock/'+token+'/approve';
 const [request,setRequest]=useState<RequestDetails>();
 const [busy,setBusy]=useState(false);
 const [approved,setApproved]=useState(false);
 const [message,setMessage]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  void api<RequestDetails>(endpoint,{signal:controller.signal}).then(setRequest).catch(error=>{
   if(!controller.signal.aborted)setMessage((error as Error).message);
  });
  return ()=>controller.abort();
 },[endpoint]);
 async function approve() {
  if(!request||busy)return;
  setBusy(true);
  setMessage('');
  try {
   const response=await startAuthentication({optionsJSON:request.options});
   await post(endpoint,{response});
   setApproved(true);
  } catch(error) {
   setMessage((error as Error).message);
  } finally {
   setBusy(false);
  }
 }
 return <section className="card">
  <h1>Approve computer sign-in</h1>
  {approved?<p>Approved. {request?.person} can return to the computer.</p>:request?<>
   <p><strong>{request.person}</strong> is signing in on <strong>{request.name}</strong>.</p>
   <p>Approve only if they’re at that computer. This opens their full Stați profile.</p>
   <button type="button" className="button primary" disabled={busy} onClick={()=>void approve()}>{busy?'Checking passkey…':'Approve with passkey'}</button>
  </>:!message&&<p role="status">Loading sign-in request…</p>}
  {message&&<p role="alert">{message}</p>}
 </section>;
}
