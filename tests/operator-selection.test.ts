import {env} from 'cloudflare:test';
import {beforeEach,expect,it,vi} from 'vitest';
import {hash,now,token} from '../src/server/core';
import {OPERATOR_LEASE_PROTOCOL,activatePhoneOperator,beginPhoneOperator,operatorDeviceContext,operatorSelectionGuard,renewOperatorSelection,requireSelectedOperator,resetOperatorSelection,selectMemberOperator,selectPinOperator} from '../src/server/operator-selection';
import type {OperatorAuthority,OperatorDeviceContext} from '../src/server/operator-selection';

// All profiles, devices and challenge approval flags are isolated D1 fixtures.
// Marking a flag approved tests nonce consumption, not a WebAuthn ceremony.
beforeEach(async()=>{await env.DB.batch(['operator_selections','operator_sessions','operator_unlocks'].map(table=>env.DB.prepare('DELETE FROM '+table)));});
async function person(role='member',status='active'){
 const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Isolated','T',?,?,?)").bind(id,role,status,now()).run();return id;
}
async function station(ownerId:string){
 const deviceId=crypto.randomUUID(),credential=token(),deviceTokenHash=await hash(credential);
 await env.DB.prepare("INSERT INTO devices(id,name,token_hash,owner_id,created_at,pair_expires,last_seen) VALUES(?,'Local lease test',?,?,?,?,?)").bind(deviceId,deviceTokenHash,ownerId,now(),now()+300,now()).run();
 return{deviceId,deviceTokenHash,credential};
}
async function fixture(){
 const owner=await person('admin'),member=await person(),admin=await person('admin'),device=await station(owner),pin={salt:token(),digest:token()};
 await env.DB.prepare('INSERT INTO account_pins VALUES(?,?,?)').bind(admin,pin.salt,pin.digest).run();
 const request=(lease?:string,proof?:string,credential=device.credential)=>new Request('http://localhost:8787/api/station/operator/presence',{method:'POST',headers:{Authorization:'Bearer '+credential,...(lease?{'X-Stati-Operator-Lease':lease}:{}),...(proof?{'X-Stati-Operator':proof}:{})}});
 return{owner,member,admin,pin,device,request};
}
const row=(deviceId:string)=>env.DB.prepare('SELECT * FROM operator_selections WHERE device_id=?').bind(deviceId).first();
const counts=async()=>Object.fromEntries(await Promise.all(['operator_selections','operator_sessions','operator_unlocks'].map(async table=>[table,(await env.DB.prepare('SELECT COUNT(*) AS count FROM '+table).first<{count:number}>())!.count])));
const denied=(operation:Promise<unknown>,status=403)=>expect(operation).rejects.toMatchObject({status});
async function approved(raw:string){await env.DB.prepare('UPDATE operator_unlocks SET approved=1 WHERE token_hash=?').bind(await hash(raw)).run();}
function withBatch(before:(statements:D1PreparedStatement[])=>Promise<D1Result[]>){return{...env,DB:new Proxy(env.DB,{get(target,property){if(property==='batch')return before;const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}})};}
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve};};

