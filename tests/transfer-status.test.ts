import {env,SELF} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {hash,now,token} from '../src/server/core';
import {lookupTransferStatuses,transferStatusInput} from '../src/server/transfer-status';

// Isolated Worker/D1 fixtures only: no production identities or remote writes.
async function fixture(){
 const owner=crypto.randomUUID(),sender=crypto.randomUUID(),deviceId=crypto.randomUUID(),receiverId=crypto.randomUUID(),credential=token(),time=now();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,'Owner','T','active','admin',?)").bind(owner,time),
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,'Sender','T','active','member',?)").bind(sender,time),
  env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(deviceId,await hash(credential),'Isolated station',owner,time,time+600,time),
  env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiverId,deviceId,await hash(token()),time+300,time)
 ]);
 return{owner,sender,deviceId,receiverId,credential,time};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function seed(f:Fixture,{status='queued',record=true,transfer=true,age=60,expires=600,reason=null}:{status?:string;record?:boolean;transfer?:boolean;age?:number;expires?:number;reason?:string|null}={}){
 const id=crypto.randomUUID(),created=f.time-age;
 if(transfer)await env.DB.prepare('INSERT INTO transfers(id,receiver_id,device_id,sender_id,filename,bytes,content_type,object_key,status,created_at,expires_at,rejection_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,f.receiverId,f.deviceId,f.sender,'Isolated lyrics.txt',1,'text/plain','isolated-status/'+id,status,created,f.time+expires,reason).run();
 if(record)await env.DB.prepare('INSERT INTO delivery_records(id,device_id,sender_id,filename,bytes,status,rejection_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,f.deviceId,f.sender,'Isolated lyrics.txt',1,status,reason,created,created).run();
 return id;
}
async function result(f:Fixture,id:string,time=f.time){return(await lookupTransferStatuses(env,f.deviceId,[id],time)).statuses[0];}
function call(f:Fixture,path='/station/transfers/status',data:unknown={ids:[crypto.randomUUID()]}){
 return SELF.fetch('http://localhost:8787/api'+path,{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access',Authorization:'Bearer '+f.credential,'Content-Type':'application/json'},body:JSON.stringify(data)});
}

it('returns current queued availability separately from a durable receipt',async()=>{
 const f=await fixture(),id=await seed(f);expect(await result(f,id)).toEqual({id,status:'queued',remoteAvailable:true,rejection_reason:null,sender_role:'member',expires_at:f.time+600});
 await env.DB.prepare('DELETE FROM transfers WHERE id=?').bind(id).run();expect(await result(f,id)).toEqual({id,status:'queued',remoteAvailable:false,rejection_reason:null,sender_role:null,expires_at:f.time-60+86400});
});
it.each([-1,0,1])('uses the exact live deadline boundary (%s seconds)',async expires=>{
 const f=await fixture(),id=await seed(f,{expires});expect(await result(f,id)).toMatchObject({status:expires<=0?'expired':'queued',remoteAvailable:expires>0,expires_at:f.time+expires});
});
it.each([86399,86400,86401])('keeps sender fallback expiry semantics without a temporary row at age %s',async age=>{
 const f=await fixture(),id=await seed(f,{age,transfer:false});expect(await result(f,id)).toMatchObject({status:age>=86400?'expired':'queued',remoteAvailable:false,sender_role:null,expires_at:f.time-age+86400});
});
it('uses a future live deadline even when a durable queued record is older than24hours',async()=>{
 const f=await fixture(),id=await seed(f,{age:90000,expires:500});expect(await result(f,id)).toMatchObject({status:'queued',remoteAvailable:true,expires_at:f.time+500});
});
it.each(['delivered','rejected','expired'])('retains durable %s after temporary cleanup without inventing remote availability',async status=>{
 const f=await fixture(),id=await seed(f,{status,reason:status==='rejected'?'Use the revised song':null,expires:-1});const expected={status,remoteAvailable:false,sender_role:null,rejection_reason:status==='rejected'?'Use the revised song':null};expect(await result(f,id)).toMatchObject(expected);await env.DB.prepare('DELETE FROM transfers WHERE id=?').bind(id).run();expect(await result(f,id)).toMatchObject(expected);
});
it('does not let a stale temporary queued row override a durable rejection',async()=>{
 const f=await fixture(),id=await seed(f,{status:'rejected',reason:'Already prepared'});await env.DB.prepare("UPDATE transfers SET status='queued',rejection_reason=NULL WHERE id=?").bind(id).run();expect(await result(f,id)).toMatchObject({status:'rejected',remoteAvailable:false,rejection_reason:'Already prepared'});
});
it('keeps a queued durable receipt truthful if its temporary row is already decided',async()=>{
 const f=await fixture(),id=await seed(f);await env.DB.prepare("UPDATE transfers SET status='delivered' WHERE id=?").bind(id).run();expect(await result(f,id)).toMatchObject({status:'queued',remoteAvailable:false});
});
it('supports a legacy temporary transfer without its durable receipt',async()=>{
 const f=await fixture(),id=await seed(f,{record:false});expect(await result(f,id)).toMatchObject({status:'queued',remoteAvailable:true});expect(await result(f,id,f.time+601)).toMatchObject({status:'expired',remoteAvailable:false});
});
it('makes another station ID identical to an unknown ID',async()=>{
 const f=await fixture(),other=await fixture(),id=await seed(other,{status:'rejected',reason:'Private reason'}),unknown=crypto.randomUUID();const rows=(await lookupTransferStatuses(env,f.deviceId,[id,unknown])).statuses;expect(rows).toEqual([id,unknown].map(id=>({id,status:'unavailable',remoteAvailable:false,rejection_reason:null,sender_role:null})));
});
it('checks current active sender role, rather than role cached in native history',async()=>{
 const f=await fixture(),id=await seed(f);await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(f.sender).run();expect(await result(f,id)).toMatchObject({sender_role:'admin',remoteAvailable:true});await env.DB.prepare("UPDATE users SET role='member' WHERE id=?").bind(f.sender).run();expect(await result(f,id)).toMatchObject({sender_role:'member'});await env.DB.prepare("UPDATE users SET role='admin',status='removed' WHERE id=?").bind(f.sender).run();expect(await result(f,id)).toMatchObject({sender_role:null,remoteAvailable:true});
});
it('deduplicates IDs and handles100 IDs with one bounded D1 query and no R2 reads',async()=>{
 const f=await fixture(),id=await seed(f),ids=[id,...Array.from({length:99},()=>crypto.randomUUID())];let reads=0,parameters=0;
 const DB=new Proxy(env.DB,{get(target,property){if(property==='prepare')return(sql:string)=>{const prepared=target.prepare(sql);return{bind(...values:unknown[]){parameters=values.length;return{async all(){reads++;return prepared.bind(...values).all();}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}}) as D1Database;
 const FILES=new Proxy(env.FILES,{get(){throw Error('Status lookup must not inspect cloud bytes.');}});
 expect((await lookupTransferStatuses({...env,DB,FILES},f.deviceId,ids)).statuses).toHaveLength(100);expect(reads).toBe(1);expect(parameters).toBe(3);expect((await lookupTransferStatuses(env,f.deviceId,[id,id])).statuses).toHaveLength(1);
});
it.each([{ids:[]},{ids:Array.from({length:101},()=>crypto.randomUUID())},{ids:['invalid']},{ids:[crypto.randomUUID()],extra:true}])('rejects malformed/unbounded input %#',value=>{
 expect(transferStatusInput.safeParse(value).success).toBe(false);
});
it('exposes the bounded route before the generic file matcher and needs no chosen operator',async()=>{
 const f=await fixture(),id=await seed(f);const response=await call(f,undefined,{ids:[id]});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({statuses:[{id,status:'queued',remoteAvailable:true}]});
});
it.each(['device revoked','owner removed','invalid credential'])('denies lookup when %s',async kind=>{
 const f=await fixture(),id=await seed(f);if(kind==='device revoked')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(f.time,f.deviceId).run();if(kind==='owner removed')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.owner).run();if(kind==='invalid credential')f.credential=token();const response=await call(f,undefined,{ids:[id]});expect(response.status).toBe(401);
});
it('puts a queued transfer ahead of more than100 newer completed rows in station state',async()=>{
 const f=await fixture(),id=await seed(f,{age:1000});for(let index=0;index<101;index++)await seed(f,{status:'delivered',age:index});const response=await SELF.fetch('http://localhost:8787/api/station/state',{headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access',Authorization:'Bearer '+f.credential}});expect(response.status).toBe(200);const state=await response.json() as {transfers:{id:string;status:string}[]};expect(state.transfers).toHaveLength(100);expect(state.transfers[0]).toMatchObject({id,status:'queued'});
});
