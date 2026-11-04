import {now} from './core';

// Shared by sender history and idempotent receipts. Absence of a temporary row
// or cloud object is not proof of delivery. Only explicit deadlines can project
// an otherwise queued record to expired before scheduled cleanup runs.
export const SENDER_DELIVERY_STATUS_SQL="CASE WHEN record.status='queued' AND COALESCE(live.expires_at,record.created_at+86400)<=? THEN 'expired' ELSE record.status END";
export const SENDER_DELIVERY_TRANSFER_JOIN_SQL='LEFT JOIN transfers live ON live.id=record.id AND live.sender_id=record.sender_id AND live.device_id=record.device_id';

export type SenderDelivery={id:string;filename:string;status:'queued'|'delivered'|'rejected'|'expired';rejection_reason:string|null;created_at:number;updated_at:number;dismissed_at:number|null;history_hidden_at:number|null;computer_name:string};

export async function senderDeliveries(env:Env,senderId:string,time=now()){
 return(await env.DB.prepare(`SELECT record.id,record.filename,${SENDER_DELIVERY_STATUS_SQL} AS status,
  record.rejection_reason,record.history_hidden_at,record.created_at,record.updated_at,dismissal.dismissed_at,device.name AS computer_name
  FROM delivery_records record JOIN devices device ON device.id=record.device_id
  ${SENDER_DELIVERY_TRANSFER_JOIN_SQL}
  LEFT JOIN delivery_dismissals dismissal ON dismissal.transfer_id=record.id AND dismissal.user_id=record.sender_id
  WHERE record.sender_id=? AND record.created_at>?
  ORDER BY CASE WHEN record.status IN ('delivered','rejected') AND dismissal.dismissed_at IS NULL THEN 0 ELSE 1 END,
   record.updated_at DESC,record.id DESC LIMIT 100`).bind(time,senderId,time-604800).all<SenderDelivery>()).results;
}
