import {z} from 'zod';
import {HttpError,now} from './core';

export const connectionPresenceSchema=z.object({deviceIds:z.array(z.string().uuid()).max(100).default([])}).strict();

// Presence is an explicit selection pulse, not an account-wide heartbeat. A
// single guarded statement both rechecks authority and binds the current lease.
// Other tabs' selections are left alone and expire after the existing 45s TTL.
export async function renewConnectionPresence(env:Env,{userId,sessionHash,deviceIds}:{userId:string;sessionHash:string;deviceIds:string[]}){
 const parsed=connectionPresenceSchema.safeParse({deviceIds});
 if(!parsed.success)throw new HttpError(400,'Choose up to 100 valid computers.');
 const selected=[...new Set(parsed.data.deviceIds.map(id=>id.toLowerCase()))];
 if(!selected.length)return{ok:true,renewed:0};
 const time=now(),entries=selected.map(deviceId=>({deviceId,connectionId:crypto.randomUUID()}));
 const result=await env.DB.prepare(`
  INSERT INTO computer_connections(id,receiver_id,device_id,user_id,status,last_seen,created_at)
  SELECT json_extract(selection.value,'$.connectionId'),r.id,d.id,requester.id,'approved',?,?
  FROM json_each(?) selection
  JOIN users requester ON requester.id=? AND requester.status IN ('active','pending')
  JOIN sessions s ON s.user_id=requester.id AND s.token_hash=? AND s.expires_at>?
  JOIN devices d ON d.id=json_extract(selection.value,'$.deviceId') AND d.revoked_at IS NULL AND d.last_seen>?
  JOIN users owner ON owner.id=d.owner_id AND owner.status='active'
  JOIN receivers r ON r.device_id=d.id AND r.closed_at IS NULL AND r.expires_at>?
  LEFT JOIN station_memberships membership ON membership.device_id=d.id AND membership.user_id=requester.id
  LEFT JOIN computer_connections current ON current.receiver_id=r.id AND current.user_id=requester.id
  WHERE r.id=(SELECT live.id FROM receivers live WHERE live.device_id=d.id AND live.closed_at IS NULL AND live.expires_at>? ORDER BY live.created_at DESC,live.id DESC LIMIT 1)
  AND NOT EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=d.id AND removed.user_id=requester.id)
  AND ((requester.role='admin' AND requester.status='active') OR (
   (membership.status IS NULL OR membership.status!='denied')
   AND (current.status IS NULL OR current.status!='denied')
   AND (membership.status='approved' OR current.status='approved')
  ))
  ON CONFLICT(receiver_id,user_id) DO UPDATE SET status=excluded.status,last_seen=excluded.last_seen
 `).bind(time,time,JSON.stringify(entries),userId,sessionHash,time,time-45,time,time).run();
 return{ok:true,renewed:result.meta.changes||0};
}
