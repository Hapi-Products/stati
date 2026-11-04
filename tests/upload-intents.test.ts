import {afterEach,describe,expect,it,vi} from 'vitest';
import {createExecutionContext,createScheduledController,env} from 'cloudflare:test';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';
import {cleanupUploadAttempts,UPLOAD_PROTOCOL} from '../src/server/upload-intents';

// All identities, bytes, database writes and failure injection stay in local test bindings.
const objects:string[]=[];
afterEach(async()=>{if(objects.length)await env.FILES.delete(objects.splice(0));});
function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
function proxied<T extends object>(target:T,overrides:Partial<Record<keyof T,unknown>>):T{return new Proxy(target,{get(object,key){if(Object.hasOwn(overrides,key))return Reflect.get(overrides,key);const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});}
async function fixture(role='admin'){
 const senderId=crypto.randomUUID(),ownerId=crypto.randomUUID(),deviceId=crypto.randomUUID(),receiverId=crypto.randomUUID(),session=token(),credential=token(),receiver=token();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,?,?,'active',?,?)").bind(senderId,'Isolated','T',role,now()),
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,?,?,'active','admin',?)").bind(ownerId,'Owner','T',now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),senderId,now()+14*86400),
  env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(deviceId,await hash(credential),'Isolated intent fixture',ownerId,now(),now()+1000,now()),
  env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiverId,deviceId,await hash(receiver),now()+1000,now()),
  env.DB.prepare("INSERT INTO station_memberships VALUES(?,?,'approved',?)").bind(deviceId,senderId,now()),
 ]);
 const puts:string[]=[];
 const files=proxied(env.FILES,{put:async(...args:Parameters<R2Bucket['put']>)=>{puts.push(String(args[0]));objects.push(String(args[0]));return env.FILES.put(...args);}});
 const bindings={...env,FILES:files};
 const content='Împreună cântăm. Original isolated lyric bytes.';
 async function send(intentId=crypto.randomUUID(),{text=content,filename='Cântare.txt',target='device:'+deviceId,overrides={},checksum,legacy=false,signal,source}:{text?:string;filename?:string;target?:string;overrides?:Partial<Env>;checksum?:string;legacy?:boolean;signal?:AbortSignal;source?:ReadableStream<Uint8Array>}={}){
  const body=new TextEncoder().encode(text),sha256=checksum??await hash(text);
  return worker.fetch(new Request('http://localhost:8787/api/receive/'+target+(legacy?'':'/uploads/'+intentId),{method:'POST',signal,headers:{Origin:'http://localhost:8787',Cookie:'stati_session='+session,'X-Filename':encodeURIComponent(filename),'Content-Length':String(body.length),...(sha256?{'X-Checksum-SHA256':sha256}:{})},body:source||body}),{...bindings,...overrides},createExecutionContext());
 }
 async function call(path:string,{method='GET',body,bearer=false,overrides={}}:{method?:string;body?:unknown;bearer?:boolean;overrides?:Partial<Env>}={}){return worker.fetch(new Request('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',Cookie:'stati_session='+session,...(bearer?{Authorization:'Bearer '+credential}:{})},...(body?{body:JSON.stringify(body)}:{})}),{...bindings,...overrides},createExecutionContext());}
 async function receipt(intentId:string,forDevice=deviceId){return call('/uploads/'+intentId+'?deviceId='+forDevice);}
 async function counts(){const result=await env.DB.prepare('SELECT (SELECT COUNT(*) FROM transfers WHERE device_id=?) AS transfers,(SELECT COUNT(*) FROM delivery_records WHERE device_id=?) AS records,(SELECT COUNT(*) FROM upload_intents WHERE device_id=? AND transfer_id IS NOT NULL) AS accepted').bind(deviceId,deviceId,deviceId).first();return result;}
 return{senderId,ownerId,deviceId,receiverId,session,credential,receiver,content,puts,bindings,send,call,receipt,counts};
}

