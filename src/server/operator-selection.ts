import {hash,HttpError,now,token} from './core';
import {assistedApprover,stationMemberAccess} from './station-assisted-sign-in';
import type {MinistryRole} from './ministry-roles';

export const OPERATOR_LEASE_PROTOCOL='stati-operator-v1';
export const OPERATOR_LEASE_SECONDS=45;
const phoneSeconds=300,proofSeconds=8*3600;
type ProofKind='member'|'pin'|'passkey';
export type OperatorDeviceContext={deviceId:string;deviceTokenHash:string};
export type OperatorAuthority=Readonly<OperatorDeviceContext&{userId:string;selectionHash:string;proofKind:ProofKind;adminSessionHash:string|null;ministryRole:MinistryRole|null}>;
type ActiveSelection={protocol:typeof OPERATOR_LEASE_PROTOCOL;lease:string;userId:string;active:true;expiresAt:number;ttlSeconds:number};
type AdminSelection=ActiveSelection&{proof:string;proofExpiresAt:number};
type PendingSelection={protocol:typeof OPERATOR_LEASE_PROTOCOL;lease:string;userId:string;active:false;expiresAt:number;ttlSeconds:number;token:string};
const secret=(value:string|null|undefined)=>typeof value==='string'&&/^[A-Za-z0-9_-]{32,100}$/.test(value)?value:null;
const unavailable=()=>new HttpError(403,'Choose your profile again. Its operator selection expired or access changed.');

/** Use only after the normal paired-device authentication. Bind writes to that
 * exact credential too, so rotation between the route lookup and commit fails. */
export async function operatorDeviceContext(request:Request,deviceId:string):Promise<OperatorDeviceContext>{
 const authorization=request.headers.get('Authorization'),raw=authorization?.startsWith('Bearer ')?secret(authorization.slice(7)):null;
 if(!raw)throw new HttpError(401,'A paired computer credential is required.');
 return{deviceId,deviceTokenHash:await hash(raw)};
}

/** Repeat this predicate inside the authoritative mutation, not only a prior
 * lookup. Build it immediately before that mutation with a fresh server time. */
export function operatorSelectionGuard(authority:OperatorAuthority,time=now()){
 return activeSelectionGuard(authority,time);
}
function activeSelectionGuard(authority:OperatorDeviceContext&{userId:string;selectionHash:string;adminSessionHash:string|null;proofKind?:ProofKind;ministryRole?:MinistryRole|null},time:number){
 return{sql:`EXISTS(SELECT 1 FROM operator_selections selected
  JOIN devices station ON station.id=selected.device_id JOIN users operator ON operator.id=selected.user_id JOIN users owner ON owner.id=station.owner_id
  WHERE selected.device_id=? AND selected.user_id=? AND selected.selection_hash=? ${authority.proofKind?'AND selected.proof_kind=? AND selected.ministry_role IS ?':''}
  AND selected.admin_session_hash IS CASE WHEN selected.proof_kind='member' THEN NULL ELSE ? END
  AND selected.status='active' AND selected.expires_at>? AND station.token_hash=? AND station.revoked_at IS NULL
  AND station.operator_id=selected.user_id AND operator.status='active' AND NOT EXISTS(SELECT 1 FROM user_ministry_roles hiddenPastor WHERE hiddenPastor.user_id=operator.id AND hiddenPastor.role IN ('pastor','commenter')) AND owner.status='active'
  AND ((selected.proof_kind='member' AND operator.role='member' AND selected.admin_session_hash IS NULL AND selected.ministry_role IS NULL AND NOT EXISTS(SELECT 1 FROM user_ministry_roles WHERE user_id=operator.id))
   OR (selected.proof_kind IN ('pin','passkey') AND ((operator.role='admin' AND selected.ministry_role IS NULL)
    OR (selected.proof_kind='passkey' AND operator.role='member' AND ((selected.ministry_role IS NULL AND NOT EXISTS(SELECT 1 FROM user_ministry_roles WHERE user_id=operator.id)) OR EXISTS(SELECT 1 FROM user_ministry_roles ministry WHERE ministry.user_id=operator.id AND ministry.role=selected.ministry_role))))
    AND EXISTS(SELECT 1 FROM operator_sessions authentication
    WHERE authentication.token_hash=selected.admin_session_hash AND authentication.device_id=selected.device_id AND authentication.user_id=selected.user_id AND authentication.expires_at>?)))
  AND NOT EXISTS(SELECT 1 FROM station_assisted_sessions assistance WHERE assistance.proof_hash=selected.admin_session_hash
   AND NOT (${stationMemberAccess('station','operator')} AND ${assistedApprover('assistance')})))`,
  params:[authority.deviceId,authority.userId,authority.selectionHash,...(authority.proofKind?[authority.proofKind,authority.ministryRole??null]:[]),authority.adminSessionHash,time,authority.deviceTokenHash,time]};
}

