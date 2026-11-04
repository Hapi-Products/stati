import {accountSetupWindow} from '../shared/services';
import {HttpError,MAX_FILE,now,safeFilename} from './core';
import {expectedTransferChecksum,storeTransfer} from './transfer-integrity';
import {prepareUploadStream} from './upload-stream';
import {SENDER_DELIVERY_STATUS_SQL,SENDER_DELIVERY_TRANSFER_JOIN_SQL} from './sender-deliveries';

export const UPLOAD_PROTOCOL='stati-upload-v1';
const retention=7*86400,attemptLifetime=600;
export type UploadFingerprint={filename:string;bytes:number;sha256:string};
type Intent=UploadFingerprint&{sender_id:string;device_id:string;intent_id:string;transfer_id:string|null;expires_at:number};
export type UploadReceipt={protocol:typeof UPLOAD_PROTOCOL;intentId:string;id:string;deviceId:string;accepted:true;status:'queued'|'delivered'|'rejected'|'expired';filename:string;bytes:number;sha256:string;replayed:boolean;rejectionReason?:string};
type Attempt={id:string;object_key:string;transfer_id:string;state:'active'|'ready'|'cleanup'|'retired';expires_at:number;updated_at:number};
type QueueDetails={id:string;key:string;receiverId:string;senderId:string;sessionHash:string;filename:string;bytes:number;contentType:string};

export function uploadFingerprint(request:Request):UploadFingerprint{
 const bytes=Number(request.headers.get('content-length'));
 if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>MAX_FILE||!request.body)throw new HttpError(413,'Choose a non-empty file up to 50 MB.');
 const sha256=expectedTransferChecksum(request.headers);
 if(!sha256)throw new HttpError(400,'A verified file checksum is required. Choose the file again.');
 let filename;try{filename=safeFilename(decodeURIComponent(request.headers.get('x-filename')||'file'));}catch{throw new HttpError(400,'Invalid file name. Choose the file again.');}
 return{filename,bytes,sha256};
}

async function intent(env:Env,senderId:string,deviceId:string,intentId:string){return env.DB.prepare('SELECT * FROM upload_intents WHERE sender_id=? AND device_id=? AND intent_id=?').bind(senderId,deviceId,intentId).first<Intent>();}
function assertFingerprint(saved:Intent,expected:UploadFingerprint){
 if(saved.filename!==expected.filename||saved.bytes!==expected.bytes||saved.sha256!==expected.sha256)throw new HttpError(409,'This send request belongs to a different file. Start a new send instead.');
 if(saved.expires_at<=now())throw new HttpError(410,'This send request expired. Check Your files before starting another send.');
}

export async function uploadReceipt(env:Env,senderId:string,deviceId:string,intentId:string,replayed=true):Promise<UploadReceipt|null>{
 const time=now(),row=await env.DB.prepare(`SELECT i.*,${SENDER_DELIVERY_STATUS_SQL} AS status,record.rejection_reason FROM upload_intents i JOIN delivery_records record ON record.id=i.transfer_id AND record.sender_id=i.sender_id AND record.device_id=i.device_id ${SENDER_DELIVERY_TRANSFER_JOIN_SQL} WHERE i.sender_id=? AND i.device_id=? AND i.intent_id=? AND i.expires_at>?`).bind(time,senderId,deviceId,intentId,time).first<Intent&{status:UploadReceipt['status'];rejection_reason:string|null}>();
 if(!row||!row.transfer_id)return null;
 const status=row.status;
 return{protocol:UPLOAD_PROTOCOL,intentId:row.intent_id,id:row.transfer_id,deviceId:row.device_id,accepted:true,status,filename:row.filename,bytes:row.bytes,sha256:row.sha256,replayed,...(status==='rejected'&&row.rejection_reason?{rejectionReason:row.rejection_reason}:{})};
}

export async function replayUpload(env:Env,senderId:string,deviceId:string,intentId:string,expected:UploadFingerprint){
 const saved=await intent(env,senderId,deviceId,intentId);
 if(!saved)return null;
 assertFingerprint(saved,expected);
 return saved.transfer_id?uploadReceipt(env,senderId,deviceId,intentId):null;
}

