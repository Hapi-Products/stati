import {env,SELF,createExecutionContext} from 'cloudflare:test';
import {expect,it,vi} from 'vitest';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';
import {pinDigest} from '../src/server/operator-auth';
import {OPERATOR_LEASE_PROTOCOL,selectMemberOperator} from '../src/server/operator-selection';

// Actual route/SQL tests use isolated local identities and cryptographic keys.
// The one approved-flag race fixture models an already verified old challenge;
// the positive new phone flow below performs a real signed WebAuthn assertion.
async function person(role='member',status='active'){
 const id=crypto.randomUUID(),session=token();await env.DB.batch([env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Route','T',?,?,?)").bind(id,role,status,now()),env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+86400)]);return{id,cookie:'stati_session='+session};
}
type Selection={lease:string;userId:string;expiresAt:number;ttlSeconds:number;proof?:string;token?:string;url?:string;active:boolean;protocol:string};
async function fixture(){
 const owner=await person('admin'),member=await person(),admin=await person('admin'),deviceId=crypto.randomUUID(),credential=token(),deviceTokenHash=await hash(credential),receiverId=crypto.randomUUID(),receiverToken=token(18),pin='7392',salt=token();
 await env.DB.batch([env.DB.prepare("INSERT INTO devices(id,name,token_hash,owner_id,created_at,pair_expires,last_seen) VALUES(?,'Isolated route PC',?,?,?,?,?)").bind(deviceId,deviceTokenHash,owner.id,now(),now()+300,now()),env.DB.prepare('INSERT INTO receivers VALUES(?,?,?,?,NULL,?)').bind(receiverId,deviceId,await hash(receiverToken),now()+300,now()),env.DB.prepare('INSERT INTO account_pins VALUES(?,?,?)').bind(admin.id,salt,await pinDigest(pin,salt))]);
 type Options={method?:string;data?:unknown;lease?:string;proof?:string;legacy?:boolean;credential?:string;cookie?:string;bindings?:Env};
 const call=(path:string,{method='POST',data={},lease,proof,legacy=false,credential:raw=credential,cookie,bindings}:Options={})=>{
  const request=new Request('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',Authorization:'Bearer '+raw,Cookie:'stati_access=isolated-test-access'+(cookie?'; '+cookie:''),...(method!=='GET'?{'Content-Type':'application/json'}:{}),...(!legacy?{'X-Stati-Operator-Protocol':OPERATOR_LEASE_PROTOCOL}:{}),...(lease?{'X-Stati-Operator-Lease':lease}:{}),...(proof?{'X-Stati-Operator':proof}:{})},body:method!=='GET'?JSON.stringify(data):undefined});
  return bindings?worker.fetch(request,bindings,createExecutionContext()):SELF.fetch(request);
 };
 const select=async(userId=member.id,legacy=false)=>{const response=await call('/station/operator',{data:{userId,...(userId===admin.id?{pin}:{})},legacy});expect(response.status).toBe(200);return response.json() as Promise<Selection>;};
 const pending=async(user?:Awaited<ReturnType<typeof person>>)=>{user??=await person('member','pending');const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO computer_connections VALUES(?,?,?,?,'pending',?,?)").bind(id,receiverId,deviceId,user.id,now(),now()).run();return{id,user};};
 const decide=(id:string,selected?:Selection,options:Options={})=>call('/station/connections/'+id+'/decision',{data:{status:'approved'},lease:selected?.lease,proof:selected?.proof,...options});
 const state=()=>call('/station/state',{method:'GET'});
 return{owner,member,admin,deviceId,credential,deviceTokenHash,receiverId,pin,call,select,pending,decide,state};
}
const selectedRow=(deviceId:string)=>env.DB.prepare('SELECT * FROM operator_selections WHERE device_id=?').bind(deviceId).first();
const auditRows=(id:string)=>env.DB.prepare('SELECT * FROM audit WHERE subject_id=?').bind(id).all();
const base64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const decode=(text:string)=>Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),character=>character.charCodeAt(0));
const concat=(...parts:Uint8Array[])=>{const bytes=new Uint8Array(parts.reduce((size,part)=>size+part.length,0));let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;};
async function passkey(userId:string){
 const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',key.publicKey),id=token();
 const cose=isoCBOR.encode(new Map<number,number|Uint8Array>([[1,2],[3,-7],[-1,1],[-2,decode(jwk.x!)],[-3,decode(jwk.y!)]]));await env.DB.prepare('INSERT INTO passkeys VALUES(?,?,?,?,?,?)').bind(id,userId,btoa(String.fromCharCode(...cose)),0,'["internal"]',now()).run();
 let counter=0;return async(challenge:string)=>{
  counter++;const encode=new TextEncoder(),digest=async(value:Uint8Array)=>new Uint8Array(await crypto.subtle.digest('SHA-256',value)),auth=concat(await digest(encode.encode('localhost')),new Uint8Array([5,0,0,0,counter])),client=encode.encode(JSON.stringify({type:'webauthn.get',challenge,origin:'http://localhost:8787'})),raw=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,concat(auth,await digest(client))));
  const integer=(value:Uint8Array)=>{let offset=0;while(offset<value.length-1&&value[offset]===0)offset++;const part=value.slice(offset),bytes=part[0]&128?concat(new Uint8Array([0]),part):part;return concat(new Uint8Array([2,bytes.length]),bytes);};
  const sequence=concat(integer(raw.slice(0,32)),integer(raw.slice(32))),signature=concat(new Uint8Array([48,sequence.length]),sequence);
  return{id,rawId:id,type:'public-key',response:{authenticatorData:base64(auth),clientDataJSON:base64(client),signature:base64(signature),userHandle:null},clientExtensionResults:{}};
 };
}

