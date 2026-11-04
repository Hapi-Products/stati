import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {createScheduledController,env} from 'cloudflare:test';
import {cleanupProfilePhotos} from '../src/server/profile-photo-storage';
import {hash,now,token} from '../src/server/core';
import worker from '../src/server/index';
import samples from './fixtures/profile-photos.json';

// These stress/fault fixtures use only Vitest's isolated local D1/R2 bindings.
const objects=new Set<string>(),users=new Set<string>(),devices=new Set<string>();
const png=()=>Uint8Array.from(atob(samples.fixtures.find(sample=>sample.extension==='png')!.base64),character=>character.charCodeAt(0));
beforeEach(async()=>{
 // Other local suites deliberately retain tombstones. Reset only cleanup
 // ledgers here so the bounded-batch tests have an exact eligible population.
 await env.DB.batch([env.DB.prepare('DELETE FROM profile_photo_objects'),env.DB.prepare('DELETE FROM upload_attempts')]);
});
afterEach(async()=>{
 if(objects.size){const keys=JSON.stringify([...objects]);await env.FILES.delete([...objects]);await env.DB.batch([
  env.DB.prepare('DELETE FROM profile_photo_objects WHERE object_key IN (SELECT value FROM json_each(?))').bind(keys),
  env.DB.prepare('DELETE FROM upload_attempts WHERE object_key IN (SELECT value FROM json_each(?))').bind(keys),
  env.DB.prepare('DELETE FROM transfers WHERE object_key IN (SELECT value FROM json_each(?))').bind(keys),
 ]);}
 if(devices.size){const ids=JSON.stringify([...devices]);await env.DB.batch([env.DB.prepare('DELETE FROM receivers WHERE device_id IN (SELECT value FROM json_each(?))').bind(ids),env.DB.prepare('DELETE FROM devices WHERE id IN (SELECT value FROM json_each(?))').bind(ids)]);}
 if(users.size)await env.DB.prepare('DELETE FROM users WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...users])).run();
 objects.clear();users.clear();devices.clear();
});
type Query={sql:string;parameters:unknown[];method:string};
type Hooks={beforeQuery?:(query:Query)=>Promise<void>|void;afterQuery?:(query:Query)=>Promise<void>|void;beforeDelete?:(keys:string[])=>Promise<void>|void;afterDelete?:(keys:string[])=>Promise<void>|void};
function instrument(hooks:Hooks={}){
 const queries:Query[]=[],deletes:string[][]=[],statements=new WeakMap<object,{statement:D1PreparedStatement;sql:string;parameters:unknown[]}>();
 function statement(target:D1PreparedStatement,sql:string,parameters:unknown[]=[]):D1PreparedStatement{
  const proxy=new Proxy(target,{get(target,property){
   if(property==='bind')return(...values:unknown[])=>statement(target.bind(...values),sql,values);
   if(['run','first','all','raw'].includes(String(property)))return async(...arguments_:unknown[])=>{const query={sql,parameters,method:String(property)};queries.push(query);await hooks.beforeQuery?.(query);const result=await Reflect.apply(Reflect.get(target,property),target,arguments_);await hooks.afterQuery?.(query);return result;};
   const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});statements.set(proxy,{statement:target,sql,parameters});return proxy;
 }
 function database(source:D1Database):D1Database{return new Proxy(source,{get(target,property){
  if(property==='prepare')return(sql:string)=>statement(target.prepare(sql),sql);
  if(property==='batch')return async(values:D1PreparedStatement[])=>{const metadata=values.map(value=>statements.get(value));if(metadata.some(entry=>!entry))throw Error('The query-budget check received an untracked D1 statement.');for(const entry of metadata)if(entry){const query={sql:entry.sql,parameters:entry.parameters,method:'batch'};queries.push(query);await hooks.beforeQuery?.(query);}const result=await target.batch(metadata.map(entry=>entry!.statement));for(const entry of metadata)if(entry)await hooks.afterQuery?.({sql:entry.sql,parameters:entry.parameters,method:'batch'});return result;};
  if(property==='withSession')return(...arguments_:unknown[])=>database(Reflect.apply(Reflect.get(target,property),target,arguments_));
  if(property==='exec')return()=>{throw Error('D1.exec cannot bypass the query-budget counter. Use counted prepared statements.');};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});}
 const files=new Proxy(env.FILES,{get(target,property){
  if(property==='delete')return async(value:string|string[])=>{const keys=Array.isArray(value)?value:[value];deletes.push([...keys]);await hooks.beforeDelete?.(keys);await target.delete(value);await hooks.afterDelete?.(keys);};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 return {environment:{...env,DB:database(env.DB),FILES:files},queries,deletes};
}
async function person(status='active'){
 const id=crypto.randomUUID();users.add(id);await env.DB.prepare('INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,?,?,?,?,?)').bind(id,'Isolated','T','member',status,now()).run();return id;
}
type State='active'|'ready'|'current'|'cleanup'|'retired';
async function photoObjects(userId:string,count:number,state:State='cleanup'){
 const keys=Array.from({length:count},()=>`profiles/${userId}/${crypto.randomUUID()}`),bytes=png();
 for(let offset=0;offset<keys.length;offset+=20)await Promise.all(keys.slice(offset,offset+20).map(async key=>{objects.add(key);await env.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'}});}));
 for(let offset=0;offset<keys.length;offset+=25)await env.DB.batch(keys.slice(offset,offset+25).map(key=>env.DB.prepare('INSERT INTO profile_photo_objects(object_key,user_id,expected_key,state,expires_at,updated_at) VALUES(?,?,NULL,?,?,?)').bind(key,userId,state,now()-1,now()-1000000)));
 return keys;
}
async function rows(keys:string[]){return (await env.DB.prepare('SELECT object_key,state FROM profile_photo_objects WHERE object_key IN (SELECT value FROM json_each(?)) ORDER BY object_key').bind(JSON.stringify(keys)).all<{object_key:string;state:State}>()).results;}
async function existing(keys:string[]){const result:string[]=[];for(let offset=0;offset<keys.length;offset+=20)await Promise.all(keys.slice(offset,offset+20).map(async key=>{if(await env.FILES.head(key))result.push(key);}));return result.sort();}
const fence=(query:Query)=>/UPDATE\s+profile_photo_objects\s+SET[\s\S]*?\bstate\s*=/i.test(query.sql);

describe('Bounded profile photo cleanup',()=>{
 it('cleans100 eligible objects in one R2 batch and at most8 D1 statements',async()=>{
  const owner=await person(),settled=await photoObjects(owner,90),retired=await photoObjects(owner,10,'retired'),keys=[...settled,...retired],state=instrument();
  const result=await cleanupProfilePhotos(state.environment);
  expect(result).toEqual({failed:0,attempted:100});expect(state.queries.length).toBeLessThanOrEqual(8);expect(state.deletes).toHaveLength(1);expect(state.deletes[0].sort()).toEqual([...keys].sort());expect(await existing(keys)).toEqual([]);
  expect(await rows(settled)).toEqual([]);expect((await rows(retired)).map(row=>row.state)).toEqual(Array(10).fill('retired'));
  console.info('PHOTO_CLEANUP_QUERY_BUDGET '+JSON.stringify({profiles:100,d1Statements:state.queries.length,r2DeleteCalls:state.deletes.length}));
 });

 it('protects current and removed-account references and repairs only settled referenced rows',async()=>{
  const active=await person(),removed=await person('removed'),repairOwner=await person('removed'),retiredOwner=await person('removed');
  const [activeKey]=await photoObjects(active,1,'current'),[removedKey]=await photoObjects(removed,1,'current'),[repairKey]=await photoObjects(repairOwner,1),[retiredKey]=await photoObjects(retiredOwner,1,'retired'),[unused]=await photoObjects(active,1);
  await env.DB.batch([[active,activeKey],[removed,removedKey],[repairOwner,repairKey],[retiredOwner,retiredKey]].map(([id,key])=>env.DB.prepare('UPDATE users SET photo_key=? WHERE id=?').bind(key,id)));
  const state=instrument(),result=await cleanupProfilePhotos(state.environment),kept=[activeKey,removedKey,repairKey,retiredKey];
  expect(result.failed).toBe(0);expect(state.queries.length).toBeLessThanOrEqual(8);expect(await existing(kept)).toEqual([...kept].sort());expect(await env.FILES.head(unused)).toBeNull();expect(state.deletes.flat()).toEqual([unused]);
  const states=new Map((await rows(kept)).map(row=>[row.object_key,row.state]));expect(states.get(activeKey)).toBe('current');expect(states.get(removedKey)).toBe('current');expect(states.get(repairKey)).toBe('current');expect(states.get(retiredKey)).toBe('retired');
 });

 it('retains retired records and removes an unknown late write on a later run',async()=>{
  const owner=await person(),[key]=await photoObjects(owner,1,'active'),state=instrument();
  expect((await cleanupProfilePhotos(state.environment)).failed).toBe(0);expect(await rows([key])).toEqual([{object_key:key,state:'retired'}]);expect(await env.FILES.head(key)).toBeNull();
  await env.FILES.put(key,png(),{httpMetadata:{contentType:'image/png'}});expect(await env.FILES.head(key)).not.toBeNull();
  const later=instrument();expect((await cleanupProfilePhotos(later.environment,now()+86400)).failed).toBe(0);expect(later.queries.length).toBeLessThanOrEqual(8);expect(await env.FILES.head(key)).toBeNull();expect(await rows([key])).toEqual([{object_key:key,state:'retired'}]);
 });

 it('retains every ledger record when R2 rejects the batch and completes on retry',async()=>{
  const owner=await person(),keys=await photoObjects(owner,100);let failures=0;
  const state=instrument({beforeDelete:()=>{if(failures++===0)throw Error('Isolated R2 batch deletion failure');}}),result=await cleanupProfilePhotos(state.environment);
  expect(result).toEqual({failed:100,attempted:100});expect((await rows(keys))).toHaveLength(100);expect(await existing(keys)).toEqual([...keys].sort());expect(state.queries.length).toBeLessThanOrEqual(8);
  const retry=instrument();expect(await cleanupProfilePhotos(retry.environment)).toEqual({failed:0,attempted:100});expect(await rows(keys)).toEqual([]);expect(await existing(keys)).toEqual([]);expect(retry.queries.length).toBeLessThanOrEqual(8);
 });

 it('retains tracking when R2 deletes the bytes but loses the batch response',async()=>{
  const owner=await person(),keys=await photoObjects(owner,100);let failures=0;
  const state=instrument({afterDelete:()=>{if(failures++===0)throw Error('Isolated R2 batch response lost');}}),result=await cleanupProfilePhotos(state.environment);
  expect(result).toEqual({failed:100,attempted:100});expect((await rows(keys))).toHaveLength(100);expect(await existing(keys)).toEqual([]);
  const retry=instrument();expect((await cleanupProfilePhotos(retry.environment)).failed).toBe(0);expect(await rows(keys)).toEqual([]);expect(retry.queries.length).toBeLessThanOrEqual(8);
 });

 it('preserves ledger and bytes when the reference read fails',async()=>{
  const owner=await person(),keys=await photoObjects(owner,100);let failures=0;
  const state=instrument({beforeQuery:query=>{if(/SELECT\s+DISTINCT\s+photo_key\s+FROM\s+users/i.test(query.sql)&&failures++===0)throw Error('Isolated reference lookup outage');}}),result=await cleanupProfilePhotos(state.environment);
  expect(failures).toBe(1);expect(result).toEqual({failed:100,attempted:100});expect(state.deletes).toEqual([]);expect((await rows(keys))).toHaveLength(100);expect(await existing(keys)).toEqual([...keys].sort());
  const retry=instrument();expect((await cleanupProfilePhotos(retry.environment)).failed).toBe(0);expect(await rows(keys)).toEqual([]);expect(await existing(keys)).toEqual([]);
 });

 it('preserves tracking when D1 finalization fails after object deletion',async()=>{
  const owner=await person(),keys=await photoObjects(owner,100);let failures=0;
  const state=instrument({beforeQuery:query=>{if(/DELETE\s+FROM\s+profile_photo_objects/i.test(query.sql)&&failures++===0)throw Error('Isolated ledger finalization failure');}}),result=await cleanupProfilePhotos(state.environment);
  expect(failures).toBe(1);expect(result).toEqual({failed:100,attempted:100});expect((await rows(keys))).toHaveLength(100);expect(await existing(keys)).toEqual([]);
  const retry=instrument();expect((await cleanupProfilePhotos(retry.environment)).failed).toBe(0);expect(await rows(keys)).toEqual([]);expect(retry.queries.length).toBeLessThanOrEqual(8);
 });

 it('keeps a newly referenced current row out of the atomic cleanup fence',async()=>{
  const owner=await person(),[key]=await photoObjects(owner,1,'current');let injected=false,stateAfterFence:string|undefined;
  const state=instrument({
   beforeQuery:async query=>{if(fence(query)&&!injected){injected=true;await env.DB.prepare('UPDATE users SET photo_key=? WHERE id=?').bind(key,owner).run();}},
   afterQuery:async query=>{if(fence(query))stateAfterFence=(await rows([key]))[0]?.state;},
  }),result=await cleanupProfilePhotos(state.environment);
  expect(injected).toBe(true);expect(stateAfterFence).toBe('current');expect(result.failed).toBe(0);expect(state.deletes).toEqual([]);expect(await env.FILES.head(key)).not.toBeNull();expect(await rows([key])).toEqual([{object_key:key,state:'current'}]);
 });

 it('keeps a full scheduled cleanup of500 transfers,100 attempts and100 photos below50 D1 statements',async()=>{
  const owner=await person(),profileKeys=await photoObjects(owner,100),device=crypto.randomUUID(),receiver=crypto.randomUUID();devices.add(device);
  await env.DB.batch([
   env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(device,await hash(token()),'Isolated cleanup fixture',owner,now(),now()+3600,now()),
   env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiver,device,await hash(token()),now()+3600,now()),
  ]);
  const transfers=Array.from({length:500},()=>crypto.randomUUID()),attempts=Array.from({length:100},()=>({id:crypto.randomUUID(),transfer:crypto.randomUUID()})),transferKeys=transfers.map(id=>'transfers/'+id),attemptKeys=attempts.map(item=>'transfers/'+item.transfer),payload=new Uint8Array([120]);
  for(let offset=0;offset<transferKeys.length+attemptKeys.length;offset+=20)await Promise.all([...transferKeys,...attemptKeys].slice(offset,offset+20).map(async key=>{objects.add(key);await env.FILES.put(key,payload);}));
  for(let offset=0;offset<transfers.length;offset+=25)await env.DB.batch(transfers.slice(offset,offset+25).map(id=>env.DB.prepare('INSERT INTO transfers(id,receiver_id,device_id,sender_id,filename,bytes,content_type,object_key,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,receiver,device,owner,'isolated.txt',1,'text/plain','transfers/'+id,'queued',now()-1100000,now()-1000000)));
  for(let offset=0;offset<attempts.length;offset+=25)await env.DB.batch(attempts.slice(offset,offset+25).map(item=>env.DB.prepare('INSERT INTO upload_attempts(id,object_key,transfer_id,state,expires_at,updated_at) VALUES(?,?,?,\'cleanup\',?,?)').bind(item.id,'transfers/'+item.transfer,item.transfer,now()-1,now()-1000000)));
  const state=instrument();await worker.scheduled(createScheduledController(),state.environment);
  expect(state.queries.length).toBeLessThanOrEqual(50);expect(await existing([...profileKeys,...transferKeys,...attemptKeys])).toEqual([]);expect(await rows(profileKeys)).toEqual([]);
  expect((await env.DB.prepare('SELECT id FROM transfers WHERE device_id=?').bind(device).all()).results).toEqual([]);expect((await env.DB.prepare('SELECT id FROM upload_attempts WHERE object_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(attemptKeys)).all()).results).toEqual([]);
  console.info('FULL_CLEANUP_QUERY_BUDGET '+JSON.stringify({transfers:500,attempts:100,profiles:100,d1Statements:state.queries.length,r2DeleteCalls:state.deletes.length}));
 },20000);
});
