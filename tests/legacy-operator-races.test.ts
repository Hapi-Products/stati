import {createExecutionContext,env} from 'cloudflare:test';
import {expect,it,vi} from 'vitest';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';
import {pinDigest} from '../src/server/operator-auth';
import {selectMemberOperator} from '../src/server/operator-selection';

// These compatibility tests use only isolated local D1 records and real routes.
// Inject exactly before the legacy mutation batch, after initial authentication.
async function person(role='member'){
 const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Legacy','T',?,'active',?)").bind(id,role,now()).run();return id;
}
async function fixture(){
 const owner=await person('admin'),admin=await person('admin'),member=await person(),deviceId=crypto.randomUUID(),credential=token(),deviceTokenHash=await hash(credential),salt=token(),pin='7392';
 await env.DB.batch([
  env.DB.prepare("INSERT INTO devices(id,name,token_hash,owner_id,created_at,pair_expires,last_seen) VALUES(?,'Isolated compatibility PC',?,?,?,?,?)").bind(deviceId,deviceTokenHash,owner,now(),now()+300,now()),
  env.DB.prepare('INSERT INTO account_pins VALUES(?,?,?)').bind(admin,salt,await pinDigest(pin,salt)),
  env.DB.prepare('INSERT INTO passkeys VALUES(?,?,?,?,?,?)').bind(token(),admin,'AA==',0,'[]',now())
 ]);
 const context={deviceId,deviceTokenHash};
 const call=(path:string,data:unknown={},bindings=env,proof?:string)=>worker.fetch(new Request('http://localhost:8787/api/station'+path,{method:'POST',headers:{Origin:'http://localhost:8787',Authorization:'Bearer '+credential,'Content-Type':'application/json',...(proof?{'X-Stati-Operator':proof}:{})},body:JSON.stringify(data)}),bindings,createExecutionContext());
 const selected=()=>env.DB.prepare('SELECT * FROM operator_selections WHERE device_id=?').bind(deviceId).first();
 const operator=()=>env.DB.prepare('SELECT operator_id FROM devices WHERE id=?').bind(deviceId).first<{operator_id:string|null}>();
 const counts=()=>env.DB.prepare('SELECT (SELECT COUNT(*) FROM operator_sessions WHERE device_id=?) AS sessions,(SELECT COUNT(*) FROM operator_unlocks WHERE device_id=?) AS unlocks').bind(deviceId,deviceId).first();
 return{owner,admin,member,deviceId,credential,context,pin,call,selected,operator,counts};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
function beforeLegacyCommit(change:()=>Promise<unknown>,batchNumber=1){
 let batches=0,injected=0;
 const DB=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(statements:D1PreparedStatement[])=>{if(++batches===batchNumber){injected++;await change();}return target.batch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 return{bindings:{...env,DB},injected:()=>injected};
}
async function chooseMember(f:Fixture){return selectMemberOperator(env,f.context,f.member);}
async function legacyPin(f:Fixture,bindings=env){return f.call('/operator',{userId:f.admin,pin:f.pin},bindings);}
async function assertNoLegacyProof(f:Fixture){expect(await f.counts()).toEqual({sessions:0,unlocks:0});expect((await f.operator())?.operator_id).toBeNull();}

it('keeps old preview PIN/member/phone and reset working when no new-protocol selection exists',async()=>{
 const f=await fixture(),pin=await legacyPin(f);expect(pin.status).toBe(200);expect(await pin.json()).toMatchObject({ok:true,proof:expect.any(String)});expect(await f.counts()).toEqual({sessions:1,unlocks:0});
 expect((await f.call('/operator',{userId:f.member})).status).toBe(200);expect((await f.operator())?.operator_id).toBe(f.member);expect(await f.counts()).toEqual({sessions:0,unlocks:0});
 const phone=await f.call('/operator/unlock',{userId:f.admin});expect(phone.status).toBe(200);expect(await phone.json()).toMatchObject({token:expect.any(String),url:expect.stringContaining('/unlock/'),expiresAt:now()+300});expect(await f.counts()).toEqual({sessions:0,unlocks:1});
 expect((await f.call('/operator',{userId:null})).status).toBe(200);await assertNoLegacyProof(f);expect(await f.selected()).toBeNull();
});
it.each(['PIN','member','phone'] as const)('refuses an old %s choice while a new-protocol profile is selected',async kind=>{
 const f=await fixture(),selected=await chooseMember(f),before=await f.selected();
 const response=kind==='PIN'?await legacyPin(f):await f.call(kind==='member'?'/operator':'/operator/unlock',{userId:kind==='member'?f.member:f.admin});
 expect(response.status).toBe(409);expect(await f.selected()).toEqual(before);expect((await f.operator())?.operator_id).toBe(selected.userId);expect(await f.counts()).toEqual({sessions:0,unlocks:0});
});
it.each(['PIN','member','phone'] as const)('a late old %s choice cannot clear a newly selected profile',async kind=>{
 const f=await fixture();let expected:unknown;
 const injected=beforeLegacyCommit(async()=>{await chooseMember(f);expected=await f.selected();},kind==='PIN'?2:1);
 const response=kind==='PIN'?await legacyPin(f,injected.bindings):await f.call(kind==='member'?'/operator':'/operator/unlock',{userId:kind==='member'?f.member:f.admin},injected.bindings);
 expect(injected.injected()).toBe(1);expect(response.status).toBe(409);expect(await f.selected()).toEqual(expected);expect((await f.operator())?.operator_id).toBe(f.member);expect(await f.counts()).toEqual({sessions:0,unlocks:0});
});
it.each(['changed PIN','demoted admin','removed admin','rotated credential','revoked computer','removed owner'] as const)('does not issue a late old-PIN proof after %s',async kind=>{
 const f=await fixture(),injected=beforeLegacyCommit(async()=>{
  if(kind==='changed PIN')await env.DB.prepare('UPDATE account_pins SET salt=?,digest=? WHERE user_id=?').bind(token(),token(),f.admin).run();
  if(kind==='demoted admin')await env.DB.prepare("UPDATE users SET role='member' WHERE id=?").bind(f.admin).run();
  if(kind==='removed admin')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.admin).run();
  if(kind==='rotated credential')await env.DB.prepare('UPDATE devices SET token_hash=? WHERE id=?').bind(await hash(token()),f.deviceId).run();
  if(kind==='revoked computer')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.deviceId).run();
  if(kind==='removed owner')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.owner).run();
 },2);
 const response=await legacyPin(f,injected.bindings);expect(injected.injected()).toBe(1);expect(response.status).toBe(409);await assertNoLegacyProof(f);
});
it('does not switch a late old member choice after that profile becomes an admin',async()=>{
 const f=await fixture(),injected=beforeLegacyCommit(()=>env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(f.member).run());
 expect((await f.call('/operator',{userId:f.member},injected.bindings)).status).toBe(409);expect(injected.injected()).toBe(1);await assertNoLegacyProof(f);
});
it.each(['demoted admin','rotated credential','revoked computer','removed owner'] as const)('does not create a late old phone challenge after %s',async kind=>{
 const f=await fixture(),injected=beforeLegacyCommit(async()=>{
  if(kind==='demoted admin')await env.DB.prepare("UPDATE users SET role='member' WHERE id=?").bind(f.admin).run();
  if(kind==='rotated credential')await env.DB.prepare('UPDATE devices SET token_hash=? WHERE id=?').bind(await hash(token()),f.deviceId).run();
  if(kind==='revoked computer')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.deviceId).run();
  if(kind==='removed owner')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.owner).run();
 });
 expect((await f.call('/operator/unlock',{userId:f.admin},injected.bindings)).status).toBe(409);expect(injected.injected()).toBe(1);await assertNoLegacyProof(f);
});
it('a late old reset cannot clear a new-protocol choice created after device authentication',async()=>{
 const f=await fixture();let expected:unknown;const injected=beforeLegacyCommit(async()=>{await chooseMember(f);expected=await f.selected();});
 expect((await f.call('/operator',{userId:null},injected.bindings)).status).toBe(200);expect(injected.injected()).toBe(1);expect(await f.selected()).toEqual(expected);expect((await f.operator())?.operator_id).toBe(f.member);
});
it('an old-credential reset cannot clear a newer credential legacy operator',async()=>{
 const f=await fixture(),injected=beforeLegacyCommit(async()=>{
  await env.DB.prepare('UPDATE devices SET token_hash=? WHERE id=?').bind(await hash(token()),f.deviceId).run();
  await env.DB.prepare('UPDATE devices SET operator_id=? WHERE id=?').bind(f.member,f.deviceId).run();
 });
 expect((await f.call('/operator',{userId:null},injected.bindings)).status).toBe(200);expect(injected.injected()).toBe(1);expect((await f.operator())?.operator_id).toBe(f.member);
});