describe('idempotent whole-file upload protocol',()=>{
 it('advertises the stable device and protocol through both receiver entry points',async()=>{
  const f=await fixture();for(const target of [f.receiver,'device:'+f.deviceId]){const response=await f.call('/receive/'+target);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({deviceId:f.deviceId,uploadProtocol:UPLOAD_PROTOCOL});}
 });
 it('stores original checked bytes once and confirms a lost-success retry with the same receipt',async()=>{
  const f=await fixture(),intent=crypto.randomUUID();const first=await f.send(intent,{filename:'../Cântare.txt'});expect(first.status).toBe(201);
  const created=await first.json() as {id:string};expect(created).toMatchObject({protocol:UPLOAD_PROTOCOL,intentId:intent,deviceId:f.deviceId,accepted:true,status:'queued',filename:'Cântare.txt',sha256:await hash(f.content),bytes:new TextEncoder().encode(f.content).length,replayed:false});
  const second=await f.send(intent,{filename:'../Cântare.txt'});expect(second.status).toBe(200);expect(await second.json()).toMatchObject({...created,replayed:true});
  const lookup=await f.receipt(intent);expect(lookup.status).toBe(200);expect(await lookup.json()).toMatchObject({...created,replayed:true});expect(f.puts).toHaveLength(1);expect(await f.counts()).toEqual({transfers:1,records:1,accepted:1});
  expect(await(await env.FILES.get(f.puts[0]))!.text()).toBe(f.content);expect((await env.DB.prepare('SELECT id FROM upload_attempts WHERE object_key=?').bind(f.puts[0]).first())).toBeNull();
 });
 it('uses one operation across a receiver link, the computer list and a rotated receiver link',async()=>{
  const f=await fixture(),intent=crypto.randomUUID();
  const first=await f.send(intent,{target:f.receiver});expect(first.status).toBe(201);
  const original=await first.json() as {id:string};
  const rotated=token(),receiverId=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare('UPDATE receivers SET closed_at=? WHERE id=?').bind(now(),f.receiverId),
   env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiverId,f.deviceId,await hash(rotated),now()+1000,now()),
  ]);
  for(const target of ['device:'+f.deviceId,rotated,f.receiver]){
   const response=await f.send(intent,{target});expect(response.status).toBe(200);
   expect(await response.json()).toMatchObject({id:original.id,deviceId:f.deviceId,replayed:true});
  }
  expect(f.puts).toHaveLength(1);expect(await f.counts()).toEqual({transfers:1,records:1,accepted:1});
  const history=await(await f.call('/transfers')).json() as {id:string}[];
  expect(history.filter(row=>row.id===original.id)).toHaveLength(1);
 });
 it('atomically resolves simultaneous identical attempts to one accepted transfer and cleans only the loser',async()=>{
  const f=await fixture(),intent=crypto.randomUUID(),both=deferred(),release=deferred();let started=0;
  const files=proxied(f.bindings.FILES,{put:async(...args:Parameters<R2Bucket['put']>)=>{if(++started===2)both.resolve();await release.promise;return f.bindings.FILES.put(...args);}});
  const first=f.send(intent,{overrides:{FILES:files}}),second=f.send(intent,{overrides:{FILES:files}});await both.promise;
  expect((await env.DB.prepare('SELECT transfer_id FROM upload_intents WHERE device_id=?').bind(f.deviceId).first())?.transfer_id).toBeNull();release.resolve();
  const responses=await Promise.all([first,second]);expect(responses.map(response=>response.status).sort()).toEqual([200,201]);const receipts=await Promise.all(responses.map(response=>response.json())) as {id:string}[];expect(receipts[0].id).toBe(receipts[1].id);
  expect(f.puts).toHaveLength(2);expect(await f.counts()).toEqual({transfers:1,records:1,accepted:1});expect(await env.FILES.head('transfers/'+receipts[0].id)).not.toBeNull();for(const key of f.puts.filter(key=>key!=='transfers/'+receipts[0].id))expect(await env.FILES.head(key)).toBeNull();
 });
 it.each(['name','bytes','checksum'])('rejects a changed %s on the same intent before another object is uploaded',async(change)=>{
  const f=await fixture(),intent=crypto.randomUUID();expect((await f.send(intent)).status).toBe(201);
  const next=change==='name'?{filename:'Other.txt'}:change==='bytes'?{text:f.content+'!'}:{text:f.content.replace('Original','Changed!')};
  expect((await f.send(intent,next)).status).toBe(409);expect(f.puts).toHaveLength(1);expect(await f.counts()).toEqual({transfers:1,records:1,accepted:1});
 });
 it('allows an intentional new intent for the same bytes and never scopes identity by hash alone',async()=>{
  const f=await fixture();expect((await f.send()).status).toBe(201);expect((await f.send()).status).toBe(201);expect(await f.counts()).toEqual({transfers:2,records:2,accepted:2});expect(new Set(f.puts).size).toBe(2);
 });
 it('keeps lookup private to the sender and exact destination',async()=>{
  const f=await fixture(),other=await fixture(),intent=crypto.randomUUID();expect((await f.receipt(intent)).status).toBe(404);expect((await f.send(intent)).status).toBe(201);
  expect((await other.receipt(intent,f.deviceId)).status).toBe(404);expect((await f.receipt(intent,other.deviceId)).status).toBe(404);
  const anonymous=await worker.fetch(new Request('http://localhost:8787/api/uploads/'+intent+'?deviceId='+f.deviceId),env,createExecutionContext());expect([401,403]).toContain(anonymous.status);
 });
 it.each(['delivered','rejected'] as const)('replays current %s status after cloud bytes and temporary transfer rows are deleted',async(status)=>{
  const f=await fixture(),intent=crypto.randomUUID(),sent=await(await f.send(intent)).json() as {id:string};
  const decision=await f.call('/station/transfers/'+sent.id+(status==='delivered'?'/delivered':'/reject'),{method:'POST',body:status==='rejected'?{reason:'Wrong service'}:{},bearer:true});expect(decision.status).toBe(200);
  await worker.scheduled(createScheduledController(),env);expect(await env.FILES.head('transfers/'+sent.id)).toBeNull();
  const replay=await f.send(intent);expect(replay.status).toBe(200);expect(await replay.json()).toMatchObject({id:sent.id,status,replayed:true,...(status==='rejected'?{rejectionReason:'Wrong service'}:{})});expect(f.puts).toHaveLength(1);
 });
 it('confirms own accepted member sends after receiver/window closure without permitting a new send',async()=>{
  const f=await fixture('member'),intent=crypto.randomUUID();expect((await f.send(intent)).status).toBe(201);
  await env.DB.prepare('UPDATE receivers SET closed_at=? WHERE id=?').bind(now(),f.receiverId).run();vi.setSystemTime(new Date('2026-10-12T00:00:00-07:00'));
  expect((await f.receipt(intent)).status).toBe(200);expect((await f.send(intent)).status).toBe(200);expect((await f.send()).status).toBe(410);expect(f.puts).toHaveLength(1);
 });
 it('reports queued expiry and removes accepted fingerprint data with seven-day delivery retention',async()=>{
  const f=await fixture(),intent=crypto.randomUUID();expect((await f.send(intent)).status).toBe(201);vi.setSystemTime(new Date(Date.now()+86401*1000));
  expect(await(await f.receipt(intent)).json()).toMatchObject({status:'expired'});await worker.scheduled(createScheduledController(),env);expect(await(await f.receipt(intent)).json()).toMatchObject({status:'expired'});
  vi.setSystemTime(new Date(Date.now()+7*86400*1000));await worker.scheduled(createScheduledController(),env);expect((await f.receipt(intent)).status).toBe(404);expect(await env.DB.prepare('SELECT intent_id FROM upload_intents WHERE device_id=?').bind(f.deviceId).first()).toBeNull();
 });
 it('requires valid IDs/checksums and cleans invalid type/checksum streams without queueing',async()=>{
  const f=await fixture();for(const options of [{checksum:''},{checksum:'invalid'},{filename:'song.exe'},{checksum:'0'.repeat(64)}]){expect([400,415]).toContain((await f.send(crypto.randomUUID(),options)).status);}
  expect((await f.send('invalid')).status).toBe(400);expect((await f.call('/uploads/invalid?deviceId='+f.deviceId)).status).toBe(400);expect(await f.counts()).toEqual({transfers:0,records:0,accepted:0});for(const key of f.puts)expect(await env.FILES.head(key)).toBeNull();
 });
});

