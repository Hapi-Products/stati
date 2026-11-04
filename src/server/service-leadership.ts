import {z} from 'zod';
import {HttpError,now} from './core';
import type {MinistryAuthority} from './ministry-roles';
import {stationMinistryGuard} from './station-catalog';

const target={id:z.string().uuid(),expectedRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1),expectedLeadershipRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1)};
export const serviceLeadershipAction=z.discriminatedUnion('type',[
 z.object({type:z.literal('claim-leadership'),...target,takeOver:z.boolean().default(false)}).strict(),
 z.object({type:z.literal('release-leadership'),...target}).strict(),
 z.object({type:z.literal('finalize-order'),...target}).strict(),
 z.object({type:z.literal('acknowledge-order'),...target}).strict(),
]);
type Action=z.infer<typeof serviceLeadershipAction>;
type LeadershipRow={leader_id:string|null;revision:number;finalized_revision:number|null;finalized_at:number|null;acknowledged_revision:number|null;acknowledged_at:number|null;leader_label:string|null;acknowledged_label:string|null};
const canLead=(authority:MinistryAuthority)=>authority.capabilities.planServices||authority.ministryRole==='pastor';
const canTakeOver=(authority:MinistryAuthority)=>authority.user.role==='admin'||['pastor','worship_leader','worship_member','choir_director'].includes(authority.ministryRole||'');
export function isLeadershipAction(value:{type:string}):value is Action{return serviceLeadershipAction.options.some(option=>option.shape.type.value===value.type);}

/** Assigned running orders require their named leader, including administrators
 * who must explicitly take over first. Unassigned legacy plans remain editable
 * by the existing planning roles; a pastor must claim one before editing it. */