it('issues one hashed member selection and renews the same identity with no admin proof',async()=>{
 const f=await fixture(),selected=await selectMemberOperator(env,f.device,f.member);
 expect(selected).toMatchObject({protocol:OPERATOR_LEASE_PROTOCOL,userId:f.member,active:true,ttlSeconds:45,expiresAt:now()+45});expect(selected.lease).toMatch(/^[\w-]{43}$/);expect('proof' in selected).toBe(false);
 expect(await row(f.device.deviceId)).toMatchObject({user_id:f.member,selection_hash:await hash(selected.lease),proof_kind:'member',status:'active',admin_session_hash:null,unlock_hash:null});expect(JSON.stringify(await row(f.device.deviceId))).not.toContain(selected.lease);
 const authority=await requireSelectedOperator(f.request(selected.lease),env,f.device.deviceId);expect(authority.userId).toBe(f.member);
 vi.setSystemTime(new Date((now()+30)*1000));const renewal=await renewOperatorSelection(f.request(selected.lease),env,f.device.deviceId,f.member);expect(renewal).toEqual({active:true,userId:f.member,expiresAt:now()+45,ttlSeconds:45});expect('lease' in renewal).toBe(false);expect(await counts()).toEqual({operator_selections:1,operator_sessions:0,operator_unlocks:0});
});
it('renews with one guarded UPDATE and no read-then-write authority dependency',async()=>{
 const f=await fixture(),selected=await selectMemberOperator(env,f.device,f.member);let writes=0;
 const DB=new Proxy(env.DB,{get(target,property){if(property==='prepare')return(sql:string)=>{expect(sql).toMatch(/^UPDATE operator_selections SET/);writes++;return target.prepare(sql);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 expect((await renewOperatorSelection(f.request(selected.lease),{...env,DB},f.device.deviceId,f.member)).active).toBe(true);expect(writes).toBe(1);
});
it('never grants authority from operator_id, device heartbeat, or an existing legacy proof alone',async()=>{
 const f=await fixture(),legacy=token();await env.DB.batch([env.DB.prepare('UPDATE devices SET operator_id=?,last_seen=? WHERE id=?').bind(f.admin,now(),f.device.deviceId),env.DB.prepare('INSERT INTO operator_sessions VALUES(?,?,?,?)').bind(await hash(legacy),f.device.deviceId,f.admin,now()+8*3600)]);
 await denied(requireSelectedOperator(f.request(undefined,legacy),env,f.device.deviceId),428);await denied(requireSelectedOperator(f.request(token(),legacy),env,f.device.deviceId));await denied(renewOperatorSelection(f.request(token(),legacy),env,f.device.deviceId,f.admin));expect(await row(f.device.deviceId)).toBeNull();
});
it.each([45,46])('requires explicit selection again at %s seconds; heartbeat cannot revive it',async seconds=>{
 const f=await fixture(),selected=await selectMemberOperator(env,f.device,f.member);vi.setSystemTime(new Date((now()+seconds)*1000));await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now(),f.device.deviceId).run();
 await denied(requireSelectedOperator(f.request(selected.lease),env,f.device.deviceId));await denied(renewOperatorSelection(f.request(selected.lease),env,f.device.deviceId,f.member));expect((await row(f.device.deviceId))?.expires_at).toBe(selected.expiresAt);
});
it('rejects wrong secret, identity, device and rotated credential without changing the live selection',async()=>{
 const f=await fixture(),selected=await selectMemberOperator(env,f.device,f.member),other=await station(f.owner);
 await denied(requireSelectedOperator(f.request(token()),env,f.device.deviceId));await denied(requireSelectedOperator(f.request(selected.lease),env,f.device.deviceId,f.admin));await denied(requireSelectedOperator(f.request(selected.lease,undefined,other.credential),env,other.deviceId));await denied(requireSelectedOperator(f.request(selected.lease,undefined,token()),env,f.device.deviceId));
 expect((await row(f.device.deviceId))?.selection_hash).toBe(await hash(selected.lease));
});
it('PIN selection creates a separate exact eight-hour proof; lease renewal cannot extend authentication',async()=>{
 const f=await fixture(),selected=await selectPinOperator(env,f.device,f.admin,f.pin);expect(selected.proof).not.toBe(selected.lease);expect(selected.proofExpiresAt).toBe(now()+8*3600);
 await denied(requireSelectedOperator(f.request(selected.lease),env,f.device.deviceId));await denied(requireSelectedOperator(f.request(selected.lease,token()),env,f.device.deviceId));expect((await requireSelectedOperator(f.request(selected.lease,selected.proof),env,f.device.deviceId)).proofKind).toBe('pin');
 // Represent a selection kept alive through the service, near its fixed proof deadline.
 vi.setSystemTime(new Date((selected.proofExpiresAt-5)*1000));await env.DB.prepare('UPDATE operator_selections SET expires_at=? WHERE device_id=?').bind(now()+45,f.device.deviceId).run();
 expect(await renewOperatorSelection(f.request(selected.lease,selected.proof),env,f.device.deviceId,f.admin)).toEqual({active:true,userId:f.admin,expiresAt:selected.proofExpiresAt,ttlSeconds:5});
 expect((await env.DB.prepare('SELECT expires_at FROM operator_sessions WHERE token_hash=?').bind(await hash(selected.proof)).first())?.expires_at).toBe(selected.proofExpiresAt);
 vi.setSystemTime(new Date(selected.proofExpiresAt*1000));await denied(requireSelectedOperator(f.request(selected.lease,selected.proof),env,f.device.deviceId));await denied(renewOperatorSelection(f.request(selected.lease,selected.proof),env,f.device.deviceId,f.admin));
});
it.each(['pending','removed'])('does not issue member or admin selections for a %s account',async status=>{
 const f=await fixture(),user=await person('member',status);await denied(selectMemberOperator(env,f.device,user));await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(user).run();await denied(beginPhoneOperator(env,f.device,user,token()));expect(await counts()).toEqual({operator_selections:0,operator_sessions:0,operator_unlocks:0});
});
it.each(['revoked device','inactive owner','wrong paired credential'])('guards new issuance against %s',async kind=>{
 const f=await fixture(),context={...f.device};
 if(kind==='revoked device')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.device.deviceId).run();
 if(kind==='inactive owner')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.owner).run();
 if(kind==='wrong paired credential')context.deviceTokenHash=await hash(token());
 await denied(selectMemberOperator(env,context,f.member));await denied(selectPinOperator(env,context,f.admin,f.pin));await denied(beginPhoneOperator(env,context,f.admin,token()));expect(await counts()).toEqual({operator_selections:0,operator_sessions:0,operator_unlocks:0});
});
it('member/admin issuance cannot silently convert roles or overwrite another choice on a zero-row guard',async()=>{
 const f=await fixture(),old=await selectMemberOperator(env,f.device,f.member),candidate=await person();
 await denied(selectMemberOperator(env,f.device,f.admin));await denied(selectPinOperator(env,f.device,f.member,f.pin));
 const db=withBatch(async statements=>{await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(candidate).run();return env.DB.batch(statements);});
 await denied(selectMemberOperator(db,f.device,candidate));expect((await row(f.device.deviceId))?.selection_hash).toBe(await hash(old.lease));expect((await requireSelectedOperator(f.request(old.lease),env,f.device.deviceId)).userId).toBe(f.member);
});
it('compares the exact verified PIN record at commit and leaves another selected member intact',async()=>{
 const f=await fixture(),old=await selectMemberOperator(env,f.device,f.member);await env.DB.prepare('UPDATE account_pins SET digest=? WHERE user_id=?').bind(token(),f.admin).run();
 await denied(selectPinOperator(env,f.device,f.admin,f.pin));expect((await row(f.device.deviceId))?.selection_hash).toBe(await hash(old.lease));expect(await counts()).toEqual({operator_selections:1,operator_sessions:0,operator_unlocks:0});
});
it('rolls back issuance, revocation and operator_id together when a batched statement fails',async()=>{
 const f=await fixture(),old=await selectPinOperator(env,f.device,f.admin,f.pin),before=await row(f.device.deviceId);
 const broken=withBatch(statements=>env.DB.batch([...statements,env.DB.prepare('INSERT INTO missing_operator_test_table VALUES(1)')]));await expect(selectMemberOperator(broken,f.device,f.member)).rejects.toThrow();
 expect(await row(f.device.deviceId)).toEqual(before);expect((await requireSelectedOperator(f.request(old.lease,old.proof),env,f.device.deviceId)).userId).toBe(f.admin);expect(await counts()).toEqual({operator_selections:1,operator_sessions:1,operator_unlocks:0});
});
it('phone selection stays pending until approval, then consumes its exact nonce once and retains the lease',async()=>{
 const f=await fixture(),pending=await beginPhoneOperator(env,f.device,f.admin,token());expect(pending).toMatchObject({protocol:OPERATOR_LEASE_PROTOCOL,active:false,userId:f.admin,ttlSeconds:300,expiresAt:now()+300});expect(pending.token).not.toBe(pending.lease);
 await denied(requireSelectedOperator(f.request(pending.lease),env,f.device.deviceId));await denied(renewOperatorSelection(f.request(pending.lease),env,f.device.deviceId,f.admin));expect(await activatePhoneOperator(env,f.device,pending)).toBeNull();expect(await counts()).toEqual({operator_selections:1,operator_sessions:0,operator_unlocks:1});
 await approved(pending.token);const active=await activatePhoneOperator(env,f.device,pending);expect(active).toMatchObject({lease:pending.lease,userId:f.admin,active:true,ttlSeconds:45});expect((await requireSelectedOperator(f.request(active!.lease,active!.proof),env,f.device.deviceId)).proofKind).toBe('passkey');expect(await counts()).toEqual({operator_selections:1,operator_sessions:1,operator_unlocks:0});await denied(activatePhoneOperator(env,f.device,pending));
});
it.each(['lease','token','user','device'])('rejects a phone status with the wrong %s binding',async kind=>{
 const f=await fixture(),pending=await beginPhoneOperator(env,f.device,f.admin,token());await approved(pending.token);const args={...pending},context:OperatorDeviceContext={...f.device};
 if(kind==='lease')args.lease=token();if(kind==='token')args.token=token();if(kind==='user')args.userId=f.member;if(kind==='device')Object.assign(context,await station(f.owner));
 await denied(activatePhoneOperator(env,context,args));expect(await counts()).toEqual({operator_selections:1,operator_sessions:0,operator_unlocks:1});
});
it('an approved old phone request cannot replace a newer member selection',async()=>{
 const f=await fixture(),pending=await beginPhoneOperator(env,f.device,f.admin,token());await approved(pending.token);const member=await selectMemberOperator(env,f.device,f.member);
 await denied(activatePhoneOperator(env,f.device,pending));expect(await counts()).toEqual({operator_selections:1,operator_sessions:0,operator_unlocks:0});expect((await row(f.device.deviceId))?.selection_hash).toBe(await hash(member.lease));
});
it('a phone activation paused before its atomic batch cannot win against a newer explicit choice',async()=>{
 const f=await fixture(),pending=await beginPhoneOperator(env,f.device,f.admin,token());await approved(pending.token);const started=deferred(),release=deferred();
 const paused=withBatch(async statements=>{started.resolve();await release.promise;return env.DB.batch(statements);});const consuming=activatePhoneOperator(paused,f.device,pending);await started.promise;const member=await selectMemberOperator(env,f.device,f.member);release.resolve();await denied(consuming);
 expect((await row(f.device.deviceId))?.selection_hash).toBe(await hash(member.lease));expect(await counts()).toEqual({operator_selections:1,operator_sessions:0,operator_unlocks:0});
});
it('only one of two racing approved-phone consumptions can issue a proof',async()=>{
 const f=await fixture(),pending=await beginPhoneOperator(env,f.device,f.admin,token());await approved(pending.token);const results=await Promise.allSettled([activatePhoneOperator(env,f.device,pending),activatePhoneOperator(env,f.device,pending)]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(await counts()).toEqual({operator_selections:1,operator_sessions:1,operator_unlocks:0});
});
it('phone expiry is strict at five minutes and cannot be renewed into active authority',async()=>{
 const f=await fixture(),pending=await beginPhoneOperator(env,f.device,f.admin,token());await approved(pending.token);vi.setSystemTime(new Date(pending.expiresAt*1000));await denied(activatePhoneOperator(env,f.device,pending));await denied(renewOperatorSelection(f.request(pending.lease),env,f.device.deviceId,f.admin));expect((await counts()).operator_sessions).toBe(0);
});
it('same-secret reset clears pending and active state; delayed old reset cannot clear a newer choice',async()=>{
 const f=await fixture(),pending=await beginPhoneOperator(env,f.device,f.admin,token());await approved(pending.token);expect(await resetOperatorSelection(f.request(pending.lease),env,f.device.deviceId)).toEqual({reset:true});await denied(activatePhoneOperator(env,f.device,pending));
 const first=await selectPinOperator(env,f.device,f.admin,f.pin),second=await selectMemberOperator(env,f.device,f.member);
 expect(await resetOperatorSelection(f.request(first.lease,first.proof),env,f.device.deviceId)).toEqual({reset:false});expect(await resetOperatorSelection(f.request(),env,f.device.deviceId)).toEqual({reset:false});expect((await requireSelectedOperator(f.request(second.lease),env,f.device.deviceId)).userId).toBe(f.member);
 vi.setSystemTime(new Date(second.expiresAt*1000));expect(await resetOperatorSelection(f.request(second.lease),env,f.device.deviceId)).toEqual({reset:true});expect(await counts()).toEqual({operator_selections:0,operator_sessions:0,operator_unlocks:0});
});
it.each(['member promotion','admin demotion','selected removal'])('atomically revokes %s and never revives old authority after restoration',async kind=>{
 const f=await fixture(),selected=kind==='member promotion'?await selectMemberOperator(env,f.device,f.member):await selectPinOperator(env,f.device,f.admin,f.pin),userId=selected.userId;
 await env.DB.prepare(kind==='selected removal'?"UPDATE users SET status='removed' WHERE id=?":"UPDATE users SET role=? WHERE id=?").bind(...(kind==='selected removal'?[userId]:[kind==='member promotion'?'admin':'member',userId])).run();
 expect(await counts()).toEqual({operator_selections:0,operator_sessions:0,operator_unlocks:0});await env.DB.prepare("UPDATE users SET role=?,status='active' WHERE id=?").bind(kind==='member promotion'?'member':'admin',userId).run();
 await denied(requireSelectedOperator(f.request(selected.lease,'proof' in selected?selected.proof:undefined),env,f.device.deviceId));
});
it.each(['update','remove','create'])('PIN %s revokes current proof, selection and pending phone requests',async kind=>{
 const f=await fixture();if(kind==='create')await env.DB.prepare('DELETE FROM account_pins WHERE user_id=?').bind(f.admin).run();
 // Keep both kinds on different PCs for the same administrator.
 const selected=kind==='create'?null:await selectPinOperator(env,f.device,f.admin,f.pin),phoneDevice=await station(f.owner);await beginPhoneOperator(env,phoneDevice,f.admin,token());
 if(kind==='update')await env.DB.prepare('UPDATE account_pins SET digest=? WHERE user_id=?').bind(token(),f.admin).run();
 if(kind==='remove')await env.DB.prepare('DELETE FROM account_pins WHERE user_id=?').bind(f.admin).run();
 if(kind==='create')await env.DB.prepare('INSERT INTO account_pins VALUES(?,?,?)').bind(f.admin,token(),token()).run();
 expect(await counts()).toEqual({operator_selections:0,operator_sessions:0,operator_unlocks:0});if(selected)await denied(requireSelectedOperator(f.request(selected.lease,selected.proof),env,f.device.deviceId));
});
it('owner status changes revoke every owned station and do not revive on reactivation',async()=>{
 const f=await fixture(),member=await selectMemberOperator(env,f.device,f.member),second=await station(f.owner),third=await station(f.owner),admin=await selectPinOperator(env,second,f.admin,f.pin);await beginPhoneOperator(env,third,f.admin,token());
 await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.owner).run();expect(await counts()).toEqual({operator_selections:0,operator_sessions:0,operator_unlocks:0});await env.DB.prepare("UPDATE users SET status='active' WHERE id=?").bind(f.owner).run();
 await denied(requireSelectedOperator(f.request(member.lease),env,f.device.deviceId));await denied(requireSelectedOperator(f.request(admin.lease,admin.proof,second.credential),env,second.deviceId));expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM devices WHERE owner_id=? AND operator_id IS NOT NULL').bind(f.owner).first())?.count).toBe(0);
});
it.each(['revoked','credential','owner'])('device %s mutation atomically invalidates authority even when restored',async kind=>{
 const f=await fixture(),selected=await selectPinOperator(env,f.device,f.admin,f.pin);
 if(kind==='revoked'){await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.device.deviceId).run();await env.DB.prepare('UPDATE devices SET revoked_at=NULL WHERE id=?').bind(f.device.deviceId).run();}
 if(kind==='credential'){await env.DB.prepare('UPDATE devices SET token_hash=? WHERE id=?').bind(await hash(token()),f.device.deviceId).run();await env.DB.prepare('UPDATE devices SET token_hash=? WHERE id=?').bind(f.device.deviceTokenHash,f.device.deviceId).run();}
 if(kind==='owner'){const owner=await person('admin');await env.DB.prepare('UPDATE devices SET owner_id=? WHERE id=?').bind(owner,f.device.deviceId).run();await env.DB.prepare('UPDATE devices SET owner_id=? WHERE id=?').bind(f.owner,f.device.deviceId).run();}
 expect(await counts()).toEqual({operator_selections:0,operator_sessions:0,operator_unlocks:0});await denied(requireSelectedOperator(f.request(selected.lease,selected.proof),env,f.device.deviceId));
});
it('a no-op role/PIN update and normal operator_id selection writes do not spuriously revoke a valid lease',async()=>{
 const f=await fixture(),selected=await selectPinOperator(env,f.device,f.admin,f.pin);await env.DB.batch([env.DB.prepare('UPDATE users SET role=role,status=status WHERE id=?').bind(f.admin),env.DB.prepare('UPDATE account_pins SET salt=salt,digest=digest WHERE user_id=?').bind(f.admin),env.DB.prepare('UPDATE devices SET operator_id=operator_id,last_seen=? WHERE id=?').bind(now(),f.device.deviceId)]);expect((await requireSelectedOperator(f.request(selected.lease,selected.proof),env,f.device.deviceId)).userId).toBe(f.admin);
});