describe('commit reconciliation and durable attempt cleanup',()=>{
 it('reconciles an actually committed D1 batch whose response was lost without deleting accepted bytes',async()=>{
  const f=await fixture(),intent=crypto.randomUUID();let lost=false;
  const db=proxied(env.DB,{batch:async(...args:Parameters<D1Database['batch']>)=>{const result=await env.DB.batch(...args);if(!lost){lost=true;throw Error('Isolated committed response lost');}return result;}});
  const response=await f.send(intent,{overrides:{DB:db}});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({replayed:true,accepted:true});expect(await f.counts()).toEqual({transfers:1,records:1,accepted:1});expect(await env.FILES.head(f.puts[0])).not.toBeNull();
 });
 it('retains an accepted object when both commit response and reconciliation read are unavailable',async()=>{
  const f=await fixture(),intent=crypto.randomUUID();let unavailable=false;
  const db=proxied(env.DB,{batch:async(...args:Parameters<D1Database['batch']>)=>{await env.DB.batch(...args);unavailable=true;throw Error('Isolated committed response lost');},prepare:(sql:string)=>{if(unavailable)throw Error('Isolated database unavailable');return env.DB.prepare(sql);}});
  expect((await f.send(intent,{overrides:{DB:db}})).status).toBe(503);expect(await env.FILES.head(f.puts[0])).not.toBeNull();expect((await f.receipt(intent)).status).toBe(200);expect((await f.send(intent)).status).toBe(200);expect(f.puts).toHaveLength(1);
 });
 it('preserves legacy accepted bytes after the same commit-then-transport-error failure',async()=>{
  const f=await fixture();const db=proxied(env.DB,{batch:async(...args:Parameters<D1Database['batch']>)=>{await env.DB.batch(...args);throw Error('Isolated committed legacy response lost');}});
  const response=await f.send(crypto.randomUUID(),{legacy:true,overrides:{DB:db}});expect(response.status).toBe(201);expect(await response.json()).toMatchObject({status:'queued'});expect(await env.FILES.head(f.puts[0])).not.toBeNull();expect((await f.counts())?.transfers).toBe(1);
 });
 it('keeps a settled failed attempt tracked when cleanup deletion fails and retries it hourly',async()=>{
  const f=await fixture('member');let failDelete=true;
  const files=proxied(f.bindings.FILES,{put:async(...args:Parameters<R2Bucket['put']>)=>{const result=await f.bindings.FILES.put(...args);await env.DB.prepare("UPDATE station_memberships SET status='denied' WHERE device_id=? AND user_id=?").bind(f.deviceId,f.senderId).run();return result;},delete:async(...args:Parameters<R2Bucket['delete']>)=>{if(failDelete)throw Error('Isolated cleanup offline');return env.FILES.delete(...args);}});
  expect((await f.send(crypto.randomUUID(),{overrides:{FILES:files}})).status).toBe(403);expect(await env.FILES.head(f.puts[0])).not.toBeNull();expect((await env.DB.prepare('SELECT state FROM upload_attempts WHERE object_key=?').bind(f.puts[0]).first())?.state).toBe('cleanup');
  expect((await cleanupUploadAttempts({...env,FILES:files})).failed).toBe(1);failDelete=false;expect((await cleanupUploadAttempts({...env,FILES:files})).failed).toBe(0);expect(await env.FILES.head(f.puts[0])).toBeNull();expect(await env.DB.prepare('SELECT id FROM upload_attempts WHERE object_key=?').bind(f.puts[0]).first()).toBeNull();
 });
 it('fences an expired unknown PUT, retains its tombstone through empty deletes, and cleans a late completion',async()=>{
  const f=await fixture(),started=deferred(),release=deferred();
  const files=proxied(f.bindings.FILES,{put:async(...args:Parameters<R2Bucket['put']>)=>{started.resolve();await release.promise;return f.bindings.FILES.put(...args);}});
  const pending=f.send(crypto.randomUUID(),{overrides:{FILES:files}});await started.promise;vi.setSystemTime(new Date(Date.now()+601000));
  expect((await cleanupUploadAttempts(env)).failed).toBe(0);expect((await env.DB.prepare("SELECT state FROM upload_attempts WHERE state='retired' ORDER BY updated_at DESC LIMIT 1").first())?.state).toBe('retired');
  expect((await cleanupUploadAttempts(env)).failed).toBe(0);release.resolve();expect((await pending).status).toBe(408);expect(await f.counts()).toEqual({transfers:0,records:0,accepted:0});for(const key of f.puts)expect(await env.FILES.head(key)).toBeNull();
 });
 it('janitor fences a ready attempt before deleting so its delayed commit cannot queue a missing file',async()=>{
  const f=await fixture(),started=deferred(),release=deferred();
  const db=proxied(env.DB,{batch:async(...args:Parameters<D1Database['batch']>)=>{started.resolve();await release.promise;return env.DB.batch(...args);}});
  const pending=f.send(crypto.randomUUID(),{overrides:{DB:db}});await started.promise;vi.setSystemTime(new Date(Date.now()+601000));await cleanupUploadAttempts(env);release.resolve();expect((await pending).status).toBe(410);expect(await f.counts()).toEqual({transfers:0,records:0,accepted:0});expect(await env.FILES.head(f.puts[0])).toBeNull();
 });
 it('purges anonymous retired tombstones after seven days without allowing a late upload to recreate or commit them',async()=>{
  const f=await fixture(),started=deferred(),release=deferred();
  const files=proxied(f.bindings.FILES,{put:async(...args:Parameters<R2Bucket['put']>)=>{started.resolve();await release.promise;return f.bindings.FILES.put(...args);}});
  const pending=f.send(crypto.randomUUID(),{overrides:{FILES:files}});await started.promise;
  const attempt=await env.DB.prepare("SELECT id,object_key FROM upload_attempts WHERE state='active' ORDER BY updated_at DESC LIMIT 1").first<{id:string;object_key:string}>();expect(attempt).not.toBeNull();
  vi.setSystemTime(new Date(Date.now()+(7*86400+601)*1000));await cleanupUploadAttempts(env);
  expect(await env.DB.prepare('SELECT id FROM upload_attempts WHERE id=?').bind(attempt!.id).first()).toBeNull();
  release.resolve();expect((await pending).status).toBe(408);expect(await f.counts()).toEqual({transfers:0,records:0,accepted:0});
  expect(await env.DB.prepare('SELECT id FROM upload_attempts WHERE id=?').bind(attempt!.id).first()).toBeNull();
  // Miniflare does not run the real bucket lifecycle. The late unqueued object
  // remains for that independently verified policy, not an accepted transfer.
  expect(await env.FILES.head(attempt!.object_key)).not.toBeNull();
 });
 it('cancellation after receiving bytes but before commit never creates an accepted transfer',async()=>{
  const f=await fixture(),controller=new AbortController();const files=proxied(f.bindings.FILES,{put:async(...args:Parameters<R2Bucket['put']>)=>{const result=await f.bindings.FILES.put(...args);controller.abort();return result;}});
  expect((await f.send(crypto.randomUUID(),{signal:controller.signal,overrides:{FILES:files}})).status).toBe(400);expect(await f.counts()).toEqual({transfers:0,records:0,accepted:0});expect(await env.FILES.head(f.puts[0])).toBeNull();
 });
 it('cancels a prepared source when stopped during prefix inspection without starting storage',async()=>{
  const f=await fixture(),controller=new AbortController();let canceled=false;
  const source=new ReadableStream<Uint8Array>({pull(stream){stream.enqueue(new TextEncoder().encode(f.content));controller.abort();},cancel(){canceled=true;}},{highWaterMark:0});
  const intent=crypto.randomUUID();
  expect((await f.send(intent,{signal:controller.signal,source})).status).toBe(400);
  expect(canceled).toBe(true);expect(f.puts).toHaveLength(0);expect(await f.counts()).toEqual({transfers:0,records:0,accepted:0});expect((await f.receipt(intent)).status).toBe(404);
 });
 it.each(['receiver link','computer list'])('cancellation during commit authorization for the %s cannot queue the file',async path=>{
  const f=await fixture(),controller=new AbortController();let stored=false;
  const files=proxied(f.bindings.FILES,{put:async(...args:Parameters<R2Bucket['put']>)=>{const result=await f.bindings.FILES.put(...args);stored=true;return result;}});
  const db=proxied(env.DB,{prepare:(sql:string)=>{
   const source=env.DB.prepare(sql);
   if(!stored||!sql.startsWith('SELECT u.* FROM users u JOIN sessions'))return source;
   return proxied(source,{bind:(...values:unknown[])=>{
    const bound=source.bind(...values);
    return proxied(bound,{first:async(...args:Parameters<D1PreparedStatement['first']>)=>{const result=await bound.first(...args);controller.abort();return result;}});
   }});
  }});
  const intent=crypto.randomUUID();
  expect((await f.send(intent,{target:path==='receiver link'?f.receiver:'device:'+f.deviceId,signal:controller.signal,overrides:{FILES:files,DB:db}})).status).toBe(400);
  expect(await f.counts()).toEqual({transfers:0,records:0,accepted:0});expect((await f.receipt(intent)).status).toBe(404);
  for(const key of f.puts)expect(await env.FILES.head(key)).toBeNull();
  // The original operation remains retryable after a deliberate stop.
  expect((await f.send(intent)).status).toBe(201);expect(await f.counts()).toEqual({transfers:1,records:1,accepted:1});
 });
});

