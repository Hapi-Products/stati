import {createExecutionContext,env} from 'cloudflare:test';
import {expect,it,vi} from 'vitest';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';
import type {SenderDelivery} from '../src/server/sender-deliveries';

// Disposable local Worker/D1/R2 fixtures only. These tests do not write live accounts or files.
async function person(role='member',status='active'){
 const id=crypto.randomUUID(),session=token(),sessionHash=await hash(session);
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,'History','T',?,?,?)").bind(id,status,role,now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(sessionHash,id,now()+86400),
 ]);
 return{id,session,sessionHash};
}
type Person=Awaited<ReturnType<typeof person>>;
async function fixture(){
 const sender=await person(),owner=await person('admin'),other=await person(),deviceId=crypto.randomUUID(),receiverId=crypto.randomUUID(),credential=token();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(deviceId,await hash(credential),'Isolated history destination',owner.id,now(),now()+600,now()),
  env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiverId,deviceId,await hash(token()),now()+300,now()),
  env.DB.prepare("INSERT INTO station_memberships(device_id,user_id,status,updated_at) VALUES(?,?,'approved',?)").bind(deviceId,sender.id,now()),
 ]);
 return{sender,other,owner,deviceId,receiverId,credential};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function seed(f:Fixture,status:'queued'|'delivered'|'rejected'|'expired',actor=f.sender,{age=60,transfer=true,expires=now()+3600}:{age?:number;transfer?:boolean;expires?:number}={}){
 const id=crypto.randomUUID(),intentId=crypto.randomUUID(),filename='Isolated-'+id+'.txt',content='History fixture bytes',bytes=new TextEncoder().encode(content).byteLength,sha256=await hash(content),objectKey='history-visibility-fixtures/'+id,createdAt=now()-age;
 await env.DB.batch([
  env.DB.prepare('INSERT INTO delivery_records(id,device_id,sender_id,filename,bytes,status,rejection_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,f.deviceId,actor.id,filename,bytes,status,status==='rejected'?'Use the revised lyrics':null,createdAt,now()-30),
  env.DB.prepare('INSERT INTO upload_intents(sender_id,device_id,intent_id,filename,bytes,sha256,transfer_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(actor.id,f.deviceId,intentId,filename,bytes,sha256,id,createdAt,now()+86400),
 ]);
 if(transfer){await env.DB.prepare('INSERT INTO transfers(id,receiver_id,device_id,sender_id,filename,bytes,content_type,object_key,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,f.receiverId,f.deviceId,actor.id,filename,bytes,'text/plain',objectKey,status,createdAt,expires).run();await env.FILES.put(objectKey,content);}
 return{id,intentId,objectKey,content};
}
async function call(path:string,{actor,method='GET',origin='http://localhost:8787',bindings=env,headers={},body}:{actor?:Person;method?:string;origin?:string;bindings?:Env;headers?:Record<string,string>;body?:BodyInit}={}){
 return worker.fetch(new Request('http://localhost:8787/api'+path,{method,headers:{Origin:origin,Cookie:'stati_access=isolated-test-access'+(actor?'; stati_session='+actor.session:''),...headers},body}),bindings,createExecutionContext());
}
const clear=(actor?:Person,bindings=env)=>call('/transfers/clear-history',{actor,method:'POST',bindings});
async function list(actor:Person){const response=await call('/transfers',{actor});expect(response.status).toBe(200);return response.json<SenderDelivery[]>();}
async function receipt(f:Fixture,actor:Person,intentId:string){const response=await call('/uploads/'+intentId+'?deviceId='+f.deviceId,{actor});expect(response.status).toBe(200);return response.json();}

it('hides only the sender’s finished rows while preserving queued sends, others, bytes, receipts and popup dismissals',async()=>{
 const f=await fixture(),queued=await seed(f,'queued'),delivered=await seed(f,'delivered'),rejected=await seed(f,'rejected'),expired=await seed(f,'expired'),other=await seed(f,'delivered',f.other);
 await env.DB.prepare('INSERT INTO delivery_dismissals VALUES(?,?,?)').bind(rejected.id,f.sender.id,now()-10).run();
 const beforeRecord=await env.DB.prepare('SELECT * FROM delivery_records WHERE id=?').bind(delivered.id).first(),beforeTransfer=await env.DB.prepare('SELECT * FROM transfers WHERE id=?').bind(delivered.id).first(),beforeReceipt=await receipt(f,f.sender,delivered.intentId);
 expect((await clear(f.sender)).status).toBe(200);
 const rows=await list(f.sender);expect(rows).toHaveLength(4);
 for(const entry of [delivered,rejected,expired])expect(rows.find(row=>row.id===entry.id)?.history_hidden_at).toBe(now());
 expect(rows.find(row=>row.id===queued.id)).toMatchObject({status:'queued',history_hidden_at:null});
 expect(rows.find(row=>row.id===delivered.id)?.dismissed_at).toBeNull();expect(rows.find(row=>row.id===rejected.id)?.dismissed_at).toBe(now()-10);
 expect(await env.DB.prepare('SELECT history_hidden_at FROM delivery_records WHERE id=?').bind(other.id).first()).toEqual({history_hidden_at:null});
 expect(await env.DB.prepare('SELECT * FROM delivery_records WHERE id=?').bind(delivered.id).first()).toEqual({...beforeRecord,history_hidden_at:now()});
 expect(await env.DB.prepare('SELECT * FROM transfers WHERE id=?').bind(delivered.id).first()).toEqual(beforeTransfer);
 expect(await receipt(f,f.sender,delivered.intentId)).toEqual(beforeReceipt);
 expect(await(await env.FILES.get(delivered.objectKey))!.text()).toBe(delivered.content);
 const dismiss=await call('/transfers/'+delivered.id+'/dismiss',{actor:f.sender,method:'POST'});expect(dismiss.status).toBe(200);expect((await list(f.sender)).find(row=>row.id===delivered.id)?.dismissed_at).toBe(now());
});
it('repeated clear preserves the first hidden timestamp and a later upload/delivery stays visible',async()=>{
 const f=await fixture(),old=await seed(f,'delivered'),clearedAt=now();expect((await clear(f.sender)).status).toBe(200);vi.setSystemTime(new Date((now()+2)*1000));expect((await clear(f.sender)).status).toBe(200);
 expect((await list(f.sender)).find(row=>row.id===old.id)?.history_hidden_at).toBe(clearedAt);
 const content='New lyrics after the history was cleared',bytes=new TextEncoder().encode(content),intentId=crypto.randomUUID();
 const upload=await call('/receive/device:'+f.deviceId+'/uploads/'+intentId,{actor:f.sender,method:'POST',body:bytes,headers:{'Content-Type':'text/plain','X-Filename':'New lyrics.txt','Content-Length':String(bytes.length),'X-Checksum-SHA256':await hash(content)}});expect(upload.status).toBe(201);
 const accepted=await upload.json<{id:string}>();expect((await list(f.sender)).find(row=>row.id===accepted.id)).toMatchObject({status:'queued',history_hidden_at:null});
 const delivered=await call('/station/transfers/'+accepted.id+'/delivered',{method:'POST',body:'{}',headers:{Authorization:'Bearer '+f.credential,'Content-Type':'application/json'}});expect(delivered.status).toBe(200);
 expect((await list(f.sender)).find(row=>row.id===accepted.id)).toMatchObject({status:'delivered',history_hidden_at:null,dismissed_at:null});expect((await receipt(f,f.sender,intentId) as {status:string}).status).toBe('delivered');
});
it('can hide projected-expired rows without hiding a genuinely queued send with a future live deadline',async()=>{
 const f=await fixture(),noLive=await seed(f,'queued',f.sender,{age:86401,transfer:false}),expiredLive=await seed(f,'queued',f.sender,{age:90,expires:now()}),futureLive=await seed(f,'queued',f.sender,{age:90000,expires:now()+600});
 const before=await list(f.sender);expect(before.find(row=>row.id===noLive.id)?.status).toBe('expired');expect(before.find(row=>row.id===expiredLive.id)?.status).toBe('expired');expect(before.find(row=>row.id===futureLive.id)?.status).toBe('queued');
 expect((await clear(f.sender)).status).toBe(200);const after=await list(f.sender);expect(after.find(row=>row.id===noLive.id)?.history_hidden_at).toBe(now());expect(after.find(row=>row.id===expiredLive.id)?.history_hidden_at).toBe(now());expect(after.find(row=>row.id===futureLive.id)?.history_hidden_at).toBeNull();
 for(const item of [noLive,expiredLive,futureLive])expect(await env.DB.prepare('SELECT status FROM delivery_records WHERE id=?').bind(item.id).first()).toEqual({status:'queued'});
});
it.each(['missing session','revoked session','expired session','removed user'])('rejects clear history with %s',async kind=>{
 const f=await fixture(),row=await seed(f,'delivered');let actor:Person|undefined=f.sender;
 if(kind==='missing session')actor=undefined;
 if(kind==='revoked session')await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.sender.sessionHash).run();
 if(kind==='expired session')await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(now(),f.sender.sessionHash).run();
 if(kind==='removed user')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.sender.id).run();
 expect((await clear(actor)).status).toBe(401);expect(await env.DB.prepare('SELECT history_hidden_at FROM delivery_records WHERE id=?').bind(row.id).first()).toEqual({history_hidden_at:null});
});
it('rejects a cross-origin clear without changing history',async()=>{
 const f=await fixture(),row=await seed(f,'delivered');expect((await call('/transfers/clear-history',{actor:f.sender,method:'POST',origin:'https://unrelated.example'})).status).toBe(403);
 expect(await env.DB.prepare('SELECT history_hidden_at FROM delivery_records WHERE id=?').bind(row.id).first()).toEqual({history_hidden_at:null});
});
it.each(['revoked','expired'])('the final clear statement respects a session that is %s after authentication',async kind=>{
 const f=await fixture(),row=await seed(f,'delivered');let intercepted=false;
 const DB=new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>{const statement=target.prepare(sql);if(!sql.startsWith('UPDATE delivery_records SET history_hidden_at='))return statement;return{bind(...values:unknown[]){const bound=statement.bind(...values);return{async run(){intercepted=true;if(kind==='revoked')await target.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.sender.sessionHash).run();else await target.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(now(),f.sender.sessionHash).run();return bound.run();}};}};};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}) as D1Database;
 const response=await clear(f.sender,{...env,DB});expect(intercepted).toBe(true);expect([200,401,403,409]).toContain(response.status);
 expect(await env.DB.prepare('SELECT history_hidden_at FROM delivery_records WHERE id=?').bind(row.id).first()).toEqual({history_hidden_at:null});
});
it('matches the canonical destination scope before using a temporary row’s expiry to hide queued history',async()=>{
 const f=await fixture(),other=await fixture(),row=await seed(f,'queued',f.sender,{age:60,expires:now()});
 // An inconsistent legacy temporary row must not provide another destination's
 // deadline. Canonical sender history and receipts already ignore that row.
 await env.DB.prepare('UPDATE transfers SET device_id=?,receiver_id=? WHERE id=?').bind(other.deviceId,other.receiverId,row.id).run();
 expect((await list(f.sender)).find(item=>item.id===row.id)).toMatchObject({status:'queued',history_hidden_at:null});
 expect((await clear(f.sender)).status).toBe(200);
 expect((await list(f.sender)).find(item=>item.id===row.id)).toMatchObject({status:'queued',history_hidden_at:null});
});
