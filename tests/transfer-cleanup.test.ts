import {afterEach,describe,expect,it} from 'vitest';
import {env} from 'cloudflare:test';
import {now} from '../src/server/core';
import {cleanupTransfers} from '../src/server/transfer-cleanup';
const keys:string[]=[],fixtureUsers:string[]=[],fixtureDevices:string[]=[],fixtureReceivers:string[]=[],fixtureTransfers:string[]=[];
afterEach(async()=>{
 if(keys.length)await env.FILES.delete(keys.splice(0));
 for(const [table,ids] of [['transfers',fixtureTransfers],['receivers',fixtureReceivers],['devices',fixtureDevices],['users',fixtureUsers]] as const){
  if(ids.length)await env.DB.prepare(`DELETE FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids.splice(0))).run();
 }
});
async function seed(count:number,status='queued',expires=now()-1){
 const user=crypto.randomUUID(),device=crypto.randomUUID(),receiver=crypto.randomUUID();
 fixtureUsers.push(user);fixtureDevices.push(device);fixtureReceivers.push(receiver);
 await env.DB.batch([
  env.DB.prepare('INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,?,?,?,?,?)').bind(user,'Local cleanup fixture','T','member','active',now()),
  env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires) VALUES(?,?,?,?,?,?)').bind(device,crypto.randomUUID(),'Local cleanup fixture',user,now(),now()+1000),
  env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiver,device,crypto.randomUUID(),now()+1000,now()),
 ]);
 const rows=Array.from({length:count},()=>{const id=crypto.randomUUID();return{id,key:'transfers/'+id};});keys.push(...rows.map(row=>row.key));fixtureTransfers.push(...rows.map(row=>row.id));
 await env.DB.batch(rows.map(row=>env.DB.prepare('INSERT INTO transfers(id,receiver_id,device_id,sender_id,filename,bytes,content_type,object_key,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(row.id,receiver,device,user,'Local fixture.txt',1,'text/plain',row.key,status,now(),expires)));
 for(let offset=0;offset<rows.length;offset+=16)await Promise.all(rows.slice(offset,offset+16).map(row=>env.FILES.put(row.key,'x')));
 return rows;
}
function countedDb(){let queries=0;const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>new Proxy(statement,{get(target,property){if(property==='bind')return(...values:unknown[])=>wrap(target.bind(...values));const value=Reflect.get(target,property);if(['all','first','run','raw'].includes(String(property)))return(...args:unknown[])=>{queries++;return value.apply(target,args);};return typeof value==='function'?value.bind(target):value;}});return {db:new Proxy(env.DB,{get(target,property){if(property==='prepare')return(sql:string)=>wrap(target.prepare(sql));const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}}),count:()=>queries};}

describe('Bounded bulk transfer cleanup',()=>{
 it('cleans a full 500-file batch with a small fixed D1 query count and leaves overflow for the next pass',async()=>{
  const rows=await seed(501),counter=countedDb(),result=await cleanupTransfers({...env,DB:counter.db});expect(result).toEqual({failed:0,attempted:500});expect(counter.count()).toBeLessThanOrEqual(5);
  const remaining=await env.DB.prepare('SELECT id,object_key FROM transfers').all<{id:string;object_key:string}>();expect(remaining.results).toHaveLength(1);expect(await env.FILES.head(remaining.results[0].object_key)).not.toBeNull();expect(await env.FILES.head(rows.find(row=>row.id!==remaining.results[0].id)!.key)).toBeNull();
  expect(await cleanupTransfers(env)).toEqual({failed:0,attempted:1});expect((await env.DB.prepare('SELECT id FROM transfers').all()).results).toEqual([]);
 },15000);
 it('preserves fresh queued files while cleaning delivered and rejected cloud copies',async()=>{
  const [waiting]=await seed(1,'queued',now()+1000),[delivered]=await seed(1,'delivered',now()+1000),[rejected]=await seed(1,'rejected',now()+1000);expect(await cleanupTransfers(env)).toEqual({failed:0,attempted:2});expect(await env.FILES.head(waiting.key)).not.toBeNull();for(const row of [delivered,rejected])expect(await env.FILES.head(row.key)).toBeNull();
 });
 it('continues per-key after a failed bulk delete and keeps only the failed row for retry',async()=>{
  const rows=await seed(3),bad=rows[1].key;const files=new Proxy(env.FILES,{get(target,property){if(property==='delete')return async(value:string|string[])=>{if((Array.isArray(value)?value:[value]).includes(bad))throw Error('Local isolated deletion failure');return target.delete(value);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}}),counter=countedDb();
  expect(await cleanupTransfers({...env,DB:counter.db,FILES:files})).toEqual({failed:1,attempted:3});expect(counter.count()).toBeLessThanOrEqual(5);const remaining=await env.DB.prepare('SELECT object_key FROM transfers').all<{object_key:string}>();expect(remaining.results.map(row=>row.object_key)).toEqual([bad]);expect(await env.FILES.head(bad)).not.toBeNull();expect(await cleanupTransfers(env)).toEqual({failed:0,attempted:1});
 });
 it('keeps database rows when deletion finalization fails, then safely retries already deleted objects',async()=>{
  const rows=await seed(2);const db=new Proxy(env.DB,{get(target,property){if(property==='prepare')return(sql:string)=>{const statement=target.prepare(sql);if(!sql.startsWith('DELETE FROM transfers'))return statement;return new Proxy(statement,{get(statement,method){if(method==='bind')return(...args:unknown[])=>new Proxy(statement.bind(...args),{get(bound,key){if(key==='run')return async()=>{throw Error('Local isolated finalization failure');};const value=Reflect.get(bound,key);return typeof value==='function'?value.bind(bound):value;}});const value=Reflect.get(statement,method);return typeof value==='function'?value.bind(statement):value;}});};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  expect(await cleanupTransfers({...env,DB:db})).toEqual({failed:2,attempted:2});expect((await env.DB.prepare('SELECT id FROM transfers').all()).results).toHaveLength(2);for(const row of rows)expect(await env.FILES.head(row.key)).toBeNull();expect(await cleanupTransfers(env)).toEqual({failed:0,attempted:2});
 });
 it('uses the selected id/key pair when finalizing rows, so an externally changed pointer is preserved',async()=>{
  const [row]=await seed(1),replacement='transfers/'+crypto.randomUUID();keys.push(replacement);await env.FILES.put(replacement,'new');let changed=false;
  const files=new Proxy(env.FILES,{get(target,property){if(property==='delete')return async(value:string|string[])=>{await target.delete(value);if(!changed){changed=true;await env.DB.prepare('UPDATE transfers SET object_key=? WHERE id=?').bind(replacement,row.id).run();}};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  expect(await cleanupTransfers({...env,FILES:files})).toEqual({failed:0,attempted:1});expect((await env.DB.prepare('SELECT object_key FROM transfers WHERE id=?').bind(row.id).first<{object_key:string}>())?.object_key).toBe(replacement);expect(await env.FILES.head(replacement)).not.toBeNull();
 });
});
