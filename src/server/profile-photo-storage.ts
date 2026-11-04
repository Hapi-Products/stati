import {HttpError,now} from './core';

type PhotoObject={object_key:string;user_id:string|null;expected_key:string|null;state:'active'|'ready'|'current'|'cleanup'|'retired';expires_at:number;updated_at:number};
const attemptLifetime=600;
const uncertain=()=>new HttpError(503,'The photo save could not be confirmed. Check your profile before trying again.');
const conflict=()=>new HttpError(409,'Another photo was saved while this one was uploading. Choose your photo again to replace it.');
const profileKey=(value:string)=>/^profiles\/[\w-]{20,60}\/[\w-]{20,60}$/.test(value);

// Fence first: an expired/failed attempt can never become ready or commit later.
// Once fenced, any existing pointer is safe to read before deleting the object;
// no API can assign this random key again after its ready state is lost.
async function cleanObject(env:Env,key:string,{settled=false,time=now()}={}){
 const row=await env.DB.prepare(`UPDATE profile_photo_objects SET
 state=CASE WHEN ?=1 OR state IN ('ready','current') THEN 'cleanup' WHEN state='active' THEN 'retired' ELSE state END,updated_at=?
 WHERE object_key=? AND (?=1 OR state IN ('cleanup','retired') OR state='current' OR expires_at<=?)
 AND (state!='current' OR NOT EXISTS(SELECT 1 FROM users u WHERE u.photo_key=profile_photo_objects.object_key)) RETURNING *`).bind(settled?1:0,time,key,settled?1:0,time).first<PhotoObject>();
 if(!row)return;
 if(!profileKey(row.object_key))throw Error('Invalid profile object ledger key.');
 if(await env.DB.prepare('SELECT id FROM users WHERE photo_key=? LIMIT 1').bind(row.object_key).first()){
  if(row.state==='cleanup')await env.DB.prepare("UPDATE profile_photo_objects SET state='current',updated_at=? WHERE object_key=? AND state='cleanup' AND EXISTS(SELECT 1 FROM users u WHERE u.photo_key=profile_photo_objects.object_key)").bind(time,row.object_key).run();return;
 }
 await env.FILES.delete(row.object_key);
 if(row.state==='cleanup')await env.DB.prepare("DELETE FROM profile_photo_objects WHERE object_key=? AND state='cleanup'").bind(row.object_key).run();
 // An R2 PUT can have an unknown outcome. Keep retired keys after deletion so a
 // late write remains eligible for the next cron run; there is no profile TTL.
}
async function bestEffortCleanup(env:Env,key:string,settled:boolean){
 try{await cleanObject(env,key,{settled});}catch{console.error(JSON.stringify({event:'profile_photo_cleanup_failed'}));}
}

