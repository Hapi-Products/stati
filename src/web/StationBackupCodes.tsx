import {useState} from 'react';
import {startAuthentication, type PublicKeyCredentialRequestOptionsJSON} from '@simplewebauthn/browser';
import {KeyRound} from 'lucide-react';
import {post} from './api';

export function StationBackupCodes() {
 const [codes,setCodes]=useState<string[]>([]);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [replacing,setReplacing]=useState(false);
 async function generate() {
  setBusy(true);
  setMessage('');
  try {
   const options=await post<PublicKeyCredentialRequestOptionsJSON>('/me/station-backup-codes/options',{});
   const response=await startAuthentication({optionsJSON:options});
   const result=await post<{codes:string[]}>('/me/station-backup-codes',{response});
   setCodes(result.codes);
  } catch(error) {
   setMessage((error as Error).message);
  } finally {
   setBusy(false);
   setReplacing(false);
  }
 }
 return <details className="card" onToggle={event=>{if(!event.currentTarget.open){setCodes([]);setReplacing(false);}}}>
  <summary><KeyRound size={20}/>Computer sign-in backup codes</summary>
  <p>Keep these codes somewhere safe. Use one on a church computer when your phone is unavailable, then ask an administrator to approve your sign-in.</p>
  {codes.length>0&&<>
   <p>Save these codes now. Each code works once.</p>
   <ul aria-label="Backup codes">{codes.map(code=><li key={code}><code>{code}</code></li>)}</ul>
   <button type="button" className="button" onClick={()=>setCodes([])}>Hide codes</button>
  </>}
  {replacing?<>
   <p>Generating codes replaces all unused codes from your previous set.</p>
   <button type="button" className="button primary" disabled={busy} onClick={()=>void generate()}>{busy?'Checking passkey…':'Generate with passkey'}</button>
   <button type="button" className="button" disabled={busy} onClick={()=>setReplacing(false)}>Cancel</button>
  </>:codes.length===0&&<button type="button" className="button" disabled={busy} onClick={()=>setReplacing(true)}>Generate backup codes</button>}
  <p role="status">{message}</p>
 </details>;
}