export function serviceOrderGuard(authority:MinistryAuthority,deviceId:string,serviceId:string){
 return authority.capabilities.planServices?{sql:'NOT EXISTS(SELECT 1 FROM station_service_leadership leadership WHERE leadership.device_id=? AND leadership.service_id=? AND leadership.leader_id IS NOT NULL AND leadership.leader_id<>?)',params:[deviceId,serviceId,authority.user.id]}:{sql:'EXISTS(SELECT 1 FROM station_service_leadership leadership WHERE leadership.device_id=? AND leadership.service_id=? AND leadership.leader_id=?)',params:[deviceId,serviceId,authority.user.id]};
}
export async function serviceLeadershipMap(env:Env,deviceId:string,authority:MinistryAuthority,plans:{id:string;revision:number;archived:boolean}[]){
 const guard=stationMinistryGuard(authority,deviceId,'readSongs');
 const rows=(await env.DB.prepare(`SELECT leadership.*,leader.first_name||' '||leader.last_initial||'.' AS leader_label,acknowledger.first_name||' '||acknowledger.last_initial||'.' AS acknowledged_label FROM station_service_leadership leadership LEFT JOIN users leader ON leader.id=leadership.leader_id LEFT JOIN users acknowledger ON acknowledger.id=leadership.acknowledged_by WHERE leadership.device_id=? AND ${guard.sql}`).bind(deviceId,...guard.params).all<LeadershipRow&{service_id:string}>()).results;
 const byId=new Map(rows.map(row=>[row.service_id,row]));
 return new Map(plans.map(plan=>{const row=byId.get(plan.id),leaderId=row?.leader_id||null,isLeader=leaderId===authority.user.id;
  return[plan.id,{leaderId,leaderLabel:row?.leader_label||null,revision:row?.revision||0,isLeader,canClaim:!plan.archived&&canLead(authority)&&!leaderId,canTakeOver:!plan.archived&&canTakeOver(authority)&&!!leaderId&&!isLeader,canEdit:!plan.archived&&(isLeader||!leaderId&&authority.capabilities.planServices),canAcknowledge:!plan.archived&&authority.kind==='operator'&&row?.finalized_revision===plan.revision&&row?.acknowledged_revision!==plan.revision,finalizedRevision:row?.finalized_revision||null,finalizedAt:row?.finalized_at||null,acknowledgedRevision:row?.acknowledged_revision||null,acknowledgedAt:row?.acknowledged_at||null,acknowledgedByLabel:row?.acknowledged_label||null}] as const;
 }));
}
export async function changeServiceLeadership(env:Env,deviceId:string,authority:MinistryAuthority,data:Action,native:boolean){
 if(!canLead(authority))throw new HttpError(403,'Your role does not allow service leadership.');
 if(data.type==='acknowledge-order'&&(!native||authority.kind!=='operator'))throw new HttpError(403,'Acknowledge the service order from the authenticated presentation computer.');
 const row=await env.DB.prepare('SELECT * FROM station_service_leadership WHERE device_id=? AND service_id=?').bind(deviceId,data.id).first<LeadershipRow>();
 if((row?.revision||0)!==data.expectedLeadershipRevision)throw new HttpError(409,'The service leader changed. Refresh before continuing.');
 if(data.type==='claim-leadership'){
  if(row?.leader_id&&row.leader_id!==authority.user.id&&(!data.takeOver||!canTakeOver(authority)))throw new HttpError(403,'An authorized backup must explicitly take over this service.');
 }else if(data.type!=='acknowledge-order'&&row?.leader_id!==authority.user.id)throw new HttpError(403,'Only the selected service leader can change or finalize this running order.');
 if(data.type==='acknowledge-order'&&row?.finalized_revision!==data.expectedRevision)throw new HttpError(409,'The leader must finalize the latest saved order before it is acknowledged.');
 const timestamp=now(),guard=stationMinistryGuard(authority,deviceId,'readSongs',timestamp),service={sql:'EXISTS(SELECT 1 FROM station_services WHERE device_id=? AND id=? AND revision=? AND archived=0)',params:[deviceId,data.id,data.expectedRevision]},auditId=crypto.randomUUID();
 let mutation:D1PreparedStatement;
 if(data.type==='claim-leadership')mutation=env.DB.prepare(`INSERT INTO station_service_leadership(device_id,service_id,leader_id,revision,updated_at) SELECT ?,?,?,1,? WHERE ${guard.sql} AND ${service.sql} AND COALESCE((SELECT revision FROM station_service_leadership WHERE device_id=? AND service_id=?),0)=? ON CONFLICT(device_id,service_id) DO UPDATE SET leader_id=excluded.leader_id,revision=station_service_leadership.revision+1,finalized_revision=NULL,finalized_at=NULL,acknowledged_revision=NULL,acknowledged_by=NULL,acknowledged_at=NULL,updated_at=excluded.updated_at WHERE station_service_leadership.revision=? AND station_service_leadership.leader_id IS ?`).bind(deviceId,data.id,authority.user.id,timestamp,...guard.params,...service.params,deviceId,data.id,data.expectedLeadershipRevision,data.expectedLeadershipRevision,row?.leader_id||null);
 else{
  const update=data.type==='release-leadership'?'leader_id=NULL,finalized_revision=NULL,finalized_at=NULL,acknowledged_revision=NULL,acknowledged_by=NULL,acknowledged_at=NULL':data.type==='finalize-order'?'finalized_revision=?,finalized_at=?,acknowledged_revision=NULL,acknowledged_by=NULL,acknowledged_at=NULL':'acknowledged_revision=?,acknowledged_by=?,acknowledged_at=?';
  const values=data.type==='release-leadership'?[]:data.type==='finalize-order'?[data.expectedRevision,timestamp]:[data.expectedRevision,authority.user.id,timestamp];
  const ownership=data.type==='acknowledge-order'?'finalized_revision=?':'leader_id=?';
  mutation=env.DB.prepare(`UPDATE station_service_leadership SET ${update},revision=revision+1,updated_at=? WHERE device_id=? AND service_id=? AND revision=? AND ${ownership} AND ${guard.sql} AND ${service.sql}`).bind(...values,timestamp,deviceId,data.id,data.expectedLeadershipRevision,data.type==='acknowledge-order'?data.expectedRevision:authority.user.id,...guard.params,...service.params);
 }
 const result=await env.DB.batch([mutation,env.DB.prepare('INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,?,?,? WHERE changes()>0').bind(auditId,authority.user.id,'station-service-'+data.type,deviceId,timestamp)]);
 if(!result[0].meta.changes)throw new HttpError(409,'The service, leader or your access changed. Refresh and try again.');
}
