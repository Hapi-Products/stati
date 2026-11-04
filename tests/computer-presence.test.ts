import {env,SELF} from 'cloudflare:test';
import {beforeEach,it,expect,vi} from 'vitest';
import {hash,now,token} from '../src/server/core';

// All identities, credentials and rows below belong to the isolated Workers test
// runtime. Requests intentionally omit the computer-passcode cookie.
beforeEach(()=>vi.setSystemTime(new Date('2026-10-12T12:00:00-07:00')));
async function member(role='member'){
 const id=crypto.randomUUID(),session=token();
 await env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,'Presence','T','active',?,?)").bind(id,role,now()).run();
 await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+3600).run();
 return{id,cookie:'stati_session='+session};
}
function call(endpoint:string,{method='GET',data,cookie,bearer}:{method?:string;data?:unknown;cookie?:string;bearer?:string}={}){
 return SELF.fetch('http://localhost:8787/api'+endpoint,{method,headers:{Origin:'http://localhost:8787','CF-Connecting-IP':crypto.randomUUID(),...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{})},body:data?JSON.stringify(data):undefined});
}
async function computer(){
 const owner=await member(),administrator=await member('admin');
 const pair=await call('/devices/pair',{method:'POST',data:{name:'Isolated presence PC'}});expect(pair.status).toBe(200);
 const device=await pair.json() as {id:string;credential:string;code:string};
 expect((await call('/devices/claim',{method:'POST',data:{code:device.code},cookie:owner.cookie})).status).toBe(200);
 return{owner,administrator,device};
}
async function list(endpoint:string,cookie:string){const response=await call(endpoint,{cookie});expect(response.status).toBe(200);return response.json() as Promise<{id:string;online?:number}[]>;}

it('a paired device heartbeat needs no profile/passcode cookie but cannot create an operator proof or online receiver without a lease',async()=>{
 const {administrator,device}=await computer();
 expect((await env.DB.prepare('SELECT last_seen FROM devices WHERE id=?').bind(device.id).first())?.last_seen).toBeNull();
 expect((await call('/station/state')).status).toBe(401);
 const response=await call('/station/state',{bearer:device.credential});expect(response.status).toBe(200);
 const state=await response.json() as {adminUnlocked:boolean;computerOnline:boolean;device:{operator_id:string|null}};
 expect(state.adminUnlocked).toBe(false);expect(state.device.operator_id).toBeNull();expect(state.computerOnline).toBe(true);
 expect((await env.DB.prepare('SELECT last_seen FROM devices WHERE id=?').bind(device.id).first())?.last_seen).toBe(now());
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM operator_sessions WHERE device_id=?').bind(device.id).first())?.count).toBe(0);
 expect(await list('/receivers',administrator.cookie)).toContainEqual(expect.objectContaining({id:device.id,online:0}));
 expect((await call('/station/receiver',{method:'POST',bearer:device.credential})).status).toBe(200);
 expect(await list('/receivers',administrator.cookie)).toContainEqual(expect.objectContaining({id:device.id,online:1}));
});

it('receiver listings require both a heartbeat newer than exactly 45 seconds and a lease later than now',async()=>{
 const {owner,administrator,device}=await computer();
 const opened=await call('/station/receiver',{method:'POST',bearer:device.credential});expect(opened.status).toBe(200);
 const lease=await opened.json() as {id:string};
 // Membership visibility itself is covered by security.test.ts; this checks the
 // additional live-presence boundary for an already approved member.
 await env.DB.prepare("INSERT INTO station_memberships VALUES(?,?,'approved',?)").bind(device.id,owner.id,now()).run();
 await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now()-44,device.id).run();
 expect(await list('/receivers',owner.cookie)).toContainEqual(expect.objectContaining({id:device.id,online:1}));
 await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now()-45,device.id).run();
 expect(await list('/receivers',owner.cookie)).not.toContainEqual(expect.objectContaining({id:device.id}));
 expect(await list('/receivers',administrator.cookie)).toContainEqual(expect.objectContaining({id:device.id,online:0}));
 expect(await list('/devices',owner.cookie)).toContainEqual(expect.objectContaining({id:device.id}));
 await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now(),device.id).run();
 await env.DB.prepare('UPDATE receivers SET expires_at=? WHERE id=?').bind(now(),lease.id).run();
 expect(await list('/receivers',owner.cookie)).not.toContainEqual(expect.objectContaining({id:device.id}));
 expect(await list('/receivers',administrator.cookie)).toContainEqual(expect.objectContaining({id:device.id,online:0}));
 await env.DB.prepare('UPDATE receivers SET expires_at=? WHERE id=?').bind(now()+1,lease.id).run();
 expect(await list('/receivers',owner.cookie)).toContainEqual(expect.objectContaining({id:device.id,online:1}));
});