export async function storeProfilePhoto(env:Env,{userId,previousKey,sessionHash,bytes,type,signal}:{userId:string;previousKey:string|null;sessionHash:string;bytes:Uint8Array;type:string;signal:AbortSignal}){
 const key='profiles/'+userId+'/'+crypto.randomUUID();let putStarted=false,putConfirmed=false;
 try{
  await env.DB.prepare("INSERT INTO profile_photo_objects(object_key,user_id,expected_key,state,expires_at,updated_at) VALUES(?,?,?,'active',?,?)").bind(key,userId,previousKey,now()+attemptLifetime,now()).run();
  signal.throwIfAborted();putStarted=true;
  const stored=await env.FILES.put(key,bytes,{httpMetadata:{contentType:type}});if(!stored)throw Error('Photo write was not confirmed.');putConfirmed=true;
  const ready=await env.DB.prepare("UPDATE profile_photo_objects SET state='ready',updated_at=? WHERE object_key=? AND state='active' AND expires_at>?").bind(now(),key,now()).run();
  if(!ready.meta.changes)throw new HttpError(408,'This photo upload expired. Choose the photo again.');
  signal.throwIfAborted();
  const time=now(),result=await env.DB.batch([
   env.DB.prepare(`UPDATE users SET photo_key=? WHERE id=? AND status!='removed' AND photo_key IS ?
    AND EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=users.id AND s.token_hash=? AND s.expires_at>?)
    AND EXISTS(SELECT 1 FROM profile_photo_objects p WHERE p.object_key=? AND p.user_id=users.id AND p.expected_key IS users.photo_key AND p.state='ready' AND p.expires_at>?)`)
    .bind(key,userId,previousKey,sessionHash,time,key,time),
   env.DB.prepare("UPDATE profile_photo_objects SET state='current',updated_at=? WHERE object_key=? AND state='ready' AND EXISTS(SELECT 1 FROM users WHERE id=? AND photo_key=?)").bind(time,key,userId,key),
   env.DB.prepare(`INSERT INTO profile_photo_objects(object_key,user_id,expected_key,state,expires_at,updated_at)
    SELECT ?,?,NULL,'cleanup',?,? WHERE ? IS NOT NULL AND EXISTS(SELECT 1 FROM users WHERE id=? AND photo_key=?) AND EXISTS(SELECT 1 FROM profile_photo_objects p WHERE p.object_key=? AND p.state='current')
    ON CONFLICT(object_key) DO UPDATE SET state=CASE WHEN profile_photo_objects.state IN ('active','retired') THEN 'retired' ELSE 'cleanup' END,updated_at=excluded.updated_at`)
    .bind(previousKey,userId,time,time,previousKey,userId,key,key),
  ]);
  if(!result[0].meta.changes)throw conflict();
  if(previousKey)await bestEffortCleanup(env,previousKey,false);
  return {ok:true};
 }catch(error){
  // A successful D1 transaction can lose its response. Read primary state before
  // cleanup; on uncertainty keep the ledger and bytes for reconciliation.
  let current:{photo_key:string|null;status:string;session_live:number}|null;
  try{current=await env.DB.prepare("SELECT photo_key,status,EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=users.id AND s.token_hash=? AND s.expires_at>?) AS session_live FROM users WHERE id=?").bind(sessionHash,now(),userId).first<{photo_key:string|null;status:string;session_live:number}>();}catch{throw uncertain();}
  if(putConfirmed&&current?.photo_key===key){if(previousKey)await bestEffortCleanup(env,previousKey,false);return {ok:true};}
  await bestEffortCleanup(env,key,!putStarted||putConfirmed);
  if(!current||current.status==='removed'||!current.session_live)throw new HttpError(401,'Your account access changed before the photo was saved. Sign in again.');
  if(error instanceof HttpError)throw error;
  if(signal.aborted)throw new HttpError(400,'The photo upload stopped before it was saved. Try again.');
  throw uncertain();
 }
}

export async function cleanupProfilePhotos(env:Env,time=now()){
 // Fence the whole bounded batch before reading references. This keeps the
 // hourly job within D1's per-invocation query budget without tiny backlogs.
 const candidates=await env.DB.prepare(`UPDATE profile_photo_objects SET
 state=CASE WHEN state IN ('ready','current') THEN 'cleanup' WHEN state='active' THEN 'retired' ELSE state END,updated_at=?
 WHERE object_key IN (SELECT p.object_key FROM profile_photo_objects p
  WHERE state IN ('cleanup','retired') OR (state IN ('active','ready') AND expires_at<=?)
  OR (state='current' AND NOT EXISTS(SELECT 1 FROM users u WHERE u.photo_key=p.object_key))
  ORDER BY updated_at,object_key LIMIT 100)
 AND (state!='current' OR NOT EXISTS(SELECT 1 FROM users u WHERE u.photo_key=profile_photo_objects.object_key)) RETURNING *`).bind(time,time).all<PhotoObject>();
 const valid=candidates.results.filter(row=>profileKey(row.object_key));let failed=candidates.results.length-valid.length;
 if(!valid.length)return {failed,attempted:candidates.results.length};
 try{
  const referenced=await env.DB.prepare('SELECT DISTINCT photo_key FROM users WHERE photo_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(valid.map(row=>row.object_key))).all<{photo_key:string}>(),keys=new Set(referenced.results.map(row=>row.photo_key));
  const repair=valid.filter(row=>row.state==='cleanup'&&keys.has(row.object_key)).map(row=>row.object_key);
  if(repair.length)await env.DB.prepare("UPDATE profile_photo_objects SET state='current' WHERE state='cleanup' AND object_key IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM users u WHERE u.photo_key=profile_photo_objects.object_key)").bind(JSON.stringify(repair)).run();
  const unused=valid.filter(row=>!keys.has(row.object_key)).map(row=>row.object_key);
  if(unused.length){
   await env.FILES.delete(unused);
   await env.DB.prepare("DELETE FROM profile_photo_objects WHERE state='cleanup' AND object_key IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM users u WHERE u.photo_key=profile_photo_objects.object_key)").bind(JSON.stringify(unused)).run();
  }
 }catch{failed+=valid.length;}
 return {failed,attempted:candidates.results.length};
}
