import {z} from 'zod';
import {body,cookie,hash,HttpError,json,now,token,type Device,type User} from './core';
import {ilumin8PairingKey} from './ilumin8-catalog';
import {MAX_PROFILE_BYTES,profilePhotoResponse} from './profile-photo';

const challengeKind='ilumin8-participant';
const challengeSchema=z.string().regex(/^[a-f0-9]{64}$/);
const ticketSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const issueSchema=z.object({stationId:z.uuid(),binding:challengeSchema});
const redeemSchema=z.object({ticket:ticketSchema,binding:challengeSchema});
type Profile=Pick<User,'id'|'first_name'|'last_initial'|'photo_key'>;

async function connectedOwner(request:Request,env:Env,device:Device){
 const credential=request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
 if(!credential)throw new HttpError(401,'Pair this computer first.');
 const row=await env.DB.prepare(
  "SELECT owner.id,owner.first_name,owner.last_initial,owner.photo_key FROM devices pc " +
  "JOIN users owner ON owner.id=pc.owner_id AND owner.status='active' " +
  "JOIN settings pairing ON pairing.key=? AND pairing.value='1' " +
  'WHERE pc.id=? AND pc.owner_id=? AND pc.token_hash=? AND pc.revoked_at IS NULL'
 ).bind(ilumin8PairingKey(device.id),device.id,device.owner_id,await hash(credential)).first<Profile>();
 if(!row)throw new HttpError(403,'Pair Ilumin8 with Stați to view the connected account.');
 return row;
}

async function photoObject(env:Env,key:string|null){
 if(!key)return null;
 const object=await env.FILES.get(key);
 return object && object.size>0 && object.size<=MAX_PROFILE_BYTES &&
  ['image/jpeg','image/png','image/webp'].includes(object.httpMetadata?.contentType??'') ? object : null;
}

export async function readIlumin8Account(request:Request,env:Env,device:Device,photo=false){
 const owner=await connectedOwner(request,env,device);
 if(!photo)return json({
  firstName:owner.first_name,lastInitial:owner.last_initial,photoVersion:owner.photo_key?await hash(owner.photo_key):null
 });
 const object=await photoObject(env,owner.photo_key);
 if(!object)throw new HttpError(404,'Photo unavailable.');
 return profilePhotoResponse(object);
}

export async function issueIlumin8Participant(request:Request,env:Env,actor:User){
 const {stationId,binding}=await body(request,issueSchema,1024),time=now();
 const cookieValue=cookie(request,'stati_session');
 if(!cookieValue)throw new HttpError(401,'Sign in to Stați before sharing your profile.');
 const active=await env.DB.prepare(
  "SELECT 1 FROM devices pc JOIN users owner ON owner.id=pc.owner_id AND owner.status='active' " +
  "JOIN settings pairing ON pairing.key=? AND pairing.value='1' WHERE pc.id=? AND pc.revoked_at IS NULL " +
  'AND NOT EXISTS(SELECT 1 FROM station_disconnections sd WHERE sd.device_id=pc.id AND sd.user_id=?)'
 ).bind(ilumin8PairingKey(stationId),stationId,actor.id).first();
 if(!active)throw new HttpError(404,'This Ilumin8 computer is no longer connected to Stați.');
 const key='ilumin8-profile:'+actor.id;
 const limit=await env.DB.prepare(
  'INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET '+
  'count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count'
 ).bind(key,time+60,time,time).first<{count:number}>();
 if(!limit||limit.count>12)throw new HttpError(429,'Too many clicker scans. Try again in a minute.');
 const ticket=token();
 await env.DB.prepare('INSERT INTO challenges VALUES(?,?,?,?,?)')
  .bind(await hash(ticket),challengeKind,binding,JSON.stringify({stationId,actorId:actor.id,sessionHash:await hash(cookieValue)}),time+90).run();
 return json({ticket},201);
}

export async function redeemIlumin8Participant(request:Request,env:Env,device:Device){
 const {ticket,binding}=await body(request,redeemSchema,1024),time=now();
 await connectedOwner(request,env,device);
 // Take only a ticket bound to this QR and station. Another desktop cannot
 // inspect or consume it, and revocation/sign-out wins before the exchange.
 const credential=request.headers.get('authorization')!.slice(7);
 const issued=await env.DB.prepare(
  "DELETE FROM challenges WHERE id=? AND kind=? AND challenge=? AND expires_at>? AND json_extract(payload,'$.stationId')=?"+
  " AND EXISTS(SELECT 1 FROM devices pc JOIN users owner ON owner.id=pc.owner_id AND owner.status='active'"+
  " JOIN settings pairing ON pairing.key=? AND pairing.value='1' WHERE pc.id=? AND pc.token_hash=? AND pc.revoked_at IS NULL)"+
  " AND EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id AND u.status='active'"+
  " WHERE s.token_hash=json_extract(payload,'$.sessionHash') AND u.id=json_extract(payload,'$.actorId') AND s.expires_at>?"+
  " AND NOT EXISTS(SELECT 1 FROM station_disconnections sd WHERE sd.device_id=? AND sd.user_id=u.id)) RETURNING payload"
 ).bind(await hash(ticket),challengeKind,binding,time,device.id,ilumin8PairingKey(device.id),device.id,await hash(credential),time,device.id).first<{payload:string}>();
 if(!issued)throw new HttpError(410,'Your Stați identity code expired. Scan the clicker QR again.');
 const {actorId}=JSON.parse(issued.payload) as {actorId:string};
 const account=await env.DB.prepare("SELECT id,first_name,photo_key FROM users WHERE id=? AND status='active'")
  .bind(actorId).first<Profile>();
 if(!account)throw new HttpError(410,'This Stați account is no longer available.');
 const avatar=await participantAvatar(env,account.photo_key);
 return json({id:account.id,firstName:account.first_name,...(avatar?{avatar}:{})});
}

async function participantAvatar(env:Env,key:string|null){
 try {
  const object=await photoObject(env,key);
  if(!object)return;
  const bytes=new Uint8Array(await object.arrayBuffer());
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return 'data:'+object.httpMetadata!.contentType+';base64,'+btoa(binary);
 } catch { return undefined; }
}