export async function requireSelectedOperator(request:Request,env:Env,deviceId:string,expectedUserId?:string):Promise<OperatorAuthority>{
 const lease=secret(request.headers.get('X-Stati-Operator-Lease'));
 if(!lease)throw new HttpError(428,'Update Stați and choose a profile before approving requests on this computer.');
 const context=await operatorDeviceContext(request,deviceId),selectionHash=await hash(lease);
 const selected=await env.DB.prepare('SELECT user_id,proof_kind,ministry_role FROM operator_selections WHERE device_id=? AND selection_hash=?').bind(deviceId,selectionHash).first<{user_id:string;proof_kind:ProofKind;ministry_role:MinistryRole|null}>();
 if(!selected||expectedUserId&&selected.user_id!==expectedUserId)throw unavailable();
 const proof=secret(request.headers.get('X-Stati-Operator'));
 if(selected.proof_kind!=='member'&&!proof)throw unavailable();
 const authority:OperatorAuthority=Object.freeze({...context,userId:selected.user_id,selectionHash,proofKind:selected.proof_kind,ministryRole:selected.ministry_role,adminSessionHash:selected.proof_kind==='member'?null:await hash(proof!)});
 const guard=operatorSelectionGuard(authority);
 if(!await env.DB.prepare('SELECT 1 AS allowed WHERE '+guard.sql).bind(...guard.params).first())throw unavailable();
 return authority;
}

// Every follow-up statement is fenced by the newly generated selection nonce.
// A zero-row guarded INSERT is not an error and must not clear an older choice.
function selectionExists(context:OperatorDeviceContext,selectionHash:string){return{sql:'EXISTS(SELECT 1 FROM operator_selections current JOIN devices station ON station.id=current.device_id WHERE current.device_id=? AND current.selection_hash=? AND station.token_hash=?)',params:[context.deviceId,selectionHash,context.deviceTokenHash]};}
function issueSelection(env:Env,context:OperatorDeviceContext,{userId,selectionHash,kind,status,adminHash,unlockHash,expiresAt,time,pin,ministryRole=null,baseRole,backupCodeHash}:{userId:string;selectionHash:string;kind:ProofKind;status:'pending'|'active';adminHash:string|null;unlockHash:string|null;expiresAt:number;time:number;pin?:{salt:string;digest:string};ministryRole?:MinistryRole|null;baseRole?:'member'|'admin';backupCodeHash?:string}){
 const expectedRole=baseRole||(kind==='member'||ministryRole?'member':'admin');
 return env.DB.prepare(`INSERT INTO operator_selections(device_id,user_id,selection_hash,proof_kind,status,admin_session_hash,unlock_hash,expires_at,created_at,ministry_role)
 SELECT station.id,operator.id,?,?,?,?,?,?,?,? FROM devices station JOIN users owner ON owner.id=station.owner_id JOIN users operator ON operator.id=?
 WHERE station.id=? AND station.token_hash=? AND station.revoked_at IS NULL AND owner.status='active' AND operator.status='active' AND NOT EXISTS(SELECT 1 FROM user_ministry_roles hiddenPastor WHERE hiddenPastor.user_id=operator.id AND hiddenPastor.role IN ('pastor','commenter')) AND operator.role=?
 ${ministryRole?'AND EXISTS(SELECT 1 FROM user_ministry_roles ministry WHERE ministry.user_id=operator.id AND ministry.role=?)':expectedRole==='member'?'AND NOT EXISTS(SELECT 1 FROM user_ministry_roles WHERE user_id=operator.id)':''}
 ${pin?'AND EXISTS(SELECT 1 FROM account_pins pin WHERE pin.user_id=operator.id AND pin.salt=? AND pin.digest=?)':''}
 ${backupCodeHash?`AND ${stationMemberAccess('station','operator')} AND EXISTS(SELECT 1 FROM station_backup_codes backup WHERE backup.user_id=operator.id AND backup.code_hash=?)`:''}
 ON CONFLICT(device_id) DO UPDATE SET user_id=excluded.user_id,selection_hash=excluded.selection_hash,proof_kind=excluded.proof_kind,status=excluded.status,admin_session_hash=excluded.admin_session_hash,unlock_hash=excluded.unlock_hash,expires_at=excluded.expires_at,created_at=excluded.created_at,ministry_role=excluded.ministry_role`)
 .bind(selectionHash,kind,status,adminHash,unlockHash,expiresAt,time,ministryRole,userId,context.deviceId,context.deviceTokenHash,expectedRole,...(ministryRole?[ministryRole]:[]),...(pin?[pin.salt,pin.digest]:[]),...(backupCodeHash?[backupCodeHash]:[]));
}
function active(lease:string,userId:string,time:number):ActiveSelection{return{protocol:OPERATOR_LEASE_PROTOCOL,lease,userId,active:true,expiresAt:time+OPERATOR_LEASE_SECONDS,ttlSeconds:OPERATOR_LEASE_SECONDS};}

