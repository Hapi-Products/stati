import {env} from 'cloudflare:test';
import {it,expect} from 'vitest';
import {now} from '../src/server/core';
import {readStationTeamScope,stationTeamScopeGuard} from '../src/server/station-team-scope';

async function person(role='member',status='active') {
 const id=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Scope','T',?,?,?)")
  .bind(id,role,status,now()).run();
 return id;
}
async function station(owner:string){
 const id=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires) VALUES(?,?,?,?,?,0)')
  .bind(id,crypto.randomUUID(),'Isolated station',owner,now()).run();
 return id;
}
async function grant(device:string,user:string,role='member',ministry:string|null=null){
 await env.DB.prepare("INSERT INTO station_memberships(device_id,user_id,status,updated_at,role,ministry_role) VALUES(?,?,'approved',?,?,?)")
  .bind(device,user,now(),role,ministry).run();
}
async function guardedRename(scope:Awaited<ReturnType<typeof readStationTeamScope>>){
 const guard=stationTeamScopeGuard(scope);
 return env.DB.prepare('UPDATE devices SET name=? WHERE id=? AND '+guard.sql)
  .bind('Changed name',scope.deviceId,...guard.params).run();
}

it('does not grant an unrelated global administrator access',async()=>{
 const owner=await person(),admin=await person('admin'),id=await station(owner);
 await expect(readStationTeamScope(env,id,admin)).rejects.toMatchObject({status:403});
});
it('recognizes an owner independently of the global role',async()=>{
 const owner=await person(),id=await station(owner),scope=await readStationTeamScope(env,id,owner);
 expect(scope).toMatchObject({deviceId:id,userId:owner,role:'admin',ministryRole:null});
 expect(Object.isFrozen(scope)).toBe(true);
 expect((await guardedRename(scope)).meta.changes).toBe(1);
});
it('keeps explicit roles different on two computers without inheriting global ministry roles',async()=>{
 const owner=await person(),user=await person('admin'),a=await station(owner),b=await station(owner);
 await env.DB.prepare("INSERT INTO user_ministry_roles(user_id,role,updated_at) VALUES(?,'pastor',?)").bind(user,now()).run();
 await grant(a,user,'admin','worship_leader');
 await grant(b,user);
 expect(await readStationTeamScope(env,a,user)).toMatchObject({role:'admin',ministryRole:'worship_leader'});
 expect(await readStationTeamScope(env,b,user)).toMatchObject({role:'member',ministryRole:null});
});
it.each(['denied','disconnected','revoked'])('blocks %s stations even for their owner',async kind=>{
 const owner=await person('admin'),id=await station(owner),scope=await readStationTeamScope(env,id,owner);
 if(kind==='denied')await env.DB.prepare("INSERT INTO station_memberships(device_id,user_id,status,updated_at) VALUES(?,?,'denied',?)").bind(id,owner,now()).run();
 if(kind==='disconnected')await env.DB.prepare('INSERT INTO station_disconnections(device_id,user_id,created_at,operation_id) VALUES(?,?,?,?)').bind(id,owner,now(),crypto.randomUUID()).run();
 if(kind==='revoked')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),id).run();
 await expect(readStationTeamScope(env,id,owner)).rejects.toMatchObject({status:403});
 expect((await guardedRename(scope)).meta.changes).toBe(0);
});
it.each(['demotion','ministry change','membership removal','owner change','member removal','owner removal'])('rechecks %s in the same statement as a protected write',async change=>{
 const owner=await person(),user=await person('admin'),id=await station(owner);
 await grant(id,user,'admin');
 const scope=await readStationTeamScope(env,id,user);
 if(change==='demotion')await env.DB.prepare("UPDATE station_memberships SET role='member' WHERE device_id=? AND user_id=?").bind(id,user).run();
 if(change==='ministry change')await env.DB.prepare("UPDATE station_memberships SET ministry_role='pastor' WHERE device_id=? AND user_id=?").bind(id,user).run();
 if(change==='membership removal')await env.DB.prepare('DELETE FROM station_memberships WHERE device_id=? AND user_id=?').bind(id,user).run();
 if(change==='owner change')await env.DB.prepare('UPDATE devices SET owner_id=? WHERE id=?').bind(await person(),id).run();
 if(change==='member removal')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(user).run();
 if(change==='owner removal')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(owner).run();
 expect((await guardedRename(scope)).meta.changes).toBe(0);
 expect((await env.DB.prepare('SELECT name FROM devices WHERE id=?').bind(id).first())?.name).toBe('Isolated station');
});
it.each(['pending','removed'])('does not let a %s account use approved membership',async status=>{
 const owner=await person(),user=await person('admin',status),id=await station(owner);
 await grant(id,user,'admin');
 await expect(readStationTeamScope(env,id,user)).rejects.toMatchObject({status:403});
});
it('does not treat an approved connection as lasting membership',async()=>{
 const owner=await person(),user=await person('admin'),id=await station(owner),receiver=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiver,id,crypto.randomUUID(),now()+300,now()).run();
 await env.DB.prepare("INSERT INTO computer_connections(id,receiver_id,device_id,user_id,status,created_at,last_seen) VALUES(?,?,?,?,'approved',?,?)").bind(crypto.randomUUID(),receiver,id,user,now(),now()).run();
 await expect(readStationTeamScope(env,id,user)).rejects.toMatchObject({status:403});
});
it('allows unchanged approved scope through a write fence',async()=>{
 const owner=await person(),user=await person(),id=await station(owner);
 await grant(id,user,'admin','worship_leader');
 expect((await guardedRename(await readStationTeamScope(env,id,user))).meta.changes).toBe(1);
});
