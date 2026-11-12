import {env,SELF} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {fixture,native} from './helpers/service-fixture';
import {hash} from '../src/server/core';

it('desktop team reads require a current verified operator and expose only accessible named groups',async()=>{
 const f=await fixture('worship_member');
 const visible=crypto.randomUUID(),privateGroup=crypto.randomUUID();
 for(const id of [visible,privateGroup]){
  await env.DB.prepare('INSERT INTO worship_groups(id,name,owner_id,creation_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)')
   .bind(id,'Team fixture',f.owner,await hash(id),f.timestamp,f.timestamp).run();
 }
 await env.DB.prepare('INSERT INTO worship_group_members(group_id,user_id,assigned_by,created_at) VALUES(?,?,?,?)')
  .bind(visible,f.user,f.owner,f.timestamp).run();
 const operator=await native(f);
 const headers=new Headers(operator.request().headers);
 headers.set('Cookie','stati_access=isolated-test-access');
 headers.set('Origin','http://localhost:8787');
 const call=(path:string,method='GET',requestHeaders=headers)=>SELF.fetch('http://localhost:8787/api/station/team/'+path,{method,headers:requestHeaders});
 const noLease=new Headers(headers);
 noLease.delete('X-Stati-Operator-Lease');
 noLease.delete('X-Stati-Operator');
 expect((await call('tasks','GET',noLease)).status).toBeGreaterThanOrEqual(400);
 expect((await call('tasks')).status).toBe(200);
 expect((await call('tasks','POST')).status).toBeGreaterThanOrEqual(400);
 const groups=await call('groups');
 expect(groups.status).toBe(200);
 const data=await groups.json<{groups:{id:string}[]}>();
 expect(data.groups.map(group=>group.id)).toContain(visible);
 expect(data.groups.map(group=>group.id)).not.toContain(privateGroup);
 expect((await call('groups/'+privateGroup)).status).toBe(404);
 expect((await call('files')).status).toBe(400);
 expect((await call('files?groupId='+visible)).status).toBe(200);
 await env.DB.prepare("UPDATE station_memberships SET status='denied' WHERE device_id=? AND user_id=?").bind(f.deviceId,f.user).run();
 expect((await call('tasks')).status).toBeGreaterThanOrEqual(400);
});