/** A member explicitly identifies themself; this never creates an admin proof. */
export async function selectMemberOperator(env:Env,context:OperatorDeviceContext,userId:string):Promise<ActiveSelection>{
 const lease=token(),selectionHash=await hash(lease),time=now(),guard=selectionExists(context,selectionHash);
 const results=await env.DB.batch([
  issueSelection(env,context,{userId,selectionHash,kind:'member',status:'active',adminHash:null,unlockHash:null,expiresAt:time+OPERATOR_LEASE_SECONDS,time}),
  env.DB.prepare('DELETE FROM operator_sessions WHERE device_id=? AND '+guard.sql).bind(context.deviceId,...guard.params),
  env.DB.prepare('DELETE FROM operator_unlocks WHERE device_id=? AND '+guard.sql).bind(context.deviceId,...guard.params),
  env.DB.prepare('UPDATE devices SET operator_id=? WHERE id=? AND '+guard.sql).bind(userId,context.deviceId,...guard.params),
 ]);
 if(!results[0].meta.changes)throw unavailable();
 return active(lease,userId,time);
}

/** Call only after PIN verification, passing the exact record verified by the
 * server. A concurrent PIN change or role change cannot issue a new session. */
export async function selectPinOperator(env:Env,context:OperatorDeviceContext,userId:string,verifiedPin:{salt:string;digest:string}):Promise<AdminSelection>{
 const lease=token(),proof=token(),[selectionHash,adminHash]=await Promise.all([hash(lease),hash(proof)]),time=now(),guard=selectionExists(context,selectionHash),proofExpiresAt=time+proofSeconds;
 const results=await env.DB.batch([
  issueSelection(env,context,{userId,selectionHash,kind:'pin',status:'active',adminHash,unlockHash:null,expiresAt:time+OPERATOR_LEASE_SECONDS,time,pin:verifiedPin}),
  env.DB.prepare('DELETE FROM operator_sessions WHERE device_id=? AND '+guard.sql).bind(context.deviceId,...guard.params),
  env.DB.prepare('DELETE FROM operator_unlocks WHERE device_id=? AND '+guard.sql).bind(context.deviceId,...guard.params),
  env.DB.prepare('INSERT INTO operator_sessions(token_hash,device_id,user_id,expires_at) SELECT ?,?,?,? WHERE '+guard.sql).bind(adminHash,context.deviceId,userId,proofExpiresAt,...guard.params),
  env.DB.prepare('UPDATE devices SET operator_id=? WHERE id=? AND '+guard.sql).bind(userId,context.deviceId,...guard.params),
 ]);
 if(!results[0].meta.changes)throw unavailable();
 return{...active(lease,userId,time),proof,proofExpiresAt};
}

