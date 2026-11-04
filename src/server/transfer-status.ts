import {z} from 'zod';
import {now} from './core';

export const transferStatusInput=z.object({ids:z.array(z.string().uuid()).min(1).max(100)}).strict();
type Status='queued'|'delivered'|'rejected'|'expired'|'unavailable';
type Row={id:string;transfer_status:Exclude<Status,'unavailable'>|null;expires_at:number|null;transfer_reason:string|null;receipt_status:Exclude<Status,'unavailable'>|null;receipt_reason:string|null;created_at:number|null;sender_role:'admin'|'member'|null};

// The caller authenticates the paired computer. Each join is independently
// scoped: an unknown ID and another computer's ID have the same response.
// Temporary-row absence never proves a save, and no object-storage read is
// needed to reconcile durable history. Availability describes the HTTP queue,
// separately from the sender's durable delivery status.
export async function lookupTransferStatuses(env:Env,deviceId:string,ids:string[],time=now()){
 const requested=[...new Set(transferStatusInput.parse({ids}).ids)];
 const rows=await env.DB.prepare(`SELECT requested.value AS id,t.status AS transfer_status,t.expires_at,t.rejection_reason AS transfer_reason,
  record.status AS receipt_status,record.rejection_reason AS receipt_reason,record.created_at,
  CASE WHEN sender.status='active' THEN sender.role ELSE NULL END AS sender_role
  FROM json_each(?) requested
  LEFT JOIN transfers t ON t.id=requested.value AND t.device_id=?
  LEFT JOIN delivery_records record ON record.id=requested.value AND record.device_id=?
  LEFT JOIN users sender ON sender.id=t.sender_id`).bind(JSON.stringify(requested),deviceId,deviceId).all<Row>();
 return{statuses:rows.results.map(row=>{
  let status:Status='unavailable',reason:string|null=null;
  const deadline=row.expires_at??(row.created_at===null?null:row.created_at+86400);
  // Match sender history/receipts: an explicit durable decision wins; a queued
  // record projects expiry at its live or fallback deadline, never before it.
  if(row.receipt_status&&row.receipt_status!=='queued'){status=row.receipt_status;reason=row.receipt_reason;}
  else if(row.receipt_status==='queued')status=deadline!==null&&deadline<=time?'expired':'queued';
  else if(row.transfer_status){status=row.transfer_status==='queued'&&deadline!==null&&deadline<=time?'expired':row.transfer_status;reason=row.transfer_reason;}
  const remoteAvailable=status==='queued'&&row.transfer_status==='queued'&&row.expires_at!==null&&row.expires_at>time;
  return{id:row.id,status,remoteAvailable,rejection_reason:status==='rejected'?reason:null,sender_role:remoteAvailable?row.sender_role:null,...(deadline!==null?{expires_at:deadline}:{})};
 })};
}
