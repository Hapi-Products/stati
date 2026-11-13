import {createExecutionContext, env, SELF, waitOnExecutionContext} from 'cloudflare:test';
import {expect, it, vi} from 'vitest';
import {fixture} from './helpers/service-fixture';
import {hash, token} from '../src/server/core';
import worker from '../src/server/index';

it('syncs the leader’s exact service item and PDF page only within the named group', async () => {
 const f = await fixture('worship_leader');
 const group = crypto.randomUUID(), member = crypto.randomUUID(), outsider = crypto.randomUUID();
 const memberCookie = token(), outsiderCookie = token();
 const plan = await f.create();
 const song = f.song();
 const saved = (await f.change({type:'save',id:plan.id,plan:{...plan,songs:[song]}})).plans[0];
 for (const [id,session] of [[member,memberCookie],[outsider,outsiderCookie]]) {
  await env.DB.batch([
   env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Test','T','member','active',?)").bind(id,f.timestamp),
   env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,f.timestamp+3600),
   env.DB.prepare("INSERT INTO user_ministry_roles(user_id,role,assigned_by,updated_at) VALUES(?,'worship_member',?,?)").bind(id,f.owner,f.timestamp),
   env.DB.prepare("INSERT INTO station_memberships(device_id,user_id,status,updated_at) VALUES(?,?,'approved',?)").bind(f.deviceId,id,f.timestamp),
  ]);
 }
 await env.DB.prepare('INSERT INTO worship_groups(id,name,owner_id,creation_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)')
  .bind(group,'Test worship group',f.user,await hash(group),f.timestamp,f.timestamp).run();
 for (const id of [f.user,member]) {
  await env.DB.prepare('INSERT INTO worship_group_members VALUES(?,?,?,?)').bind(group,id,f.user,f.timestamp).run();
 }
 const request = (session: string, method='GET', payload?: object) => SELF.fetch(
  'http://localhost:8787/api/computers/'+f.deviceId+'/worship-live/'+group,
  {method,headers:{Origin:'http://localhost:8787',Cookie:'stati_session='+session},body:payload ? JSON.stringify(payload) : undefined},
 );
 const update = {
  serviceId:plan.id,sessionId:crypto.randomUUID(),sequence:1,itemId:song.id,page:2,
  mode:'document',transition:'pageTurn',columns:2,slideSize:2,
 };
 const clicker = (session: string, payload?: object) => SELF.fetch(
  'http://localhost:8787/api/computers/'+f.deviceId+'/live-clicker',
  {method:payload?'POST':'GET',headers:{Origin:'http://localhost:8787',Cookie:'stati_session='+session},body:payload ? JSON.stringify(payload) : undefined},
 );
 expect(await (await request(memberCookie)).json()).toEqual({state:'waiting'});
 expect((await request(outsiderCookie)).status).toBe(403);
 expect((await request(f.session,'PUT',update)).status).toBe(409);
 const claim = (await f.change({type:'claim-leadership',id:plan.id,expectedRevision:saved.revision,expectedLeadershipRevision:0})).plans[0];
 expect(claim.leadership.isLeader).toBe(true);
 expect((await request(memberCookie,'PUT',update)).status).toBe(409);
 expect((await request(f.session,'PUT',update)).status).toBe(200);
 expect(await (await request(memberCookie)).json()).toEqual({state:'live',isLeader:false,position:update});
 // Count remote D1 calls across the actual Worker request, including authentication.
 let databaseCalls = 0;
 const DB = new Proxy(env.DB,{get(target,key) {
  if (key !== 'prepare') return Reflect.get(target,key);
  return (sql:string) => {
   const measure = (statement:D1PreparedStatement):D1PreparedStatement => new Proxy(statement,{get(target,method) {
    if (method === 'bind') return (...values:unknown[]) => measure(target.bind(...values));
    if (method === 'first' || method === 'run') return (...args:[]) => {
     databaseCalls++;
     return target[method](...args);
    };
    return Reflect.get(target,method);
   }});
   return measure(target.prepare(sql));
  };
 }});
 const measureRead = (path:string,session?:string) => worker.fetch(
  new Request('http://localhost:8787/api/computers/'+f.deviceId+path,{
   headers:{Origin:'http://localhost:8787',...(session ? {Cookie:'stati_session='+session} : {})},
  }),{...env,DB},createExecutionContext());
 const measured = await measureRead('/worship-live/'+group,memberCookie);
 expect(await measured.json()).toEqual({state:'live',isLeader:false,position:update});
 expect(databaseCalls).toBe(2);
 databaseCalls = 0;
 const lyrics = await measureRead('/songs/'+f.songId,memberCookie);
 expect(await lyrics.json()).toMatchObject({id:f.songId,text:'Împreună cântăm'});
 expect(databaseCalls).toBe(2);
 for (const path of ['/worship-live/'+group,'/live-clicker','/songs/'+f.songId]) {
  expect((await measureRead(path)).status).toBe(401);
 }
 expect((await request(f.session,'PUT',{...update,sequence:2,page:3})).status).toBe(200);
 expect((await request(f.session,'PUT',update)).status).toBe(409);
 expect(await (await request(memberCookie)).json()).toMatchObject({position:{page:3}});
 const ready = {...update,sequence:3,page:1,pageCount:3};
 expect((await request(f.session,'PUT',ready)).status).toBe(200);
 expect(await (await clicker(f.session)).json()).toMatchObject({live:{
  position:ready,songTitle:'Împreună cântăm',songId:f.songId,contentHash:f.contentHash
 }});
 expect(await (await clicker(memberCookie)).json()).toEqual({live:null});
 const move = {sessionId:ready.sessionId,itemId:ready.itemId,sequence:ready.sequence,page:1,turn:null,direction:1};
 expect((await clicker(memberCookie,move)).status).toBe(409);
 const followerHeaders = {Origin:'http://localhost:8787',Cookie:'stati_session='+memberCookie};
 const subscription = await worker.fetch(new Request('http://localhost:8787/api/tasks/events',{
  headers:{...followerHeaders,Upgrade:'websocket'}
 }),env,createExecutionContext());
 expect(subscription.status).toBe(101);
 const socket=subscription.webSocket!;
 socket.accept();
 const next=()=>new Promise<string>(resolve=>socket.addEventListener('message',event=>resolve(String(event.data)),{once:true}));
 let moved:{position:{page:number;clickerTurn:string}};
 try {
  expect(JSON.parse(await next())).toEqual({type:'tasks-ready'});
  const updateArrived=next(),ctx=createExecutionContext();
  const accepted = await worker.fetch(new Request('http://localhost:8787/api/computers/'+f.deviceId+'/live-clicker',{
   method:'POST',headers:{...followerHeaders,Cookie:'stati_session='+f.session},body:JSON.stringify(move)
  }),env,ctx);
  expect(accepted.status).toBe(200);
  moved = await accepted.json();
  await waitOnExecutionContext(ctx);
  expect(JSON.parse(await updateArrived)).toEqual({type:'live-reader-changed'});
  expect(await (await request(memberCookie)).json()).toMatchObject({position:{page:2}});
 } finally { socket.close(1000,'Test complete'); }
 expect(moved.position.page).toBe(2);
 expect((await clicker(f.session,move)).status).toBe(409);
 expect((await clicker(f.session,{...move,page:2,turn:moved.position.clickerTurn})).status).toBe(409);
 expect((await request(f.session,'PATCH',{sessionId:ready.sessionId})).status).toBe(200);
 expect(await (await request(memberCookie)).json()).toMatchObject({position:{page:2,clickerTurn:moved.position.clickerTurn}});
 expect((await clicker(f.session,{...move,page:2,turn:moved.position.clickerTurn,direction:-1})).status).toBe(200);
 expect((await clicker(f.session,{...move,page:1})).status).toBe(409);
 expect((await request(f.session,'PUT',{...ready,sequence:4,page:0})).status).toBe(200);
 expect((await clicker(f.session,{...move,page:0,direction:1})).status).toBe(409);
 expect((await request(memberCookie,'DELETE',{sessionId:update.sessionId})).status).toBe(200);
 expect(await (await request(memberCookie)).json()).toMatchObject({state:'live'});
 vi.setSystemTime(new Date((f.timestamp+25)*1000));
 expect(await (await request(memberCookie)).json()).toEqual({state:'waiting'});
 expect(await (await clicker(f.session)).json()).toEqual({live:null});
 expect((await clicker(f.session,{...move,sequence:4,page:0})).status).toBe(409);
 await env.DB.prepare('DELETE FROM worship_group_members WHERE group_id=? AND user_id=?').bind(group,member).run();
 expect((await request(memberCookie)).status).toBe(403);
 await f.change({type:'select',id:null});
 expect(await (await request(f.session)).json()).toEqual({state:'idle'});
 await env.DB.prepare('INSERT INTO worship_group_members VALUES(?,?,?,?)').bind(group,member,f.user,f.timestamp).run();
 const solo = {...update, serviceId:null, itemId:f.songId, songHash:f.contentHash,
  sessionId:crypto.randomUUID(), page:0, pageCount:3};
 expect((await request(memberCookie,'PUT',solo)).status).toBe(403);
 expect((await request(f.session,'PUT',{...solo,songHash:'0'.repeat(64)})).status).toBe(409);
 expect((await request(f.session,'PUT',solo)).status).toBe(200);
 expect(await (await request(memberCookie)).json()).toMatchObject({state:'live',songTitle:'Împreună cântăm',position:solo});
 expect(await (await SELF.fetch('http://localhost:8787/api/build-status')).json()).toEqual({version:1,allowed:false});
 expect(await (await clicker(f.session)).json()).toMatchObject({live:{position:solo,songId:f.songId}});
 expect((await clicker(f.session,{sessionId:solo.sessionId,itemId:solo.itemId,sequence:1,page:0,turn:null,direction:1})).status).toBe(200);
 expect((await request(f.session,'PATCH',{sessionId:solo.sessionId})).status).toBe(200);
 expect(await (await request(memberCookie)).json()).toMatchObject({position:{page:1}});
 expect((await request(f.session,'DELETE',{sessionId:solo.sessionId})).status).toBe(200);
 expect(await (await request(memberCookie)).json()).toEqual({state:'idle'});
});