export async function beginPhoneOperator(env:Env,context:OperatorDeviceContext,userId:string,challenge:string,backupCodeHash?:string):Promise<PendingSelection>{
 if(typeof challenge!=='string'||challenge.length<16||challenge.length>1024)throw new HttpError(400,'A new server passkey challenge is required.');
 const person=await env.DB.prepare("SELECT u.role,m.role AS ministry_role FROM users u LEFT JOIN user_ministry_roles m ON m.user_id=u.id WHERE u.id=? AND u.status='active'").bind(userId).first<{role:'member'|'admin';ministry_role:MinistryRole|null}>();
 if(!person||['pastor','commenter'].includes(person.ministry_role??'')||backupCodeHash&&person.role!=='member')throw unavailable();
 const ministryRole=person.role==='admin'?null:person.ministry_role;
 const lease=token(),raw=token(),[selectionHash,unlockHash]=await Promise.all([hash(lease),hash(raw)]),time=now(),expiresAt=time+phoneSeconds,guard=selectionExists(context,selectionHash);
 const results=await env.DB.batch([
  issueSelection(env,context,{userId,selectionHash,kind:'passkey',status:'pending',adminHash:null,unlockHash,expiresAt,time,ministryRole,baseRole:person.role,backupCodeHash}),
  env.DB.prepare('DELETE FROM operator_sessions WHERE device_id=? AND '+guard.sql).bind(context.deviceId,...guard.params),
  env.DB.prepare('DELETE FROM operator_unlocks WHERE device_id=? AND '+guard.sql).bind(context.deviceId,...guard.params),
  env.DB.prepare('INSERT INTO operator_unlocks(token_hash,device_id,user_id,challenge,expires_at,approved) SELECT ?,?,?,?,?,0 WHERE '+guard.sql).bind(unlockHash,context.deviceId,userId,challenge,expiresAt,...guard.params),
  ...(backupCodeHash?[
   env.DB.prepare('DELETE FROM station_backup_codes WHERE user_id=? AND code_hash=? AND '+guard.sql).bind(userId,backupCodeHash,...guard.params),
   env.DB.prepare('INSERT INTO station_assisted_unlocks(unlock_hash) SELECT ? WHERE '+guard.sql).bind(unlockHash,...guard.params),
  ]:[]),
  env.DB.prepare('UPDATE devices SET operator_id=NULL WHERE id=? AND '+guard.sql).bind(context.deviceId,...guard.params),
 ]);
 if(!results[0].meta.changes){
  if(backupCodeHash)throw new HttpError(403,'This backup code is unavailable for this member and computer.');
  throw unavailable();
 }
 return{protocol:OPERATOR_LEASE_PROTOCOL,lease,userId,active:false,expiresAt,ttlSeconds:phoneSeconds,token:raw};
}

function pendingGuard(context:OperatorDeviceContext,userId:string,selectionHash:string,unlockHash:string,time:number){return{sql:`SELECT selected.device_id,selected.user_id FROM operator_selections selected
 JOIN devices station ON station.id=selected.device_id JOIN users owner ON owner.id=station.owner_id JOIN users operator ON operator.id=selected.user_id
 JOIN operator_unlocks challenge ON challenge.token_hash=selected.unlock_hash AND challenge.device_id=selected.device_id AND challenge.user_id=selected.user_id
 WHERE selected.device_id=? AND selected.user_id=? AND selected.selection_hash=? AND selected.unlock_hash=? AND selected.proof_kind='passkey' AND selected.status='pending'
 AND selected.expires_at>? AND challenge.expires_at>? AND station.token_hash=? AND station.revoked_at IS NULL AND owner.status='active' AND operator.status='active' AND NOT EXISTS(SELECT 1 FROM user_ministry_roles hiddenPastor WHERE hiddenPastor.user_id=operator.id AND hiddenPastor.role IN ('pastor','commenter'))
 AND ((operator.role='admin' AND selected.ministry_role IS NULL) OR (operator.role='member' AND ((selected.ministry_role IS NULL AND NOT EXISTS(SELECT 1 FROM user_ministry_roles WHERE user_id=operator.id)) OR EXISTS(SELECT 1 FROM user_ministry_roles ministry WHERE ministry.user_id=operator.id AND ministry.role=selected.ministry_role))))
 AND NOT EXISTS(SELECT 1 FROM station_assisted_unlocks assistance WHERE assistance.unlock_hash=challenge.token_hash
  AND NOT (${stationMemberAccess('station','operator')} AND (challenge.approved=0 OR ${assistedApprover('assistance')})))`,params:[context.deviceId,userId,selectionHash,unlockHash,time,time,context.deviceTokenHash]};}

/** Returns null only while this exact live phone ceremony awaits approval.
 * Consuming it once creates a separate proof and retains the private lease. */
