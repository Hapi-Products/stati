import {useState} from 'react';
import {api,post} from './api';
import {useVisiblePolling} from './useConnectionPresence';
import {Check,X} from 'lucide-react';
type Request={id:string;first_name:string;last_initial:string;computerName:string};
export function ConnectionRequests(){const [requests,setRequests]=useState<Request[]>([]),[error,setError]=useState('');async function refresh(){try{setRequests(await api<Request[]>('/connections/pending'));}catch{}}
useVisiblePolling(async signal=>{const result=await api<Request[]>('/connections/pending',{signal});if(!signal.aborted)setRequests(result);},[],15000);
return requests.length?<section className="card"><h2>Connection requests</h2>{requests.map(r=><div className="row" key={r.id}><div><strong>{r.first_name} {r.last_initial}.</strong><small>{r.computerName}</small></div>{(['approved','denied'] as const).map(status=><button key={status} className="team-action" title={status==='approved'?'Approve access':'Deny access'} aria-label={(status==='approved'?'Approve access for ':'Deny access for ')+r.first_name+' '+r.last_initial} onClick={async()=>{try{await post('/connections/'+r.id+'/decision',{status});await refresh();}catch(e){setError((e as Error).message);}}}>{status==='approved'?<Check size={19}/>:<X size={19}/>}</button>)}</div>)}{error&&<p role="alert">{error}</p>}</section>:null;}
