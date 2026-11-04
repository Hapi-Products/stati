import {createExecutionContext,env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';

// Real isolated Worker routes, D1 and R2 only. No production account/object.
async function fixture(){
 const owner=crypto.randomUUID(),sender=crypto.randomUUID(),deviceId=crypto.randomUUID(),receiverId=crypto.randomUUID(),id=crypto.randomUUID(),credential=token(),time=now(),key='isolated-automatic/'+id,bytes='Isolated song lyrics';
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,'Owner','T','active','admin',?)").bind(owner,time),
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,'Sender','T','active','admin',?)").bind(sender,time),
  env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(deviceId,await hash(credential),'Isolated delivery station',owner,time,time+600,time),
  env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiverId,deviceId,await hash(token()),time+300,time),
  env.DB.prepare('INSERT INTO transfers(id,receiver_id,device_id,sender_id,filename,bytes,content_type,object_key,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,receiverId,deviceId,sender,'lyrics.txt',bytes.length,'text/plain',key,time-60,time+86400),
  env.DB.prepare("INSERT INTO delivery_records(id,device_id,sender_id,filename,bytes,status,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)").bind(id,deviceId,sender,'lyrics.txt',bytes.length,time-60,time-60)
 ]);
 await env.FILES.put(key,bytes,{httpMetadata:{contentType:'text/plain'}});
 return{owner,sender,deviceId,receiverId,id,credential,time,key,bytes};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function call(f:Fixture,{automatic=true,ack=false,bindings=env,body,credential=f.credential}:{automatic?:boolean;ack?:boolean;bindings?:Env;body?:unknown;credential?:string}={}){
 const request=new Request('http://localhost:8787/api/station/transfers/'+f.id+(ack?'/delivered':''),{method:ack?'POST':'GET',headers:{Origin:'http://localhost:8787',Authorization:'Bearer '+credential,...(!ack&&automatic?{'X-Stati-Delivery-Mode':'automatic'}:{}),...(ack?{'Content-Type':'application/json'}:{})},...(ack?{body:JSON.stringify(body??{automatic})}:{})});
 return worker.fetch(request,bindings,createExecutionContext());
}
async function record(f:Fixture){return env.DB.prepare('SELECT status,rejection_reason,created_at,updated_at FROM delivery_records WHERE id=?').bind(f.id).first();}
async function stillQueued(f:Fixture,before:unknown){expect(await env.DB.prepare('SELECT status,delivered_at,rejection_reason FROM transfers WHERE id=?').bind(f.id).first()).toEqual({status:'queued',delivered_at:null,rejection_reason:null});expect(await record(f)).toEqual(before);expect(await(await env.FILES.get(f.key))?.text()).toBe(f.bytes);}
async function changeSender(f:Fixture,kind:'demoted'|'removed'){await env.DB.prepare(kind==='demoted'?"UPDATE users SET role='member' WHERE id=?":"UPDATE users SET status='removed' WHERE id=?").bind(f.sender).run();}
function beforeBatch(change:()=>Promise<unknown>){
 let injected=0;const DB=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(statements:D1PreparedStatement[])=>{injected++;await change();return target.batch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 return{bindings:{...env,DB},count:()=>injected};
}

it('allows background automatic GET and ACK for a current active admin sender without a selected operator',async()=>{
 const f=await fixture(),response=await call(f);expect(response.status).toBe(200);expect(await response.text()).toBe(f.bytes);expect(await env.DB.prepare('SELECT operator_id FROM devices WHERE id=?').bind(f.deviceId).first()).toEqual({operator_id:null});expect((await call(f,{ack:true})).status).toBe(200);expect(await record(f)).toMatchObject({status:'delivered'});expect(await env.FILES.get(f.key)).toBeNull();
});
it.each(['demoted','removed'] as const)('refuses automatic download and ACK for a sender already %s',async kind=>{
 const f=await fixture(),before=await record(f);await changeSender(f,kind);expect((await call(f)).status).toBe(404);expect((await call(f,{ack:true})).status).toBe(409);await stillQueued(f,before);
});
it.each(['demoted','removed'] as const)('fences automatic ACK when the sender is %s after the initial route reads',async kind=>{
 const f=await fixture(),before=await record(f);expect((await call(f)).status).toBe(200);const injected=beforeBatch(()=>changeSender(f,kind));const response=await call(f,{ack:true,bindings:injected.bindings});expect(injected.count()).toBe(1);expect(response.status).toBe(409);await stillQueued(f,before);
});
it.each(['demoted','removed'] as const)('allows the explicit computer-save path for an already accepted file from a %s sender',async kind=>{
 const f=await fixture();await changeSender(f,kind);const downloaded=await call(f,{automatic:false});expect(downloaded.status).toBe(200);expect(await downloaded.text()).toBe(f.bytes);expect((await call(f,{ack:true,automatic:false})).status).toBe(200);expect(await record(f)).toMatchObject({status:'delivered'});expect(await env.FILES.get(f.key)).toBeNull();
});
it('keeps an already delivered automatic ACK idempotent after sender demotion',async()=>{
 const f=await fixture();expect((await call(f,{ack:true})).status).toBe(200);await changeSender(f,'demoted');const response=await call(f,{ack:true});expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true});expect(await record(f)).toMatchObject({status:'delivered'});expect(await env.FILES.get(f.key)).toBeNull();
});
it.each(['revoked device','rotated credential','removed owner'] as const)('fences automatic ACK when the %s changes after the initial route reads',async kind=>{
 const f=await fixture(),before=await record(f),injected=beforeBatch(async()=>{
  if(kind==='revoked device')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(f.time,f.deviceId).run();
  if(kind==='rotated credential')await env.DB.prepare('UPDATE devices SET token_hash=? WHERE id=?').bind(await hash(token()),f.deviceId).run();
  if(kind==='removed owner')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.owner).run();
 });
 expect((await call(f,{ack:true,bindings:injected.bindings})).status).toBe(409);expect(injected.count()).toBe(1);await stillQueued(f,before);
});
it('denies an already revoked computer before automatic GET/ACK and preserves queued bytes',async()=>{
 const f=await fixture(),before=await record(f);await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(f.time,f.deviceId).run();expect((await call(f)).status).toBe(401);expect((await call(f,{ack:true})).status).toBe(401);await stillQueued(f,before);
});
it('does not permit another paired computer to download or decide this transfer',async()=>{
 const f=await fixture(),other=await fixture(),before=await record(f);expect((await call(f,{credential:other.credential})).status).toBe(404);expect((await call(f,{ack:true,credential:other.credential})).status).toBe(404);await stillQueued(f,before);
});
it('rejects an invalid automatic flag before changing the queue or cloud bytes',async()=>{
 const f=await fixture(),before=await record(f);expect((await call(f,{ack:true,body:{automatic:'true'}})).status).toBe(400);await stillQueued(f,before);
});
it('leaves a declined automatic save available for a later explicit computer review',async()=>{
 const f=await fixture(),before=await record(f);await changeSender(f,'demoted');expect((await call(f,{ack:true})).status).toBe(409);await stillQueued(f,before);expect((await call(f,{ack:true,automatic:false})).status).toBe(200);expect(await record(f)).toMatchObject({status:'delivered'});expect(await env.FILES.get(f.key)).toBeNull();
});
