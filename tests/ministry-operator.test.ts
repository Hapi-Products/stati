import {createExecutionContext,env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';
import {operatorVerified} from '../src/server/operator-auth';
import {OPERATOR_LEASE_PROTOCOL,beginPhoneOperator,requireSelectedOperator,selectMemberOperator} from '../src/server/operator-selection';
import {ministryAuthorityGuard,ministryRoles,requireMinistryCapability,type MinistryRole} from '../src/server/ministry-roles';

async function person(role='member',ministryRole:MinistryRole|null=null){const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Verified','T',?,'active',?)").bind(id,role,now()).run();if(ministryRole)await env.DB.prepare('INSERT INTO user_ministry_roles VALUES(?,?,?,?)').bind(id,ministryRole,id,now()).run();return id;}
async function fixture(role:MinistryRole|null='worship_leader'){
 const owner=await person('admin'),member=await person('member',role),deviceId=crypto.randomUUID(),credential=token(),deviceTokenHash=await hash(credential),receiverId=crypto.randomUUID();
 await env.DB.batch([env.DB.prepare("INSERT INTO devices(id,name,token_hash,owner_id,created_at,pair_expires,last_seen) VALUES(?,'Isolated ministry PC',?,?,?,?,?)").bind(deviceId,deviceTokenHash,owner,now(),now()+300,now()),env.DB.prepare('INSERT INTO receivers VALUES(?,?,?,?,NULL,?)').bind(receiverId,deviceId,await hash(token()),now()+300,now())]);
 const request=(path:string,{method='POST',data={},lease,proof,legacy=false}:{method?:string;data?:unknown;lease?:string;proof?:string;legacy?:boolean}={})=>new Request('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',Authorization:'Bearer '+credential,...(!legacy?{'X-Stati-Operator-Protocol':OPERATOR_LEASE_PROTOCOL}:{}),...(lease?{'X-Stati-Operator-Lease':lease}:{}),...(proof?{'X-Stati-Operator':proof}:{}),...(method!=='GET'?{'Content-Type':'application/json'}:{})},body:method!=='GET'?JSON.stringify(data):undefined});
 const call=(path:string,options:Parameters<typeof request>[1]={},bindings=env)=>worker.fetch(request(path,options),bindings,createExecutionContext());
 return{owner,member,deviceId,credential,deviceTokenHash,receiverId,context:{deviceId,deviceTokenHash},request,call};
}
type Selection={lease:string;token:string;userId:string;proof:string;expiresAt:number;approved:boolean};
const base64=(a:Uint8Array)=>btoa(String.fromCharCode(...a)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const decode=(text:string)=>Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0));
function concat(...parts:Uint8Array[]){const result=new Uint8Array(parts.reduce((n,part)=>n+part.length,0));let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;}
async function passkey(userId:string){
 const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',key.publicKey),id=token();
 const cose=isoCBOR.encode(new Map<number,number|Uint8Array>([[1,2],[3,-7],[-1,1],[-2,decode(jwk.x!)],[-3,decode(jwk.y!)]]));await env.DB.prepare('INSERT INTO passkeys VALUES(?,?,?,?,?,?)').bind(id,userId,btoa(String.fromCharCode(...cose)),0,'["internal"]',now()).run();
 return async(challenge:string)=>{
  const encode=new TextEncoder(),digest=async(value:Uint8Array)=>new Uint8Array(await crypto.subtle.digest('SHA-256',value)),auth=concat(await digest(encode.encode('localhost')),new Uint8Array([5,0,0,0,1])),client=encode.encode(JSON.stringify({type:'webauthn.get',challenge,origin:'http://localhost:8787'})),raw=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,concat(auth,await digest(client))));
  const integer=(value:Uint8Array)=>{let offset=0;while(offset<value.length-1&&value[offset]===0)offset++;const part=value.slice(offset),bytes=part[0]&128?concat(new Uint8Array([0]),part):part;return concat(new Uint8Array([2,bytes.length]),bytes);};const sequence=concat(integer(raw.slice(0,32)),integer(raw.slice(32))),signature=concat(new Uint8Array([48,sequence.length]),sequence);
  return{id,rawId:id,type:'public-key',response:{authenticatorData:base64(auth),clientDataJSON:base64(client),signature:base64(signature),userHandle:null},clientExtensionResults:{}};
 };
}
async function phone(f:Awaited<ReturnType<typeof fixture>>){
 const sign=await passkey(f.member),begin=await f.call('/station/operator/unlock',{data:{userId:f.member}});expect(begin.status).toBe(200);const pending=await begin.json() as Selection,options=await f.call('/operator-unlock/'+pending.token,{method:'GET'});expect(options.status).toBe(200);const challenge=(await options.json() as {options:{challenge:string}}).options.challenge,response=await sign(challenge);
 return{pending,response};
}
async function activated(f:Awaited<ReturnType<typeof fixture>>){const {pending,response}=await phone(f);expect((await f.call('/operator-unlock/'+pending.token+'/verify',{data:{response}})).status).toBe(200);const status=await f.call('/station/operator/unlock/status',{data:{userId:f.member,token:pending.token},lease:pending.lease});expect(status.status).toBe(200);return await status.json() as Selection;}

