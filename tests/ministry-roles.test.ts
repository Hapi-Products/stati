import {createExecutionContext,env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import worker from '../src/server/index';
import {hash,now,token,type User} from '../src/server/core';
import {ministryCapabilities,ministryRoles,requireMinistryCapability,ministryAuthorityGuard,type MinistryRole} from '../src/server/ministry-roles';

// All identities, sessions and mutations here belong to isolated local D1.
async function person(role:User['role']='member',ministryRole:MinistryRole|null=null,status:User['status']='active'){
 const id=crypto.randomUUID(),session=token();await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Ministry','T',?,?,?)").bind(id,role,status,now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+86400),
 ]);if(ministryRole)await env.DB.prepare('INSERT INTO user_ministry_roles VALUES(?,?,?,?)').bind(id,ministryRole,id,now()).run();
 return{id,session,cookie:'stati_session='+session,role,ministryRole,status};
}
type Person=Awaited<ReturnType<typeof person>>;
async function call(path:string,{actor,method='GET',data,bindings=env}:{actor?:Person;method?:string;data?:unknown;bindings?:Env}={}){
 return worker.fetch(new Request('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access'+(actor?'; '+actor.cookie:''),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined}),bindings,createExecutionContext());
}
const patch=(actor:Person,target:Person,data:unknown,bindings=env)=>call('/members/'+target.id,{actor,method:'PATCH',data,bindings});
const current=(id:string)=>env.DB.prepare('SELECT u.role,u.status,m.role AS ministry_role FROM users u LEFT JOIN user_ministry_roles m ON m.user_id=u.id WHERE u.id=?').bind(id).first();
const audit=(id:string)=>env.DB.prepare('SELECT actor_id,action FROM audit WHERE subject_id=?').bind(id).all();

