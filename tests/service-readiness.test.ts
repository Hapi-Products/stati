import {env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {hash,now,token} from '../src/server/core';
import {activatePhoneOperator,beginPhoneOperator} from '../src/server/operator-selection';
import {readStationServiceVersions,changeStationService} from '../src/server/station-services';
import {changeServiceReadiness,readServiceReadiness} from '../src/server/service-readiness';
import {serviceContent} from '../src/shared/service-readiness.js';

async function fixture(){
 const owner=crypto.randomUUID(),user=crypto.randomUUID(),session=token(),timestamp=now();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Owner','T','admin','active',?)").bind(owner,timestamp),
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Operator','T','member','active',?)").bind(user,timestamp),
  env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await hash(session),user,timestamp+3600),
  env.DB.prepare("INSERT INTO user_ministry_roles(user_id,role,assigned_by,updated_at) VALUES(?,'worship_member',?,?)").bind(user,owner,timestamp),
 ]);
 const web=(data?:unknown)=>new Request('http://localhost/api/computers/services',{method:data===undefined?'GET':'POST',headers:{Cookie:'stati_session='+session},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const station=async(name='Church computer',suppliedHash?:string)=>{
  const songHash=suppliedHash||await hash('Exact native song bytes');
  const deviceId=crypto.randomUUID(),credential=token(),songId=await hash(token());
  await env.DB.batch([
   env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(deviceId,await hash(credential),name,owner,timestamp,timestamp+600,timestamp),
   env.DB.prepare("INSERT INTO station_memberships(device_id,user_id,status,updated_at) VALUES(?,?,'approved',?)").bind(deviceId,user,timestamp),
   env.DB.prepare('INSERT INTO station_catalog(device_id,song_id,title,content_hash,filename,category,language,font_size,text,first_slide,added_at,modified_at,generation,search_text,payload_bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(deviceId,songId,'Împreună cântăm',songHash,'song.pro','Worship','ron',72,'Împreună cântăm','Împreună cântăm',timestamp,timestamp,crypto.randomUUID(),'impreuna cantam',200),
  ]);
  const save=async(data:unknown,bindings=env)=>changeStationService(web(data),bindings,deviceId).then(r=>r.json() as Promise<any>);
  const create=async(options:{notes?:string;repeats?:number;arrangement?:{name:string;slides:number[]}}={})=>{
   const created=(await save({type:'create',title:'Sunday worship',date:'2026-11-01',time:'09:25'})).plans.find((plan:any)=>plan.active);
   const songs=Array.from({length:options.repeats||1},()=>({id:crypto.randomUUID(),songId,contentHash:songHash,title:'Song',filename:'song.pro',reviewed:false,...(options.arrangement?{arrangement:options.arrangement}:{})}));
   return(await save({type:'save',id:created.id,plan:{...created,notes:options.notes||'',songs}})).plans.find((plan:any)=>plan.id===created.id);
  };
  const capture=async(plan:any)=>(await readStationServiceVersions(new Request('http://localhost/?current=true',{headers:request().headers}),env,deviceId,plan.id,true).then(r=>r.json() as Promise<any>)).snapshot;
  const context={deviceId,deviceTokenHash:await hash(credential)},pending=await beginPhoneOperator(env,context,user,token());
  await env.DB.prepare('UPDATE operator_unlocks SET approved=1 WHERE token_hash=?').bind(await hash(pending.token)).run();
  const active=await activatePhoneOperator(env,context,pending);if(!active)throw Error('Native proof fixture activation failed.');
  const request=(data?:unknown)=>new Request('http://localhost/api/station/services',{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+credential,'X-Stati-Operator-Lease':active.lease,'X-Stati-Operator':active.proof},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const read=async(id:string)=>readServiceReadiness(request(),env,deviceId,id,true).then(r=>r.json() as Promise<any>);
  const change=async(id:string,data:unknown,bindings=env)=>changeServiceReadiness(request(data),bindings,deviceId,id,true).then(r=>r.json() as Promise<any>);
  const report=(approved:any,status='passed')=>({type:'check',versionId:approved.id,contentHash:approved.contentHash,checks:approved.plan.songs.map((song:any)=>({kind:'song',reference:song.id,title:song.title,status,message:status==='passed'?'Exact saved version checked':'Check this file'}))});
  const check=async(approved:any,status='passed',bindings=env)=>change(approved.plan.id,report(approved,status),bindings);
  const ack=async(approved:any,bindings=env)=>change(approved.plan.id,{type:'acknowledge',versionId:approved.id},bindings);
  return{deviceId,credential,songId,songHash,create,save,capture,request,read,change,report,check,ack};
 };
 return{owner,user,web,station};
}
function beforeBatch(change:()=>Promise<unknown>){let calls=0;const DB=new Proxy(env.DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{calls++;if(calls===1)await change();return target.batch(statements);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});return{bindings:{...env,DB},calls:()=>calls};}
const reject=async(task:Promise<unknown>,status:number)=>expect(task).rejects.toMatchObject({status});
const current=(snapshot:any,id:string)=>snapshot.computers.find((computer:any)=>computer.deviceId===id);

it('automatically snapshots current saved service and checks every repeated appearance without a manual acknowledgement',async()=>{
 const f=await fixture(),s=await f.station(),plan=await s.create({repeats:2}),before=await s.read(plan.id),saved=await s.capture(plan);
 expect(before).toMatchObject({approvedVersionId:saved.id,canCheck:true});expect(current(before,s.deviceId)).toMatchObject({matches:false,stale:true,checkedAt:null});expect(before).not.toHaveProperty('canAcknowledge');
 const checked=await s.check(saved);expect(current(checked,s.deviceId)).toMatchObject({matches:true,stale:false});expect(current(checked,s.deviceId).checks).toHaveLength(2);expect(current(checked,s.deviceId)).not.toHaveProperty('acknowledgedAt');expect(current(checked,s.deviceId)).not.toHaveProperty('acknowledgedBy');
 await reject(s.ack(saved),400);await s.check(saved);expect(await env.DB.prepare("SELECT COUNT(*) count FROM audit WHERE subject_id=? AND action LIKE 'service-readiness-%'").bind(s.deviceId).first()).toEqual({count:2});
});
it('shows matching approved services on accessible backup computers regardless of station, service and appearance IDs',async()=>{
 const f=await fixture(),a=await f.station('Primary'),b=await f.station('Backup'),primary=await a.capture(await a.create()),backup=await b.capture(await b.create());await a.check(primary);await b.check(backup);
 const result=await a.read(primary.plan.id);expect(result.computers).toHaveLength(2);expect(current(result,b.deviceId)).toMatchObject({serviceId:backup.plan.id,matches:true,stale:false});
 // Later saved changes are immediately current; an older history record cannot keep the prior identity active.
 await b.save({type:'save',id:backup.plan.id,plan:{...backup.plan,title:'Monday draft'}});expect(current(await a.read(primary.plan.id),b.deviceId)).toMatchObject({serviceId:null,matches:false});
});
it('does not treat different approved notes, arrangements, song bytes or an ambiguous backup as an approved match',async()=>{
 const f=await fixture(),a=await f.station(),b=await f.station('Other notes'),c=await f.station('Other arrangement'),d=await f.station('Other bytes',await hash('different')),e=await f.station('Ambiguous'),primary=await a.capture(await a.create());
 const bVersion=await b.capture(await b.create({notes:'Different instructions'})),cVersion=await c.capture(await c.create({arrangement:{name:'Short',slides:[1]}})),dVersion=await d.capture(await d.create()),eVersion=await e.capture(await e.create());
 await Promise.all([b.check(bVersion),c.check(cVersion),d.check(dVersion),e.check(eVersion)]);await e.create();
 const result=await a.read(primary.plan.id);for(const device of[b,c,d])expect(current(result,device.deviceId)).toMatchObject({matches:false,stale:true});expect(current(result,e.deviceId)).toMatchObject({ambiguous:true,serviceId:null,matches:false});
});
it('keeps unavailable, revoked, unapproved and another ministry’s computers out of the comparison',async()=>{
 const f=await fixture(),a=await f.station(),b=await f.station(),c=await f.station(),foreign=await fixture(),d=await foreign.station(),primary=await a.capture(await a.create());
 await env.DB.prepare('DELETE FROM station_memberships WHERE device_id=?').bind(b.deviceId).run();await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),c.deviceId).run();
 const result=await a.read(primary.plan.id);expect(result.computers.map((computer:any)=>computer.deviceId)).toEqual([a.deviceId]);expect(result.computers.some((computer:any)=>computer.deviceId===d.deviceId)).toBe(false);
});
it('allows web readers to view readiness but permits only a current named native proof to submit checks',async()=>{
 const f=await fixture(),s=await f.station(),approved=await s.capture(await s.create());
 expect(await readServiceReadiness(f.web(),env,s.deviceId,approved.plan.id).then(r=>r.json())).toMatchObject({canCheck:false});
 await reject(changeServiceReadiness(f.web(s.report(approved)),env,s.deviceId,approved.plan.id),403);
 await reject(changeServiceReadiness(new Request('http://localhost/',{method:'POST',headers:{Authorization:'Bearer '+s.credential},body:JSON.stringify(s.report(approved))}),env,s.deviceId,approved.plan.id,true),428);
 const other=await f.station();await reject(other.read(approved.plan.id),404);
 await env.DB.prepare('DELETE FROM user_ministry_roles WHERE user_id=?').bind(f.user).run();await reject(s.read(approved.plan.id),403);
});
it('rejects missing, duplicate and foreign appearance checks, foreign versions and an incorrect approved file hash',async()=>{
 const f=await fixture(),s=await f.station(),approved=await s.capture(await s.create({repeats:2})),report=s.report(approved);
 await reject(s.change(approved.plan.id,{...report,checks:report.checks.slice(1)}),400);
 await reject(s.change(approved.plan.id,{...report,checks:[report.checks[0],report.checks[0]]}),400);
 await reject(s.change(approved.plan.id,{...report,checks:[report.checks[0],{...report.checks[1],reference:crypto.randomUUID()}]}),400);
 await reject(s.change(approved.plan.id,{...report,contentHash:'f'.repeat(64)}),409);
 await reject(s.change(approved.plan.id,{...report,versionId:crypto.randomUUID()}),409);
 expect(await env.DB.prepare('SELECT COUNT(*) count FROM station_service_checks WHERE device_id=?').bind(s.deviceId).first()).toEqual({count:0});
});
it('reports failed, warning, stale and future-dated checks honestly without a confirmation stage',async()=>{
 const f=await fixture(),s=await f.station(),saved=await s.capture(await s.create());
 expect(current(await s.check(saved,'failed'),s.deviceId).checks[0].status).toBe('failed');expect(current(await s.check(saved,'warning'),s.deviceId).checks[0].status).toBe('warning');
 await env.DB.prepare('UPDATE station_service_checks SET acknowledged_at=?,acknowledged_by=? WHERE device_id=?').bind(now(),f.user,s.deviceId).run();const currentCheck=current(await s.read(saved.plan.id),s.deviceId);expect(currentCheck).not.toHaveProperty('acknowledgedAt');expect(currentCheck).not.toHaveProperty('acknowledgedBy');
 await env.DB.prepare('UPDATE station_service_checks SET checked_at=? WHERE device_id=?').bind(now()-1800,s.deviceId).run();expect(current(await s.read(saved.plan.id),s.deviceId)).toMatchObject({stale:true});
 await env.DB.prepare('UPDATE station_service_checks SET checked_at=? WHERE device_id=?').bind(now()+1,s.deviceId).run();expect(current(await s.read(saved.plan.id),s.deviceId)).toMatchObject({stale:true});await reject(s.ack(saved),400);
});
it('a changed catalog makes a former success stale and cannot be reported against the former saved bytes',async()=>{
 const f=await fixture(),s=await f.station(),approved=await s.capture(await s.create());await s.check(approved);await env.DB.prepare('UPDATE station_catalog SET content_hash=? WHERE device_id=?').bind('f'.repeat(64),s.deviceId).run();
 const result=current(await s.read(approved.plan.id),s.deviceId);expect(result).toMatchObject({stale:true});expect(result.checks.at(-1)).toMatchObject({status:'failed',title:'Saved song versions'});await reject(s.check(approved),409);await reject(s.ack(approved),400);
});
it.each(['role','membership','owner','station','proof','catalogue','approval','archive'] as const)('atomically fences a %s change while storing a readiness check',async kind=>{
 const f=await fixture(),s=await f.station(),approved=await s.capture(await s.create());const race=beforeBatch(async()=>{
  if(kind==='role')await env.DB.prepare('DELETE FROM user_ministry_roles WHERE user_id=?').bind(f.user).run();
  if(kind==='membership')await env.DB.prepare('DELETE FROM station_memberships WHERE device_id=? AND user_id=?').bind(s.deviceId,f.user).run();
  if(kind==='owner')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.owner).run();
  if(kind==='station')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),s.deviceId).run();
  if(kind==='proof')await env.DB.prepare('DELETE FROM operator_selections WHERE device_id=?').bind(s.deviceId).run();
  if(kind==='catalogue')await env.DB.prepare('UPDATE station_catalog SET content_hash=? WHERE device_id=?').bind('f'.repeat(64),s.deviceId).run();
  if(kind==='approval'){const draft=(await s.save({type:'save',id:approved.plan.id,plan:{...approved.plan,notes:'New approved version'}})).plans.find((plan:any)=>plan.id===approved.plan.id);await s.capture(draft);}
  if(kind==='archive')await s.save({type:'archive',id:approved.plan.id,archived:true});
 });await reject(s.check(approved,'passed',race.bindings),409);expect(race.calls()).toBe(1);expect(await env.DB.prepare('SELECT COUNT(*) count FROM station_service_checks WHERE device_id=?').bind(s.deviceId).first()).toEqual({count:0});expect(await env.DB.prepare("SELECT COUNT(*) count FROM audit WHERE subject_id=? AND action='service-readiness-check'").bind(s.deviceId).first()).toEqual({count:0});
});
it('a new saved revision immediately invalidates the earlier readiness report without asking for approval',async()=>{
 const f=await fixture(),s=await f.station(),saved=await s.capture(await s.create());await s.check(saved);const changed=(await s.save({type:'save',id:saved.plan.id,plan:{...saved.plan,notes:'Current instructions'}})).plans.find((plan:any)=>plan.id===saved.plan.id);const result=await s.read(saved.plan.id);expect(result.currentRevision).toBe(changed.revision);expect(result.approvedRevision).toBe(changed.revision);expect(current(result,s.deviceId)).toMatchObject({matches:false,stale:true});await reject(s.check(saved),409);const currentVersion=await s.capture(changed);expect(current(await s.check(currentVersion),s.deviceId)).toMatchObject({matches:true,stale:false});
});
it('content comparison ignores station and checklist completion identities while preserving ordered arrangements and actual instructions',()=>{
 const source={title:'Împreună',date:'2026-11-01',time:'09:25',notes:'Instructions',tasks:[{id:'a',text:'Check audio',done:false}],songs:[{id:'a',songId:'local',title:'Cântăm',contentHash:'a'.repeat(64),reviewed:false,arrangement:{name:'Opening',slides:[2,1,2]}}]};
 expect(serviceContent({...source,tasks:[{id:'b',text:'Check audio',done:true}],songs:[{...source.songs[0],id:'b',songId:'other',reviewed:true}]})).toBe(serviceContent(source));expect(serviceContent({...source,songs:[{...source.songs[0],arrangement:{name:'Opening',slides:[1,2]}}]})).not.toBe(serviceContent(source));expect(serviceContent({...source,notes:'Changed'})).not.toBe(serviceContent(source));
});
