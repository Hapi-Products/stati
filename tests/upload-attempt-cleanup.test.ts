import {afterEach,describe,expect,it} from 'vitest';
import {env} from 'cloudflare:test';
import {now} from '../src/server/core';
import {cleanupUploadAttempts} from '../src/server/upload-intents';

// These are isolated local D1/R2 fixtures. No real account, upload or network.
type Attempt={id:string;key:string;transferId:string;state:string;expiresAt:number};
const owned=new Set<string>(),ownedAttempts=new Set<string>();
afterEach(async()=>{if(ownedAttempts.size)await env.DB.prepare('DELETE FROM upload_attempts WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...ownedAttempts])).run();ownedAttempts.clear();if(owned.size)await env.FILES.delete([...owned]);owned.clear();});
async function attempt(state='cleanup',expiresAt=now()-1,updatedAt=now()-100){
 const row={id:crypto.randomUUID(),key:'transfers/'+crypto.randomUUID(),transferId:crypto.randomUUID(),state,expiresAt};
 ownedAttempts.add(row.id);owned.add(row.key);
 await env.DB.prepare('INSERT INTO upload_attempts VALUES(?,?,?,?,?,?)').bind(row.id,row.key,row.transferId,state,expiresAt,updatedAt).run();
 await env.FILES.put(row.key,'Isolated bulk cleanup fixture');return row;
}
async function ledger(row:Attempt){return env.DB.prepare('SELECT state FROM upload_attempts WHERE id=?').bind(row.id).first<{state:string}>();}
async function referenced(row:Attempt,kind:'transfer'|'receipt'){
 const user=crypto.randomUUID(),device=crypto.randomUUID(),receiver=crypto.randomUUID(),time=now();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,?,?,'active','member',?)").bind(user,'Isolated','T',time),
  env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(device,crypto.randomUUID(),'Isolated cleanup fixture',user,time,time+1000,time),
  env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiver,device,crypto.randomUUID(),time+1000,time),
 ]);
 if(kind==='transfer')await env.DB.prepare('INSERT INTO transfers(id,receiver_id,device_id,sender_id,filename,bytes,content_type,object_key,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(row.transferId,receiver,device,user,'isolated.txt',1,'text/plain',row.key,time,time+1000).run();
 else await env.DB.batch([
  env.DB.prepare('INSERT INTO delivery_records(id,device_id,sender_id,filename,bytes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(row.transferId,device,user,'isolated.txt',1,'delivered',time,time),
  env.DB.prepare('INSERT INTO upload_intents(sender_id,device_id,intent_id,filename,bytes,sha256,transfer_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(user,device,crypto.randomUUID(),'isolated.txt',1,'0'.repeat(64),row.transferId,time,time+1000),
 ]);
}
function instrument({beforeSql,afterSql,remove}:{beforeSql?:(sql:string)=>Promise<void>|void;afterSql?:(sql:string)=>Promise<void>|void;remove?:(keys:string[])=>Promise<void>}={}){
 const queries:{sql:string;parameters:unknown[]}[]=[],deletes:string[][]=[];
 function statement(source:D1PreparedStatement,sql:string,parameters:unknown[]=[]):D1PreparedStatement{
  return new Proxy(source,{get(target,property){
   if(property==='bind')return(...values:unknown[])=>statement(target.bind(...values),sql,values);
   if(['run','first','all','raw'].includes(String(property)))return async(...args:unknown[])=>{queries.push({sql,parameters});await beforeSql?.(sql);const result=await Reflect.apply(Reflect.get(target,property),target,args);await afterSql?.(sql);return result;};
   const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
 }
 const DB=new Proxy(env.DB,{get(target,property){
  if(property==='prepare')return(sql:string)=>statement(target.prepare(sql),sql);
  if(property==='batch')return async(statements:D1PreparedStatement[])=>{for(const _statement of statements)queries.push({sql:'batch statement',parameters:[]});return target.batch(statements);};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 const FILES=new Proxy(env.FILES,{get(target,property){
  if(property==='delete')return async(key:string|string[])=>{const keys=typeof key==='string'?[key]:key;deletes.push(keys);if(remove)await remove(keys);else await target.delete(key);};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 return {environment:{...env,DB,FILES},queries,deletes};
}

describe('bounded bulk upload-attempt cleanup',()=>{
 it('fences and removes100 objects in constant D1 queries and leaves the next bounded batch',async()=>{
  const rows:Attempt[]=[];for(let index=0;index<105;index++)rows.push(await attempt('cleanup',now()-1,now()-1000+index));
  const checked=instrument(),result=await cleanupUploadAttempts(checked.environment);
  expect(result).toEqual({failed:0,attempted:100});expect(checked.queries.length).toBeLessThanOrEqual(8);expect(Math.max(...checked.queries.map(query=>query.parameters.length))).toBeLessThanOrEqual(2);expect(checked.deletes).toHaveLength(1);expect(checked.deletes[0]).toHaveLength(100);
  const remaining=await env.DB.prepare('SELECT COUNT(*) AS count FROM upload_attempts').first<{count:number}>();expect(remaining?.count).toBe(5);
  expect((await env.FILES.list({prefix:'transfers/'})).objects.map(object=>object.key).sort()).toEqual(rows.slice(100).map(row=>row.key).sort());
  const next=instrument();expect(await cleanupUploadAttempts(next.environment)).toEqual({failed:0,attempted:5});expect(next.queries.length).toBeLessThanOrEqual(8);expect((await env.FILES.list({prefix:'transfers/'})).objects).toEqual([]);
 });

 it('retains accepted bytes from transfers and durable receipts, fences unknown writes, and leaves unexpired work alone',async()=>{
  const transfer=await attempt(),receipt=await attempt(),active=await attempt('active'),ready=await attempt('ready'),retired=await attempt('retired'),settled=await attempt(),liveActive=await attempt('active',now()+1000),liveReady=await attempt('ready',now()+1000);
  await referenced(transfer,'transfer');await referenced(receipt,'receipt');
  const checked=instrument();expect(await cleanupUploadAttempts(checked.environment)).toEqual({failed:0,attempted:6});expect(checked.queries.length).toBeLessThanOrEqual(8);
  for(const row of [transfer,receipt]){expect(await env.FILES.head(row.key)).not.toBeNull();expect(await ledger(row)).toBeNull();expect(checked.deletes.flat()).not.toContain(row.key);}
  for(const row of [active,retired]){expect(await ledger(row)).toEqual({state:'retired'});expect(await env.FILES.head(row.key)).toBeNull();}
  for(const row of [ready,settled]){expect(await ledger(row)).toBeNull();expect(await env.FILES.head(row.key)).toBeNull();}
  expect(await ledger(liveActive)).toEqual({state:'active'});expect(await ledger(liveReady)).toEqual({state:'ready'});for(const row of [liveActive,liveReady])expect(await env.FILES.head(row.key)).not.toBeNull();
  expect((await env.DB.prepare("UPDATE upload_attempts SET state='ready' WHERE id=? AND state='active'").bind(active.id).run()).meta.changes).toBe(0);
 });

 it('preserves every ledger after a partially successful bulk R2 deletion and retries safely',async()=>{
  const settled=await attempt(),oldUnknown=await attempt('retired',now()-8*86400);let fail=true;
  const checked=instrument({remove:async keys=>{if(fail){await env.FILES.delete(keys[0]);throw Error('Isolated partial bulk deletion');}await env.FILES.delete(keys);}});
  expect(await cleanupUploadAttempts(checked.environment)).toEqual({failed:2,attempted:2});expect(await ledger(settled)).toEqual({state:'cleanup'});expect(await ledger(oldUnknown)).toEqual({state:'retired'});
  fail=false;expect(await cleanupUploadAttempts(checked.environment)).toEqual({failed:0,attempted:2});for(const row of [settled,oldUnknown]){expect(await ledger(row)).toBeNull();expect(await env.FILES.head(row.key)).toBeNull();}
 });

 it('does not delete objects when primary reference inspection fails after fencing',async()=>{
  const unknown=await attempt('active'),ready=await attempt('ready');let fail=true;
  const checked=instrument({beforeSql:sql=>{if(fail&&sql.includes('AS id FROM json_each(?) candidate'))throw Error('Isolated reference outage');}});
  expect(await cleanupUploadAttempts(checked.environment)).toEqual({failed:2,attempted:2});expect(checked.deletes).toEqual([]);expect(await ledger(unknown)).toEqual({state:'retired'});expect(await ledger(ready)).toEqual({state:'cleanup'});
  for(const row of [unknown,ready])expect(await env.FILES.head(row.key)).not.toBeNull();
  fail=false;expect(await cleanupUploadAttempts(checked.environment)).toEqual({failed:0,attempted:2});expect(await ledger(unknown)).toEqual({state:'retired'});expect(await ledger(ready)).toBeNull();
 });

 it('keeps accepted objects safe when deleting their redundant ledger needs a retry',async()=>{
  const accepted=await attempt(),unused=await attempt();await referenced(accepted,'receipt');let fail=true;
  const checked=instrument({beforeSql:sql=>{if(fail&&sql.includes("AND state IN ('cleanup','retired')")){fail=false;throw Error('Isolated accepted-ledger deletion failure');}}});
  expect(await cleanupUploadAttempts(checked.environment)).toEqual({failed:1,attempted:2});expect(await env.FILES.head(accepted.key)).not.toBeNull();expect(await ledger(accepted)).toEqual({state:'cleanup'});expect(await env.FILES.head(unused.key)).toBeNull();
  expect(await cleanupUploadAttempts(checked.environment)).toEqual({failed:0,attempted:1});expect(await ledger(accepted)).toBeNull();expect(await env.FILES.head(accepted.key)).not.toBeNull();expect(checked.deletes.flat()).not.toContain(accepted.key);
 });

 it('retains an unknown-write tombstone until its seven-day bound and removes a late orphan on another pass',async()=>{
  const unknown=await attempt('active'),checked=instrument();expect(await cleanupUploadAttempts(checked.environment)).toEqual({failed:0,attempted:1});expect(await ledger(unknown)).toEqual({state:'retired'});
  await env.FILES.put(unknown.key,'Isolated late unknown object');expect(await cleanupUploadAttempts(checked.environment)).toEqual({failed:0,attempted:1});expect(await ledger(unknown)).toEqual({state:'retired'});expect(await env.FILES.head(unknown.key)).toBeNull();
  expect(await cleanupUploadAttempts(checked.environment,now()+8*86400)).toEqual({failed:0,attempted:1});expect(await ledger(unknown)).toBeNull();
 });
});
