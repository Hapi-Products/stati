import {z} from 'zod';
import {cookie,hash,HttpError,now,type User} from './core';
import {operatorSelectionGuard,requireSelectedOperator,type OperatorAuthority} from './operator-selection';

export const ministryRoles=['worship_leader','worship_member','pastor','choir_director','commenter'] as const;
export type MinistryRole=typeof ministryRoles[number];
export type MinistryCapabilities={readSongs:boolean;commentSongs:boolean;planServices:boolean;createSlides:boolean;editLyrics:boolean;manageWorship:boolean;manageTeam:boolean;sendFiles:boolean};
export type MinistryCapability=keyof MinistryCapabilities;
export type MinistryAuthority=Readonly<{
 user:User;ministryRole:MinistryRole|null;capabilities:MinistryCapabilities;
 kind:'session'|'operator';sessionHash:string|null;operator:OperatorAuthority|null;
}>;
export function ministryCapabilities(user:Pick<User,'role'|'status'>,ministryRole:MinistryRole|null,{native=false}:{native?:boolean}={}):MinistryCapabilities{
 const active=user.status==='active'&&(!native||ministryRole!=='pastor'&&ministryRole!=='commenter'),admin=active&&user.role==='admin';
 return{readSongs:active&&(native||admin||ministryRole!==null),commentSongs:active&&(admin||ministryRole!==null),planServices:active&&(admin||ministryRole==='worship_leader'||ministryRole==='worship_member'||ministryRole==='choir_director'),createSlides:active&&native,editLyrics:admin,manageWorship:active&&(admin||ministryRole==='worship_leader'),manageTeam:admin,sendFiles:active&&(admin||ministryRole!=='commenter')};
}
export function ministryProfile<T extends Pick<User,'role'|'status'>>(user:T,ministryRole:MinistryRole|null,context:{native?:boolean}={}){
 return{...user,ministryRole,effectiveRole:user.role==='admin'?'admin':ministryRole||'member',capabilities:ministryCapabilities(user,ministryRole,context),requiresUnlock:user.status==='active'&&(context.native||user.role==='admin'||ministryRole!==null)};
}
export async function readMinistryRole(env:Env,userId:string):Promise<MinistryRole|null>{return(await env.DB.prepare('SELECT role FROM user_ministry_roles WHERE user_id=?').bind(userId).first<{role:MinistryRole}>())?.role||null;}

/** Authentication is distinct from a profile-name click. Only a real session or
 * a current PIN/passkey-selected operator can carry ministry capabilities. */
export async function requireMinistryAuthority(request:Request,env:Env,deviceId?:string):Promise<MinistryAuthority>{
 const raw=cookie(request,'stati_session'),native=!!deviceId&&request.headers.has('Authorization');let user:User|null=null,sessionHash:string|null=null,operator:OperatorAuthority|null=null;
 if(raw&&!native){sessionHash=await hash(raw);user=await env.DB.prepare("SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.status!='removed'").bind(sessionHash,now()).first<User>();if(user&&user.status!=='active')throw new HttpError(403,'An administrator or worship leader needs to approve your account.');}
 if(!user&&deviceId){operator=await requireSelectedOperator(request,env,deviceId);if(operator.proofKind==='member')throw new HttpError(403,'Use your phone passkey before managing songs or services.');user=await env.DB.prepare("SELECT * FROM users WHERE id=? AND status='active'").bind(operator.userId).first<User>();sessionHash=null;}
 if(!user)throw new HttpError(401,'Sign in with your passkey to continue.');
 const ministryRole=await readMinistryRole(env,user.id);
 return Object.freeze({user,ministryRole,capabilities:ministryCapabilities(user,ministryRole,{native:!!operator}),kind:operator?'operator':'session',sessionHash,operator});
}
export async function requireMinistryCapability(request:Request,env:Env,capability:MinistryCapability,deviceId?:string){
 const authority=await requireMinistryAuthority(request,env,deviceId);
 if(!authority.capabilities[capability])throw new HttpError(403,'Your role does not allow this action.');
 return authority;
}
function capabilitySql(capability:MinistryCapability,authority:MinistryAuthority){
 switch(capability){
  case 'readSongs':return authority.kind==='operator'?"1=1":"(actor.role='admin' OR ministry.role IN ('worship_leader','worship_member','pastor','choir_director','commenter'))";
  case 'commentSongs':return "(actor.role='admin' OR ministry.role IN ('worship_leader','worship_member','pastor','choir_director','commenter'))";
  case 'createSlides':return authority.kind==='operator'?'1=1':'0=1';
  case 'planServices':return "(actor.role='admin' OR ministry.role IN ('worship_leader','worship_member','choir_director'))";
  case 'editLyrics':case 'manageTeam':return "actor.role='admin'";
  case 'manageWorship':return "(actor.role='admin' OR ministry.role='worship_leader')";
  case 'sendFiles':return "(actor.role='admin' OR ministry.role IS NULL OR ministry.role<>'commenter')";
  default:throw new HttpError(403,'Unknown capability.');
 }
}
/** Repeat in the actual mutation. Role changes, sign-out, revoked credentials
 * and expired/replaced native proofs cannot win a read-then-write race. */
