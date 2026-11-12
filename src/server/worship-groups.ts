import {z} from 'zod';
import {body,hash,HttpError,json,now} from './core';
import {requireStationMinistry,stationMinistryGuard} from './station-catalog';
import {ministryAuthorityGuard,requireMinistryCapability,type MinistryAuthority} from './ministry-roles';
import type {WorshipGroup,WorshipGroupDetail,WorshipGroupList,WorshipGroupMember} from '../shared/worship-groups-types';

type GroupRow={id:string;name:string;owner_id:string;creation_hash:string;revision:number;created_at:number;updated_at:number;member_count:number};
const identifier=z.string().uuid();
const name=z.string().normalize('NFKC').trim().min(1).max(80).refine(value=>!/[\u0000-\u001f\u007f]/.test(value),'Use a group name without control characters.');
const memberIds=z.array(identifier).max(100).transform(values=>[...new Set(values)].sort());
const creation=z.object({id:identifier,name,memberIds}).strict();
const update=z.object({name,memberIds,revision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1)}).strict();
const missing=()=>new HttpError(404,'This worship group is no longer available to your account.');
function validId(id:string){if(!identifier.safeParse(id).success)throw new HttpError(400,'Choose a saved worship group.');}

/** Call alongside a fresh ministry authority guard in the actual SQL operation.
 * The expression is a trusted server-owned column/placeholder, never user SQL. */
