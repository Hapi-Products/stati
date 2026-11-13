import {env, SELF} from 'cloudflare:test';
import {expect, it, vi} from 'vitest';
import {fixture} from './helpers/service-fixture';
import {hash, token} from '../src/server/core';

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
 expect(await (await request(memberCookie)).json()).toEqual({state:'waiting'});
 expect((await request(outsiderCookie)).status).toBe(403);
 expect((await request(f.session,'PUT',update)).status).toBe(409);
 const claim = (await f.change({type:'claim-leadership',id:plan.id,expectedRevision:saved.revision,expectedLeadershipRevision:0})).plans[0];
 expect(claim.leadership.isLeader).toBe(true);
 expect((await request(memberCookie,'PUT',update)).status).toBe(409);
 expect((await request(f.session,'PUT',update)).status).toBe(200);
 expect(await (await request(memberCookie)).json()).toEqual({state:'live',isLeader:false,position:update});
 expect((await request(f.session,'PUT',{...update,sequence:2,page:3})).status).toBe(200);
 expect((await request(f.session,'PUT',update)).status).toBe(409);
 expect(await (await request(memberCookie)).json()).toMatchObject({position:{page:3}});
 expect((await request(memberCookie,'DELETE',{sessionId:update.sessionId})).status).toBe(200);
 expect(await (await request(memberCookie)).json()).toMatchObject({state:'live'});
 vi.setSystemTime(new Date((f.timestamp+25)*1000));
 expect(await (await request(memberCookie)).json()).toEqual({state:'waiting'});
 await env.DB.prepare('DELETE FROM worship_group_members WHERE group_id=? AND user_id=?').bind(group,member).run();
 expect((await request(memberCookie)).status).toBe(403);
 await f.change({type:'select',id:null});
 expect(await (await request(f.session)).json()).toEqual({state:'idle'});
});