it('requires a selected lease for real native decisions; old30 receives an update-required error',async()=>{
 const f=await fixture(),pending=await f.pending();expect((await f.decide(pending.id)).status).toBe(428);const legacy=await f.select(f.admin.id,true),response=await f.decide(pending.id,legacy,{legacy:true});expect(response.status).toBe(428);expect(await response.json()).toMatchObject({error:expect.stringContaining('Update Stați')});expect((await auditRows(pending.id)).results).toEqual([]);
 // Compatibility: old30's existing PIN/settings policy and heartbeat remain usable.
 vi.setSystemTime(new Date((now()+46)*1000));expect((await f.call('/station/enrollment-code',{method:'GET',proof:legacy.proof,legacy:true})).status).toBe(200);expect((await f.state()).status).toBe(200);expect((await f.call('/station/receiver',{method:'PATCH',data:{id:f.receiverId},legacy:true})).status).toBe(200);
});
it('member selection approves through the real route and audits the selected person rather than station owner',async()=>{
 const f=await fixture(),selected=await f.select(),pending=await f.pending();expect(selected).toMatchObject({protocol:OPERATOR_LEASE_PROTOCOL,userId:f.member.id,active:true,ttlSeconds:45});expect(selected.proof).toBeUndefined();expect((await f.decide(pending.id,selected)).status).toBe(200);
 expect((await auditRows(pending.id)).results).toMatchObject([{actor_id:f.member.id,action:'station-computer-access-approved'}]);expect((await env.DB.prepare('SELECT status FROM station_memberships WHERE device_id=? AND user_id=?').bind(f.deviceId,pending.user.id).first())?.status).toBe('approved');
});
it('real PIN selection requires correct PIN and separate proof in addition to a live lease',async()=>{
 const f=await fixture();expect((await f.call('/station/operator',{data:{userId:f.admin.id,pin:'1111'}})).status).toBe(401);const selected=await f.select(f.admin.id),pending=await f.pending();expect(selected.proof).toBeTruthy();expect(selected.proof).not.toBe(selected.lease);
 expect((await f.decide(pending.id,{...selected,proof:undefined})).status).toBe(403);expect((await f.decide(pending.id,{...selected,proof:token()})).status).toBe(403);expect((await f.decide(pending.id,selected)).status).toBe(200);
});
it('presence renews only its same selected user and keeps profile secrets out of state/renewal responses',async()=>{
 const f=await fixture(),selected=await f.select();expect((await f.call('/station/operator/presence',{data:{userId:f.admin.id},lease:selected.lease})).status).toBe(403);vi.setSystemTime(new Date((now()+30)*1000));
 const response=await f.call('/station/operator/presence',{data:{userId:f.member.id},lease:selected.lease});expect(response.status).toBe(200);expect(await response.json()).toEqual({active:true,userId:f.member.id,expiresAt:now()+45,ttlSeconds:45});
 const state=await(await f.state()).json();expect(state).toMatchObject({operatorLeaseProtocol:OPERATOR_LEASE_PROTOCOL});expect(JSON.stringify(state)).not.toContain(selected.lease);expect(JSON.stringify(state)).not.toContain(await hash(selected.lease));
});
it('state and receiver heartbeats keep the PC online without reviving an expired selected operator',async()=>{
 const f=await fixture(),selected=await f.select(),pending=await f.pending();vi.setSystemTime(new Date(selected.expiresAt*1000));expect((await f.state()).status).toBe(200);expect((await f.call('/station/receiver',{method:'PATCH',data:{id:f.receiverId}})).status).toBe(200);expect((await f.decide(pending.id,selected)).status).toBe(403);expect((await f.call('/station/operator/presence',{data:{userId:f.member.id},lease:selected.lease})).status).toBe(403);expect((await selectedRow(f.deviceId))?.expires_at).toBe(selected.expiresAt);
});
it('legacy null reset and delayed old-secret reset cannot clear a current new-protocol selection',async()=>{
 const f=await fixture(),first=await f.select(f.admin.id),second=await f.select();expect((await f.call('/station/operator',{legacy:true,data:{userId:null}})).status).toBe(200);expect((await selectedRow(f.deviceId))?.selection_hash).toBe(await hash(second.lease));
 expect(await(await f.call('/station/operator',{data:{userId:null},lease:first.lease})).json()).toMatchObject({reset:false});const pending=await f.pending();expect((await f.decide(pending.id,second)).status).toBe(200);
 expect(await(await f.call('/station/operator',{data:{userId:null},lease:second.lease})).json()).toMatchObject({reset:true});expect(await selectedRow(f.deviceId)).toBeNull();
});
it('a connected web administrator keeps approval control and can use the unchanged web decision route',async()=>{
 const f=await fixture(),selected=await f.select(),pending=await f.pending(),web=await f.pending(f.admin);await env.DB.prepare("UPDATE computer_connections SET status='approved' WHERE id=?").bind(web.id).run();expect((await f.decide(pending.id,selected)).status).toBe(403);
 const response=await f.call('/connections/'+pending.id+'/decision',{data:{status:'approved'},cookie:f.admin.cookie});expect(response.status).toBe(200);expect((await auditRows(pending.id)).results).toMatchObject([{actor_id:f.admin.id,action:'admin-computer-access-approved'}]);
});
it('new phone route uses a nonce-bound private lease and verifies a real signed public passkey assertion',async()=>{
 const f=await fixture(),signed=await passkey(f.admin.id),response=await f.call('/station/operator/unlock',{data:{userId:f.admin.id}});expect(response.status).toBe(200);const pending=await response.json() as Selection&{token:string;url:string};expect(pending).toMatchObject({active:false,ttlSeconds:300,userId:f.admin.id});expect(pending.url).toBe('http://localhost:8787/unlock/'+pending.token);expect(pending.url).not.toContain(pending.lease);
 const optionsResponse=await SELF.fetch('http://localhost:8787/api/operator-unlock/'+pending.token);expect(optionsResponse.status).toBe(200);const options=await optionsResponse.json() as {options:{challenge:string}};expect(JSON.stringify(options)).not.toContain(pending.lease);
 expect((await f.call('/station/operator/unlock/status',{data:{token:pending.token,userId:f.admin.id}})).status).toBe(403);expect(await(await f.call('/station/operator/unlock/status',{data:{token:pending.token,userId:f.admin.id},lease:pending.lease})).json()).toEqual({approved:false});
 const assertion=await signed(options.options.challenge);expect((await f.call('/operator-unlock/'+pending.token+'/verify',{data:{response:assertion}})).status).toBe(200);
 expect(await(await f.call('/station/operator/unlock/status',{legacy:true,data:{token:pending.token}})).json()).toEqual({approved:false});
 const activation=await f.call('/station/operator/unlock/status',{data:{token:pending.token,userId:f.admin.id},lease:pending.lease});expect(activation.status).toBe(200);const selected=await activation.json() as Selection;expect(selected).toMatchObject({approved:true,lease:pending.lease,active:true,ttlSeconds:45});expect(selected.proof).toBeTruthy();expect((await f.decide((await f.pending()).id,selected)).status).toBe(200);
});
it('an old approved new-protocol phone result cannot replace a later selected member',async()=>{
 const f=await fixture();await passkey(f.admin.id);const pending=await(await f.call('/station/operator/unlock',{data:{userId:f.admin.id}})).json() as Selection&{token:string};await env.DB.prepare('UPDATE operator_unlocks SET approved=1 WHERE token_hash=?').bind(await hash(pending.token)).run();const member=await f.select();expect((await f.call('/station/operator/unlock/status',{data:{token:pending.token,userId:f.admin.id},lease:pending.lease})).status).toBe(403);expect((await selectedRow(f.deviceId))?.selection_hash).toBe(await hash(member.lease));
});
it('legacy approved phone consumption cannot overwrite a new selection created after its initial lookup',async()=>{
 const f=await fixture();await passkey(f.admin.id);const pending=await(await f.call('/station/operator/unlock',{legacy:true,data:{userId:f.admin.id}})).json() as {token:string};await env.DB.prepare('UPDATE operator_unlocks SET approved=1 WHERE token_hash=?').bind(await hash(pending.token)).run();let newer:Selection|undefined,injected=false;
 const DB=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(statements:D1PreparedStatement[])=>{if(!injected){injected=true;newer=await selectMemberOperator(env,{deviceId:f.deviceId,deviceTokenHash:f.deviceTokenHash},f.member.id);}return target.batch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 const response=await f.call('/station/operator/unlock/status',{legacy:true,data:{token:pending.token},bindings:{...env,DB}});expect(injected).toBe(true);expect(response.status).not.toBe(500);expect(newer).toBeTruthy();expect((await selectedRow(f.deviceId))?.selection_hash).toBe(await hash(newer!.lease));
});
it('old30 phone approval still issues only its legacy proof when no new selection exists',async()=>{
 const f=await fixture();await passkey(f.admin.id);const pending=await(await f.call('/station/operator/unlock',{legacy:true,data:{userId:f.admin.id}})).json() as {token:string};await env.DB.prepare('UPDATE operator_unlocks SET approved=1 WHERE token_hash=?').bind(await hash(pending.token)).run();const response=await f.call('/station/operator/unlock/status',{legacy:true,data:{token:pending.token}});expect(response.status).toBe(200);const selected=await response.json() as Selection&{approved:boolean};expect(selected.approved).toBe(true);expect(selected.proof).toBeTruthy();expect(selected.lease).toBeUndefined();expect(await selectedRow(f.deviceId)).toBeNull();expect((await f.call('/station/enrollment-code',{method:'GET',legacy:true,proof:selected.proof})).status).toBe(200);
});
it('a selected-operator change between route lookup and decision batch leaves membership and audit untouched',async()=>{
 const f=await fixture(),selected=await f.select(f.admin.id),pending=await f.pending();let replaced=false;
 const DB=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(statements:D1PreparedStatement[])=>{if(!replaced){replaced=true;await selectMemberOperator(env,{deviceId:f.deviceId,deviceTokenHash:f.deviceTokenHash},f.member.id);}return target.batch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 const response=await f.decide(pending.id,selected,{bindings:{...env,DB}});expect(response.status).toBe(409);expect((await auditRows(pending.id)).results).toEqual([]);expect(await env.DB.prepare('SELECT status FROM station_memberships WHERE device_id=? AND user_id=?').bind(f.deviceId,pending.user.id).first()).toBeNull();
});
it('real account role edits revoke lease/proof together and do not revive them on re-promotion',async()=>{
 const f=await fixture(),selected=await f.select(f.admin.id);expect((await f.call('/members/'+f.admin.id,{method:'PATCH',data:{action:'demote'},cookie:f.owner.cookie})).status).toBe(200);expect(await selectedRow(f.deviceId)).toBeNull();expect((await f.call('/members/'+f.admin.id,{method:'PATCH',data:{action:'promote'},cookie:f.owner.cookie})).status).toBe(200);expect((await f.decide((await f.pending()).id,selected)).status).toBe(403);
});

async function assistedFixture() {
 const f=await fixture();
 const signMember=await passkey(f.member.id);
 const signAdmin=await passkey(f.admin.id);
 const approval=await f.call('/me/station-backup-codes/options',{cookie:f.member.cookie});
 expect(approval.status).toBe(200);
 const challengeCookie=approval.headers.get('Set-Cookie')!.split(';')[0];
 const options=await approval.json() as {challenge:string};
 const generated=await f.call('/me/station-backup-codes',{
  cookie:f.member.cookie+'; '+challengeCookie,
  data:{response:await signMember(options.challenge)},
 });
 expect(generated.status).toBe(200);
 const {codes}=await generated.json() as {codes:string[]};
 expect(codes).toHaveLength(5);
 const saved=await env.DB.prepare('SELECT code_hash FROM station_backup_codes WHERE user_id=?').bind(f.member.id).all<{code_hash:string}>();
 expect(saved.results.map(row=>row.code_hash)).toEqual(expect.arrayContaining(await Promise.all(codes.map(code=>hash(code.replaceAll('-',''))))));
 const code=codes[0].replaceAll('-','');
 const allow=()=>env.DB.prepare("INSERT INTO station_memberships VALUES(?,?,'approved',?)").bind(f.deviceId,f.member.id,now()).run();
 const start=(userId=f.member.id,backupCode=code)=>f.call('/station/operator/unlock/assisted',{data:{userId,code:backupCode}});
 const path=(request:Selection)=>'/operator-unlock/'+request.token+'/approve';
 const status=(request:Selection,lease=request.lease)=>f.call('/station/operator/unlock/status',{lease,data:{token:request.token,userId:f.member.id}});
 return {...f,signMember,signAdmin,allow,start,path,status};
}

it('opens the named member’s existing workspace only after both a one-use backup code and an active administrator passkey',async()=>{
 const f=await assistedFixture();
 expect((await f.start()).status).toBe(403);
 expect((await f.start(f.admin.id)).status).toBe(403);
 await f.allow();
 expect((await f.start(f.member.id,'a'.repeat(32))).status).toBe(403);
 const began=await f.start();
 expect(began.status).toBe(200);
 const request=await began.json() as Selection;
 expect(request.url).toMatch(/\?assist=1$/);
 expect((await f.start()).status).toBe(403);
 expect(await (await f.status(request)).json()).toEqual({approved:false});
 expect((await f.call('/operator-unlock/'+request.token,{method:'GET'})).status).toBe(410);
 const details=await (await f.call(f.path(request),{method:'GET'})).json() as {name:string;person:string;options:{challenge:string}};
 expect(details).toMatchObject({name:'Isolated route PC',person:'Route T.'});
 expect((await f.call(f.path(request),{data:{response:await f.signMember(details.options.challenge)}})).status).toBe(403);
 expect((await f.call(f.path(request),{data:{response:await f.signAdmin(details.options.challenge)}})).status).toBe(200);
 expect((await f.call(f.path(request),{method:'GET'})).status).toBe(410);
 expect((await f.status(request,token())).status).toBe(403);
 const selection=await (await f.status(request)).json() as Selection;
 expect(selection).toMatchObject({approved:true,active:true,userId:f.member.id});
 expect((await f.call('/station/workspace',{method:'GET',lease:selection.lease,proof:selection.proof})).status).toBe(200);
 expect((await f.call('/station/enrollment-code',{method:'GET',lease:selection.lease,proof:selection.proof})).status).toBe(403);
 expect((await auditRows(f.member.id)).results).toMatchObject([{actor_id:f.admin.id,action:'station-assisted-sign-in-approved'}]);
 await env.DB.prepare("UPDATE users SET role='member' WHERE id=?").bind(f.admin.id).run();
 expect((await f.call('/station/operator/presence',{lease:selection.lease,proof:selection.proof,data:{userId:f.member.id}})).status).toBe(403);
});

it('rejects late assisted approvals when the member disconnects or the station cancels the request',async()=>{
 const f=await assistedFixture();
 await f.allow();
 const request=await (await f.start()).json() as Selection;
 const options=await (await f.call(f.path(request),{method:'GET'})).json() as {options:{challenge:string}};
 await env.DB.prepare("UPDATE station_memberships SET status='denied' WHERE device_id=? AND user_id=?").bind(f.deviceId,f.member.id).run();
 expect((await f.call(f.path(request),{data:{response:await f.signAdmin(options.options.challenge)}})).status).toBe(410);
 expect((await f.status(request)).status).toBe(403);
 await env.DB.prepare("UPDATE station_memberships SET status='approved' WHERE device_id=? AND user_id=?").bind(f.deviceId,f.member.id).run();
 expect((await f.call('/station/operator',{lease:request.lease,data:{userId:null}})).status).toBe(200);
 expect((await f.call(f.path(request),{data:{response:await f.signAdmin(options.options.challenge)}})).status).toBe(410);
 expect((await auditRows(f.member.id)).results).toEqual([]);
});
