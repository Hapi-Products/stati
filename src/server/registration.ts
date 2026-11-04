import {generateRegistrationOptions,verifyRegistrationResponse} from '@simplewebauthn/server';
import type {RegistrationResponseJSON} from '@simplewebauthn/server';
import {z} from 'zod';
import {availability} from './availability';
import {bootstrapAllowed,enrollmentGrant,enrollmentGuard,REGISTRATION_WINDOW,type EnrollmentGrant} from './access';
import {verifyEnrollment} from './enrollment';
import {body,cookie,hash,HttpError,json,now,profileSchema,setCookie,token} from './core';
const CEREMONY_WINDOW=10*60;
const profile=profileSchema.extend({code:z.string().regex(/^\d{6}$/).optional()});
const savedProfile=profileSchema.extend({id:z.string().uuid(),grantHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const responseSchema=z.object({response:z.record(z.string(),z.unknown())});
async function ensureGrant(request:Request,env:Env,code:string|undefined):Promise<{grant:EnrollmentGrant;accessCookie?:string}>{
 const existing=await enrollmentGrant(request,env);if(existing)return{grant:existing};
 const state=await availability(env);if(!state.accountCreationAllowed&&!await bootstrapAllowed(request,env))throw new HttpError(409,'Account setup is closed. Return during the service window or ask the operator to open Stați on the computer.');
 const deviceId=state.accountCodeRequired?await verifyEnrollment(env,code||''):null;
 let raw=cookie(request,'stati_access'),accessCookie:string|undefined;
 if(!raw||!await env.DB.prepare('SELECT token_hash FROM access_grants WHERE token_hash=? AND expires_at>?').bind(await hash(raw),now()).first()){raw=token();accessCookie=setCookie('stati_access',raw,31536000,env.APP_ORIGIN);}
 const grantHash=await hash(raw),timestamp=now();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO access_grants(token_hash,created_at,expires_at) VALUES(?,?,?) ON CONFLICT(token_hash) DO NOTHING').bind(grantHash,timestamp,timestamp+31536000),
  env.DB.prepare('INSERT INTO enrollment_tickets(grant_hash,expires_at,device_id,challenge_id) VALUES(?,?,?,NULL) ON CONFLICT(grant_hash) DO UPDATE SET expires_at=excluded.expires_at,device_id=excluded.device_id,challenge_id=NULL').bind(grantHash,timestamp+REGISTRATION_WINDOW,deviceId),
 ]);
 return{grant:{grant_hash:grantHash,expires_at:timestamp+REGISTRATION_WINDOW,device_id:deviceId,challenge_id:null},...(accessCookie?{accessCookie}:{})};
}
export async function registrationOptions(request:Request,env:Env){
 const input=await body(request,profile),{grant,accessCookie}=await ensureGrant(request,env,input.code),id=crypto.randomUUID();
 const options=await generateRegistrationOptions({rpName:'Stați · Hapi Products',rpID:env.RP_ID,userName:input.firstName+' '+input.lastInitial+'.',userID:new TextEncoder().encode(id),attestationType:'none',authenticatorSelection:{residentKey:'required',userVerification:'required'},timeout:CEREMONY_WINDOW*1000});
 const raw=token(),challengeId=await hash(raw),timestamp=now(),expiresAt=Math.min(grant.expires_at,timestamp+CEREMONY_WINDOW),payload=JSON.stringify({id,firstName:input.firstName,lastInitial:input.lastInitial,grantHash:grant.grant_hash}),guard=enrollmentGuard();
 // Reopening/canceling the platform passkey prompt replaces the challenge but
 // does not spend the browser's already verified joining-code grant.
 const results=await env.DB.batch([
  env.DB.prepare("DELETE FROM challenges WHERE kind='register' AND id=(SELECT challenge_id FROM enrollment_tickets WHERE grant_hash=?)").bind(grant.grant_hash),
  env.DB.prepare(`INSERT INTO challenges(id,kind,challenge,payload,expires_at) SELECT ?,'register',?,?,? WHERE EXISTS(SELECT 1 FROM enrollment_tickets ticket WHERE ticket.grant_hash=? AND ticket.expires_at>? AND ${guard})`).bind(challengeId,options.challenge,payload,expiresAt,grant.grant_hash,timestamp,timestamp),
  env.DB.prepare(`UPDATE enrollment_tickets AS ticket SET challenge_id=? WHERE ticket.grant_hash=? AND ticket.expires_at>? AND ${guard} AND EXISTS(SELECT 1 FROM challenges WHERE id=? AND expires_at>?)`).bind(challengeId,grant.grant_hash,timestamp,timestamp,challengeId,timestamp),
 ]);
 if(!results[2].meta.changes)throw new HttpError(409,'Your joining window expired or the computer access changed. Enter its current code to start again.');
 const headers=new Headers();headers.append('Set-Cookie',setCookie('stati_challenge',raw,Math.max(1,expiresAt-timestamp),env.APP_ORIGIN));if(accessCookie)headers.append('Set-Cookie',accessCookie);
 return json(options,200,headers);
}
export async function completeRegistration(request:Request,env:Env){
 const input=await body(request,responseSchema),raw=cookie(request,'stati_challenge'),grant=await enrollmentGrant(request,env);if(!raw||!grant)throw new HttpError(400,'Your joining window expired. Enter the computer code to start again.');
 const challengeId=await hash(raw);if(grant.challenge_id!==challengeId)throw new HttpError(400,'This passkey attempt was replaced. Choose Create passkey again.');
 const challenge=await env.DB.prepare("SELECT challenge,payload FROM challenges WHERE id=? AND kind='register' AND expires_at>?").bind(challengeId,now()).first<{challenge:string;payload:string}>();if(!challenge)throw new HttpError(400,'The passkey prompt expired. Choose Create passkey again; your joining window is still open.');
 const saved=savedProfile.parse(JSON.parse(challenge.payload));if(saved.grantHash!==grant.grant_hash)throw new HttpError(400,'Use the browser where you entered the computer code.');
 const result=await verifyRegistrationResponse({response:input.response as unknown as RegistrationResponseJSON,expectedChallenge:challenge.challenge,expectedOrigin:env.APP_ORIGIN,expectedRPID:env.RP_ID,requireUserVerification:true});if(!result.verified||!result.registrationInfo)throw new HttpError(400,'Passkey registration was not verified.');
 const credential=result.registrationInfo.credential,timestamp=now(),guard=enrollmentGuard();
 // D1 batches are transactions. Bind the one account insert to the current
 // grant+challenge, and consume them only after the credential is stored.
 const results=await env.DB.batch([
  env.DB.prepare(`INSERT INTO users(id,first_name,last_initial,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM enrollment_tickets ticket WHERE ticket.grant_hash=? AND ticket.challenge_id=? AND ticket.expires_at>? AND ${guard}) AND EXISTS(SELECT 1 FROM challenges WHERE id=? AND kind='register' AND expires_at>? AND challenge=? AND payload=?)`).bind(saved.id,saved.firstName,saved.lastInitial.toUpperCase(),timestamp,grant.grant_hash,challengeId,timestamp,timestamp,challengeId,timestamp,challenge.challenge,challenge.payload),
  env.DB.prepare('INSERT INTO passkeys(id,user_id,public_key,counter,transports,created_at) SELECT ?,?,?,?,?,? WHERE changes()>0').bind(credential.id,saved.id,btoa(String.fromCharCode(...credential.publicKey)),credential.counter,JSON.stringify(credential.transports||[]),timestamp),
  env.DB.prepare('DELETE FROM enrollment_tickets WHERE grant_hash=? AND challenge_id=? AND changes()>0').bind(grant.grant_hash,challengeId),
  env.DB.prepare("DELETE FROM challenges WHERE id=? AND kind='register' AND changes()>0").bind(challengeId),
 ]);
 if(!results[0].meta.changes||!results[1].meta.changes)throw new HttpError(409,'This passkey attempt expired or was already completed. Sign in with your passkey, or choose Create passkey again.');
 return saved.id;
}
