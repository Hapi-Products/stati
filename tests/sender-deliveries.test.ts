import {env,SELF} from 'cloudflare:test';
import {expect,it,vi} from 'vitest';
import {hash,now,token} from '../src/server/core';
import {senderDeliveries,type SenderDelivery} from '../src/server/sender-deliveries';

// These identities, receipts and transfers exist only in the isolated Worker
// runtime. No production account, object or delivery is created.
async function identity(role='member',status='active'){
 const id=crypto.randomUUID(),session=token(),sessionHash=await hash(session);
 await env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,'Sender','T',?,?,?)").bind(id,status,role,now()).run();
 await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(sessionHash,id,now()+14*86400).run();
 return{id,sessionHash,cookie:'stati_session='+session};
}
async function fixture(role='member',status='active'){
 const sender=await identity(role,status),owner=await identity('admin'),deviceId=crypto.randomUUID(),receiverId=crypto.randomUUID();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(deviceId,await hash(token()),'Isolated destination',owner.id,now(),now()+600,now()),
  env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiverId,deviceId,await hash(token()),now()+300,now())
 ]);
 return{sender,owner,deviceId,receiverId};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
type DeliverySeed={id:string;filename:string;status:string;created_at:number;updated_at:number;reason:string|null};
function seed(status='queued',createdAt=now(),updatedAt=createdAt):DeliverySeed{return{id:crypto.randomUUID(),filename:'Isolated song.txt',status,created_at:createdAt,updated_at:updatedAt,reason:status==='rejected'?'Different service':null};}
async function records(f:Fixture,rows:DeliverySeed[]){
 await env.DB.prepare(`INSERT INTO delivery_records(id,device_id,sender_id,filename,bytes,status,rejection_reason,created_at,updated_at)
  SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.filename'),1,json_extract(value,'$.status'),json_extract(value,'$.reason'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at') FROM json_each(?)`).bind(f.deviceId,f.sender.id,JSON.stringify(rows)).run();
}
function call(endpoint:string,{method='GET',cookie,body}:{method?:string;cookie?:string;body?:unknown}={}){
 return SELF.fetch('http://localhost:8787/api'+endpoint,{method,headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access'+(cookie?'; '+cookie:''),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});
}
async function list(f:Fixture){const response=await call('/transfers',{cookie:f.sender.cookie});expect(response.status).toBe(200);return response.json() as Promise<SenderDelivery[]>;}
const ack=(f:Fixture,id:string)=>call('/transfers/'+id+'/dismiss',{method:'POST',cookie:f.sender.cookie,body:{}});
async function receipt(f:Fixture,row:DeliverySeed,expiresAt?:number){
 const intentId=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO upload_intents(sender_id,device_id,intent_id,filename,bytes,sha256,transfer_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(f.sender.id,f.deviceId,intentId,row.filename,1,'a'.repeat(64),row.id,row.created_at,now()+86400).run();
 if(expiresAt!==undefined)await env.DB.prepare('INSERT INTO transfers(id,receiver_id,device_id,sender_id,filename,bytes,content_type,object_key,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(row.id,f.receiverId,f.deviceId,f.sender.id,row.filename,1,'text/plain','transfers/'+row.id,row.status,row.created_at,expiresAt).run();
 return()=>call('/uploads/'+intentId+'?deviceId='+f.deviceId,{cookie:f.sender.cookie}).then(async response=>{expect(response.status).toBe(200);return response.json() as Promise<{status:string}>;});
}

it('surfaces a six-day-old send that was just saved or rejected ahead of newer queued files',async()=>{
 const f=await fixture(),queued=Array.from({length:150},()=>seed('queued',now()-10,now())),saved=seed('delivered',now()-6*86400,now()-2),rejected=seed('rejected',now()-5*86400,now()-1);await records(f,[...queued,saved,rejected]);
 const result=await list(f);expect(result).toHaveLength(100);expect(result.slice(0,2).map(row=>row.id)).toEqual([rejected.id,saved.id]);expect(result[0].rejection_reason).toBe('Different service');
});
it('drains more than 150 undismissed outcomes through real idempotent ACKs without queued files hiding them',async()=>{
 const f=await fixture(),outcomes=Array.from({length:155},(_,index)=>seed(index%2?'delivered':'rejected',now()-86400-index,now()-100-index)),queued=Array.from({length:140},()=>seed('queued',now()-1,now()));await records(f,[...outcomes,...queued]);
 const displayed=new Set<string>();
 for(let pass=0;pass<3;pass++){
  const pending=(await list(f)).filter(row=>['delivered','rejected'].includes(row.status)&&row.dismissed_at===null);if(!pending.length)break;
  expect(pending.length).toBe(pass===0?100:55);for(const row of pending){expect(displayed.has(row.id)).toBe(false);displayed.add(row.id);}
  for(let index=0;index<pending.length;index+=10){const responses=await Promise.all(pending.slice(index,index+10).map(row=>ack(f,row.id)));expect(responses.every(response=>response.status===200)).toBe(true);}
 }
 expect(displayed.size).toBe(155);expect((await list(f)).filter(row=>['delivered','rejected'].includes(row.status)&&row.dismissed_at===null)).toEqual([]);
 expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM delivery_records WHERE sender_id=?').bind(f.sender.id).first()).toEqual({count:295});
 const id=outcomes[0].id,before=await env.DB.prepare('SELECT dismissed_at FROM delivery_dismissals WHERE transfer_id=? AND user_id=?').bind(id,f.sender.id).first();vi.setSystemTime(new Date((now()+1)*1000));expect((await ack(f,id)).status).toBe(200);expect(await env.DB.prepare('SELECT dismissed_at FROM delivery_dismissals WHERE transfer_id=? AND user_id=?').bind(id,f.sender.id).first()).toEqual(before);
});
it('uses updated time and descending ID as deterministic order within each priority group',async()=>{
 const f=await fixture(),rows=[seed('queued',now()-1,now()-10),seed('queued',now()-100,now()-10),seed('rejected',now()-500,now()-20),seed('delivered',now()-1000,now()-20),seed('delivered',now()-10,now())];await records(f,rows);expect((await ack(f,rows[4].id)).status).toBe(200);
 const expected=[...rows].sort((a,b)=>{const group=(row:DeliverySeed)=>['delivered','rejected'].includes(row.status)&&row.id!==rows[4].id?0:1;return group(a)-group(b)||b.updated_at-a.updated_at||(a.id<b.id?1:-1);});expect((await list(f)).map(row=>row.id)).toEqual(expected.map(row=>row.id));
});
it('keeps seven-day creation retention even when an older terminal outcome has a fresh update',async()=>{
 const f=await fixture(),old=seed('delivered',now()-604801,now()),boundary=seed('rejected',now()-604800,now()),visible=seed('delivered',now()-604799,now()-1);await records(f,[old,boundary,visible]);expect((await list(f)).map(row=>row.id)).toEqual([visible.id]);
});
it.each(['member','admin'])('keeps %s history and dismissals private to the actual sender',async role=>{
 const f=await fixture(role),other=await fixture('admin'),row=seed('rejected');await records(f,[row]);
 expect(await list(other)).toEqual([]);expect((await ack(other,row.id)).status).toBe(404);expect((await list(f))[0]).toMatchObject({id:row.id,dismissed_at:null,rejection_reason:'Different service'});
 expect((await ack(f,row.id)).status).toBe(200);expect((await list(f))[0]).toMatchObject({id:row.id,dismissed_at:now()});
});
it('allows a pending account to read its own approved-computer delivery outcome',async()=>{
 const f=await fixture('member','pending'),row=seed('delivered');await records(f,[row]);expect((await list(f))[0].id).toBe(row.id);expect((await ack(f,row.id)).status).toBe(200);
});
it.each(['removed account','revoked session','expired session'])('rejects history and ACK after %s',async kind=>{
 const f=await fixture(),row=seed('delivered');await records(f,[row]);
 if(kind==='removed account')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.sender.id).run();
 if(kind==='revoked session')await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.sender.sessionHash).run();
 if(kind==='expired session')await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(now(),f.sender.sessionHash).run();
 expect((await call('/transfers',{cookie:f.sender.cookie})).status).toBe(401);expect((await ack(f,row.id)).status).toBe(401);expect(await env.DB.prepare('SELECT transfer_id FROM delivery_dismissals WHERE transfer_id=?').bind(row.id).first()).toBeNull();
});
it('retains truthful own history after the destination is revoked without exposing other senders',async()=>{
 const f=await fixture(),other=await fixture(),row=seed('rejected');await records(f,[row]);await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.deviceId).run();expect((await list(f))[0]).toMatchObject({id:row.id,status:'rejected',computer_name:'Isolated destination'});expect(await list(other)).toEqual([]);
});
it.each([
 {name:'live expiry at now',age:60,live:0,expected:'expired'},
 {name:'live expiry before now',age:60,live:-1,expected:'expired'},
 {name:'live future expiry overrides older record age',age:90000,live:100,expected:'queued'},
 {name:'no transfer before fallback deadline',age:86399,live:undefined,expected:'queued'},
 {name:'no transfer exactly at fallback deadline',age:86400,live:undefined,expected:'expired'},
 {name:'no transfer after fallback deadline',age:86401,live:undefined,expected:'expired'}
])('projects consistent list/receipt status for $name without waiting for cron',async({age,live,expected})=>{
 const f=await fixture(),row=seed('queued',now()-age);await records(f,[row]);const getReceipt=await receipt(f,row,live===undefined?undefined:now()+live);
 expect((await list(f))[0].status).toBe(expected);expect((await getReceipt()).status).toBe(expected);expect(await env.DB.prepare('SELECT status FROM delivery_records WHERE id=?').bind(row.id).first()).toEqual({status:'queued'});
});
it.each(['delivered','rejected','expired'])('preserves explicit %s status regardless of transfer deadlines or cleanup',async status=>{
 const f=await fixture(),row=seed(status,now()-2*86400,now()-10);await records(f,[row]);const getReceipt=await receipt(f,row,now()-1);expect((await list(f))[0].status).toBe(status);expect((await getReceipt()).status).toBe(status);await env.DB.prepare('DELETE FROM transfers WHERE id=?').bind(row.id).run();expect((await list(f))[0].status).toBe(status);expect((await getReceipt()).status).toBe(status);
});
it('never invents saved status from absent cloud bytes or a missing temporary transfer row',async()=>{
 const f=await fixture(),row=seed('queued',now()-60);await records(f,[row]);const getReceipt=await receipt(f,row,now()+1000);expect(await env.FILES.head('transfers/'+row.id)).toBeNull();expect((await list(f))[0].status).toBe('queued');expect((await getReceipt()).status).toBe('queued');await env.DB.prepare('DELETE FROM transfers WHERE id=?').bind(row.id).run();expect((await list(f))[0].status).toBe('queued');expect((await getReceipt()).status).toBe('queued');
});
it('cannot ACK queued or projected-expired records as if delivery had completed',async()=>{
 const f=await fixture(),queued=seed('queued'),expired=seed('queued',now()-86401);await records(f,[queued,expired]);expect((await ack(f,queued.id)).status).toBe(409);expect((await ack(f,expired.id)).status).toBe(409);
});
it('canonical history stays a single bounded read and never queries object storage',async()=>{
 const f=await fixture(),row=seed('delivered');await records(f,[row]);let queries=0;
 const DB=new Proxy(env.DB,{get(target,property){if(property==='prepare')return(sql:string)=>{const prepared=target.prepare(sql);return{bind(...parameters:unknown[]){return{async all(){queries++;return prepared.bind(...parameters).all();}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}}) as D1Database;
 const FILES=new Proxy(env.FILES,{get(){throw Error('Sender history must not infer status from cloud objects.');}});
 expect(await senderDeliveries({...env,DB,FILES},f.sender.id)).toHaveLength(1);expect(queries).toBe(1);
});

it.each(['another sender','another computer'])('does not expose a receipt mislinked to %s',async kind=>{
 const f=await fixture(),other=await fixture(),row=seed('rejected');
 await records(kind==='another sender'?other:{...other,sender:f.sender},[row]);
 const intentId=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO upload_intents(sender_id,device_id,intent_id,filename,bytes,sha256,transfer_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(f.sender.id,f.deviceId,intentId,'Expected file.txt',1,'a'.repeat(64),row.id,now(),now()+86400).run();
 const response=await call('/uploads/'+intentId+'?deviceId='+f.deviceId,{cookie:f.sender.cookie});expect(response.status).toBe(404);expect(await response.json()).toEqual({error:'This send is not confirmed yet.'});
});
