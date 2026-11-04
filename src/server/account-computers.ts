import {HttpError,now,type User} from './core';

export async function renameAccountComputer(env:Env,actor:User,deviceId:string,name:string,sessionHash:string){
 if(actor.role!=='admin'||actor.status!=='active')throw new HttpError(403,'Only an administrator can rename a computer.');
 const result=await env.DB.prepare("UPDATE devices SET name=? WHERE id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=? AND actor.role='admin' AND actor.status='active' AND EXISTS(SELECT 1 FROM sessions session WHERE session.user_id=actor.id AND session.token_hash=? AND session.expires_at>?))").bind(name,deviceId,actor.id,sessionHash,now()).run();
 if(!result.meta.changes)throw new HttpError(403,'The computer or administrator access changed. Refresh and try again.');
 return{ok:true,name};
}

export async function disconnectAccountComputer(env:Env,actor:User,deviceId:string,sessionHash:string){
 const time=now(),operationId=crypto.randomUUID();
 const result=await env.DB.batch([
  env.DB.prepare(`INSERT INTO station_disconnections(device_id,user_id,created_at,operation_id)
   SELECT computer.id,person.id,?,? FROM devices computer JOIN users person ON person.id=? AND person.status='active'
   WHERE EXISTS(SELECT 1 FROM sessions session WHERE session.user_id=person.id AND session.token_hash=? AND session.expires_at>?) AND computer.id=? AND computer.revoked_at IS NULL AND (person.role='admin' OR computer.owner_id=person.id
    OR EXISTS(SELECT 1 FROM station_memberships member WHERE member.device_id=computer.id AND member.user_id=person.id)
    OR EXISTS(SELECT 1 FROM computer_connections connection WHERE connection.device_id=computer.id AND connection.user_id=person.id))
   ON CONFLICT(device_id,user_id) DO UPDATE SET created_at=excluded.created_at,operation_id=excluded.operation_id`).bind(time,operationId,actor.id,sessionHash,time,deviceId),
  // Preserve a deliberate operator denial. Disconnecting must never provide a
  // way for someone to clear their own denied membership and approve themselves.
  env.DB.prepare("DELETE FROM station_memberships WHERE device_id=? AND user_id=? AND status!='denied' AND EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=station_memberships.device_id AND removed.user_id=station_memberships.user_id AND removed.operation_id=?)").bind(deviceId,actor.id,operationId),
  env.DB.prepare("DELETE FROM computer_connections WHERE device_id=? AND user_id=? AND status!='denied' AND EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=computer_connections.device_id AND removed.user_id=computer_connections.user_id AND removed.operation_id=?)").bind(deviceId,actor.id,operationId),
  env.DB.prepare("INSERT INTO audit SELECT ?,?,'disconnect-own-computer',?,? WHERE EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=? AND removed.user_id=? AND removed.operation_id=?)").bind(crypto.randomUUID(),actor.id,deviceId,time,deviceId,actor.id,operationId),
 ]);
 if(!result[0].meta.changes)throw new HttpError(403,'You do not have a saved connection to this computer.');
 return{ok:true};
}

