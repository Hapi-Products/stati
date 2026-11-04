import {env,createExecutionContext,waitOnExecutionContext} from 'cloudflare:test';
import {afterEach,expect,it} from 'vitest';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';
import {notifyWorkspaceChange} from '../src/server/task-events';
const sockets:WebSocket[]=[];
afterEach(()=>{for(const socket of sockets)socket.close(1000,'Test complete');sockets.length=0;});
async function actor(role='member'){const id=crypto.randomUUID(),session=token();await env.DB.batch([env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Live','T',?,'active',?)").bind(id,role,now()),env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+86400)]);return{id,cookie:'stati_session='+session};}
type Actor=Awaited<ReturnType<typeof actor>>;
function request(path:string,user:Actor|undefined,options:RequestInit={}){return new Request('http://localhost:8787/api'+path,{...options,headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access'+(user?'; '+user.cookie:''),...options.headers}});}
async function connect(user:Actor){const response=await worker.fetch(request('/tasks/events',user,{headers:{Upgrade:'websocket'}}),env,createExecutionContext());expect(response.status).toBe(101);const socket=response.webSocket!;socket.accept();sockets.push(socket);return socket;}
function next(socket:WebSocket){return new Promise<string>(resolve=>socket.addEventListener('message',event=>resolve(String(event.data)),{once:true}));}
it('only approved authenticated same-origin sessions can subscribe',async()=>{
 const user=await actor();
 expect((await worker.fetch(request('/tasks/events',undefined,{headers:{Upgrade:'websocket'}}),env,createExecutionContext())).status).toBeGreaterThanOrEqual(400);
 expect((await worker.fetch(request('/tasks/events',user,{headers:{Upgrade:'websocket',Origin:'https://other.invalid'}}),env,createExecutionContext())).status).toBe(403);
 await env.DB.prepare("UPDATE users SET status='pending' WHERE id=?").bind(user.id).run();expect((await worker.fetch(request('/tasks/events',user,{headers:{Upgrade:'websocket'}}),env,createExecutionContext())).status).toBe(403);
});
it('an accepted task change invalidates a second device without sending private task contents',async()=>{
 const first=await actor(),second=await actor(),socket=await connect(second),ready=await next(socket);expect(JSON.parse(ready)).toEqual({type:'tasks-ready'});
 const message=next(socket),ctx=createExecutionContext();
 const response=await worker.fetch(request('/tasks',first,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',id:crypto.randomUUID(),title:'Private test title',body:'Private test body',urgent:false})}),env,ctx);expect(response.status).toBe(200);
 await waitOnExecutionContext(ctx);expect(JSON.parse(await message)).toEqual({type:'tasks-changed'});
});
it('revoked sessions are closed before another task change can notify them',async()=>{
 const first=await actor(),second=await actor(),socket=await connect(second);await next(socket);
 const closed=new Promise<number>(resolve=>socket.addEventListener('close',event=>resolve(event.code),{once:true}));await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(second.id).run();
 const ctx=createExecutionContext();expect((await worker.fetch(request('/tasks',first,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',id:crypto.randomUUID(),title:'After revoke',body:'Nothing private on the socket',urgent:false})}),env,ctx)).status).toBe(200);await waitOnExecutionContext(ctx);expect(await closed).toBe(1008);
});
it('subscribers cannot use the channel as a broadcast endpoint',async()=>{
 const user=await actor(),socket=await connect(user);await next(socket);const closed=new Promise<number>(resolve=>socket.addEventListener('close',event=>resolve(event.code),{once:true}));socket.send('fake update');expect(await closed).toBe(1008);
});

it('a saved group change immediately invalidates another device with metadata only',async()=>{
 const first=await actor('admin'),second=await actor(),socket=await connect(second);await next(socket);
 const message=next(socket),ctx=createExecutionContext();
 const response=await worker.fetch(request('/worship-groups',first,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),name:'Private group name',memberIds:[]})}),env,ctx);
 expect(response.status).toBe(201);await waitOnExecutionContext(ctx);expect(JSON.parse(await message)).toEqual({type:'groups-changed'});
});
it('every workspace invalidation is content-free and revocation-safe',async()=>{
 const user=await actor(),socket=await connect(user);await next(socket);
 for(const type of ['catalog-changed','services-changed','files-changed'] as const){const message=next(socket);await notifyWorkspaceChange(env,type);expect(JSON.parse(await message)).toEqual({type});}
 const closed=new Promise<number>(resolve=>socket.addEventListener('close',event=>resolve(event.code),{once:true}));await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id).run();await notifyWorkspaceChange(env,'files-changed');expect(await closed).toBe(1008);
});