it.each(ministryRoles)('exposes %s without replacing the base member role',async role=>{
 const member=await person('member',role),response=await call('/me',{actor:member});expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({user:{role:'member',ministryRole:role,effectiveRole:role,requiresUnlock:true,capabilities:{readSongs:true,planServices:role!=='pastor'&&role!=='commenter',editLyrics:false,manageTeam:false,manageWorship:role==='worship_leader',sendFiles:role!=='commenter'}}});
 expect((await current(member.id))?.role).toBe('member');
});
it('keeps base administrator authority independent of a ministry assignment',async()=>{
 const admin=await person('admin','pastor');expect(await(await call('/me',{actor:admin})).json()).toMatchObject({user:{role:'admin',ministryRole:'pastor',effectiveRole:'admin',capabilities:{editLyrics:true,manageTeam:true,planServices:true}}});
 expect(ministryCapabilities({role:'member',status:'pending'},'worship_leader')).toEqual({readSongs:false,commentSongs:false,planServices:false,createSlides:false,editLyrics:false,manageWorship:false,manageTeam:false,sendFiles:false});
});
it('lets an administrator assign every ministry role and clear it without changing base membership',async()=>{
 const admin=await person('admin'),target=await person();
 for(const role of ministryRoles){expect((await patch(admin,target,{action:'assign-role',ministryRole:role})).status).toBe(200);expect(await current(target.id)).toEqual({role:'member',status:'active',ministry_role:role});}
 expect((await patch(admin,target,{action:'assign-role',ministryRole:null})).status).toBe(200);expect(await current(target.id)).toEqual({role:'member',status:'active',ministry_role:null});expect((await audit(target.id)).results).toHaveLength(ministryRoles.length+1);
});
it('lets worship leaders assign both worship roles on other eligible members',async()=>{
 const leader=await person('member','worship_leader'),target=await person();
 for(const role of ['worship_leader','worship_member']){expect((await patch(leader,target,{action:'assign-role',ministryRole:role})).status).toBe(200);expect((await current(target.id))?.ministry_role).toBe(role);}
 expect((await audit(target.id)).results).toEqual([{actor_id:leader.id,action:'assign-ministry-worship_leader'},{actor_id:leader.id,action:'assign-ministry-worship_member'}]);
});
it.each(['pastor','choir_director',null] as const)('does not let a worship leader assign %s',async role=>{
 const leader=await person('member','worship_leader'),target=await person('member','worship_member');expect((await patch(leader,target,{action:'assign-role',ministryRole:role})).status).toBe(403);expect((await current(target.id))?.ministry_role).toBe('worship_member');expect((await audit(target.id)).results).toEqual([]);
});
it.each(['pastor','choir_director','admin'] as const)('does not let a worship leader change an existing %s',async role=>{
 const leader=await person('member','worship_leader'),target=role==='admin'?await person('admin'):await person('member',role);expect((await patch(leader,target,{action:'assign-role',ministryRole:'worship_member'})).status).toBe(403);expect((await audit(target.id)).results).toEqual([]);
});
it.each(['approve','promote','demote','remove','assign-role'] as const)('disallows self %s, including administrators and worship leaders',async action=>{
 for(const actor of [await person('admin'),await person('member','worship_leader')])expect((await patch(actor,actor,{action,...(action==='assign-role'?{ministryRole:'worship_leader'}:{})})).status).toBe(400);
});
it.each(['promote','demote','remove'] as const)('reserves global account action %s for administrators',async action=>{
 const leader=await person('member','worship_leader'),target=await person('member','worship_member');expect((await patch(leader,target,{action})).status).toBe(403);expect((await audit(target.id)).results).toEqual([]);
});
it.each([null,'worship_member','pastor','choir_director'] as const)('denies role editing by a %s account',async role=>{
 const actor=await person('member',role),target=await person();expect((await patch(actor,target,{action:'assign-role',ministryRole:'worship_leader'})).status).toBe(403);
});
it('allows worship approval with an explicit leader role or a default worship-member role',async()=>{
 const leader=await person('member','worship_leader'),target=await person('member',null,'pending'),other=await person('member',null,'pending');
 expect((await patch(leader,target,{action:'approve'})).status).toBe(200);expect(await current(target.id)).toEqual({role:'member',status:'active',ministry_role:'worship_member'});
 expect((await patch(leader,other,{action:'approve',ministryRole:'worship_leader'})).status).toBe(200);expect(await current(other.id)).toEqual({role:'member',status:'active',ministry_role:'worship_leader'});
 expect((await patch(leader,target,{action:'approve'})).status).toBe(409);expect((await audit(target.id)).results).toEqual([{actor_id:leader.id,action:'approve'}]);
});
it('hides pending pastor/choir/admin accounts from worship leaders and refuses approval',async()=>{
 const leader=await person('member','worship_leader'),worship=await person('member','worship_member','pending'),unassigned=await person('member',null,'pending'),pastor=await person('member','pastor','pending'),choir=await person('member','choir_director','pending'),admin=await person('admin',null,'pending');
 const rows=await(await call('/members',{actor:leader})).json() as {id:string;ministryRole:MinistryRole|null}[];
 expect(rows.map(row=>row.id)).toEqual(expect.arrayContaining([leader.id,worship.id,unassigned.id]));for(const target of [pastor,choir,admin]){expect(rows.some(row=>row.id===target.id)).toBe(false);expect((await patch(leader,target,{action:'approve',ministryRole:'worship_member'})).status).toBe(403);}
 const ordinary=await person();expect((await(await call('/members',{actor:ordinary})).json() as {id:string}[]).some(row=>row.id===worship.id)).toBe(false);
});
it('preserves administrator approve/promote/demote compatibility and audits only committed actions',async()=>{
 const admin=await person('admin'),target=await person('member',null,'pending');
 for(const action of ['approve','promote','demote'])expect((await patch(admin,target,{action})).status).toBe(200);
 expect(await current(target.id)).toEqual({role:'member',status:'active',ministry_role:null});expect((await audit(target.id)).results.map(row=>row.action)).toEqual(['approve','promote','demote']);
});
it('rejects unrecognized roles and extra base-role fields rather than trusting the client',async()=>{
 const admin=await person('admin'),target=await person();for(const data of [{action:'assign-role',ministryRole:'admin'},{action:'assign-role',ministryRole:'worship_member',role:'admin'},{action:'approve',ministryRole:'owner'}])expect((await patch(admin,target,data)).status).toBe(400);
 expect((await call('/members/'+target.id,{method:'PATCH',data:{action:'assign-role',ministryRole:'worship_leader'}})).status).toBe(401);expect(await current(target.id)).toEqual({role:'member',status:'active',ministry_role:null});
});

