import {generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import type {AuthenticationResponseJSON,AuthenticatorTransport} from '@simplewebauthn/server';
import {hash,HttpError,now,token} from './core';
import type {OperatorDeviceContext} from './operator-selection';
export async function pinDigest(pin:string,salt:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256);return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');}
export async function verifyAdminPasskey(env:Env,userId:string,challenge:string,response:AuthenticationResponseJSON){const key=await env.DB.prepare('SELECT * FROM passkeys WHERE id=? AND user_id=?').bind(response.id,userId).first<{id:string;public_key:string;counter:number;transports:string}>();if(!key)throw new HttpError(401,'Use the passkey for this account.');const result=await verifyAuthenticationResponse({response,expectedChallenge:challenge,expectedOrigin:env.APP_ORIGIN,expectedRPID:env.RP_ID,requireUserVerification:true,credential:{id:key.id,publicKey:Uint8Array.from(atob(key.public_key),c=>c.charCodeAt(0)),counter:key.counter,transports:JSON.parse(key.transports) as AuthenticatorTransport[]}});if(!result.verified)throw new HttpError(401,'Passkey verification failed.');await env.DB.prepare('UPDATE passkeys SET counter=? WHERE id=?').bind(result.authenticationInfo.newCounter,key.id).run();}
export async function adminOptions(env:Env,userId:string,preferPhone=false){const keys=await env.DB.prepare('SELECT id,transports FROM passkeys WHERE user_id=?').bind(userId).all<{id:string;transports:string}>();if(!keys.results.length)throw new HttpError(409,'Set up your account passkey first.');const options=await generateAuthenticationOptions({rpID:env.RP_ID,userVerification:'required',allowCredentials:keys.results.map(k=>({id:k.id}))});return {...options,...(preferPhone?{hints:['hybrid']}:{})};}
export async function operatorVerified(r:Request,env:Env,deviceId:string){const proof=r.headers.get('X-Stati-Operator');if(!proof)return false;return !!await env.DB.prepare("SELECT s.user_id FROM operator_sessions s JOIN devices d ON d.id=s.device_id JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.device_id=? AND s.user_id=d.operator_id AND s.expires_at>? AND u.role='admin' AND u.status='active' AND NOT EXISTS(SELECT 1 FROM user_ministry_roles pastor WHERE pastor.user_id=u.id AND pastor.role IN ('pastor','commenter')) AND d.revoked_at IS NULL").bind(await hash(proof),deviceId,now()).first();}
export async function requireOperator(r:Request,env:Env,deviceId:string){if(!await operatorVerified(r,env,deviceId))throw new HttpError(403,'Unlock an administrator account on this computer first.');}
type VerifiedPin={salt:string;digest:string};
const legacyChanged=()=>new HttpError(409,'The profile or computer changed. Update Stați or choose your profile again.');
/** Older clients never remove nonce-bound choices, including expired choices.
 * Keep this predicate inside the first authoritative statement: role, pairing
 * and PIN reads before verification can all become stale before its commit. */
function legacyDeviceGuard(context:OperatorDeviceContext){return{sql:`EXISTS(SELECT 1 FROM devices station JOIN users owner ON owner.id=station.owner_id
 WHERE station.id=? AND station.token_hash=? AND station.revoked_at IS NULL AND owner.status='active'
 AND NOT EXISTS(SELECT 1 FROM operator_selections selected WHERE selected.device_id=station.id))`,params:[context.deviceId,context.deviceTokenHash]};}
function legacyPersonGuard(context:OperatorDeviceContext,userId:string,role:'member'|'admin',pin?:VerifiedPin){
 const device=legacyDeviceGuard(context);
 return{sql:`${device.sql} AND EXISTS(SELECT 1 FROM users operator WHERE operator.id=? AND operator.status='active' AND operator.role=? AND NOT EXISTS(SELECT 1 FROM user_ministry_roles pastor WHERE pastor.user_id=operator.id AND pastor.role IN ('pastor','commenter'))
 ${pin?'AND EXISTS(SELECT 1 FROM account_pins pin WHERE pin.user_id=operator.id AND pin.salt=? AND pin.digest=?)':''})`,params:[...device.params,userId,role,...(pin?[pin.salt,pin.digest]:[])]};
}

/** Legacy PIN compatibility requires the exact PIN record already verified by
 * the route. A denied guarded insertion cannot clear another selection/proof. */
export async function issueOperator(env:Env,context:OperatorDeviceContext,userId:string,pin:VerifiedPin){
 const proof=token(),proofHash=await hash(proof),guard=legacyPersonGuard(context,userId,'admin',pin),time=now();
 const issued='EXISTS(SELECT 1 FROM operator_sessions WHERE token_hash=? AND device_id=?)',issuedParams=[proofHash,context.deviceId];
 const results=await env.DB.batch([
  env.DB.prepare('INSERT INTO operator_sessions(token_hash,device_id,user_id,expires_at) SELECT ?,?,?,? WHERE '+guard.sql).bind(proofHash,context.deviceId,userId,time+8*3600,...guard.params),
  env.DB.prepare('UPDATE devices SET operator_id=? WHERE id=? AND '+issued).bind(userId,context.deviceId,...issuedParams),
  env.DB.prepare('DELETE FROM operator_unlocks WHERE device_id=? AND '+issued).bind(context.deviceId,...issuedParams),
  env.DB.prepare('DELETE FROM operator_sessions WHERE device_id=? AND token_hash<>? AND '+issued).bind(context.deviceId,proofHash,...issuedParams)
 ]);
 if(!results[0].meta.changes)throw legacyChanged();
 return proof;
}

export async function selectLegacyMemberOperator(env:Env,context:OperatorDeviceContext,userId:string){
 const guard=legacyPersonGuard(context,userId,'member');
 const results=await env.DB.batch([
  env.DB.prepare('DELETE FROM operator_sessions WHERE device_id=? AND '+guard.sql).bind(context.deviceId,...guard.params),
  env.DB.prepare('DELETE FROM operator_unlocks WHERE device_id=? AND '+guard.sql).bind(context.deviceId,...guard.params),
  env.DB.prepare('UPDATE devices SET operator_id=? WHERE id=? AND '+guard.sql).bind(userId,context.deviceId,...guard.params)
 ]);
 if(!results[2].meta.changes)throw legacyChanged();
}

export async function beginLegacyPhoneOperator(env:Env,context:OperatorDeviceContext,userId:string,challenge:string){
 const raw=token(),unlockHash=await hash(raw),guard=legacyPersonGuard(context,userId,'admin'),expiresAt=now()+300;
 const issued='EXISTS(SELECT 1 FROM operator_unlocks WHERE token_hash=? AND device_id=?)',issuedParams=[unlockHash,context.deviceId];
 const results=await env.DB.batch([
  env.DB.prepare('INSERT INTO operator_unlocks(token_hash,device_id,user_id,challenge,expires_at,approved) SELECT ?,?,?,?,?,0 WHERE '+guard.sql).bind(unlockHash,context.deviceId,userId,challenge,expiresAt,...guard.params),
  env.DB.prepare('DELETE FROM operator_sessions WHERE device_id=? AND '+issued).bind(context.deviceId,...issuedParams),
  env.DB.prepare('DELETE FROM operator_unlocks WHERE device_id=? AND token_hash<>? AND '+issued).bind(context.deviceId,unlockHash,...issuedParams),
  env.DB.prepare('UPDATE devices SET operator_id=NULL WHERE id=? AND '+issued).bind(context.deviceId,...issuedParams)
 ]);
 if(!results[0].meta.changes)throw legacyChanged();
 return{token:raw,expiresAt};
}

export async function resetLegacyOperator(env:Env,context:OperatorDeviceContext){
 const guard=legacyDeviceGuard(context);
 await env.DB.batch([
  env.DB.prepare('UPDATE devices SET operator_id=NULL WHERE id=? AND '+guard.sql).bind(context.deviceId,...guard.params),
  env.DB.prepare('DELETE FROM operator_unlocks WHERE device_id=? AND '+guard.sql).bind(context.deviceId,...guard.params),
  env.DB.prepare('DELETE FROM operator_sessions WHERE device_id=? AND '+guard.sql).bind(context.deviceId,...guard.params)
 ]);
}

/** Compatibility for preview30 phone unlock. An old response cannot replace a
 * newer nonce-bound choice. This proof never grants a fresh selection lease. */
export async function issueLegacyPhoneOperator(env:Env,deviceId:string,deviceTokenHash:string,unlockToken:string){
 const proof=token(),proofHash=await hash(proof),time=now();
 const issued='EXISTS(SELECT 1 FROM operator_sessions WHERE token_hash=? AND device_id=?)';
 const results=await env.DB.batch([
  env.DB.prepare(`INSERT INTO operator_sessions(token_hash,device_id,user_id,expires_at)
   SELECT ?,challenge.device_id,challenge.user_id,? FROM operator_unlocks challenge
   JOIN devices station ON station.id=challenge.device_id JOIN users owner ON owner.id=station.owner_id JOIN users administrator ON administrator.id=challenge.user_id
   WHERE challenge.token_hash=? AND challenge.device_id=? AND challenge.approved=1 AND challenge.expires_at>?
   AND station.token_hash=? AND station.revoked_at IS NULL AND owner.status='active' AND administrator.status='active' AND administrator.role='admin'
   AND NOT EXISTS(SELECT 1 FROM operator_selections WHERE device_id=station.id)`)
   .bind(proofHash,time+8*3600,await hash(unlockToken),deviceId,time,deviceTokenHash),
  env.DB.prepare('UPDATE devices SET operator_id=(SELECT user_id FROM operator_sessions WHERE token_hash=?) WHERE id=? AND '+issued).bind(proofHash,deviceId,proofHash,deviceId),
  env.DB.prepare('DELETE FROM operator_unlocks WHERE device_id=? AND '+issued).bind(deviceId,proofHash,deviceId),
  env.DB.prepare('DELETE FROM operator_sessions WHERE device_id=? AND token_hash<>? AND '+issued).bind(deviceId,proofHash,proofHash,deviceId)
 ]);
 return results[0].meta.changes?proof:null;
}