/** The same live SQL authorization protects both legacy and idempotent commits. */
export function transferInsert(env:Env,details:QueueDetails,guard?:{attemptId:string;deviceId:string;intentId:string}){
 const time=now(),windowOpen=accountSetupWindow().accountCreationAllowed?1:0;
 const extra=guard?` AND d.id=? AND EXISTS(SELECT 1 FROM upload_attempts a WHERE a.id=? AND a.transfer_id=? AND a.object_key=? AND a.state='ready' AND a.expires_at>?) AND EXISTS(SELECT 1 FROM upload_intents i WHERE i.sender_id=sender.id AND i.device_id=d.id AND i.intent_id=? AND i.transfer_id IS NULL AND i.expires_at>?)`:'';
 return env.DB.prepare(`INSERT INTO transfers(id,receiver_id,device_id,sender_id,filename,bytes,content_type,object_key,created_at,expires_at)
 SELECT ?,r.id,r.device_id,sender.id,?,?,?,?,?,? FROM receivers r JOIN devices d ON d.id=r.device_id JOIN users owner ON owner.id=d.owner_id JOIN users sender ON sender.id=?
 WHERE r.id=? AND d.revoked_at IS NULL AND owner.status='active' AND sender.status!='removed' AND (sender.role='admin' OR NOT EXISTS(SELECT 1 FROM user_ministry_roles blocked WHERE blocked.user_id=sender.id AND blocked.role='commenter'))
 AND NOT EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=d.id AND removed.user_id=sender.id)
 AND EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=? AND s.user_id=sender.id AND s.expires_at>?)
 AND ((sender.role='admin' AND sender.status='active') OR (?=1 AND r.closed_at IS NULL AND r.expires_at>? AND d.last_seen>?
 AND NOT EXISTS(SELECT 1 FROM computer_connections blocked WHERE blocked.receiver_id=r.id AND blocked.user_id=sender.id AND blocked.status='denied')
 AND ((sender.status='active' AND NOT EXISTS(SELECT 1 FROM station_memberships deny WHERE deny.device_id=d.id AND deny.user_id=sender.id AND deny.status='denied'))
 OR EXISTS(SELECT 1 FROM station_memberships sm WHERE sm.device_id=d.id AND sm.user_id=sender.id AND sm.status='approved')
 OR EXISTS(SELECT 1 FROM computer_connections c WHERE c.receiver_id=r.id AND c.user_id=sender.id AND c.status='approved' AND NOT EXISTS(SELECT 1 FROM station_memberships sm WHERE sm.device_id=d.id AND sm.user_id=sender.id AND sm.status='denied')))))${extra}`)
 .bind(details.id,details.filename,details.bytes,details.contentType,details.key,time,time+86400,details.senderId,details.receiverId,details.sessionHash,time,windowOpen,time,time-45,...(guard?[guard.deviceId,guard.attemptId,details.id,details.key,time,guard.intentId,time]:[]));
}

async function acceptedObject(env:Env,id:string,key:string){return !!await env.DB.prepare('SELECT id FROM transfers WHERE id=? AND object_key=? UNION SELECT transfer_id AS id FROM upload_intents WHERE transfer_id=? LIMIT 1').bind(id,key,id).first();}

// Fence before checking references: once cleanup/retired, no commit can acquire
// this attempt. Unknown active PUTs keep a tombstone after object deletion.
async function cleanAttempt(env:Env,id:string,settled:boolean){
 const time=now();
 const row=await env.DB.prepare(`UPDATE upload_attempts SET state=CASE WHEN ?=1 OR state='ready' THEN 'cleanup' WHEN state='active' THEN 'retired' ELSE state END,updated_at=? WHERE id=? AND (?=1 OR state IN ('cleanup','retired') OR expires_at<=?) RETURNING *`).bind(settled?1:0,time,id,settled?1:0,time).first<Attempt>();
 if(!row)return;
 if(await acceptedObject(env,row.transfer_id,row.object_key)){await env.DB.prepare('DELETE FROM upload_attempts WHERE id=?').bind(id).run();return;}
 await env.FILES.delete(row.object_key);
 if(row.state==='cleanup')await env.DB.prepare("DELETE FROM upload_attempts WHERE id=? AND state='cleanup'").bind(id).run();
 // Retired records deliberately survive successful deletion: a PUT whose result
 // is unknown can still finish later. Hourly cleanup checks this key again.
}

