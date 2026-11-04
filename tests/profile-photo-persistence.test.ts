import {afterEach,describe,expect,it,vi} from 'vitest';
import {createExecutionContext,createScheduledController,env,waitOnExecutionContext} from 'cloudflare:test';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';
import samples from './fixtures/profile-photos.json';

// Faults and fixture identities exist only in Vitest's local D1/R2 bindings.
// Expected-red against frozen preview27; production storage implementation must
// satisfy these persistence invariants before the next publication.
type SqlCall={sql:string;parameters:unknown[];method:string};
type Hooks={beforeSql?:(call:SqlCall)=>Promise<void>|void;afterSql?:(call:SqlCall)=>Promise<void>|void;beforePut?:(key:string)=>Promise<void>|void;afterPut?:(key:string)=>Promise<void>|void;beforeDelete?:(keys:string[])=>Promise<void>|void};
const png=()=>Uint8Array.from(atob(samples.fixtures.find(sample=>sample.extension==='png')!.base64),character=>character.charCodeAt(0));
const ownedObjects=new Set<string>();
afterEach(async()=>{if(ownedObjects.size)await env.FILES.delete([...ownedObjects]);ownedObjects.clear();});
const deferred=<T=void>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve};};
async function within<T>(promise:Promise<T>,label:string){let timer!:ReturnType<typeof setTimeout>;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out waiting for '+label)),5000);})]);}finally{clearTimeout(timer);}}
const photoUpdate=(call:SqlCall)=>/UPDATE\s+users\s+SET\s+photo_key\s*=/i.test(call.sql);

function instrument(hooks:Hooks={}){
 const metadata=new WeakMap<object,{statement:D1PreparedStatement;sql:string;parameters:unknown[]}>(),puts:string[]=[],deletes:string[]=[];
 function database(source:D1Database):D1Database{
  function statement(target:D1PreparedStatement,sql:string,parameters:unknown[]=[]):D1PreparedStatement{
   const proxy=new Proxy(target,{get(target,property){
    if(property==='bind')return(...values:unknown[])=>statement(target.bind(...values),sql,values);
    if(['run','first','all','raw'].includes(String(property)))return async(...arguments_:unknown[])=>{
     const call={sql,parameters,method:String(property)};await hooks.beforeSql?.(call);
     const result=await Reflect.apply(Reflect.get(target,property),target,arguments_);await hooks.afterSql?.(call);return result;
    };
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
   }});metadata.set(proxy,{statement:target,sql,parameters});return proxy;
  }
  return new Proxy(source,{get(target,property){
   if(property==='prepare')return(sql:string)=>statement(target.prepare(sql),sql);
   if(property==='batch')return async(statements:D1PreparedStatement[])=>{
    const calls=statements.map(item=>metadata.get(item));
    for(const call of calls)if(call)await hooks.beforeSql?.({...call,method:'batch'});
    const result=await target.batch(statements.map((item,index)=>calls[index]?.statement||item));
    for(const call of calls)if(call)await hooks.afterSql?.({...call,method:'batch'});
    return result;
   };
   // Preserve instrumentation if a storage implementation requests a D1 session.
   if(property==='withSession')return(...arguments_:unknown[])=>database(Reflect.apply(Reflect.get(target,property),target,arguments_));
   const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
 }
 const files=new Proxy(env.FILES,{get(target,property){
  if(property==='put')return async(...arguments_:Parameters<R2Bucket['put']>)=>{
   const key=String(arguments_[0]);puts.push(key);ownedObjects.add(key);await hooks.beforePut?.(key);const result=await target.put(...arguments_);await hooks.afterPut?.(key);return result;
  };
  if(property==='delete')return async(key:string|string[])=>{const keys=Array.isArray(key)?key:[key];deletes.push(...keys);await hooks.beforeDelete?.(keys);return target.delete(key);};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 return {environment:{...env,DB:database(env.DB),FILES:files},puts,deletes};
}

async function fixture(){
 const id=crypto.randomUUID(),session=token(),oldKey='profiles/'+id+'/original-'+crypto.randomUUID(),bytes=png();ownedObjects.add(oldKey);
 await env.FILES.put(oldKey,bytes,{httpMetadata:{contentType:'image/png'}});
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,photo_key,created_at) VALUES(?,?,?,'active','member',?,?)").bind(id,'Isolated','T',oldKey,now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+86400),
 ]);
 const snapshot=async()=>{
  const user=await env.DB.prepare('SELECT photo_key,status FROM users WHERE id=?').bind(id).first<{photo_key:string;status:string}>(),objects=await env.FILES.list({prefix:'profiles/'+id+'/'});expect(objects.truncated).toBe(false);
  const keys=objects.objects.map(object=>object.key).sort();return {pointer:user!.photo_key,status:user!.status,keys,pointerExists:!!await env.FILES.head(user!.photo_key),unreferenced:keys.filter(key=>key!==user!.photo_key)};
 };
 async function upload(environment:Env,signal?:AbortSignal){
  const bytes=png(),ctx=createExecutionContext(),response=await worker.fetch(new Request('http://localhost:8787/api/me/photo',{method:'PUT',headers:{Origin:'http://localhost:8787',Cookie:'stati_session='+session,'X-Filename':'profile.png','Content-Length':String(bytes.length)},body:bytes,signal}),environment,ctx);
  await waitOnExecutionContext(ctx);return response;
 }
 return {id,session,oldKey,snapshot,upload};
}
async function cleanup(environment:Env){
 vi.setSystemTime(new Date(Date.now()+2*3600000));const errors:string[]=[];
 for(let attempt=0;attempt<2;attempt++)try{await worker.scheduled(createScheduledController(),environment);}catch(error){errors.push(error instanceof Error?error.message:String(error));}
 expect(errors,'Recovered scheduled cleanup must finish without errors.').toEqual([]);
 return errors;
}
function evidence(name:string,value:unknown){console.info('PHOTO_PERSISTENCE_EVIDENCE '+JSON.stringify({case:name,...value as object}));}
function cleanCurrent(snapshot:Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['snapshot']>>){expect(snapshot.pointerExists).toBe(true);expect(snapshot.unreferenced).toEqual([]);}

describe('Profile photo replacement persistence',()=>{
 it('fences a stale concurrent replacement and eventually removes all unreferenced objects',async()=>{
  const user=await fixture(),firstReached=deferred<string>(),secondReached=deferred<string>(),releaseSecond=deferred();let started=0;
  const state=instrument({beforePut:async key=>{if(started++===0){firstReached.resolve(key);await secondReached.promise;}else{secondReached.resolve(key);await releaseSecond.promise;}}});
  const abortA=new AbortController(),abortB=new AbortController(),first=user.upload(state.environment,abortA.signal);let second:Promise<Response>|undefined,responseA:Response|undefined,responseB:Response|undefined;
  try{
   await within(Promise.race([firstReached.promise,first.then(()=>{throw Error('The first save finished before reaching its R2 barrier.');})]),'the first R2 write');
   second=user.upload(state.environment,abortB.signal);
   await within(Promise.race([secondReached.promise,second.then(()=>{throw Error('The second save finished before both requests reached their R2 barriers.');})]),'the second R2 write');
   responseA=await within(first,'the first save');releaseSecond.resolve();responseB=await within(second,'the stale save');
  }finally{secondReached.resolve('released during test cleanup');releaseSecond.resolve();abortA.abort();abortB.abort();await Promise.allSettled([first,...(second?[second]:[])]);}
  const before=await user.snapshot(),cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('concurrent-replacements',{statuses:[responseA!.status,responseB!.status],before,after,puts:state.puts,cleanupErrors});
  expect(responseA!.status).toBe(200);expect(responseB!.status).toBe(409);expect(before.pointer).toBe(state.puts[0]);expect(before.pointerExists).toBe(true);expect(after.pointer).toBe(state.puts[0]);cleanCurrent(after);
 },15000);

 it('keeps the old photo after a database write fails before commit and cleans the staged object',async()=>{
  const user=await fixture();let failures=0;
  const state=instrument({beforeSql:call=>{if(photoUpdate(call)&&failures++===0)throw Error('Isolated D1 failure before photo commit');}});
  const response=await user.upload(state.environment),before=await user.snapshot(),cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('database-failure-before-commit',{status:response.status,before,after,puts:state.puts,failures,cleanupErrors});
  expect(failures).toBeGreaterThan(0);expect(response.status).toBeGreaterThanOrEqual(500);expect(before.pointer).toBe(user.oldKey);expect(before.pointerExists).toBe(true);expect(after.pointer).toBe(user.oldKey);cleanCurrent(after);
 });

 it('recognizes a committed photo after the database response is lost instead of reporting a failed save',async()=>{
  const user=await fixture();let failures=0;
  const state=instrument({afterSql:call=>{if(photoUpdate(call)&&failures++===0)throw Error('Isolated D1 response lost after photo commit');}});
  const response=await user.upload(state.environment),before=await user.snapshot(),cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('database-commit-response-lost',{status:response.status,before,after,puts:state.puts,failures,cleanupErrors});
  expect(failures).toBeGreaterThan(0);expect(response.status).toBe(200);expect(before.pointer).toBe(state.puts[0]);expect(before.pointerExists).toBe(true);expect(after.pointer).toBe(state.puts[0]);cleanCurrent(after);
 });

 it('preserves a committed photo while database reconciliation is unavailable, then cleans safely after recovery',async()=>{
  const user=await fixture();let commitFailures=0,denyReads=false,readFailures=0;
  const state=instrument({
   afterSql:call=>{if(photoUpdate(call)&&commitFailures++===0){denyReads=true;throw Error('Isolated lost commit response');}},
   beforeSql:call=>{if(denyReads&&/\bSELECT\b/i.test(call.sql)){readFailures++;throw Error('Isolated D1 reconciliation outage');}},
  });
  const response=await user.upload(state.environment),before=await user.snapshot(),deletesDuringOutage=[...state.deletes];denyReads=false;
  const cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('database-reconciliation-outage',{status:response.status,before,after,puts:state.puts,commitFailures,readFailures,deletesDuringOutage,cleanupErrors});
  expect(commitFailures).toBeGreaterThan(0);expect(readFailures).toBeGreaterThan(0);expect(response.status).toBeGreaterThanOrEqual(500);expect(deletesDuringOutage).toEqual([]);expect(before.pointer).toBe(state.puts[0]);expect(before.pointerExists).toBe(true);expect(after.pointer).toBe(state.puts[0]);cleanCurrent(after);
 });

 it('reports the new photo saved even when deleting the previous object needs a durable retry',async()=>{
  const user=await fixture();let failures=0;
  const state=instrument({beforeDelete:keys=>{if(keys.includes(user.oldKey)&&failures++===0)throw Error('Isolated old-photo deletion failure');}});
  const response=await user.upload(state.environment),before=await user.snapshot(),cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('previous-object-delete-failure',{status:response.status,before,after,puts:state.puts,failures,cleanupErrors});
  expect(failures).toBeGreaterThan(0);expect(response.status).toBe(200);expect(before.pointer).toBe(state.puts[0]);expect(before.pointerExists).toBe(true);expect(after.pointer).toBe(state.puts[0]);cleanCurrent(after);
 });

 it('does not publish a new photo for an account removed during object storage',async()=>{
  const user=await fixture();let removals=0;
  const state=instrument({afterPut:async()=>{removals++;await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(user.id).run();}});
  const response=await user.upload(state.environment),before=await user.snapshot(),cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('user-removed-during-save',{status:response.status,before,after,puts:state.puts,removals,cleanupErrors});
  expect(removals).toBe(1);expect(response.status).toBe(401);expect(before.pointer).toBe(user.oldKey);expect(before.pointerExists).toBe(true);expect(after.status).toBe('removed');expect(after.pointer).toBe(user.oldKey);cleanCurrent(after);
 });

 it('cleans an object whose R2 write committed but whose response was lost',async()=>{
  const user=await fixture();let failures=0;
  const state=instrument({afterPut:()=>{if(failures++===0)throw Error('Isolated R2 response lost after object write');}});
  const response=await user.upload(state.environment),before=await user.snapshot(),cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('object-write-response-lost',{status:response.status,before,after,puts:state.puts,failures,cleanupErrors});
  expect(failures).toBe(1);expect(response.status).toBeGreaterThanOrEqual(500);expect(before.pointer).toBe(user.oldKey);expect(before.pointerExists).toBe(true);expect(after.pointer).toBe(user.oldKey);cleanCurrent(after);
 });

 it('keeps the old photo when R2 rejects a write before storing any bytes',async()=>{
  const user=await fixture();let failures=0;
  const state=instrument({beforePut:()=>{if(failures++===0)throw Error('Isolated R2 failure before object write');}});
  const response=await user.upload(state.environment),before=await user.snapshot(),cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('object-write-failure-before-storage',{status:response.status,before,after,puts:state.puts,failures,cleanupErrors});
  expect(failures).toBe(1);expect(response.status).toBeGreaterThanOrEqual(500);expect(before.pointer).toBe(user.oldKey);expect(before.pointerExists).toBe(true);expect(after.pointer).toBe(user.oldKey);cleanCurrent(after);
 });

 it('records an active recoverable object before starting any R2 write',async()=>{
  const user=await fixture();let durableBeforePut=false;
  const state=instrument({beforePut:async key=>{
   const row=await env.DB.prepare('SELECT object_key,user_id,expected_key,state,expires_at FROM profile_photo_objects WHERE object_key=?').bind(key).first<{object_key:string;user_id:string;expected_key:string;state:string;expires_at:number}>();
   expect(row).toMatchObject({object_key:key,user_id:user.id,expected_key:user.oldKey,state:'active'});expect(row!.expires_at).toBeGreaterThan(now());durableBeforePut=true;
  }});
  const response=await user.upload(state.environment),before=await user.snapshot(),cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('durable-record-before-object-write',{status:response.status,before,after,durableBeforePut,puts:state.puts,cleanupErrors});
  expect(durableBeforePut).toBe(true);expect(response.status).toBe(200);expect(before.pointer).toBe(state.puts[0]);expect(before.pointerExists).toBe(true);cleanCurrent(after);
 });

 it('does not write an R2 object when creating its durable record fails',async()=>{
  const user=await fixture();let failures=0;
  const state=instrument({beforeSql:call=>{if(/INSERT\s+INTO\s+profile_photo_objects\b/i.test(call.sql)&&failures++===0)throw Error('Isolated initial durable-record failure');}});
  const response=await user.upload(state.environment),before=await user.snapshot(),cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('durable-record-write-failure',{status:response.status,before,after,puts:state.puts,failures,cleanupErrors});
  expect(failures).toBeGreaterThan(0);expect(response.status).toBeGreaterThanOrEqual(500);expect(state.puts).toEqual([]);expect(before.pointer).toBe(user.oldKey);expect(before.pointerExists).toBe(true);expect(after.pointer).toBe(user.oldKey);cleanCurrent(after);
 });

 it('retains a retired tombstone so a late R2 write can be cleaned again',async()=>{
  const user=await fixture();let failures=0;
  const state=instrument({afterPut:()=>{if(failures++===0)throw Error('Isolated uncertain R2 completion');}});
  const response=await user.upload(state.environment),before=await user.snapshot();await cleanup(state.environment);
  const key=state.puts[0],retiredBefore=await env.DB.prepare('SELECT state FROM profile_photo_objects WHERE object_key=?').bind(key).first<{state:string}>();
  expect(retiredBefore?.state).toBe('retired');expect(await env.FILES.head(key)).toBeNull();
  // Model the original provider write completing after the cancellation/delete.
  await env.FILES.put(key,png(),{httpMetadata:{contentType:'image/png'}});expect(await env.FILES.head(key)).not.toBeNull();
  const cleanupErrors=await cleanup(state.environment),after=await user.snapshot(),retiredAfter=await env.DB.prepare('SELECT state FROM profile_photo_objects WHERE object_key=?').bind(key).first<{state:string}>();
  evidence('late-object-write-after-retirement',{status:response.status,before,after,puts:state.puts,retiredBefore,retiredAfter,cleanupErrors});
  expect(response.status).toBeGreaterThanOrEqual(500);expect(before.pointer).toBe(user.oldKey);expect(before.pointerExists).toBe(true);expect(retiredAfter?.state).toBe('retired');expect(after.pointer).toBe(user.oldKey);cleanCurrent(after);
 });

 it('does not publish a new photo after its sign-in session is revoked during storage',async()=>{
  const user=await fixture();let revocations=0;
  const state=instrument({afterPut:async()=>{revocations++;await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(user.session)).run();}});
  const response=await user.upload(state.environment),before=await user.snapshot(),cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('session-revoked-during-save',{status:response.status,before,after,puts:state.puts,revocations,cleanupErrors});
  expect(revocations).toBe(1);expect(response.status).toBe(401);expect(before.pointer).toBe(user.oldKey);expect(before.pointerExists).toBe(true);expect(after.pointer).toBe(user.oldKey);cleanCurrent(after);
 });

 it('keeps the currently referenced photo across repeated scheduled cleanup passes',async()=>{
  const user=await fixture(),state=instrument(),response=await user.upload(state.environment);
  expect(response.status).toBe(200);const before=await user.snapshot(),key=before.pointer;expect(key).toBe(state.puts[0]);expect(before.pointerExists).toBe(true);
  for(let round=0;round<3;round++){await cleanup(state.environment);const current=await user.snapshot();expect(current.pointer).toBe(key);cleanCurrent(current);}
  const row=await env.DB.prepare('SELECT state FROM profile_photo_objects WHERE object_key=?').bind(key).first<{state:string}>();
  evidence('current-photo-retained',{status:response.status,after:await user.snapshot(),state:row?.state,deletes:state.deletes});
  expect(row?.state).toBe('current');expect(state.deletes).not.toContain(key);
 });

 it('prevents a paused PUT from publishing after scheduled cleanup retires its expired record',async()=>{
  const user=await fixture(),reached=deferred<string>(),release=deferred(),abort=new AbortController();
  const state=instrument({beforePut:async key=>{reached.resolve(key);await release.promise;}}),saving=user.upload(state.environment,abort.signal);let response:Response|undefined,key:string|undefined,retired:string|undefined;
  try{
   key=await within(Promise.race([reached.promise,saving.then(()=>{throw Error('The save finished before its paused R2 write.');})]),'the paused R2 write');
   await cleanup(state.environment);
   retired=(await env.DB.prepare('SELECT state FROM profile_photo_objects WHERE object_key=?').bind(key).first<{state:string}>())?.state;
   expect(retired).toBe('retired');expect(await env.FILES.head(key)).toBeNull();
   release.resolve();response=await within(saving,'the expired save');
  }finally{release.resolve();abort.abort();await Promise.allSettled([saving]);}
  const before=await user.snapshot(),cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('paused-object-write-expired-and-fenced',{status:response!.status,before,after,puts:state.puts,retired,cleanupErrors});
  expect(response!.status).toBe(408);expect(before.pointer).toBe(user.oldKey);expect(before.pointerExists).toBe(true);expect(after.pointer).toBe(user.oldKey);cleanCurrent(after);
 },15000);

 it('prevents a ready upload from committing after scheduled cleanup fences its expired record',async()=>{
  const user=await fixture(),reached=deferred(),release=deferred(),abort=new AbortController();let paused=false;
  const state=instrument({beforeSql:async call=>{if(photoUpdate(call)&&!paused){paused=true;reached.resolve();await release.promise;}}}),saving=user.upload(state.environment,abort.signal);let response:Response|undefined,key:string|undefined,fencedState:string|undefined;
  try{
   await within(Promise.race([reached.promise,saving.then(()=>{throw Error('The save finished before its paused pointer commit.');})]),'the ready pointer commit');key=state.puts[0];
   expect((await env.DB.prepare('SELECT state FROM profile_photo_objects WHERE object_key=?').bind(key).first<{state:string}>())?.state).toBe('ready');expect(await env.FILES.head(key)).not.toBeNull();
   await cleanup(state.environment);
   fencedState=(await env.DB.prepare('SELECT state FROM profile_photo_objects WHERE object_key=?').bind(key).first<{state:string}>())?.state;
   expect(fencedState).not.toBe('ready');expect(await env.FILES.head(key)).toBeNull();
   release.resolve();response=await within(saving,'the fenced pointer commit');
  }finally{release.resolve();abort.abort();await Promise.allSettled([saving]);}
  const before=await user.snapshot(),cleanupErrors=await cleanup(state.environment),after=await user.snapshot();
  evidence('ready-pointer-commit-expired-and-fenced',{status:response!.status,before,after,puts:state.puts,fencedState:fencedState||'removed',cleanupErrors});
  expect(response!.status).toBe(409);expect(before.pointer).toBe(user.oldKey);expect(before.pointerExists).toBe(true);expect(after.pointer).toBe(user.oldKey);cleanCurrent(after);
 },15000);

 it('never deletes a displaced photo that another account still references',async()=>{
  const user=await fixture(),other=await fixture();
  await env.DB.prepare('UPDATE users SET photo_key=? WHERE id=?').bind(user.oldKey,other.id).run();
  // Keep the other fixture's original object out of this shared-reference case.
  await env.FILES.delete(other.oldKey);
  const state=instrument(),response=await user.upload(state.environment);await cleanup(state.environment);
  const current=await user.snapshot(),shared=await other.snapshot();
  evidence('shared-reference-retained',{status:response.status,current,shared,deletes:state.deletes});
  expect(response.status).toBe(200);expect(current.pointer).toBe(state.puts[0]);expect(current.pointerExists).toBe(true);expect(shared.pointer).toBe(user.oldKey);expect(shared.pointerExists).toBe(true);expect(state.deletes).not.toContain(user.oldKey);
 });
});