export function worshipGroupAccess(authority:MinistryAuthority,expression:string,managing=false){
 return{sql:`EXISTS(SELECT 1 FROM worship_groups named_group WHERE named_group.id=${expression} AND named_group.archived_at IS NULL
  AND (?=1 OR ${managing?'named_group.owner_id=?':'EXISTS(SELECT 1 FROM worship_group_members selected_member WHERE selected_member.group_id=named_group.id AND selected_member.user_id=?)'}))`,params:[authority.user.role==='admin'?1:0,authority.user.id]};
}
export function groupMaterialAccess(authority:MinistryAuthority,alias='material'){
 const access=worshipGroupAccess(authority,alias+'.group_id');
 return{sql:`(${alias}.group_id IS NULL OR ${access.sql})`,params:access.params};
}
function group(row:GroupRow,authority:MinistryAuthority):WorshipGroup{
 return{id:row.id,name:row.name,ownerId:row.owner_id,revision:row.revision,memberCount:row.member_count,canManage:authority.capabilities.manageWorship&&(authority.user.role==='admin'||row.owner_id===authority.user.id),createdAt:row.created_at,updatedAt:row.updated_at};
}
function validMembers(ids:string[],owner:string){
 return{sql:`NOT EXISTS(SELECT 1 FROM json_each(?) selected WHERE NOT(selected.value=? OR EXISTS(
 SELECT 1 FROM users candidate JOIN user_ministry_roles ministry ON ministry.user_id=candidate.id
 WHERE candidate.id=selected.value AND candidate.status='active' AND ministry.role IN ('worship_leader','worship_member'))))`,params:[JSON.stringify(ids),owner]};
}
async function ensureMembers(env:Env,ids:string[],owner:string){
 const eligible=validMembers(ids,owner);
 if(!await env.DB.prepare('SELECT 1 WHERE '+eligible.sql).bind(...eligible.params).first())throw new HttpError(400,'Choose approved worship members for this group.');
}
async function detail(env:Env,authority:MinistryAuthority,id:string,deviceId?:string):Promise<WorshipGroupDetail>{
 const guard=deviceId?stationMinistryGuard(authority,deviceId,'readSongs'):ministryAuthorityGuard(authority,'readSongs'),access=worshipGroupAccess(authority,'named.id');
 const where=`named.id=? AND named.archived_at IS NULL AND ${guard.sql} AND ${access.sql}`,params=[id,...guard.params,...access.params];
 const results=await env.DB.batch([
  env.DB.prepare(`SELECT named.*,(SELECT COUNT(*) FROM worship_group_members membership JOIN users member ON member.id=membership.user_id WHERE membership.group_id=named.id AND member.status='active') AS member_count FROM worship_groups named WHERE ${where}`).bind(...params),
  env.DB.prepare(`SELECT member.id,member.first_name,member.last_initial,member.photo_key IS NOT NULL AS has_photo,ministry.role AS ministry_role
   FROM worship_group_members membership JOIN users member ON member.id=membership.user_id LEFT JOIN user_ministry_roles ministry ON ministry.user_id=member.id
   WHERE membership.group_id=? AND member.status='active' AND EXISTS(SELECT 1 FROM worship_groups named WHERE ${where}) ORDER BY member.first_name COLLATE NOCASE,member.id`).bind(id,...params),
 ]);
 const row=results[0].results[0] as GroupRow|undefined;if(!row)throw missing();
 const members=(results[1].results as {id:string;first_name:string;last_initial:string;has_photo:number;ministry_role:string|null}[]).map(member=>({id:member.id,name:[member.first_name,member.last_initial?member.last_initial+'.':''].filter(Boolean).join(' '),photoUrl:member.has_photo?'/api/members/'+member.id+'/photo':null,ministryRole:member.ministry_role} satisfies WorshipGroupMember));
 return{...group(row,authority),members};
}
async function list(request:Request,env:Env,authority:MinistryAuthority,deviceId?:string){
 const before=new URL(request.url).searchParams.get('before');let cursor:{time:number;id:string}|null=null;
 if(before){const match=before.match(/^(\d{1,12}):([a-f\d-]{36})$/i);if(!match||!identifier.safeParse(match[2]).success)throw new HttpError(400,'Refresh the group list.');cursor={time:Number(match[1]),id:match[2]};}
 const guard=deviceId?stationMinistryGuard(authority,deviceId,'readSongs'):ministryAuthorityGuard(authority,'readSongs'),access=worshipGroupAccess(authority,'named.id');
 const rows=await env.DB.prepare(`SELECT named.*,(SELECT COUNT(*) FROM worship_group_members membership JOIN users member ON member.id=membership.user_id WHERE membership.group_id=named.id AND member.status='active') AS member_count
 FROM worship_groups named WHERE named.archived_at IS NULL AND ${guard.sql} AND ${access.sql}${cursor?' AND (named.created_at<? OR (named.created_at=? AND named.id<?))':''} ORDER BY named.created_at DESC,named.id DESC LIMIT 101`)
 .bind(...guard.params,...access.params,...(cursor?[cursor.time,cursor.time,cursor.id]:[])).all<GroupRow>();
 const visible=rows.results.slice(0,100),last=visible.at(-1);
 return json({groups:visible.map(row=>group(row,authority)),nextCursor:rows.results.length>100&&last?last.created_at+':'+last.id:null,canCreate:authority.capabilities.manageWorship} satisfies WorshipGroupList);
}
async function create(request:Request,env:Env,authority:MinistryAuthority){
 const data=await body(request,creation),ids=[...new Set([...data.memberIds,authority.user.id])].sort(),fingerprint=await hash(JSON.stringify({name:data.name,memberIds:ids}));
 const prior=await env.DB.prepare('SELECT owner_id,creation_hash FROM worship_groups WHERE id=?').bind(data.id).first<{owner_id:string;creation_hash:string}>();
 if(prior){if(prior.owner_id!==authority.user.id||prior.creation_hash!==fingerprint)throw new HttpError(409,'This group identity belongs to a different saved request.');return json({ok:true,group:await detail(env,authority,data.id)});}
 await ensureMembers(env,ids,authority.user.id);
 const guard=ministryAuthorityGuard(authority,'manageWorship'),eligible=validMembers(ids,authority.user.id),time=now(),audit=crypto.randomUUID();
 const marker='EXISTS(SELECT 1 FROM audit WHERE id=? AND actor_id=? AND subject_id=?)',markerParams=[audit,authority.user.id,data.id];
 try{
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT INTO worship_groups(id,name,owner_id,creation_hash,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE ${guard.sql} AND ${eligible.sql} AND (SELECT COUNT(*) FROM worship_groups WHERE owner_id=? AND archived_at IS NULL)<100 ON CONFLICT(id) DO NOTHING`).bind(data.id,data.name,authority.user.id,fingerprint,time,time,...guard.params,...eligible.params,authority.user.id),
   env.DB.prepare("INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,'create-worship-group',?,? WHERE changes()>0").bind(audit,authority.user.id,data.id,time),
   env.DB.prepare(`INSERT INTO worship_group_members(group_id,user_id,assigned_by,created_at) SELECT ?,value,?,? FROM json_each(?) WHERE ${marker}`).bind(data.id,authority.user.id,time,JSON.stringify(ids),...markerParams),
  ]);
  if(!result[0].meta.changes)throw new HttpError(409,'Your access, selected members or group limit changed. Refresh before trying again.');
 }catch(error){
  const saved=await env.DB.prepare('SELECT owner_id,creation_hash FROM worship_groups WHERE id=?').bind(data.id).first<{owner_id:string;creation_hash:string}>();
  if(saved?.owner_id===authority.user.id&&saved.creation_hash===fingerprint)return json({ok:true,group:await detail(env,authority,data.id)});
  if(error instanceof HttpError)throw error;
  throw new HttpError(503,'Group creation was not confirmed. Keep this request and check it before trying again.');
 }
 return json({ok:true,group:await detail(env,authority,data.id)},201);
}
async function change(request:Request,env:Env,authority:MinistryAuthority,id:string){
 const data=await body(request,update),before=await detail(env,authority,id);
 if(!before.canManage)throw new HttpError(403,'Only this group’s leader or an administrator can change its members.');
 const ids=[...new Set([...data.memberIds,before.ownerId])].sort();await ensureMembers(env,ids,before.ownerId);
 const guard=ministryAuthorityGuard(authority,'manageWorship'),access=worshipGroupAccess(authority,'worship_groups.id',true),eligible=validMembers(ids,before.ownerId),time=now(),audit=crypto.randomUUID();
 const marker='EXISTS(SELECT 1 FROM audit WHERE id=? AND actor_id=? AND subject_id=?)',markerParams=[audit,authority.user.id,id];
 const result=await env.DB.batch([
  env.DB.prepare(`UPDATE worship_groups SET name=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived_at IS NULL AND ${guard.sql} AND ${access.sql} AND ${eligible.sql}`).bind(data.name,time,id,data.revision,...guard.params,...access.params,...eligible.params),
  env.DB.prepare("INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,'change-worship-group',?,? WHERE changes()>0").bind(audit,authority.user.id,id,time),
  env.DB.prepare(`DELETE FROM worship_group_members WHERE group_id=? AND ${marker}`).bind(id,...markerParams),
  env.DB.prepare(`INSERT INTO worship_group_members(group_id,user_id,assigned_by,created_at) SELECT ?,value,?,? FROM json_each(?) WHERE ${marker}`).bind(id,authority.user.id,time,JSON.stringify(ids),...markerParams),
 ]);
 if(!result[0].meta.changes)throw new HttpError(409,'This group, your access or its selected members changed. Refresh before saving again.');
 return json({ok:true,group:await detail(env,authority,id)});
}
export async function worshipGroupsRoute(request:Request,env:Env,id?:string,deviceId?:string){
 if(id)validId(id);
 const capability=request.method==='GET'?'readSongs':'manageWorship',authority=deviceId&&request.method==='GET'?await requireStationMinistry(request,env,deviceId,capability,true):await requireMinistryCapability(request,env,capability);
 if(request.method==='GET')return id?json({group:await detail(env,authority,id,deviceId)}):list(request,env,authority,deviceId);
 if(request.method==='POST'&&!id)return create(request,env,authority);
 if(request.method==='PATCH'&&id)return change(request,env,authority,id);
 throw new HttpError(405,'Use the group list or its member settings.');
}

/** Selection is role-scoped and paginated; names are never an access-control key. */
export async function worshipGroupCandidates(request:Request,env:Env){
 if(request.method!=='GET')throw new HttpError(405,'Open the group member picker.');
 const authority=await requireMinistryCapability(request,env,'manageWorship'),before=new URL(request.url).searchParams.get('before');
 if(before&&!identifier.safeParse(before).success)throw new HttpError(400,'Refresh the worship member list.');
 const guard=ministryAuthorityGuard(authority,'manageWorship');
 const rows=await env.DB.prepare(`SELECT candidate.id,candidate.first_name,candidate.last_initial,candidate.photo_key IS NOT NULL AS has_photo,ministry.role AS ministry_role
 FROM users candidate JOIN user_ministry_roles ministry ON ministry.user_id=candidate.id
 WHERE candidate.status='active' AND ministry.role IN ('worship_leader','worship_member') AND ${guard.sql}${before?' AND candidate.id>?':''}
 ORDER BY candidate.id LIMIT 101`).bind(...guard.params,...(before?[before]:[])).all<{id:string;first_name:string;last_initial:string;has_photo:number;ministry_role:string}>();
 const visible=rows.results.slice(0,100),last=visible.at(-1);
 const members=visible.map(member=>({id:member.id,name:[member.first_name,member.last_initial?member.last_initial+'.':''].filter(Boolean).join(' '),photoUrl:member.has_photo?'/api/members/'+member.id+'/photo':null,ministryRole:member.ministry_role} satisfies WorshipGroupMember));
 return json({members,nextCursor:rows.results.length>100&&last?last.id:null});
}