export async function storeIntentUpload(request:Request,env:Env,{senderId,deviceId,receiverId,sessionHash,intentId,fingerprint,beforeCommit}:{senderId:string;deviceId:string;receiverId:string;sessionHash:string;intentId:string;fingerprint:UploadFingerprint;beforeCommit:()=>Promise<void>}):Promise<{receipt:UploadReceipt;created:boolean}>{
 const checkCancellation=()=>{if(request.signal.aborted)throw new HttpError(400,'Sending stopped before the file was queued.');};
 checkCancellation();
 await env.DB.prepare('INSERT INTO upload_intents(sender_id,device_id,intent_id,filename,bytes,sha256,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(sender_id,device_id,intent_id) DO NOTHING').bind(senderId,deviceId,intentId,fingerprint.filename,fingerprint.bytes,fingerprint.sha256,now(),now()+retention).run();
 const saved=await intent(env,senderId,deviceId,intentId);
 if(!saved)throw new HttpError(503,'The send request could not be saved. Try again.');
 assertFingerprint(saved,fingerprint);
 if(saved.transfer_id){const receipt=await uploadReceipt(env,senderId,deviceId,intentId);if(!receipt)throw new HttpError(503,'The existing send could not be confirmed. Check Your files.');return{receipt,created:false};}
 const attemptId=crypto.randomUUID(),id=crypto.randomUUID(),key='transfers/'+id;
 await env.DB.prepare("INSERT INTO upload_attempts VALUES(?,?,?,'active',?,?)").bind(attemptId,key,id,now()+attemptLifetime,now()).run();
 let putStarted=false,settled=false;
 try{
  checkCancellation();
  const prepared=await prepareUploadStream(request.body!,fingerprint.filename,fingerprint.bytes);
  if(request.signal.aborted)await prepared.stream.cancel().catch(()=>{});
  checkCancellation();
  putStarted=true;try{await storeTransfer(env.FILES,key,prepared.stream,fingerprint.bytes,prepared.contentType,fingerprint.sha256);}finally{settled=true;}
  const ready=await env.DB.prepare("UPDATE upload_attempts SET state='ready',updated_at=? WHERE id=? AND state='active' AND expires_at>?").bind(now(),attemptId,now()).run();
  if(!ready.meta.changes)throw new HttpError(408,'This upload attempt expired. Check Your files before retrying.');
  checkCancellation();
  await beforeCommit();
  // Authorization reads are asynchronous. A stop while those reads are in
  // flight must still prevent this attempt from entering the atomic commit.
  checkCancellation();
  await env.DB.batch([
   transferInsert(env,{id,key,senderId,receiverId,sessionHash,filename:fingerprint.filename,bytes:fingerprint.bytes,contentType:prepared.contentType},{attemptId,deviceId,intentId}),
   env.DB.prepare('INSERT INTO delivery_records(id,device_id,sender_id,filename,bytes,status,rejection_reason,created_at,updated_at) SELECT id,device_id,sender_id,filename,bytes,status,NULL,created_at,created_at FROM transfers WHERE id=?').bind(id),
   env.DB.prepare('UPDATE upload_intents SET transfer_id=?,expires_at=? WHERE sender_id=? AND device_id=? AND intent_id=? AND transfer_id IS NULL AND EXISTS(SELECT 1 FROM transfers WHERE id=?)').bind(id,now()+retention,senderId,deviceId,intentId,id),
   env.DB.prepare('DELETE FROM upload_attempts WHERE id=? AND EXISTS(SELECT 1 FROM upload_intents WHERE transfer_id=?)').bind(attemptId,id),
  ]);
  const receipt=await uploadReceipt(env,senderId,deviceId,intentId);
  if(!receipt)throw new HttpError(410,'The receiver closed or your access changed before the upload finished. Request access again.');
  if(receipt.id!==id)await cleanAttempt(env,attemptId,true);
  return{receipt:{...receipt,replayed:receipt.id!==id},created:receipt.id===id};
 }catch(error){
  // A batch may commit before its response is lost. Reconcile through primary
  // D1 before deleting any owned bytes. On D1 uncertainty the ledger stays.
  let receipt:UploadReceipt|null;
  try{receipt=await uploadReceipt(env,senderId,deviceId,intentId);}catch{throw new HttpError(503,'The send result is not confirmed. Retry this same send request.');}
  if(receipt?.id===id)return{receipt,created:false};
  try{await cleanAttempt(env,attemptId,!putStarted||settled);}catch{console.error(JSON.stringify({event:'upload_attempt_cleanup_failed'}));}
  if(receipt)return{receipt,created:false};
  throw error;
 }
}