it.each(ministryRoles.filter(role=>role!=='pastor'&&role!=='commenter'))('authenticates the %s phone passkey without granting administrator authority',async role=>{
 const f=await fixture(role);expect((await f.call('/station/operator',{data:{userId:f.member}})).status).toBe(401);const selected=await activated(f);expect(selected.approved).toBe(true);expect(selected.proof).toBeTruthy();expect(selected.proof).not.toBe(selected.lease);
 const request=f.request('/station/placeholder',{lease:selected.lease,proof:selected.proof}),authority=await requireMinistryCapability(request,env,'readSongs',f.deviceId);expect(authority.ministryRole).toBe(role);expect(authority.kind).toBe('operator');expect(authority.operator?.proofKind).toBe('passkey');expect(await operatorVerified(request,env,f.deviceId)).toBe(false);
 const guard=ministryAuthorityGuard(authority,'readSongs');expect(await env.DB.prepare('SELECT 1 AS allowed WHERE '+guard.sql).bind(...guard.params).first()).toEqual({allowed:1});
 if(role==='pastor')await expect(requireMinistryCapability(request,env,'planServices',f.deviceId)).rejects.toMatchObject({status:403});else expect((await requireMinistryCapability(request,env,'planServices',f.deviceId)).capabilities.planServices).toBe(true);
 expect((await requireMinistryCapability(request,env,'createSlides',f.deviceId)).capabilities.createSlides).toBe(true);await expect(requireMinistryCapability(request,env,'editLyrics',f.deviceId)).rejects.toMatchObject({status:403});expect((await f.call('/station/enrollment-code',{method:'GET',lease:selected.lease,proof:selected.proof})).status).toBe(403);expect((await f.call('/station/operator/presence',{data:{userId:f.member},lease:selected.lease,proof:selected.proof})).status).toBe(200);
 const state=await(await f.call('/station/state',{method:'GET',lease:selected.lease,proof:selected.proof})).json() as {members:{id:string;requiresUnlock:boolean;ministryRole:MinistryRole}[]};expect(state.members.find(row=>row.id===f.member)).toMatchObject({requiresUnlock:true,ministryRole:role});expect(JSON.stringify(state)).not.toContain(selected.lease);expect(JSON.stringify(state)).not.toContain(selected.proof);
});
it('does not admit ministry users to the legacy phone-unlock path',async()=>{const f=await fixture();await passkey(f.member);expect((await f.call('/station/operator/unlock',{data:{userId:f.member},legacy:true})).status).toBe(403);expect(await env.DB.prepare('SELECT * FROM operator_unlocks WHERE device_id=?').bind(f.deviceId).first()).toBeNull();});
it('never turns an ordinary selected profile into authenticated song/service authority',async()=>{
 const f=await fixture(),ordinary=await person(),selected=await selectMemberOperator(env,f.context,ordinary),request=f.request('/station/placeholder',{lease:selected.lease});await expect(requireMinistryCapability(request,env,'planServices',f.deviceId)).rejects.toMatchObject({status:403});
 await env.DB.prepare('INSERT INTO user_ministry_roles VALUES(?,?,?,?)').bind(ordinary,'worship_leader',f.owner,now()).run();await expect(requireSelectedOperator(request,env,f.deviceId)).rejects.toMatchObject({status:403});await expect(requireMinistryCapability(request,env,'planServices',f.deviceId)).rejects.toMatchObject({status:403});
});
it('a leftover browser administrator session cannot replace the selected native identity',async()=>{
 const f=await fixture(),ordinary=await person(),selected=await selectMemberOperator(env,f.context,ordinary),session=token();await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),f.owner,now()+300).run();
 const request=f.request('/station/placeholder',{lease:selected.lease});request.headers.set('Cookie','stati_session='+session);await expect(requireMinistryCapability(request,env,'planServices',f.deviceId)).rejects.toMatchObject({status:403});
});
it.each(['change','delete','delete and restore'] as const)('revokes all native ministry proofs on role %s',async kind=>{
 const f=await fixture(),selected=await activated(f),request=f.request('/station/placeholder',{lease:selected.lease,proof:selected.proof}),authority=await requireMinistryCapability(request,env,'planServices',f.deviceId),guard=ministryAuthorityGuard(authority,'planServices');
 if(kind==='change')await env.DB.prepare("UPDATE user_ministry_roles SET role='choir_director' WHERE user_id=?").bind(f.member).run();else await env.DB.prepare('DELETE FROM user_ministry_roles WHERE user_id=?').bind(f.member).run();
 if(kind==='delete and restore')await env.DB.prepare('INSERT INTO user_ministry_roles VALUES(?,?,?,?)').bind(f.member,'worship_leader',f.owner,now()).run();
 expect(await env.DB.prepare('SELECT 1 WHERE '+guard.sql).bind(...guard.params).first()).toBeNull();await expect(requireMinistryCapability(request,env,'planServices',f.deviceId)).rejects.toMatchObject({status:403});expect(await env.DB.prepare('SELECT * FROM operator_sessions WHERE device_id=?').bind(f.deviceId).first()).toBeNull();expect((await env.DB.prepare('SELECT operator_id FROM devices WHERE id=?').bind(f.deviceId).first())?.operator_id).toBeNull();
});
it('retains a live ministry proof through a no-op role assignment',async()=>{const f=await fixture(),selected=await activated(f);await env.DB.prepare('UPDATE user_ministry_roles SET role=role,updated_at=? WHERE user_id=?').bind(now()+1,f.member).run();expect((await requireMinistryCapability(f.request('/station/placeholder',{lease:selected.lease,proof:selected.proof}),env,'planServices',f.deviceId)).user.id).toBe(f.member);});
it('invalidates pending phone approval immediately when its ministry role changes',async()=>{const f=await fixture(),{pending,response}=await phone(f);await env.DB.prepare("UPDATE user_ministry_roles SET role='pastor' WHERE user_id=?").bind(f.member).run();expect((await f.call('/operator-unlock/'+pending.token,{method:'GET'})).status).toBe(410);expect((await f.call('/operator-unlock/'+pending.token+'/verify',{data:{response}})).status).toBe(410);expect((await f.call('/station/operator/unlock/status',{data:{userId:f.member,token:pending.token},lease:pending.lease})).status).toBe(403);});
it('a late phone-start cannot overwrite another selected user after ministry reassignment',async()=>{
 const f=await fixture(),ordinary=await person(),selected=await selectMemberOperator(env,f.context,ordinary);let injected=false;
 const DB=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(statements:D1PreparedStatement[])=>{if(!injected){injected=true;await env.DB.prepare("UPDATE user_ministry_roles SET role='pastor' WHERE user_id=?").bind(f.member).run();}return target.batch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 await expect(beginPhoneOperator({...env,DB},f.context,f.member,token())).rejects.toMatchObject({status:403});expect(injected).toBe(true);expect((await requireSelectedOperator(f.request('/station/placeholder',{lease:selected.lease}),env,f.deviceId)).userId).toBe(ordinary);
});
it('does not approve a verified passkey response after a role change at the final database write',async()=>{
 const f=await fixture(),{pending,response}=await phone(f);let injected=0;
 const DB=new Proxy(env.DB,{get(target,property){if(property==='prepare')return(sql:string)=>{const statement=target.prepare(sql);if(!sql.startsWith('UPDATE operator_unlocks SET approved=1'))return statement;return new Proxy(statement,{get(prepared,key){if(key==='bind')return(...values:unknown[])=>{const bound=prepared.bind(...values);return new Proxy(bound,{get(current,operation){if(operation==='run')return async()=>{injected++;await env.DB.prepare("UPDATE user_ministry_roles SET role='pastor' WHERE user_id=?").bind(f.member).run();return current.run();};const value=Reflect.get(current,operation);return typeof value==='function'?value.bind(current):value;}});};const value=Reflect.get(prepared,key);return typeof value==='function'?value.bind(prepared):value;}});};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 expect((await f.call('/operator-unlock/'+pending.token+'/verify',{data:{response}},{...env,DB})).status).toBe(410);expect(injected).toBe(1);expect(await env.DB.prepare('SELECT * FROM operator_unlocks WHERE device_id=?').bind(f.deviceId).first()).toBeNull();
});
it('preserves ordinary member file sending for an approved pastor account',async()=>{
 const f=await fixture('pastor'),session=token();await env.DB.batch([env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),f.member,now()+300),env.DB.prepare("INSERT INTO station_memberships(device_id,user_id,status,updated_at) VALUES(?,?,'approved',?)").bind(f.deviceId,f.member,now())]);
 const response=await worker.fetch(new Request('http://localhost:8787/api/receive/device:'+f.deviceId,{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:'stati_session='+session,'X-Filename':'pastor-notes.txt','Content-Length':'5'},body:'Notes'}),env,createExecutionContext());expect(response.status).toBe(201);expect(await response.json()).toMatchObject({status:'queued',filename:'pastor-notes.txt'});
});

it('authenticates an ordinary member for native creation without granting existing-song or administrator control',async()=>{
 const f=await fixture(null),selected=await activated(f),request=f.request('/station/placeholder',{lease:selected.lease,proof:selected.proof});
 const authority=await requireMinistryCapability(request,env,'createSlides',f.deviceId);expect(authority.capabilities).toMatchObject({readSongs:true,createSlides:true,editLyrics:false,planServices:false,manageTeam:false,manageWorship:false});expect(await operatorVerified(request,env,f.deviceId)).toBe(false);
 for(const capability of ['editLyrics','planServices','manageTeam','manageWorship'] as const)await expect(requireMinistryCapability(request,env,capability,f.deviceId)).rejects.toMatchObject({status:403});
 expect((await f.call('/station/enrollment-code',{method:'GET',lease:selected.lease,proof:selected.proof})).status).toBe(403);
 const guard=ministryAuthorityGuard(authority,'createSlides');expect(await env.DB.prepare('SELECT 1 AS allowed WHERE '+guard.sql).bind(...guard.params).first()).toEqual({allowed:1});
 await env.DB.prepare('DELETE FROM operator_sessions WHERE user_id=?').bind(f.member).run();expect(await env.DB.prepare('SELECT 1 AS allowed WHERE '+guard.sql).bind(...guard.params).first()).toBeNull();
 await expect(requireMinistryCapability(request,env,'createSlides',f.deviceId)).rejects.toMatchObject({status:403});
});
it('a selected name and a browser session cannot substitute for the native creation passkey',async()=>{
 const f=await fixture(null),selected=await selectMemberOperator(env,f.context,f.member),request=f.request('/station/placeholder',{lease:selected.lease}),session=token();
 await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),f.member,now()+300).run();request.headers.set('Cookie','stati_session='+session);
 await expect(requireMinistryCapability(request,env,'createSlides',f.deviceId)).rejects.toMatchObject({status:403});
});
it('ordinary-member native creation is revoked when a ministry role is assigned after authentication',async()=>{
 const f=await fixture(null),selected=await activated(f),request=f.request('/station/placeholder',{lease:selected.lease,proof:selected.proof}),authority=await requireMinistryCapability(request,env,'createSlides',f.deviceId),guard=ministryAuthorityGuard(authority,'createSlides');
 await env.DB.prepare('INSERT INTO user_ministry_roles VALUES(?,?,?,?)').bind(f.member,'worship_member',f.owner,now()).run();expect(await env.DB.prepare('SELECT 1 WHERE '+guard.sql).bind(...guard.params).first()).toBeNull();await expect(requireMinistryCapability(request,env,'createSlides',f.deviceId)).rejects.toMatchObject({status:403});
});

