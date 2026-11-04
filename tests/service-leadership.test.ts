import {env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {fixture,rejected,beforeBatch,native} from './helpers/service-fixture';
import {changeStationService,readStationServices} from '../src/server/station-services';

type Fixture=Awaited<ReturnType<typeof fixture>>;
const action=(plan:any,type:string,extra:Record<string,unknown>={})=>({type,id:plan.id,expectedRevision:plan.revision,expectedLeadershipRevision:plan.leadership?.revision||0,...extra});
async function joinStation(actor:Fixture,station:Fixture){await env.DB.prepare("INSERT INTO station_memberships(device_id,user_id,status,updated_at) VALUES(?,?,'approved',?)").bind(station.deviceId,actor.user,station.timestamp).run();return async(data:unknown,bindings=env)=>changeStationService(new Request(station.request().url,{method:'POST',headers:actor.request().headers,body:JSON.stringify(data)}),bindings,station.deviceId).then(response=>response.json() as Promise<any>);}
it('preserves unassigned legacy plans and lets a named member lead and finalize without computer approval',async()=>{
 const f=await fixture(),created=await f.create();expect(created.leadership).toMatchObject({leaderId:null,revision:0,canClaim:true,canEdit:true,finalizedRevision:null});
 const led=(await f.change(action(created,'claim-leadership'))).plans[0];expect(led.leadership).toMatchObject({leaderId:f.user,leaderLabel:'Planner T.',revision:1,isLeader:true,canEdit:true});
 const finalized=(await f.change(action(led,'finalize-order'))).plans[0];expect(finalized.revision).toBe(1);expect(finalized.leadership).toMatchObject({finalizedRevision:1,acknowledgedRevision:null,revision:2});
 expect(await env.DB.prepare('SELECT COUNT(*) count FROM station_service_versions WHERE device_id=?').bind(f.deviceId).first()).toEqual({count:0});
});
it('requires explicit authorized takeover, then lets a pastor edit that service while keeping global creation restricted',async()=>{
 const f=await fixture(),created=await f.create(),led=(await f.change(action(created,'claim-leadership'))).plans[0],member=await fixture(null),memberChange=await joinStation(member,f),pastor=await fixture('pastor'),pastorChange=await joinStation(pastor,f);
 await rejected(memberChange({type:'save',id:led.id,plan:{...led,notes:'Unapproved change'}}),403);
 await rejected(memberChange(action(led,'claim-leadership',{takeOver:true})),403);
 await rejected(pastorChange(action(led,'claim-leadership')),403);
 const taken=(await pastorChange(action(led,'claim-leadership',{takeOver:true}))).plans[0];expect(taken.leadership).toMatchObject({leaderId:pastor.user,canEdit:true,isLeader:true});
 await rejected(f.change({type:'save',id:led.id,plan:{...led,notes:'Previous leader'}}),403);
 const saved=(await pastorChange({type:'save',id:taken.id,plan:{...taken,notes:'Pastor running order'}})).plans[0];expect(saved.notes).toBe('Pastor running order');expect(saved.revision).toBe(2);
 const finished=(await pastorChange(action(saved,'finalize-order'))).plans[0];expect(finished.leadership.finalizedRevision).toBe(2);
 await rejected(pastor.create(),403);
});
it('lets an approved worship member explicitly cover an absent leader, audit the takeover and edit only after taking over',async()=>{
 const leader=await fixture('worship_leader'),created=await leader.create(),led=(await leader.change(action(created,'claim-leadership'))).plans[0],backup=await fixture('worship_member'),backupChange=await joinStation(backup,leader);
 const visible=await readStationServices(new Request(leader.request().url,{headers:backup.request().headers}),env,leader.deviceId).then(response=>response.json() as Promise<any>);
 expect(visible.plans[0].leadership).toMatchObject({leaderId:leader.user,canTakeOver:true,canEdit:false,isLeader:false});
 await rejected(backupChange({type:'save',id:led.id,plan:{...led,notes:'Changed before takeover'}}),403);
 await rejected(backupChange(action(led,'claim-leadership')),403);
 const taken=(await backupChange(action(led,'claim-leadership',{takeOver:true}))).plans[0];expect(taken.leadership).toMatchObject({leaderId:backup.user,canEdit:true,isLeader:true,canTakeOver:false});
 const saved=(await backupChange({type:'save',id:taken.id,plan:{...taken,notes:'Backup service order'}})).plans[0];expect(saved.notes).toBe('Backup service order');
 const previousLeaderView=(await leader.read()).plans[0];expect(previousLeaderView.leadership).toMatchObject({leaderId:backup.user,isLeader:false,canEdit:false});
 await rejected(leader.change({type:'save',id:saved.id,plan:{...previousLeaderView,notes:'Old leader edit'}}),403);
 expect((await leader.read()).plans[0].notes).toBe('Backup service order');
 expect(await env.DB.prepare("SELECT COUNT(*) count FROM audit WHERE subject_id=? AND actor_id=? AND action='station-service-claim-leadership'").bind(leader.deviceId,backup.user).first()).toEqual({count:1});
});
it('rechecks a worship backup role during takeover before replacing the current leader',async()=>{
 const leader=await fixture('worship_leader'),created=await leader.create(),led=(await leader.change(action(created,'claim-leadership'))).plans[0],backup=await fixture('worship_member'),backupChange=await joinStation(backup,leader),race=beforeBatch(()=>env.DB.prepare('DELETE FROM user_ministry_roles WHERE user_id=?').bind(backup.user).run());
 await rejected(backupChange(action(led,'claim-leadership',{takeOver:true}),race.bindings),409);
 expect((await leader.read()).plans[0].leadership.leaderId).toBe(leader.user);
 expect(await env.DB.prepare("SELECT COUNT(*) count FROM audit WHERE subject_id=? AND actor_id=? AND action='station-service-claim-leadership'").bind(leader.deviceId,backup.user).first()).toEqual({count:0});
});
it('binds acknowledgement to the finalized saved revision and the authenticated presentation computer',async()=>{
 const f=await fixture(),created=await f.create(),led=(await f.change(action(created,'claim-leadership'))).plans[0],finalized=(await f.change(action(led,'finalize-order'))).plans[0];
 await rejected(f.change(action(finalized,'acknowledge-order')),403);
 const proof=await native(f),acknowledged=(await proof.change(action(finalized,'acknowledge-order'))).plans[0];expect(acknowledged.leadership).toMatchObject({acknowledgedRevision:1,acknowledgedByLabel:'Planner T.'});
 const edited=(await f.change({type:'save',id:acknowledged.id,plan:{...acknowledged,notes:'Changed after acknowledgement'}})).plans[0];expect(edited.revision).toBe(2);expect(edited.leadership.finalizedRevision).toBe(1);
 await rejected(proof.change(action(edited,'acknowledge-order')),409);
 const refinalized=(await f.change(action(edited,'finalize-order'))).plans[0];expect(refinalized.leadership.acknowledgedRevision).toBeNull();expect((await proof.change(action(refinalized,'acknowledge-order'))).plans[0].leadership.acknowledgedRevision).toBe(2);
});
it('fences competing claims and leadership changes during an order save',async()=>{
 const f=await fixture(),created=await f.create(),backup=await fixture('worship_leader'),backupChange=await joinStation(backup,f);
 const claims=await Promise.allSettled([f.change(action(created,'claim-leadership')),backupChange(action(created,'claim-leadership'))]);expect(claims.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 const current=(await f.read()).plans[0];if(current.leadership.leaderId!==f.user){await backupChange(action(current,'release-leadership'));}
 const before=(await f.read()).plans[0],led=before.leadership.leaderId===f.user?before:(await f.change(action(before,'claim-leadership'))).plans[0];
 const race=beforeBatch(()=>backupChange(action(led,'claim-leadership',{takeOver:true})));
 await rejected(f.change({type:'save',id:led.id,plan:{...led,notes:'Racing old leader'}},race.bindings),409);
 const retained=(await f.read()).plans[0];expect(retained.notes).toBe('');expect(retained.leadership.leaderId).toBe(backup.user);
});
it.each(['membership','session','role'] as const)('rechecks %s while committing leadership and leaves the service untouched',async kind=>{
 const f=await fixture(),created=await f.create(),race=beforeBatch(async()=>{if(kind==='membership')await env.DB.prepare('DELETE FROM station_memberships WHERE device_id=? AND user_id=?').bind(f.deviceId,f.user).run();if(kind==='session')await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(f.user).run();if(kind==='role')await env.DB.prepare('DELETE FROM user_ministry_roles WHERE user_id=?').bind(f.user).run();});
 await rejected(f.change(action(created,'claim-leadership'),race.bindings),409);expect(await env.DB.prepare('SELECT COUNT(*) count FROM station_service_leadership WHERE device_id=?').bind(f.deviceId).first()).toEqual({count:0});
});
it('does not let a pastor edit an unassigned service or spoof leadership fields in a save',async()=>{
 const f=await fixture(),plan=await f.create(),pastor=await fixture('pastor'),change=await joinStation(pastor,f);
 await rejected(change({type:'save',id:plan.id,plan:{...plan,notes:'Forged',leadership:{canEdit:true,leaderId:pastor.user}}}),403);
 expect((await f.read()).plans[0].notes).toBe('');
});