function beforeCommit(change:()=>Promise<unknown>){let injected=0;const DB=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(statements:D1PreparedStatement[])=>{if(!injected++){await change();}return target.batch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});return{bindings:{...env,DB},count:()=>injected};}
it.each(['leader role','actor status','session','target role','target status','target base role'] as const)('rejects a commit after concurrent %s change, without a false audit',async kind=>{
 const leader=await person('member','worship_leader'),target=await person('member','worship_member'),injected=beforeCommit(async()=>{
  if(kind==='leader role')await env.DB.prepare("UPDATE user_ministry_roles SET role='pastor' WHERE user_id=?").bind(leader.id).run();
  if(kind==='actor status')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(leader.id).run();
  if(kind==='session')await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(leader.id).run();
  if(kind==='target role')await env.DB.prepare("UPDATE user_ministry_roles SET role='pastor' WHERE user_id=?").bind(target.id).run();
  if(kind==='target status')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(target.id).run();
  if(kind==='target base role')await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(target.id).run();
 });
 expect((await patch(leader,target,{action:'assign-role',ministryRole:'worship_leader'},injected.bindings)).status).toBe(409);expect(injected.count()).toBe(1);expect((await audit(target.id)).results).toEqual([]);expect((await current(target.id))?.ministry_role).not.toBe('worship_leader');
});
it('rejects a late administrator removal after demotion, preserving target sessions and devices',async()=>{
 const admin=await person('admin'),target=await person(),device=crypto.randomUUID();await env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires) VALUES(?,?,?,?,?,?)').bind(device,await hash(token()),'Isolated role PC',target.id,now(),now()+300).run();
 const injected=beforeCommit(()=>env.DB.prepare("UPDATE users SET role='member' WHERE id=?").bind(admin.id).run());expect((await patch(admin,target,{action:'remove'},injected.bindings)).status).toBe(409);expect((await current(target.id))?.status).toBe('active');expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=?').bind(target.id).first())?.count).toBe(1);expect((await env.DB.prepare('SELECT revoked_at FROM devices WHERE id=?').bind(device).first())?.revoked_at).toBeNull();expect((await audit(target.id)).results).toEqual([]);
});
it('capability guards fence an already-read authenticated session when its ministry role changes',async()=>{
 const leader=await person('member','worship_leader'),request=new Request('http://localhost:8787/',{headers:{Cookie:leader.cookie}}),authority=await requireMinistryCapability(request,env,'planServices'),guard=ministryAuthorityGuard(authority,'planServices');
 expect(await env.DB.prepare('SELECT 1 AS allowed WHERE '+guard.sql).bind(...guard.params).first()).toEqual({allowed:1});await env.DB.prepare("UPDATE user_ministry_roles SET role='pastor' WHERE user_id=?").bind(leader.id).run();expect(await env.DB.prepare('SELECT 1 AS allowed WHERE '+guard.sql).bind(...guard.params).first()).toBeNull();await expect(requireMinistryCapability(request,env,'planServices')).rejects.toMatchObject({status:403});expect((await requireMinistryCapability(request,env,'readSongs')).ministryRole).toBe('pastor');
});

it.each([null,...ministryRoles] as const)('keeps slide creation native-only for an active %s member',async role=>{
 const web=ministryCapabilities({role:'member',status:'active'},role),native=ministryCapabilities({role:'member',status:'active'},role,{native:true});
 expect(web.createSlides).toBe(false);expect(web.editLyrics).toBe(false);expect(native.createSlides).toBe(role!=='pastor'&&role!=='commenter');expect(native.readSongs).toBe(role!=='pastor'&&role!=='commenter');expect(native.editLyrics).toBe(false);expect(native.manageTeam).toBe(false);expect(native.planServices).toBe(role!=='pastor'&&role!=='commenter'&&web.planServices);
 const member=await person('member',role),response=await call('/me',{actor:member});expect(await response.json()).toMatchObject({user:{capabilities:{createSlides:false,editLyrics:false}}});
 await expect(requireMinistryCapability(new Request('http://localhost:8787/',{headers:{Cookie:member.cookie}}),env,'createSlides')).rejects.toMatchObject({status:403});
});
it('does not grant native slide creation to pending or removed accounts or browser administrators',()=>{
 for(const status of ['pending','removed'] as const)expect(ministryCapabilities({role:'member',status},null,{native:true}).createSlides).toBe(false);
 expect(ministryCapabilities({role:'admin',status:'active'},null).createSlides).toBe(false);
});
