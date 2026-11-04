import {env,SELF} from 'cloudflare:test';
import {expect,it,vi} from 'vitest';
import {hash,now,token} from '../src/server/core';
import {renewConnectionPresence} from '../src/server/connection-presence';
import {OPERATOR_LEASE_PROTOCOL} from '../src/server/operator-selection';

// All identities, credentials and computers exist only in the isolated Worker
// test runtime. No deployed account or production database is written.
async function identity(status='active',role='member'){
 const id=crypto.randomUUID(),raw=token(),sessionHash=await hash(raw);
 await env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,'Presence','T',?,?,?)").bind(id,status,role,now()).run();
 await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(sessionHash,id,now()+3600).run();
 return{id,cookie:'stati_session='+raw,sessionHash};
}
type Identity=Awaited<ReturnType<typeof identity>>;
async function computer(owner?:Identity){
 owner=owner||await identity();const id=crypto.randomUUID(),receiverId=crypto.randomUUID(),credential=token();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(id,await hash(credential),'Isolated presence PC',owner.id,now(),now()+600,now()),
  env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiverId,id,await hash(token()),now()+300,now())
 ]);
 return{id,receiverId,credential,owner};
}
type Computer=Awaited<ReturnType<typeof computer>>;
const operatorLeases=new Map<string,string>();
function call(endpoint:string,{method='GET',data,cookie,bearer,selecting=false}:{method?:string;data?:unknown;cookie?:string;bearer?:string;selecting?:boolean}={}){
 return SELF.fetch('http://localhost:8787/api'+endpoint,{method,headers:{Origin:'http://localhost:8787','CF-Connecting-IP':crypto.randomUUID(),Cookie:'stati_access=isolated-test-access'+(cookie?'; '+cookie:''),...(data!==undefined?{'Content-Type':'application/json'}:{}),...(bearer?{Authorization:'Bearer '+bearer,...(selecting||operatorLeases.has(bearer)?{'X-Stati-Operator-Protocol':OPERATOR_LEASE_PROTOCOL}:{}),...(operatorLeases.has(bearer)?{'X-Stati-Operator-Lease':operatorLeases.get(bearer)!}:{})}:{})},body:data!==undefined?JSON.stringify(data):undefined});
}
async function chooseOperator(pc:Computer){const response=await call('/station/operator',{method:'POST',data:{userId:pc.owner.id},bearer:pc.credential,selecting:true});expect(response.status).toBe(200);operatorLeases.set(pc.credential,(await response.json() as {lease:string}).lease);}
async function pulse(user:Identity,deviceIds:string[]){const response=await call('/connections/presence',{method:'POST',data:{deviceIds},cookie:user.cookie});expect(response.status).toBe(200);return response.json() as Promise<{ok:boolean;renewed:number}>;}
async function connection(pc:Computer,user:Identity,status='approved',lastSeen=now()-100){const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO computer_connections VALUES(?,?,?,?,?,?,?)').bind(id,pc.receiverId,pc.id,user.id,status,lastSeen,now()-100).run();return id;}
async function membership(pc:Computer,user:Identity,status='approved'){await env.DB.prepare('INSERT INTO station_memberships(device_id,user_id,status,updated_at) VALUES(?,?,?,?)').bind(pc.id,user.id,status,now()).run();}
const state=(pc:Computer)=>call('/station/state',{bearer:pc.credential}).then(response=>response.json()) as Promise<{accessApprover:string}>;
async function waiting(pc:Computer){const member=await identity('pending'),response=await call('/connections/device:'+pc.id,{method:'POST',data:{},cookie:member.cookie});expect(response.status).toBe(200);const data=await response.json() as {connection:{id:string;status:string}};expect(data.connection.status).toBe('pending');return data.connection.id;}
async function seen(id:string){return(await env.DB.prepare('SELECT last_seen FROM computer_connections WHERE id=?').bind(id).first<{last_seen:number}>())?.last_seen;}

it('missing and empty scopes never revive historical administrator connections',async()=>{
 const user=await identity('active','admin'),a=await computer(),b=await computer(),first=await connection(a,user),second=await connection(b,user),before=now()-100;
 for(const data of [undefined,{}, {deviceIds:[]}]){const response=await call('/connections/presence',{method:'POST',data,cookie:user.cookie});expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,renewed:0});}
 expect(await seen(first)).toBe(before);expect(await seen(second)).toBe(before);expect((await state(a)).accessApprover).toBe('operator');expect((await state(b)).accessApprover).toBe('operator');
});
it('renews only the explicit station and leaves the other operator able to approve',async()=>{
 const user=await identity('active','admin'),a=await computer(),b=await computer(),first=await connection(a,user),second=await connection(b,user),request=await waiting(b);await chooseOperator(b);
 expect(await pulse(user,[a.id,a.id.toUpperCase()])).toEqual({ok:true,renewed:1});expect(await seen(first)).toBe(now());expect(await seen(second)).toBe(now()-100);
 expect((await state(a)).accessApprover).toBe('admin');expect((await state(b)).accessApprover).toBe('operator');
 expect((await call('/station/connections/'+request+'/decision',{method:'POST',data:{status:'approved'},bearer:b.credential})).status).toBe(200);
});
it('independent tab selections are additive and naturally expire at exactly 45 seconds',async()=>{
 const user=await identity('active','admin'),a=await computer(),b=await computer();await pulse(user,[a.id]);await pulse(user,[b.id]);
 expect((await state(a)).accessApprover).toBe('admin');expect((await state(b)).accessApprover).toBe('admin');
 vi.setSystemTime(new Date((now()+45)*1000));expect((await state(a)).accessApprover).toBe('operator');expect((await state(b)).accessApprover).toBe('operator');
});
it('rebinds an active administrator to the current lease after receiver rotation',async()=>{
 const user=await identity('active','admin'),pc=await computer(),old=await connection(pc,user);await chooseOperator(pc);
 const next=await call('/station/receiver',{method:'POST',data:{},bearer:pc.credential});expect(next.status).toBe(200);const receiver=await next.json() as {id:string};
 expect(await pulse(user,[pc.id])).toEqual({ok:true,renewed:1});expect(await seen(old)).toBe(now()-100);
 const current=await env.DB.prepare('SELECT status,last_seen FROM computer_connections WHERE receiver_id=? AND user_id=?').bind(receiver.id,user.id).first();expect(current).toEqual({status:'approved',last_seen:now()});
 const request=await waiting(pc);expect((await state(pc)).accessApprover).toBe('admin');expect((await call('/station/connections/'+request+'/decision',{method:'POST',data:{status:'approved'},bearer:pc.credential})).status).toBe(403);
 const inbox=await(await call('/connections/pending',{cookie:user.cookie})).json() as {id:string}[];expect(inbox.some(row=>row.id===request)).toBe(true);
 expect((await call('/connections/'+request+'/decision',{method:'POST',data:{status:'approved'},cookie:user.cookie})).status).toBe(200);
});
it('GET status, receiver lists and approval inbox do not refresh administrator authority',async()=>{
 const user=await identity('active','admin'),pc=await computer(),id=await connection(pc,user);
 for(const endpoint of ['/receive/device:'+pc.id,'/receivers','/devices','/connections/pending'])expect((await call(endpoint,{cookie:user.cookie})).status).toBe(200);
 expect(await seen(id)).toBe(now()-100);expect((await state(pc)).accessApprover).toBe('operator');
});
it('approved-member GET status remains approved without renewing and membership rebinds after rotation',async()=>{
 const user=await identity(),pc=await computer(),id=await connection(pc,user);await membership(pc,user);
 const info=await(await call('/receive/device:'+pc.id,{cookie:user.cookie})).json() as {connection:{status:string}};expect(info.connection.status).toBe('approved');expect(await seen(id)).toBe(now()-100);
 const next=await(await call('/station/receiver',{method:'POST',data:{},bearer:pc.credential})).json() as {id:string};expect(await pulse(user,[pc.id])).toEqual({ok:true,renewed:1});
 expect(await env.DB.prepare('SELECT status FROM computer_connections WHERE receiver_id=? AND user_id=?').bind(next.id,user.id).first()).toEqual({status:'approved'});
});
it('does not grant station approval through the service-window sending shortcut',async()=>{
 const pc=await computer();for(const status of ['active','pending']){const user=await identity(status);expect(await pulse(user,[pc.id])).toEqual({ok:true,renewed:0});expect(await env.DB.prepare('SELECT id FROM computer_connections WHERE device_id=? AND user_id=?').bind(pc.id,user.id).first()).toBeNull();}
 const pending=await identity('pending');await membership(pc,pending);expect(await pulse(pending,[pc.id])).toEqual({ok:true,renewed:1});
});
it.each(['membership denied','connection denied','both denied'])('preserves nonadministrator denials: %s',async kind=>{
 const user=await identity(),pc=await computer(),id=await connection(pc,user,kind==='membership denied'?'approved':'denied');await membership(pc,user,kind==='connection denied'?'approved':'denied');
 expect(await pulse(user,[pc.id])).toEqual({ok:true,renewed:0});expect(await seen(id)).toBe(now()-100);
 const info=await(await call('/receive/device:'+pc.id,{cookie:user.cookie})).json() as {connection:{status:string}};expect(info.connection.status).toBe('denied');
});
it('renews an existing approved connection and upgrades a newly promoted administrator pending row safely',async()=>{
 const member=await identity(),pc=await computer(),legacy=await connection(pc,member);expect(await pulse(member,[pc.id])).toEqual({ok:true,renewed:1});expect(await seen(legacy)).toBe(now());
 const promoted=await identity(),pending=await connection(pc,promoted,'pending');await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(promoted.id).run();expect(await pulse(promoted,[pc.id])).toEqual({ok:true,renewed:1});expect(await env.DB.prepare('SELECT status FROM computer_connections WHERE id=?').bind(pending).first()).toEqual({status:'approved'});
});
it.each(['revoked','offline','closed','expired','owner removed'])('does not renew an unavailable selected computer: %s',async kind=>{
 const user=await identity('active','admin'),pc=await computer(),id=await connection(pc,user);
 if(kind==='revoked')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),pc.id).run();
 if(kind==='offline')await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now()-45,pc.id).run();
 if(kind==='closed')await env.DB.prepare('UPDATE receivers SET closed_at=? WHERE id=?').bind(now(),pc.receiverId).run();
 if(kind==='expired')await env.DB.prepare('UPDATE receivers SET expires_at=? WHERE id=?').bind(now(),pc.receiverId).run();
 if(kind==='owner removed')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(pc.owner.id).run();
 expect(await pulse(user,[pc.id])).toEqual({ok:true,renewed:0});expect(await seen(id)).toBe(now()-100);
});
it('invalid input is rejected and a mixed selection only renews valid authorized live stations',async()=>{
 const user=await identity('active','admin'),pc=await computer();
 for(const data of [{deviceIds:['not-a-uuid']},{deviceIds:Array(101).fill(pc.id)},{deviceIds:'all'},{deviceId:pc.id}])expect((await call('/connections/presence',{method:'POST',data,cookie:user.cookie})).status).toBe(400);
 expect((await call('/connections/presence',{method:'POST',data:{deviceIds:[pc.id]}})).status).toBe(401);
 expect(await pulse(user,[pc.id,crypto.randomUUID()])).toEqual({ok:true,renewed:1});
});
it('handles 100 selected computers with one bounded JSON-bound statement',async()=>{
 const user=await identity('active','admin'),rows=Array.from({length:100},()=>({id:crypto.randomUUID(),receiver:crypto.randomUUID(),credential:crypto.randomUUID(),token:crypto.randomUUID()}));
 await env.DB.batch([
  env.DB.prepare("INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) SELECT json_extract(value,'$.id'),json_extract(value,'$.credential'),'Isolated bulk presence',?,?,?,? FROM json_each(?)").bind(user.id,now(),now()+600,now(),JSON.stringify(rows)),
  env.DB.prepare("INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) SELECT json_extract(value,'$.receiver'),json_extract(value,'$.id'),json_extract(value,'$.token'),?,? FROM json_each(?)").bind(now()+300,now(),JSON.stringify(rows))
 ]);
 let queries=0,parameters=0;const DB=new Proxy(env.DB,{get(target,property){if(property==='prepare')return(sql:string)=>{const statement=target.prepare(sql);return{bind(...values:unknown[]){parameters=values.length;return{async run(){queries++;return statement.bind(...values).run();}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}}) as D1Database;
 expect(await renewConnectionPresence({...env,DB},{userId:user.id,sessionHash:user.sessionHash,deviceIds:rows.map(row=>row.id)})).toEqual({ok:true,renewed:100});expect(queries).toBe(1);expect(parameters).toBeLessThanOrEqual(10);
});
it.each(['logout','session expiry','requester removed','admin demoted','owner removed','device revoked','receiver closed','membership denied'])('rechecks authority inside the write after a concurrent %s',async kind=>{
 const user=await identity('active',kind==='membership denied'?'member':'admin'),pc=await computer();if(kind==='membership denied')await membership(pc,user);
 const before=async()=>{
  if(kind==='logout')await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.sessionHash).run();
  if(kind==='session expiry')await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(now(),user.sessionHash).run();
  if(kind==='requester removed')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(user.id).run();
  if(kind==='admin demoted')await env.DB.prepare("UPDATE users SET role='member' WHERE id=?").bind(user.id).run();
  if(kind==='owner removed')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(pc.owner.id).run();
  if(kind==='device revoked')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),pc.id).run();
  if(kind==='receiver closed')await env.DB.prepare('UPDATE receivers SET closed_at=? WHERE id=?').bind(now(),pc.receiverId).run();
  if(kind==='membership denied')await env.DB.prepare("UPDATE station_memberships SET status='denied' WHERE device_id=? AND user_id=?").bind(pc.id,user.id).run();
 };
 const DB=new Proxy(env.DB,{get(target,property){if(property==='prepare')return(sql:string)=>{const statement=target.prepare(sql);return{bind(...values:unknown[]){return{async run(){await before();return statement.bind(...values).run();}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}}) as D1Database;
 expect(await renewConnectionPresence({...env,DB},{userId:user.id,sessionHash:user.sessionHash,deviceIds:[pc.id]})).toEqual({ok:true,renewed:0});expect(await env.DB.prepare('SELECT id FROM computer_connections WHERE user_id=? AND device_id=?').bind(user.id,pc.id).first()).toBeNull();
});