it.each(['device revocation','owner removal'])('%s prevents the background device credential from renewing or reopening its receiver',async action=>{
 const {owner,administrator,device}=await computer();
 const opened=await call('/station/receiver',{method:'POST',bearer:device.credential});expect(opened.status).toBe(200);
 const lease=await opened.json() as {id:string};
 expect((await call(action==='device revocation'?'/devices/'+device.id:'/members/'+owner.id,{method:action==='device revocation'?'DELETE':'PATCH',...(action==='owner removal'?{data:{action:'remove'}}:{}),cookie:administrator.cookie})).status).toBe(200);
 const before=await env.DB.prepare('SELECT last_seen FROM devices WHERE id=?').bind(device.id).first<{last_seen:number}>();
 vi.setSystemTime(new Date((now()+1)*1000));
 expect((await call('/station/state',{bearer:device.credential})).status).toBe(401);
 expect((await call('/station/receiver',{method:'PATCH',data:{id:lease.id},bearer:device.credential})).status).toBe(401);
 expect((await call('/station/receiver',{method:'POST',bearer:device.credential})).status).toBe(401);
 expect((await call('/devices/pair/status',{bearer:device.credential})).status).toBe(410);
 expect((await env.DB.prepare('SELECT last_seen FROM devices WHERE id=?').bind(device.id).first())?.last_seen).toBe(before!.last_seen);
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM receivers WHERE device_id=? AND closed_at IS NULL').bind(device.id).first())?.count).toBe(0);
 for(const endpoint of ['/devices','/receivers'])expect(await list(endpoint,administrator.cookie)).not.toContainEqual(expect.objectContaining({id:device.id}));
});

it('a background paired computer receives incoming queue IDs without selecting a profile, while anonymous callers and operator privileges stay blocked',async()=>{
 const {owner,administrator,device}=await computer(),sender=await member();
 expect((await call('/station/receiver',{method:'POST',bearer:device.credential})).status).toBe(200);
 const connection=await call('/connections/device:'+device.id,{method:'POST',data:{},cookie:sender.cookie});expect(connection.status).toBe(200);
 const pending=await connection.json() as {connection:{id:string;status:string}};expect(pending.connection.status).toBe('pending');
 expect((await call('/requests',{method:'POST',data:{deviceId:device.id,message:'Isolated background request'},cookie:owner.cookie})).status).toBe(201);
 const upload=await SELF.fetch('http://localhost:8787/api/receive/device:'+device.id,{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:administrator.cookie,'X-Filename':'background-fixture.txt','Content-Length':'5'},body:'hello'});expect(upload.status).toBe(201);
 const response=await call('/station/state',{bearer:device.credential});expect(response.status).toBe(200);
 const state=await response.json() as {device:{operator_id:string|null};adminUnlocked:boolean;transfers:{id:string}[];requests:{id:string}[];accessRequests:{id:string}[]};
 expect(state.device.operator_id).toBeNull();expect(state.adminUnlocked).toBe(false);expect(state.transfers).toHaveLength(1);expect(state.requests).toHaveLength(1);expect(state.accessRequests.some(row=>row.id===pending.connection.id)).toBe(true);
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM operator_sessions WHERE device_id=?').bind(device.id).first())?.count).toBe(0);
 expect((await call('/station/state')).status).toBe(401);expect((await call('/station/enrollment-code',{bearer:device.credential})).status).toBe(403);
});