describe('fresh and commit-time authorization',()=>{
 it.each(['removed','session','denied','closed','owner','revoked','window'])('rejects %s changes after bytes reach storage and cleans the attempt',async(change)=>{
  if(change==='window')vi.setSystemTime(new Date('2026-10-11T13:59:59-07:00'));
  const f=await fixture('member');const files=proxied(f.bindings.FILES,{put:async(...args:Parameters<R2Bucket['put']>)=>{const result=await f.bindings.FILES.put(...args);
   if(change==='removed')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.senderId).run();
   if(change==='session')await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(f.session)).run();
   if(change==='denied')await env.DB.prepare("UPDATE station_memberships SET status='denied' WHERE device_id=? AND user_id=?").bind(f.deviceId,f.senderId).run();
   if(change==='closed')await env.DB.prepare('UPDATE receivers SET closed_at=? WHERE id=?').bind(now(),f.receiverId).run();
   if(change==='owner')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.ownerId).run();
   if(change==='revoked')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.deviceId).run();
   if(change==='window')vi.setSystemTime(new Date('2026-10-11T14:00:00-07:00'));
   return result;}});
  expect([401,403,410]).toContain((await f.send(crypto.randomUUID(),{overrides:{FILES:files}})).status);expect(await f.counts()).toEqual({transfers:0,records:0,accepted:0});for(const key of f.puts)expect(await env.FILES.head(key)).toBeNull();
 });
 it.each(['demoted','session','revoked'])('SQL still rejects %s after JavaScript authorization has already passed',async(change)=>{
  if(change==='demoted')vi.setSystemTime(new Date('2026-10-12T00:00:00-07:00'));
  const f=await fixture();const db=proxied(env.DB,{batch:async(...args:Parameters<D1Database['batch']>)=>{
   if(change==='demoted')await env.DB.prepare("UPDATE users SET role='member' WHERE id=?").bind(f.senderId).run();
   if(change==='session')await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(f.session)).run();
   if(change==='revoked')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.deviceId).run();
   return env.DB.batch(...args);}});
  expect((await f.send(crypto.randomUUID(),{overrides:{DB:db}})).status).toBe(410);expect(await f.counts()).toEqual({transfers:0,records:0,accepted:0});expect(await env.FILES.head(f.puts[0])).toBeNull();
 });
});