export async function cleanupUploadAttempts(env:Env,time=now()){
 let failed=0,attempted=0;
 const failure=(phase:string,count=1)=>{failed+=count;console.error(JSON.stringify({event:'upload_attempt_bulk_cleanup_failed',phase,attempted,failed:count}));};
 let rows:Attempt[];
 try{
  // The primary write both selects and fences the bounded snapshot. A late
  // request can no longer mark these attempts ready or acquire them at commit.
  rows=(await env.DB.prepare(`UPDATE upload_attempts SET
   state=CASE WHEN state='ready' THEN 'cleanup' WHEN state='active' THEN 'retired' ELSE state END,updated_at=?
   WHERE id IN (SELECT id FROM upload_attempts WHERE state IN ('cleanup','retired') OR expires_at<=? ORDER BY updated_at,id LIMIT 100)
   RETURNING *`).bind(time,time).all<Attempt>()).results;
  attempted=rows.length;
 }catch{failure('fence');return{failed,attempted};}
 if(rows.length){
  const snapshot=JSON.stringify(rows.map(row=>({id:row.id,key:row.object_key,transferId:row.transfer_id})));
  let accepted:Set<string>;
  try{
   // Check the fenced snapshot itself, even if another successful cleanup has
   // since removed a ledger row. JSON keeps this below D1's parameter limit.
   const referenced=await env.DB.prepare(`SELECT json_extract(candidate.value,'$.id') AS id FROM json_each(?) candidate
    WHERE EXISTS(SELECT 1 FROM transfers t WHERE t.id=json_extract(candidate.value,'$.transferId') AND t.object_key=json_extract(candidate.value,'$.key'))
    OR EXISTS(SELECT 1 FROM upload_intents i WHERE i.transfer_id=json_extract(candidate.value,'$.transferId'))`).bind(snapshot).all<{id:string}>();
   accepted=new Set(referenced.results.map(row=>row.id));
  }catch{failure('references',rows.length);return{failed,attempted};}
  if(accepted.size)try{
   await env.DB.prepare(`DELETE FROM upload_attempts WHERE id IN (SELECT value FROM json_each(?)) AND state IN ('cleanup','retired')
    AND (EXISTS(SELECT 1 FROM transfers t WHERE t.id=upload_attempts.transfer_id AND t.object_key=upload_attempts.object_key)
    OR EXISTS(SELECT 1 FROM upload_intents i WHERE i.transfer_id=upload_attempts.transfer_id))`).bind(JSON.stringify([...accepted])).run();
  }catch{failure('accepted-records',accepted.size);}
  const unused=rows.filter(row=>!accepted.has(row.id));
  if(unused.length){
   let removed=false;
   try{await env.FILES.delete(unused.map(row=>row.object_key));removed=true;}catch{failure('objects',unused.length);}
   if(removed){
    const ids=JSON.stringify(unused.map(row=>row.id));
    try{
     await env.DB.prepare(`DELETE FROM upload_attempts WHERE id IN (SELECT value FROM json_each(?)) AND state='cleanup'
      AND NOT EXISTS(SELECT 1 FROM transfers t WHERE t.id=upload_attempts.transfer_id AND t.object_key=upload_attempts.object_key)
      AND NOT EXISTS(SELECT 1 FROM upload_intents i WHERE i.transfer_id=upload_attempts.transfer_id)`).bind(ids).run();
    }catch{failure('settled-records',unused.filter(row=>row.state==='cleanup').length||1);}
    // Keep unknown writes for seven days, and only retire records whose object
    // deletion succeeded in this sweep. After this bound, an old writer cannot
    // commit; transfers/ has the independently configured two-day R2 lifecycle.
    try{await env.DB.prepare("DELETE FROM upload_attempts WHERE id IN (SELECT value FROM json_each(?)) AND state='retired' AND expires_at<=?").bind(ids,time-retention).run();}
    catch{failure('retired-records',unused.filter(row=>row.state==='retired'&&row.expires_at<=time-retention).length||1);}
   }
  }
 }
 try{await env.DB.prepare('DELETE FROM upload_intents WHERE transfer_id IS NULL AND expires_at<=?').bind(time).run();}catch{failure('expired-intents');}
 return{failed,attempted};
}