export async function activatePhoneOperator(env:Env,context:OperatorDeviceContext,{userId,lease,token:raw}:{userId:string;lease:string;token:string}):Promise<AdminSelection|null>{
 if(!secret(lease)||!secret(raw))throw unavailable();
 const proof=token(),[selectionHash,unlockHash,adminHash]=await Promise.all([hash(lease),hash(raw),hash(proof)]),time=now(),pending=pendingGuard(context,userId,selectionHash,unlockHash,time),proofExpiresAt=time+proofSeconds;
 const current=selectionExists(context,selectionHash),activated=`${current.sql} AND EXISTS(SELECT 1 FROM operator_selections selected WHERE selected.device_id=? AND selected.status='active' AND selected.admin_session_hash=?)`,activatedParams=[...current.params,context.deviceId,adminHash];
 const results=await env.DB.batch([
  env.DB.prepare(`INSERT INTO operator_sessions(token_hash,device_id,user_id,expires_at) SELECT ?,selected.device_id,selected.user_id,? FROM (${pending.sql} AND challenge.approved=1) selected`).bind(adminHash,proofExpiresAt,...pending.params),
  env.DB.prepare(`INSERT INTO station_assisted_sessions(proof_hash,approved_by,passkey_id)
   SELECT ?,approved_by,passkey_id FROM station_assisted_unlocks WHERE unlock_hash=? AND changes()=1`).bind(adminHash,unlockHash),
  env.DB.prepare("UPDATE operator_selections SET status='active',admin_session_hash=?,unlock_hash=NULL,expires_at=? WHERE device_id=? AND selection_hash=? AND unlock_hash=? AND status='pending' AND EXISTS(SELECT 1 FROM operator_sessions authentication WHERE authentication.token_hash=? AND authentication.device_id=operator_selections.device_id AND authentication.user_id=operator_selections.user_id)").bind(adminHash,time+OPERATOR_LEASE_SECONDS,context.deviceId,selectionHash,unlockHash,adminHash),
  env.DB.prepare('UPDATE devices SET operator_id=? WHERE id=? AND '+activated).bind(userId,context.deviceId,...activatedParams),
  env.DB.prepare('DELETE FROM operator_unlocks WHERE token_hash=? AND '+activated).bind(unlockHash,...activatedParams),
  env.DB.prepare('DELETE FROM operator_sessions WHERE device_id=? AND token_hash<>? AND '+activated).bind(context.deviceId,adminHash,...activatedParams),
 ]);
 if(!results[0].meta.changes){
  const waiting=await env.DB.prepare(pending.sql+' AND challenge.approved=0').bind(...pending.params).first();
  if(waiting)return null;
  throw unavailable();
 }
 return{...active(lease,userId,time),proof,proofExpiresAt};
}

/** No INSERT and no change of identity: expired, pending and mismatched choices
 * cannot be renewed. Authentication retains its original eight-hour deadline. */
export async function renewOperatorSelection(request:Request,env:Env,deviceId:string,userId:string){
 const lease=secret(request.headers.get('X-Stati-Operator-Lease'));
 if(!lease)throw new HttpError(428,'Update Stați and choose a profile before approving requests on this computer.');
 const context=await operatorDeviceContext(request,deviceId),proof=secret(request.headers.get('X-Stati-Operator'));
 const [selectionHash,adminSessionHash]=await Promise.all([hash(lease),proof?hash(proof):null]),time=now(),guard=activeSelectionGuard({...context,userId,selectionHash,adminSessionHash},time),deadline=time+OPERATOR_LEASE_SECONDS;
 const row=await env.DB.prepare(`UPDATE operator_selections SET expires_at=MIN(?,COALESCE((SELECT expires_at FROM operator_sessions WHERE token_hash=operator_selections.admin_session_hash),?))
  WHERE device_id=? AND ${guard.sql} RETURNING user_id,expires_at`).bind(deadline,deadline,deviceId,...guard.params).first<{user_id:string;expires_at:number}>();
 if(!row)throw unavailable();
 return{active:true as const,userId:row.user_id,expiresAt:row.expires_at,ttlSeconds:row.expires_at-time};
}

/** Best-effort reset captures the old paired credential and old selection
 * secret. It can clear that exact active/pending/expired row, never a new one. */
export async function resetOperatorSelection(request:Request,env:Env,deviceId:string){
 const lease=secret(request.headers.get('X-Stati-Operator-Lease'));
 if(!lease)return{reset:false};
 const context=await operatorDeviceContext(request,deviceId),guard=selectionExists(context,await hash(lease));
 const result=await env.DB.batch([
  env.DB.prepare('UPDATE devices SET operator_id=NULL WHERE id=? AND '+guard.sql).bind(deviceId,...guard.params),
  env.DB.prepare('DELETE FROM operator_sessions WHERE device_id=? AND '+guard.sql).bind(deviceId,...guard.params),
  env.DB.prepare('DELETE FROM operator_unlocks WHERE device_id=? AND '+guard.sql).bind(deviceId,...guard.params),
  env.DB.prepare('DELETE FROM operator_selections WHERE device_id=? AND '+guard.sql).bind(deviceId,...guard.params),
 ]);
 return{reset:!!result[3].meta.changes};
}
