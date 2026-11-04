import {z} from 'zod';
import {body,hash,HttpError,json,now} from './core';
import {requireStationMinistry,stationMinistryGuard} from './station-catalog';
import {loadLatestApproved,ensureSavedServiceVersion} from './station-services';
import {serviceContent} from '../shared/service-readiness.js';
import type {ServiceDeskSnapshot,DeskCheck,DeskComputer} from '../shared/service-desk-types';
import type {MinistryAuthority} from './ministry-roles';

const MAX_CHECK_AGE=1800;
const check=z.object({kind:z.enum(['song','font','resource','playlist','manual']),title:z.string().trim().min(1).max(300),reference:z.string().max(60).optional(),status:z.enum(['passed','warning','failed']),message:z.string().max(600)}).strict();
const action=z.object({type:z.literal('check'),versionId:z.string().uuid(),contentHash:z.string().regex(/^[a-f0-9]{64}$/),checks:z.array(check).max(2100)}).strict();
type CheckRow={version_id:string;content_key:string;report_json:string;checked_at:number};
type Approved=NonNullable<Awaited<ReturnType<typeof loadLatestApproved>>>;
function validServiceId(id:string){if(!z.string().uuid().safeParse(id).success)throw new HttpError(400,'Choose a valid service.');}
function catalogueGuard(deviceId:string,approved:Approved){return{
 sql:"NOT EXISTS(SELECT 1 FROM json_each(?) reference LEFT JOIN station_catalog song ON song.device_id=? AND song.song_id=json_extract(reference.value,'$.songId') WHERE song.song_id IS NULL OR song.content_hash<>json_extract(reference.value,'$.contentHash'))",
 params:[JSON.stringify(approved.plan.songs.map(song=>({songId:song.songId,contentHash:song.contentHash}))),deviceId],
};}
function approvedGuard(deviceId:string,serviceId:string,versionId:string){return{
 sql:`EXISTS(SELECT 1 FROM station_service_versions version JOIN station_services service ON service.device_id=version.device_id AND service.id=version.service_id WHERE version.device_id=? AND version.service_id=? AND version.id=? AND service.archived=0 AND service.revision=version.service_revision AND NOT EXISTS(SELECT 1 FROM station_service_versions newer WHERE newer.device_id=version.device_id AND newer.service_id=version.service_id AND newer.service_revision>version.service_revision))`,
 params:[deviceId,serviceId,versionId],
};}
async function snapshot(env:Env,authority:MinistryAuthority,deviceId:string,serviceId:string,native:boolean):Promise<ServiceDeskSnapshot>{
 const guard=stationMinistryGuard(authority,deviceId,'readSongs');
 const source=await env.DB.prepare(`SELECT title,date,time,revision,archived FROM station_services WHERE device_id=? AND id=? AND ${guard.sql}`).bind(deviceId,serviceId,...guard.params).first<{title:string;date:string;time:string;revision:number;archived:number}>();
 if(!source)throw new HttpError(404,'Choose an available service.');
 const approved=source.archived?await loadLatestApproved(env,deviceId,serviceId):await ensureSavedServiceVersion(env,deviceId,serviceId,authority),wanted=approved?await hash(serviceContent(approved.plan)):null,match=approved?.plan||source;
 const devices=(await env.DB.prepare(`SELECT d.id,d.name FROM devices d JOIN users owner ON owner.id=d.owner_id WHERE d.revoked_at IS NULL AND owner.status='active' AND (?='admin' OR EXISTS(SELECT 1 FROM station_memberships membership WHERE membership.device_id=d.id AND membership.user_id=? AND membership.status='approved')) AND NOT EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=d.id AND removed.user_id=?) AND ${guard.sql} ORDER BY (d.id=?) DESC,d.name,d.id LIMIT 50`).bind(authority.user.role,authority.user.id,authority.user.id,...guard.params,deviceId).all<{id:string;name:string}>()).results;
 const computers:DeskComputer[]=[];
 for(const device of devices){
  const access=stationMinistryGuard(authority,device.id,'readSongs');
  const services=device.id===deviceId?[{id:serviceId,revision:source.revision}]:(await env.DB.prepare(`SELECT s.id,s.revision FROM station_services s WHERE s.device_id=? AND s.title=? AND s.date=? AND s.time=? AND s.archived=0 AND ${access.sql} ORDER BY s.updated_at DESC,s.id LIMIT 2`).bind(device.id,match.title,match.date,match.time,...access.params).all<{id:string;revision:number}>()).results;
  const chosen=services.length===1?services[0]:null;
  const base:DeskComputer={deviceId:device.id,name:device.name,serviceId:chosen?.id||null,revision:chosen?.revision??null,approvedRevision:null,matches:false,stale:true,checkedAt:null,checks:[],...(services.length>1?{ambiguous:true}:{})};
  if(chosen){
   const target=await loadLatestApproved(env,device.id,chosen.id);
   const row=await env.DB.prepare(`SELECT version_id,content_key,report_json,checked_at FROM station_service_checks WHERE device_id=? AND service_id=? AND ${access.sql}`).bind(device.id,chosen.id,...access.params).first<CheckRow>();
   base.approvedRevision=target?.serviceRevision??null;
   if(row){
    base.checkedAt=row.checked_at;base.checks=JSON.parse(row.report_json) as DeskCheck[];
    base.matches=!!wanted&&!!target&&target.serviceRevision===chosen.revision&&row.version_id===target.id&&row.content_key===wanted&&await hash(serviceContent(target.plan))===wanted;
    const catalogue=target?catalogueGuard(device.id,target):null;
    const unchanged=catalogue?await env.DB.prepare('SELECT 1 WHERE '+catalogue.sql).bind(...catalogue.params).first():null;
    base.stale=!base.matches||!unchanged||row.checked_at>now()||now()-row.checked_at>=MAX_CHECK_AGE||(device.id===deviceId&&!!source.archived);
    if(!unchanged)base.checks.push({kind:'song',title:'Saved song versions',status:'failed',message:'The library changed after this check. Check this computer again.'});

   }
  }
  computers.push(base);
 }
 // Fence a revocation that arrived while preparing the comparison as well.
 if(!await env.DB.prepare('SELECT 1 WHERE '+guard.sql).bind(...guard.params).first())throw new HttpError(403,'Your access changed. Sign in again.');
 return{serviceId,approvedVersionId:approved?.id||null,approvedRevision:approved?.serviceRevision??null,currentRevision:source.revision,computers,canCheck:native&&authority.kind==='operator'&&!source.archived};
}
export async function readServiceReadiness(request:Request,env:Env,deviceId:string,serviceId:string,native=false){validServiceId(serviceId);const authority=await requireStationMinistry(request,env,deviceId,'readSongs',native);return json(await snapshot(env,authority,deviceId,serviceId,native));}
export async function changeServiceReadiness(request:Request,env:Env,deviceId:string,serviceId:string,native=false){
 validServiceId(serviceId);
 const authority=await requireStationMinistry(request,env,deviceId,'readSongs',native);
 if(!native||authority.kind!=='operator')throw new HttpError(403,'Run this check on the authenticated church computer.');
 const data=await body(request,action,512*1024),approved=await ensureSavedServiceVersion(env,deviceId,serviceId,authority);
 if(!approved||approved.id!==data.versionId)throw new HttpError(409,'The saved service changed. Refresh and check again.');
 const timestamp=now(),guard=stationMinistryGuard(authority,deviceId,'readSongs',timestamp),contentKey=await hash(serviceContent(approved.plan)),version=approvedGuard(deviceId,serviceId,approved.id),catalogue=catalogueGuard(deviceId,approved);

  if(data.contentHash!==approved.contentHash)throw new HttpError(409,'Check the exact saved service version.');
  const required=new Set(approved.plan.songs.map(song=>song.id)),seen=new Set<string>();
  for(const item of data.checks.filter(item=>item.kind==='song')){if(!item.reference||!required.has(item.reference)||seen.has(item.reference))throw new HttpError(400,'Include one check for each saved song appearance.');seen.add(item.reference);}
  if(seen.size!==required.size)throw new HttpError(400,'Check every saved song appearance.');
  const serialized=JSON.stringify(data.checks);if(new TextEncoder().encode(serialized).length>200000)throw new HttpError(400,'The readiness report is too large.');
 const mutation=env.DB.prepare(`INSERT INTO station_service_checks(device_id,service_id,version_id,content_key,report_json,checked_at,checked_by) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql} AND ${version.sql} AND ${catalogue.sql} ON CONFLICT(device_id,service_id) DO UPDATE SET version_id=excluded.version_id,content_key=excluded.content_key,report_json=excluded.report_json,checked_at=excluded.checked_at,checked_by=excluded.checked_by,acknowledged_at=NULL,acknowledged_by=NULL`).bind(deviceId,serviceId,approved.id,contentKey,serialized,timestamp,authority.user.id,...guard.params,...version.params,...catalogue.params);

 const results=await env.DB.batch([mutation,env.DB.prepare('INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,?,?,? WHERE changes()>0').bind(crypto.randomUUID(),authority.user.id,'service-readiness-'+data.type,deviceId,timestamp)]);
 if(!results[0].meta.changes)throw new HttpError(409,'The saved service, your access or its song files changed. Refresh and check again.');
 return json(await snapshot(env,authority,deviceId,serviceId,native));
}
