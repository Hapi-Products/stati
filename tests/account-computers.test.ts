import {createExecutionContext,env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import worker from '../src/server/index';
import {hash,now,token,type User} from '../src/server/core';
import {disconnectAccountComputer,renameAccountComputer} from '../src/server/account-computers';

// All accounts, receivers, files and failure injection are isolated local data.
async function person(role:User['role']='member',ministry=true){
 const id=crypto.randomUUID(),session=token(),sessionHash=await hash(session);
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Account','T',?,'active',?)").bind(id,role,now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(sessionHash,id,now()+86400),
 ]);
 if(ministry&&role==='member')await env.DB.prepare("INSERT INTO user_ministry_roles VALUES(?,'worship_member',?,?)").bind(id,id,now()).run();
 const user=(await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first<User>())!;
 return{...user,sessionHash,cookie:'stati_session='+session};
}
type Person=Awaited<ReturnType<typeof person>>;
async function computer(owner?:Person){
 owner=owner||await person('admin');const id=crypto.randomUUID(),receiverId=crypto.randomUUID(),credential=token(),receiver=token();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO devices(id,name,owner_id,token_hash,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(id,'Isolated account PC',owner.id,await hash(credential),now(),now()+600,now()),
  env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiverId,id,await hash(receiver),now()+600,now()),
 ]);
 return{id,owner,receiverId,receiver,credential};
}
type Computer=Awaited<ReturnType<typeof computer>>;
async function membership(pc:Computer,actor:Person,status='approved'){
 await env.DB.prepare('INSERT INTO station_memberships(device_id,user_id,status,updated_at) VALUES(?,?,?,?) ON CONFLICT(device_id,user_id) DO UPDATE SET status=excluded.status').bind(pc.id,actor.id,status,now()).run();
}
async function connection(pc:Computer,actor:Person,status='approved'){
 const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO computer_connections VALUES(?,?,?,?,?,?,?)').bind(id,pc.receiverId,pc.id,actor.id,status,now(),now()).run();return id;
}
async function fixture(role:User['role']='member'){
 const actor=await person(role),other=await person(),pc=await computer();await membership(pc,actor);await membership(pc,other);const ownConnection=await connection(pc,actor),otherConnection=await connection(pc,other);return{actor,other,pc,ownConnection,otherConnection};
}
function call(path:string,actor:Person,{method='GET',data,bindings=env}:{method?:string;data?:unknown;bindings?:Env}={}){
 return worker.fetch(new Request('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',Cookie:actor.cookie,...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data!==undefined?JSON.stringify(data):undefined}),bindings,createExecutionContext());
}
const device=(pc:Computer)=>env.DB.prepare('SELECT * FROM devices WHERE id=?').bind(pc.id).first();
const receiver=(pc:Computer)=>env.DB.prepare('SELECT * FROM receivers WHERE id=?').bind(pc.receiverId).first();
const removed=(pc:Computer,actor:Person)=>env.DB.prepare('SELECT * FROM station_disconnections WHERE device_id=? AND user_id=?').bind(pc.id,actor.id).first<{device_id:string;user_id:string;created_at:number;operation_id:string}>();
const member=(pc:Computer,actor:Person)=>env.DB.prepare('SELECT * FROM station_memberships WHERE device_id=? AND user_id=?').bind(pc.id,actor.id).first();
const connected=(id:string)=>env.DB.prepare('SELECT * FROM computer_connections WHERE id=?').bind(id).first();
const entries=async(path:string,actor:Person)=>{const response=await call(path,actor);expect(response.status).toBe(200);return response.json() as Promise<{id:string}[]>;};
const audits=(actor:Person,pc:Computer)=>env.DB.prepare("SELECT action FROM audit WHERE actor_id=? AND subject_id=? AND action='disconnect-own-computer'").bind(actor.id,pc.id).all();
async function send(pc:Computer,actor:Person,intent=false,bindings=env){
 const bytes=new TextEncoder().encode('New song submission');
 return worker.fetch(new Request('http://localhost:8787/api/receive/device:'+pc.id+(intent?'/uploads/'+crypto.randomUUID():''),{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:actor.cookie,'Content-Type':'text/plain','Content-Length':String(bytes.length),'X-Filename':'submission.txt',...(intent?{'X-Checksum-SHA256':await hash('New song submission')}:{})},body:bytes}),bindings,createExecutionContext());
}
function beforeBatch(change:()=>Promise<unknown>){
 let injected=false;const DB=new Proxy(env.DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{if(!injected){injected=true;await change();}return target.batch(statements);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 return{bindings:{...env,DB},injected:()=>injected};
}

it('requires administrator authority for this computer rather than a global role',async()=>{
 const owner=await person(),pc=await computer(owner),other=await person(),administrator=await person('admin');
 for(const actor of [other,administrator]){
  expect((await call('/devices/'+pc.id,actor,{method:'PATCH',data:{name:'Forbidden rename'}})).status).toBe(403);
  expect((await device(pc))?.name).toBe('Isolated account PC');
 }
 const renamed=await call('/devices/'+pc.id,owner,{method:'PATCH',data:{name:'Renamed account PC'}});
 expect(renamed.status).toBe(200);expect(await renamed.json()).toEqual({ok:true,name:'Renamed account PC'});
 expect((await device(pc))?.name).toBe('Renamed account PC');
 await membership(pc,other);
 expect((await call('/devices/'+pc.id,other,{method:'PATCH',data:{name:'Member rename'}})).status).toBe(403);
 await env.DB.prepare("UPDATE station_memberships SET role='admin' WHERE device_id=? AND user_id=?").bind(pc.id,other.id).run();
 expect((await call('/devices/'+pc.id,other,{method:'PATCH',data:{name:'Local administrator rename'}})).status).toBe(200);
 expect((await device(pc))?.name).toBe('Local administrator rename');
 expect((await call('/devices/'+pc.id,owner,{method:'DELETE'})).status).toBe(403);
 expect((await device(pc))?.revoked_at).toBeNull();
});

it.each(['member','admin'] as const)('disconnects only the %s account and preserves the device, receiver and other member',async role=>{
 const f=await fixture(role),beforeDevice=await device(f.pc),beforeReceiver=await receiver(f.pc),beforeOtherMember=await member(f.pc,f.other),beforeOtherConnection=await connected(f.otherConnection);
 const result=await call('/devices/'+f.pc.id+'/disconnect',f.actor,{method:'POST',data:{userId:f.other.id}});expect(result.status).toBe(200);expect(await result.json()).toEqual({ok:true});
 expect(await device(f.pc)).toEqual(beforeDevice);expect(await receiver(f.pc)).toEqual(beforeReceiver);expect(await member(f.pc,f.other)).toEqual(beforeOtherMember);expect(await connected(f.otherConnection)).toEqual(beforeOtherConnection);
 expect(await member(f.pc,f.actor)).toBeNull();expect(await connected(f.ownConnection)).toBeNull();expect(await removed(f.pc,f.actor)).toMatchObject({device_id:f.pc.id,user_id:f.actor.id});expect((await removed(f.pc,f.actor))?.operation_id).toMatch(/^[\da-f-]{36}$/);expect(await removed(f.pc,f.other)).toBeNull();expect((await audits(f.actor,f.pc)).results).toEqual([{action:'disconnect-own-computer'}]);
 expect((await entries('/devices',f.other)).some(row=>row.id===f.pc.id)).toBe(true);
});

it.each(['member','admin'] as const)('does not revive a disconnected %s through directory reads, catalog, presence or new uploads',async role=>{
 const f=await fixture(role);expect((await call('/computers/'+f.pc.id+'/songs',f.actor)).status).toBe(200);expect((await entries('/devices',f.actor)).some(row=>row.id===f.pc.id)).toBe(true);
 expect((await call('/devices/'+f.pc.id+'/disconnect',f.actor,{method:'POST'})).status).toBe(200);
 for(const path of ['/devices','/receivers'])expect((await entries(path,f.actor)).some(row=>row.id===f.pc.id)).toBe(false);
 expect((await call('/computers/'+f.pc.id+'/songs',f.actor)).status).toBe(403);
 const presence=await call('/connections/presence',f.actor,{method:'POST',data:{deviceIds:[f.pc.id]}});expect(presence.status).toBe(200);expect(await presence.json()).toEqual({ok:true,renewed:0});expect(await connected(f.ownConnection)).toBeNull();expect(await removed(f.pc,f.actor)).not.toBeNull();
 let puts=0;const FILES=new Proxy(env.FILES,{get(target,key){if(key==='put')return async(...args:Parameters<R2Bucket['put']>)=>{puts++;return target.put(...args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 for(const intent of [false,true])expect((await send(f.pc,f.actor,intent,{...env,FILES})).status).toBe(403);expect(puts).toBe(0);
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transfers WHERE sender_id=? AND device_id=?').bind(f.actor.id,f.pc.id).first())?.count).toBe(0);
});

it('keeps denied membership and connection records through disconnect and an explicit reconnect',async()=>{
 const f=await fixture();await membership(f.pc,f.actor,'denied');await env.DB.prepare("UPDATE computer_connections SET status='denied' WHERE id=?").bind(f.ownConnection).run();
 expect((await call('/devices/'+f.pc.id+'/disconnect',f.actor,{method:'POST'})).status).toBe(200);expect(await member(f.pc,f.actor)).toMatchObject({status:'denied'});expect(await connected(f.ownConnection)).toMatchObject({status:'denied'});
 const reconnect=await call('/connections/device:'+f.pc.id,f.actor,{method:'POST'});expect(reconnect.status).toBe(200);expect(await reconnect.json()).toMatchObject({connection:{status:'denied'}});expect(await removed(f.pc,f.actor)).toBeNull();expect(await member(f.pc,f.actor)).toMatchObject({status:'denied'});expect(await connected(f.ownConnection)).toMatchObject({status:'denied'});
 expect((await send(f.pc,f.actor)).status).toBe(403);expect((await call('/computers/'+f.pc.id+'/songs',f.actor)).status).toBe(403);
 const pulse=await call('/connections/presence',f.actor,{method:'POST',data:{deviceIds:[f.pc.id]}});expect(await pulse.json()).toEqual({ok:true,renewed:0});
});

it('requires an explicit reconnect to clear a saved disconnection and creates a fresh pending member request',async()=>{
 const f=await fixture();expect((await call('/devices/'+f.pc.id+'/disconnect',f.actor,{method:'POST'})).status).toBe(200);const prior=await removed(f.pc,f.actor);
 await call('/receive/device:'+f.pc.id,f.actor);await call('/devices',f.actor);await call('/receivers',f.actor);expect(await removed(f.pc,f.actor)).toEqual(prior);
 const result=await call('/connections/device:'+f.pc.id,f.actor,{method:'POST'});expect(result.status).toBe(200);expect(await removed(f.pc,f.actor)).toBeNull();expect(await member(f.pc,f.actor)).toBeNull();
 expect(await env.DB.prepare('SELECT status FROM computer_connections WHERE receiver_id=? AND user_id=?').bind(f.pc.receiverId,f.actor.id).first()).toEqual({status:'pending'});expect(await member(f.pc,f.other)).toMatchObject({status:'approved'});
});

it('allows an administrator to reconnect explicitly to an offline computer without reopening its receiver',async()=>{
 const f=await fixture('admin');expect((await call('/devices/'+f.pc.id+'/disconnect',f.actor,{method:'POST'})).status).toBe(200);
 await env.DB.batch([env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now()-3600,f.pc.id),env.DB.prepare('UPDATE receivers SET closed_at=? WHERE id=?').bind(now(),f.pc.receiverId)]);const offlineDevice=await device(f.pc),closedReceiver=await receiver(f.pc);
 const result=await call('/connections/device:'+f.pc.id,f.actor,{method:'POST'});expect(result.status).toBe(200);expect(await result.json()).toMatchObject({connection:{status:'approved'}});expect(await removed(f.pc,f.actor)).toBeNull();expect(await device(f.pc)).toEqual(offlineDevice);expect(await receiver(f.pc)).toEqual(closedReceiver);
 expect((await entries('/devices',f.actor)).some(row=>row.id===f.pc.id)).toBe(true);expect(await env.DB.prepare('SELECT id FROM computer_connections WHERE device_id=? AND user_id=?').bind(f.pc.id,f.actor.id).first()).toBeNull();
});

it('refuses rename using an administrator snapshot after that exact session is revoked',async()=>{
 const administrator=await person('admin'),pc=await computer(administrator),before=await device(pc);await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(administrator.sessionHash).run();
 await expect(renameAccountComputer(env,administrator,pc.id,'Stale rename',administrator.sessionHash)).rejects.toMatchObject({status:403});expect(await device(pc)).toEqual(before);
});

it.each(['revoked','expired'] as const)('refuses disconnect using a previously read member snapshot after its session is %s',async change=>{
 const f=await fixture(),beforeMember=await member(f.pc,f.actor),beforeConnection=await connected(f.ownConnection);
 if(change==='revoked')await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.actor.sessionHash).run();else await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(now(),f.actor.sessionHash).run();
 await expect(disconnectAccountComputer(env,f.actor,f.pc.id,f.actor.sessionHash)).rejects.toMatchObject({status:403});expect(await removed(f.pc,f.actor)).toBeNull();expect(await member(f.pc,f.actor)).toEqual(beforeMember);expect(await connected(f.ownConnection)).toEqual(beforeConnection);expect((await audits(f.actor,f.pc)).results).toEqual([]);
});

it('does not let an old tombstone authorize later deletes or a false audit when a new disconnect fails at commit',async()=>{
 const f=await fixture(),operationId=crypto.randomUUID();await env.DB.prepare('INSERT INTO station_disconnections VALUES(?,?,?,?)').bind(f.pc.id,f.actor.id,now()-300,operationId).run();const old=await removed(f.pc,f.actor),beforeMember=await member(f.pc,f.actor),beforeConnection=await connected(f.ownConnection);
 const race=beforeBatch(()=>env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.pc.id).run());await expect(disconnectAccountComputer(race.bindings,f.actor,f.pc.id,f.actor.sessionHash)).rejects.toMatchObject({status:403});expect(race.injected()).toBe(true);
 expect(await removed(f.pc,f.actor)).toEqual(old);expect(await member(f.pc,f.actor)).toEqual(beforeMember);expect(await connected(f.ownConnection)).toEqual(beforeConnection);expect((await audits(f.actor,f.pc)).results).toEqual([]);
});

it('will not disconnect an unrelated member from a computer merely because a different user has access',async()=>{
 const f=await fixture(),unrelated=await person(),beforeDevice=await device(f.pc),beforeOther=await connected(f.otherConnection);
 expect((await call('/devices/'+f.pc.id+'/disconnect',unrelated,{method:'POST',data:{userId:f.actor.id}})).status).toBe(403);expect(await removed(f.pc,unrelated)).toBeNull();expect(await member(f.pc,f.actor)).toMatchObject({status:'approved'});expect(await connected(f.otherConnection)).toEqual(beforeOther);expect(await device(f.pc)).toEqual(beforeDevice);
});

it.each(['session revoked','administrator demoted'] as const)('does not reconnect an offline computer after concurrent %s before mutation',async change=>{
 const f=await fixture('admin');await disconnectAccountComputer(env,f.actor,f.pc.id,f.actor.sessionHash);await env.DB.prepare('UPDATE receivers SET closed_at=? WHERE id=?').bind(now(),f.pc.receiverId).run();const before=await removed(f.pc,f.actor);let injected=false;
 const DB=new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>{const statement=target.prepare(sql);if(!sql.startsWith('DELETE FROM station_disconnections'))return statement;return new Proxy(statement,{get(query,property){if(property==='bind')return(...values:unknown[])=>{const bound=query.bind(...values);return new Proxy(bound,{get(current,operation){if(operation==='run')return async()=>{injected=true;if(change==='session revoked')await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.actor.sessionHash).run();else await env.DB.prepare("UPDATE users SET role='member' WHERE id=?").bind(f.actor.id).run();return current.run();};const value=Reflect.get(current,operation);return typeof value==='function'?value.bind(current):value;}});};const value=Reflect.get(query,property);return typeof value==='function'?value.bind(query):value;}});};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const response=await call('/connections/device:'+f.pc.id,f.actor,{method:'POST',bindings:{...env,DB}});expect(injected).toBe(true);expect([401,403,409]).toContain(response.status);expect(await removed(f.pc,f.actor)).toEqual(before);
});

function beforeRename(change:()=>Promise<unknown>){
 let injected=false;
 const DB=new Proxy(env.DB,{get(target,key){
  if(key==='prepare')return(sql:string)=>{
   const statement=target.prepare(sql);
   if(!sql.startsWith('UPDATE devices SET name='))return statement;
   return new Proxy(statement,{get(query,property){
    if(property==='bind')return(...values:unknown[])=>{
     const bound=query.bind(...values);
     return new Proxy(bound,{get(current,operation){
      if(operation==='run')return async()=>{injected=true;await change();return current.run();};
      const value=Reflect.get(current,operation);return typeof value==='function'?value.bind(current):value;
     }});
    };
    const value=Reflect.get(query,property);return typeof value==='function'?value.bind(query):value;
   }});
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 return{bindings:{...env,DB},injected:()=>injected};
}

it.each(['local demotion','local denial','disconnect','owner transfer','session expiry'] as const)('refuses rename when %s happens after the scoped check',async change=>{
 const actor=await person(),pc=await computer();await membership(pc,actor);
 await env.DB.prepare("UPDATE station_memberships SET role='admin' WHERE device_id=? AND user_id=?").bind(pc.id,actor.id).run();
 const before=await device(pc);
 const race=beforeRename(async()=>{
  if(change==='local demotion')await env.DB.prepare("UPDATE station_memberships SET role='member' WHERE device_id=? AND user_id=?").bind(pc.id,actor.id).run();
  if(change==='local denial')await membership(pc,actor,'denied');
  if(change==='disconnect')await env.DB.prepare('INSERT INTO station_disconnections VALUES(?,?,?,?)').bind(pc.id,actor.id,now(),crypto.randomUUID()).run();
  if(change==='owner transfer')await env.DB.prepare('UPDATE devices SET owner_id=? WHERE id=?').bind((await person()).id,pc.id).run();
  if(change==='session expiry')await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(now(),actor.sessionHash).run();
 });
 await expect(renameAccountComputer(race.bindings,actor,pc.id,'Stale local rename',actor.sessionHash)).rejects.toMatchObject({status:403});
 expect(race.injected()).toBe(true);
 expect((await device(pc))?.name).toBe(before?.name);
});

it('does not borrow an administrator membership from a different computer',async()=>{
 const actor=await person('admin'),a=await computer(),b=await computer();
 await membership(a,actor);await membership(b,actor);
 await env.DB.prepare("UPDATE station_memberships SET role='admin' WHERE device_id=? AND user_id=?").bind(a.id,actor.id).run();
 expect((await call('/devices/'+a.id,actor,{method:'PATCH',data:{name:'My administered PC'}})).status).toBe(200);
 expect((await call('/devices/'+b.id,actor,{method:'PATCH',data:{name:'Other PC'}})).status).toBe(403);
 expect((await device(b))?.name).toBe('Isolated account PC');
});

it('keeps a local administrator grant independent of account-wide legacy demotion',async()=>{
 const actor=await person('admin'),pc=await computer();await membership(pc,actor);
 await env.DB.prepare("UPDATE station_memberships SET role='admin' WHERE device_id=? AND user_id=?").bind(pc.id,actor.id).run();
 const race=beforeRename(()=>env.DB.prepare("UPDATE users SET role='member' WHERE id=?").bind(actor.id).run());
 expect(await renameAccountComputer(race.bindings,actor,pc.id,'Locally authorized',actor.sessionHash)).toEqual({ok:true,name:'Locally authorized'});
 expect(race.injected()).toBe(true);
});
