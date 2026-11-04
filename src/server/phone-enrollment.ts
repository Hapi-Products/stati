import {computerCode} from './enrollment';
import {cookie,hash,HttpError,json,now,type User} from './core';
export async function issuePhoneEnrollment(request:Request,env:Env,id:string){
 const raw=cookie(request,'stati_session');if(!raw)throw new HttpError(401,'Sign in to continue.');
 const actor=await env.DB.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(raw),now()).first<User>();if(!actor)throw new HttpError(401,'Sign in to continue.');if(actor.role!=='admin'||actor.status!=='active')throw new HttpError(403,'Only administrators can invite new members.');
 if(!env.ENROLLMENT_SECRET||!/^[a-f0-9]{64}$/i.test(env.ENROLLMENT_SECRET))throw new HttpError(503,'The computer authenticator is not configured.');
 const sessionHash=await hash(cookie(request,'stati_session')!),expiresAt=now()+90;
 const changed=await env.DB.prepare(`INSERT INTO settings(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM devices d JOIN users owner ON owner.id=d.owner_id WHERE d.id=? AND d.revoked_at IS NULL AND owner.status='active' AND NOT EXISTS(SELECT 1 FROM station_disconnections x WHERE x.device_id=d.id AND x.user_id=?)) AND EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.id=? AND s.expires_at>? AND u.status='active' AND u.role='admin') ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind('phone_enrollment:'+id,JSON.stringify({id,sessionHash,expiresAt}),id,actor.id,sessionHash,actor.id,now()).run();
 if(!changed.meta.changes)throw new HttpError(403,'This computer is unavailable.');
 const code=computerCode(env.ENROLLMENT_SECRET,id);return json({...code,url:env.APP_ORIGIN+'/#join='+code.code,inviteExpiresAt:expiresAt});
}
export async function phoneEnrollmentDevices(env:Env){
 const rows=await env.DB.prepare("SELECT value FROM settings WHERE key LIKE 'phone_enrollment:%' LIMIT 100").all<{value:string}>(),ids:string[]=[];
 for(const row of rows.results){
  let v:{id:string;sessionHash:string;expiresAt:number};try{v=JSON.parse(row.value);}catch{continue;}
  if(!v||typeof v.id!=='string'||typeof v.sessionHash!=='string'||!Number.isSafeInteger(v.expiresAt)||v.expiresAt<=now())continue;
  const live=await env.DB.prepare(`SELECT d.id FROM devices d JOIN users owner ON owner.id=d.owner_id JOIN sessions s ON s.token_hash=? JOIN users issuer ON issuer.id=s.user_id WHERE d.id=? AND d.revoked_at IS NULL AND owner.status='active' AND s.expires_at>? AND issuer.status='active' AND issuer.role='admin' AND NOT EXISTS(SELECT 1 FROM station_disconnections x WHERE x.device_id=d.id AND x.user_id=issuer.id)`).bind(v.sessionHash,v.id,now()).first();
  if(live)ids.push(v.id);
 }
 return ids;
}