export function ministryAuthorityGuard(authority:MinistryAuthority,capability:MinistryCapability,time=now()){
 const selection=authority.operator?operatorSelectionGuard(authority.operator,time):null;
 return{sql:`EXISTS(SELECT 1 FROM users actor LEFT JOIN user_ministry_roles ministry ON ministry.user_id=actor.id
  WHERE actor.id=? AND actor.status='active' AND actor.role=? AND ministry.role IS ? AND ${capabilitySql(capability,authority)}
  AND ${selection?'('+selection.sql+')':"EXISTS(SELECT 1 FROM sessions authentication WHERE authentication.user_id=actor.id AND authentication.token_hash=? AND authentication.expires_at>?)"})`,
 params:[authority.user.id,authority.user.role,authority.ministryRole,...(selection?selection.params:[authority.sessionHash,time])]};
}

export const memberChangeSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('assign-role'),ministryRole:z.enum(ministryRoles).nullable()}).strict(),
 z.object({action:z.literal('approve'),ministryRole:z.enum(ministryRoles).optional()}).strict(),
 z.object({action:z.enum(['remove','promote','demote'])}).strict(),
]);
type MemberChange=z.infer<typeof memberChangeSchema>;
const worshipRole=(role:MinistryRole|null)=>role==='worship_leader'||role==='worship_member';
export async function changeMember(env:Env,authority:MinistryAuthority,targetId:string,data:MemberChange){
 if(targetId===authority.user.id)throw new HttpError(400,'Another authorized person must change your account.');
 const target=await env.DB.prepare('SELECT u.*,m.role AS ministry_role FROM users u LEFT JOIN user_ministry_roles m ON m.user_id=u.id WHERE u.id=?').bind(targetId).first<User&{ministry_role:MinistryRole|null}>();
 if(!target||target.status==='removed')throw new HttpError(404,'Member not found.');
 const administrator=authority.user.role==='admin'&&authority.capabilities.manageTeam;
 if(!administrator&&(!authority.capabilities.manageWorship||target.role!=='member'||target.ministry_role!==null&&!worshipRole(target.ministry_role)))throw new HttpError(403,'Worship leaders can manage worship roles only.');
 if(!administrator&&!['assign-role','approve'].includes(data.action))throw new HttpError(403,'An administrator is required.');
 const assignedRole=data.action==='assign-role'?data.ministryRole:data.action==='approve'?(data.ministryRole||target.ministry_role||(!administrator?'worship_member':null)):null;
 if(!administrator&&!worshipRole(assignedRole))throw new HttpError(403,'Worship leaders can assign worship leader or worship member.');
 if(data.action==='approve'&&target.status!=='pending')throw new HttpError(409,'This member has already been approved.');
 if(['promote','demote'].includes(data.action)&&target.status!=='active')throw new HttpError(400,'Approve the member first.');
 const time=now(),guard=ministryAuthorityGuard(authority,administrator?'manageTeam':'manageWorship',time),auditId=crypto.randomUUID();
 const targetSql="target.id=? AND target.role=? AND target.status=? AND (SELECT role FROM user_ministry_roles WHERE user_id=target.id) IS ?";
 const targetParams=[target.id,target.role,target.status,target.ministry_role],condition=targetSql+' AND '+guard.sql,conditionParams=[...targetParams,...guard.params];
 let mutation:D1PreparedStatement;
 if(data.action==='assign-role'){
  mutation=assignedRole?env.DB.prepare(`INSERT INTO user_ministry_roles(user_id,role,assigned_by,updated_at) SELECT target.id,?,?,? FROM users target WHERE ${condition} ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,assigned_by=excluded.assigned_by,updated_at=excluded.updated_at`).bind(assignedRole,authority.user.id,time,...conditionParams):env.DB.prepare(`DELETE FROM user_ministry_roles WHERE user_id IN (SELECT target.id FROM users target WHERE ${condition})`).bind(...conditionParams);
  if(!assignedRole&&target.ministry_role===null){const current=await env.DB.prepare('SELECT 1 WHERE '+guard.sql).bind(...guard.params).first();if(!current)throw new HttpError(409,'Your access changed. Refresh and try again.');return{ok:true};}
 }else mutation=env.DB.prepare(`UPDATE users AS target SET ${data.action==='approve'?"status='active'":data.action==='remove'?"status='removed'":'role=?'} WHERE ${condition}`).bind(...(['promote','demote'].includes(data.action)?[data.action==='promote'?'admin':'member']:[]),...conditionParams);
 const action=data.action==='assign-role'?'assign-ministry-'+(assignedRole||'none'):data.action;
 const marker='EXISTS(SELECT 1 FROM audit WHERE id=? AND actor_id=? AND subject_id=?)',markerParams=[auditId,authority.user.id,target.id];
 const statements=[mutation,env.DB.prepare('INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,?,?,? WHERE changes()>0').bind(auditId,authority.user.id,action,target.id,time)];
 if(data.action==='approve'&&assignedRole)statements.push(env.DB.prepare(`INSERT INTO user_ministry_roles(user_id,role,assigned_by,updated_at) SELECT ?,?,?,? WHERE ${marker} ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,assigned_by=excluded.assigned_by,updated_at=excluded.updated_at`).bind(target.id,assignedRole,authority.user.id,time,...markerParams));
 if(data.action==='remove')statements.push(
  env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND '+marker).bind(target.id,...markerParams),
  env.DB.prepare('UPDATE devices SET revoked_at=? WHERE owner_id=? AND '+marker).bind(time,target.id,...markerParams),
  env.DB.prepare('UPDATE receivers SET closed_at=? WHERE device_id IN (SELECT id FROM devices WHERE owner_id=?) AND '+marker).bind(time,target.id,...markerParams),
 );
 const results=await env.DB.batch(statements);
 if(!results[0].meta.changes)throw new HttpError(409,'The account or your access changed. Refresh and try again.');
 return{ok:true};
}

export async function listMinistryMembers(request:Request,env:Env){
 const authority=await requireMinistryAuthority(request,env),guard=ministryAuthorityGuard(authority,'sendFiles');
 const rows=await env.DB.prepare(`SELECT u.id,u.first_name,u.last_initial,u.role,u.status,u.photo_key IS NOT NULL AS has_photo,m.role AS ministry_role
  FROM users u LEFT JOIN user_ministry_roles m ON m.user_id=u.id WHERE ${guard.sql}
  AND (u.status='active' OR (u.status='pending' AND (?='admin' OR (?='worship_leader' AND u.role='member' AND (m.role IS NULL OR m.role IN ('worship_leader','worship_member')))))) ORDER BY u.first_name,u.id`)
  .bind(...guard.params,authority.user.role,authority.ministryRole).all<User&{has_photo:number;ministry_role:MinistryRole|null}>();
 return rows.results.map(({ministry_role,...row})=>ministryProfile(row,ministry_role));
}