async function pendingConnection(deviceId:string,userId:string){const receiver=crypto.randomUUID(),id=crypto.randomUUID();await env.DB.batch([env.DB.prepare('INSERT INTO receivers VALUES(?,?,?,?,NULL,?)').bind(receiver,deviceId,await hash(token()),now()+300,now()),env.DB.prepare("INSERT INTO computer_connections VALUES(?,?,?,?,'pending',?,?)").bind(id,receiver,deviceId,userId,now(),now())]);return{id,receiver};}
async function guardedDecision(authority:OperatorAuthority,id:string,status='approved'){
 const guard=operatorSelectionGuard(authority),time=now();
 // Integration contract: retain target/receiver/device/connected-web-admin
 // checks in addition to the reusable selected-operator commit predicate.
 return env.DB.batch([
  env.DB.prepare(`UPDATE computer_connections SET status=? WHERE id=? AND status='pending' AND device_id=? AND ${guard.sql}
   AND EXISTS(SELECT 1 FROM receivers r JOIN devices d ON d.id=r.device_id JOIN users owner ON owner.id=d.owner_id JOIN users member ON member.id=computer_connections.user_id WHERE r.id=computer_connections.receiver_id AND r.closed_at IS NULL AND r.expires_at>? AND d.last_seen>? AND d.revoked_at IS NULL AND owner.status='active' AND member.status!='removed')
   AND NOT EXISTS(SELECT 1 FROM computer_connections c JOIN receivers r ON r.id=c.receiver_id JOIN users u ON u.id=c.user_id WHERE c.device_id=computer_connections.device_id AND c.status='approved' AND c.last_seen>? AND r.closed_at IS NULL AND r.expires_at>? AND u.role='admin' AND u.status='active')`).bind(status,id,authority.deviceId,...guard.params,time,time-45,time-45,time),
  env.DB.prepare("INSERT INTO station_memberships(device_id,user_id,status,updated_at) SELECT device_id,user_id,status,? FROM computer_connections WHERE id=? AND changes()>0 ON CONFLICT(device_id,user_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at").bind(time,id),
  env.DB.prepare('INSERT INTO audit SELECT ?,?,?,?,? WHERE changes()>0').bind(crypto.randomUUID(),authority.userId,'station-computer-access-'+status,id,time),
 ]);
}
it('guards real D1 decisions atomically and records the selected member as actor, never the owner',async()=>{
 const f=await fixture(),selected=await selectMemberOperator(env,f.device,f.member),request=await pendingConnection(f.device.deviceId,await person()),authority=await requireSelectedOperator(f.request(selected.lease),env,f.device.deviceId);
 const result=await guardedDecision(authority,request.id);expect(result.map(row=>row.meta.changes)).toEqual([1,1,1]);expect((await env.DB.prepare('SELECT actor_id FROM audit WHERE subject_id=?').bind(request.id).first())?.actor_id).toBe(f.member);
});
it('a connected web administrator blocks the native fallback without affecting the selected lease',async()=>{
 const f=await fixture(),selected=await selectMemberOperator(env,f.device,f.member),target=await pendingConnection(f.device.deviceId,await person()),web=await pendingConnection(f.device.deviceId,f.admin);await env.DB.prepare("UPDATE computer_connections SET status='approved' WHERE id=?").bind(web.id).run();
 const authority=await requireSelectedOperator(f.request(selected.lease),env,f.device.deviceId),result=await guardedDecision(authority,target.id);expect(result.map(row=>row.meta.changes)).toEqual([0,0,0]);expect((await env.DB.prepare('SELECT status FROM computer_connections WHERE id=?').bind(target.id).first())?.status).toBe('pending');
});
it.each(['new selection','role','owner','revocation','session','expiry'])('repeats the exact commit guard after a %s change between lookup and decision',async change=>{
 const f=await fixture(),selected=await selectPinOperator(env,f.device,f.admin,f.pin),target=await pendingConnection(f.device.deviceId,await person()),authority=await requireSelectedOperator(f.request(selected.lease,selected.proof),env,f.device.deviceId);
 if(change==='new selection')await selectMemberOperator(env,f.device,f.member);
 if(change==='role')await env.DB.prepare("UPDATE users SET role='member' WHERE id=?").bind(f.admin).run();
 if(change==='owner')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.owner).run();
 if(change==='revocation')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.device.deviceId).run();
 if(change==='session')await env.DB.prepare('DELETE FROM operator_sessions WHERE token_hash=?').bind(await hash(selected.proof)).run();
 if(change==='expiry')vi.setSystemTime(new Date(selected.expiresAt*1000));
 const results=await guardedDecision(authority,target.id);expect(results.map(row=>row.meta.changes)).toEqual([0,0,0]);expect(await env.DB.prepare('SELECT id FROM audit WHERE subject_id=?').bind(target.id).first()).toBeNull();
});
it('only one racing decision can change membership and add its selected-operator audit',async()=>{
 const f=await fixture(),selected=await selectMemberOperator(env,f.device,f.member),target=await pendingConnection(f.device.deviceId,await person()),authority=await requireSelectedOperator(f.request(selected.lease),env,f.device.deviceId);
 const results=await Promise.all([guardedDecision(authority,target.id,'approved'),guardedDecision(authority,target.id,'denied')]);expect(results.map(result=>result[0].meta.changes).sort()).toEqual([0,1]);expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM audit WHERE subject_id=?').bind(target.id).first())?.count).toBe(1);expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM station_memberships WHERE device_id=?').bind(f.device.deviceId).first())?.count).toBe(1);
});
it('binds a request context to its captured paired credential and rejects malformed credentials',async()=>{
 const f=await fixture();expect(await operatorDeviceContext(f.request(),f.device.deviceId)).toEqual({deviceId:f.device.deviceId,deviceTokenHash:f.device.deviceTokenHash});await denied(operatorDeviceContext(new Request('http://localhost'),f.device.deviceId),401);
});