it('native creation context still requires an approved computer membership and exposes a passkey unlock in station profiles',async()=>{
 const f=await fixture(null),selected=await activated(f),options={method:'GET',lease:selected.lease,proof:selected.proof};
 expect((await f.call('/station/workspace',options)).status).toBe(403);
 await env.DB.prepare("INSERT INTO station_memberships(device_id,user_id,status,updated_at) VALUES(?,?,'approved',?)").bind(f.deviceId,f.member,now()).run();
 const context=await f.call('/station/workspace',options);expect(context.status).toBe(200);expect(await context.json()).toMatchObject({userId:f.member,deviceId:f.deviceId,capabilities:{readSongs:true,createSlides:true,editLyrics:false,planServices:false}});
 const state=await(await f.call('/station/state',options)).json() as {members:{id:string;requiresUnlock:boolean;capabilities:{createSlides:boolean}}[]};expect(state.members.find(row=>row.id===f.member)).toMatchObject({requiresUnlock:true,capabilities:{createSlides:true}});
 await env.DB.prepare("UPDATE station_memberships SET status='denied' WHERE device_id=? AND user_id=?").bind(f.deviceId,f.member).run();expect((await f.call('/station/workspace',options)).status).toBe(403);
});

it('keeps commenters out of the computer operator picker and unlock flow',async()=>{
 const f=await fixture('commenter');await passkey(f.member);
 expect((await f.call('/station/operator/unlock',{data:{userId:f.member}})).status).toBe(403);
 await expect(selectMemberOperator(env,f.context,f.member)).rejects.toMatchObject({status:403});
 const state=await(await f.call('/station/state',{method:'GET'})).json() as {members:{id:string}[]};
 expect(state.members.some(member=>member.id===f.member)).toBe(false);
});