it.each(['PIN','member','phone'] as const)('a refused legacy %s mutation preserves a different current legacy administrator',async kind=>{
 const f=await fixture(),salt=token(),pin='4862';await env.DB.prepare('INSERT INTO account_pins VALUES(?,?,?)').bind(f.owner,salt,await pinDigest(pin,salt)).run();
 const owner=await f.call('/operator',{userId:f.owner,pin});expect(owner.status).toBe(200);
 const before=(await env.DB.prepare('SELECT * FROM operator_sessions WHERE device_id=? ORDER BY token_hash').bind(f.deviceId).all()).results;
 const injected=beforeLegacyCommit(async()=>{
  if(kind==='PIN')await env.DB.prepare('UPDATE account_pins SET salt=?,digest=? WHERE user_id=?').bind(token(),token(),f.admin).run();
  if(kind==='member')await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(f.member).run();
  if(kind==='phone')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.admin).run();
 },kind==='PIN'?2:1);
 const response=kind==='PIN'?await legacyPin(f,injected.bindings):await f.call(kind==='member'?'/operator':'/operator/unlock',{userId:kind==='member'?f.member:f.admin},injected.bindings);
 expect(injected.injected()).toBe(1);expect(response.status).toBe(409);expect((await f.operator())?.operator_id).toBe(f.owner);expect((await env.DB.prepare('SELECT * FROM operator_sessions WHERE device_id=? ORDER BY token_hash').bind(f.deviceId).all()).results).toEqual(before);
});
it('conservatively fences old clients when a nonce-bound choice has expired',async()=>{
 const f=await fixture(),selected=await chooseMember(f),before=await f.selected();vi.setSystemTime(new Date((selected.expiresAt+1)*1000));
 const response=await legacyPin(f);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:expect.stringContaining('Update Stați')});expect(await f.selected()).toEqual(before);expect((await f.operator())?.operator_id).toBe(f.member);
});
