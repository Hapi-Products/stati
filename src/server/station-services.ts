import {z} from 'zod';
import {body,hash as fingerprint,HttpError,json,now} from './core';
import type {MinistryAuthority} from './ministry-roles';
import {requireStationMinistry,stationMinistryGuard} from './station-catalog';
import {serviceLeadershipAction,isLeadershipAction,changeServiceLeadership,serviceLeadershipMap,serviceOrderGuard} from './service-leadership';

const identifier=z.string().regex(/^[\w-]{20,60}$/),hash=z.string().regex(/^[a-f0-9]{64}$/),time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;},'Choose a valid service date.');
const arrangement=z.object({name:z.string().trim().min(1).max(80),slides:z.array(z.number().int().min(1).max(500)).min(1).max(500)}).strict();
const song=z.object({id:identifier,songId:hash,contentHash:hash,title:z.string().min(1).max(300),filename:z.string().max(255),reviewed:z.boolean(),arrangement:arrangement.optional()}).strict();
const task=z.object({id:identifier,text:z.string().trim().min(1).max(120),done:z.boolean()}).strict();
const content=z.object({title:z.string().trim().min(1).max(80),date,time,notes:z.string().max(5000),reviewed:z.boolean(),archived:z.boolean(),tasks:z.array(task).max(50),songs:z.array(song).max(1000),templateId:identifier.optional()}).strict();
const plan=content.extend({id:z.string().uuid(),revision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),active:z.boolean().optional(),approvedVersionId:z.string().uuid().optional(),approvedRevision:z.number().int().min(1).optional(),status:z.string().max(120).optional(),leadership:z.unknown().optional(),templateId:identifier.optional(),playlist:z.object({phase:z.enum(['waiting','error','synced','disabled','review']),message:z.string().max(600),playlistName:z.string().max(180).optional()}).optional()}).strict();
const reference=z.object({songId:hash,contentHash:hash,title:z.string().max(300).optional(),filename:z.string().max(255).optional()}).strict();
export const stationServiceAction=z.discriminatedUnion('type',[
 ...serviceLeadershipAction.options,
 z.object({type:z.literal('create'),title:z.string().trim().min(1).max(80),date,time}).strict(),
 z.object({type:z.literal('save'),id:z.string().uuid(),plan}).strict(),
 z.object({type:z.literal('duplicate'),id:z.string().uuid(),date:date.optional()}).strict(),
 z.object({type:z.literal('archive'),id:z.string().uuid(),archived:z.boolean()}).strict(),
 z.object({type:z.literal('select'),id:z.string().uuid().nullable()}).strict(),
 z.object({type:z.literal('import'),plan}).strict(),
 z.object({type:z.literal('attach-songs'),expectedActiveServiceId:z.string().uuid(),songs:z.array(reference).max(1000)}).strict(),
]);
type Content=z.infer<typeof content>;
type Plan=z.infer<typeof plan>;
type Stored={id:string;title:string;date:string;time:string;archived:number;revision:number;content_json:string};
const MAX_STATION_BYTES=2*1024*1024;
function payload(value:Content):Content{return{title:value.title,date:value.date,time:value.time,notes:value.notes,reviewed:value.reviewed,archived:value.archived,tasks:value.tasks,songs:value.songs,...(value.templateId?{templateId:value.templateId}:{})};}
function validateUnique(value:Content){if(new Set(value.songs.map(song=>song.id)).size!==value.songs.length||new Set(value.tasks.map(task=>task.id)).size!==value.tasks.length)throw new HttpError(400,'Use unique song appearances and checklist identifiers.');}
function decode(row:Stored,activeServiceId:string|null):Plan{const value=content.parse(JSON.parse(row.content_json));return{...value,id:row.id,revision:row.revision,active:row.id===activeServiceId};}
async function list(env:Env,deviceId:string,authority:MinistryAuthority){
 const guard=stationMinistryGuard(authority,deviceId,'readSongs');
 const rows=(await env.DB.prepare(`SELECT id,title,date,time,archived,revision,content_json FROM station_services WHERE device_id=? AND ${guard.sql} ORDER BY date,time,id LIMIT 100`).bind(deviceId,...guard.params).all<Stored>()).results;
 const selected=await env.DB.prepare(`SELECT selection.service_id FROM station_service_selections selection JOIN station_services service ON service.device_id=selection.device_id AND service.id=selection.service_id AND service.archived=0 WHERE selection.device_id=? AND ${guard.sql}`).bind(deviceId,...guard.params).first<{service_id:string}>();
 const activeServiceId=selected?.service_id||null,plans=rows.map(row=>decode(row,activeServiceId)),leadership=await serviceLeadershipMap(env,deviceId,authority,plans);return{plans:plans.map(plan=>({...plan,leadership:leadership.get(plan.id)})),activeServiceId};
}
export async function readStationServices(request:Request,env:Env,deviceId:string,native=false){const authority=await requireStationMinistry(request,env,deviceId,'readSongs',native);return json(await list(env,deviceId,authority));}
async function canonicalSongs(env:Env,deviceId:string,songs:Content['songs']){
 if(!songs.length)return songs;const ids=[...new Set(songs.map(song=>song.songId))];
 const rows=(await env.DB.prepare('SELECT song_id,title,filename,content_hash FROM station_catalog WHERE device_id=? AND song_id IN(SELECT value FROM json_each(?))').bind(deviceId,JSON.stringify(ids)).all<{song_id:string;title:string;filename:string;content_hash:string}>()).results,byId=new Map(rows.map(row=>[row.song_id,row]));
 return songs.map(song=>{const actual=byId.get(song.songId);if(!actual||actual.content_hash!==song.contentHash)throw new HttpError(409,'A selected song changed or is no longer available on this computer. Refresh its library and try again.');return{...song,title:actual.title,filename:actual.filename};});
}
function catalogueGuard(deviceId:string,songs:Content['songs']){return{sql:`NOT EXISTS(SELECT 1 FROM json_each(?) reference LEFT JOIN station_catalog song ON song.device_id=? AND song.song_id=json_extract(reference.value,'$.songId') WHERE song.song_id IS NULL OR song.content_hash<>json_extract(reference.value,'$.contentHash'))`,params:[JSON.stringify(songs.map(song=>({songId:song.songId,contentHash:song.contentHash}))),deviceId]};}
export async function changeStationService(request:Request,env:Env,deviceId:string,native=false){
 const authority=await requireStationMinistry(request,env,deviceId,'readSongs',native),data=await body(request,stationServiceAction,512*1024);
 if(isLeadershipAction(data)){await changeServiceLeadership(env,deviceId,authority,data,native);return json(await list(env,deviceId,authority));}
 const assignedPastor=authority.ministryRole==='pastor'&&['save','archive'].includes(data.type);
 if(!authority.capabilities.planServices&&!assignedPastor)throw new HttpError(403,'Your role does not allow this action.');
 if(data.type==='attach-songs'&&(!native||authority.kind!=='operator'))throw new HttpError(403,'Only the authenticated computer can attach newly saved songs.');
 const timestamp=now(),guard=stationMinistryGuard(authority,deviceId,assignedPastor?'readSongs':'planServices',timestamp),auditId=crypto.randomUUID();
 const audited={sql:'EXISTS(SELECT 1 FROM audit WHERE id=? AND actor_id=? AND subject_id=?)',params:[auditId,authority.user.id,deviceId]};
 const mutationAudit=()=>env.DB.prepare('INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,?,?,? WHERE changes()>0').bind(auditId,authority.user.id,'station-service-'+data.type,deviceId,timestamp);
 if(data.type==='select'){
  const selected=await env.DB.batch([
   env.DB.prepare(`INSERT INTO station_service_selections(device_id,service_id,updated_by,updated_at) SELECT ?,?,?,? WHERE ${guard.sql} AND (? IS NULL OR EXISTS(SELECT 1 FROM station_services WHERE device_id=? AND id=? AND archived=0)) ON CONFLICT(device_id) DO UPDATE SET service_id=excluded.service_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(deviceId,data.id,authority.user.id,timestamp,...guard.params,data.id,deviceId,data.id),mutationAudit(),
  ]);
  if(!selected[0].meta.changes)throw new HttpError(409,'The service or your computer access changed. Refresh and try again.');return json(await list(env,deviceId,authority));
 }
 const sourceId=data.type==='attach-songs'?data.expectedActiveServiceId:data.type==='create'?null:data.type==='import'?data.plan.id:data.id;
 const existing=sourceId?await env.DB.prepare(`SELECT id,title,date,time,archived,revision,content_json FROM station_services WHERE device_id=? AND id=? AND ${guard.sql}`).bind(deviceId,sourceId,...guard.params).first<Stored>():null;
 if(data.type==='import'&&existing){
  // A second PC/profile can import the same stable identifier without replacing
  // the station's newer shared plan. The original local copy remains its backup.
  return json({...await list(env,deviceId,authority),imported:false});
 }
 if(!['create','import'].includes(data.type)&&!existing)throw new HttpError(404,'This service is unavailable on this computer.');
 let id:string,revision:number,next:Content,previousRevision:number|null=null;
 if(data.type==='create'){id=crypto.randomUUID();revision=1;next={title:data.title,date:data.date,time:data.time,notes:'',reviewed:false,archived:false,tasks:[],songs:[]};}
 else if(data.type==='import'){id=data.plan.id;revision=Math.max(1,data.plan.revision);next=payload(data.plan);}
 else{
  const saved=decode(existing!,null);previousRevision=saved.revision;id=saved.id;revision=saved.revision+1;
  if(data.type==='save'){if(data.plan.id!==data.id||data.plan.revision!==saved.revision)throw new HttpError(409,'This service changed while it was being edited. Reload it before saving.');next=payload({...data.plan,archived:saved.archived});}
  else if(data.type==='duplicate'){id=crypto.randomUUID();revision=1;next={...payload(saved),title:saved.title.slice(0,73)+' (copy)',date:data.date||saved.date,archived:false,reviewed:false,tasks:saved.tasks.map(task=>({...task,id:crypto.randomUUID(),done:false})),songs:saved.songs.map(song=>({...song,id:crypto.randomUUID(),reviewed:false}))};}
  else if(data.type==='archive')next={...payload(saved),archived:data.archived};
  else{if(saved.archived)throw new HttpError(409,'Choose an active service.');const songs=saved.songs.map(song=>({...song}));for(const source of data.songs){const found=songs.find(song=>song.songId===source.songId),entry={id:found?.id||crypto.randomUUID(),songId:source.songId,contentHash:source.contentHash,title:source.title||found?.title||'Song',filename:source.filename||found?.filename||'',reviewed:found?.contentHash===source.contentHash?found.reviewed:false};if(found)Object.assign(found,entry);else songs.push(entry);}if(songs.length>1000)throw new HttpError(400,'Use up to 1000 songs per service.');next={...payload(saved),songs,reviewed:false};}
 }
 validateUnique(next);next={...next,songs:await canonicalSongs(env,deviceId,next.songs)};const serialized=JSON.stringify(next),catalogue=catalogueGuard(deviceId,next.songs),selection=data.type==='attach-songs'?{sql:'EXISTS(SELECT 1 FROM station_service_selections WHERE device_id=? AND service_id=?)',params:[deviceId,data.expectedActiveServiceId]}:{sql:'1=1',params:[] as (string|number|null)[]};
 const capacity={sql:'(SELECT COALESCE(SUM(length(CAST(content_json AS BLOB))),0) FROM station_services WHERE device_id=? AND id<>?)+?<=?',params:[deviceId,id,new TextEncoder().encode(serialized).length,MAX_STATION_BYTES]};
 const insert=['create','import','duplicate'].includes(data.type),source=data.type==='duplicate'?{sql:'EXISTS(SELECT 1 FROM station_services WHERE device_id=? AND id=? AND revision=?)',params:[deviceId,sourceId,previousRevision]}:{sql:'1=1',params:[] as (string|number|null)[]};
 const order=['save','archive','attach-songs'].includes(data.type)?serviceOrderGuard(authority,deviceId,id):{sql:'1=1',params:[] as (string|number|null)[]};
 if(['save','archive','attach-songs'].includes(data.type)&&!await env.DB.prepare('SELECT 1 WHERE '+order.sql).bind(...order.params).first())throw new HttpError(403,'Only the selected service leader can edit this running order. An authorized backup can take over first.');
 const condition=`${guard.sql} AND ${catalogue.sql} AND ${selection.sql} AND ${capacity.sql} AND ${source.sql} AND ${order.sql}`,params=[...guard.params,...catalogue.params,...selection.params,...capacity.params,...source.params,...order.params];
 const mutation=insert?env.DB.prepare(`INSERT INTO station_services(device_id,id,title,date,time,archived,revision,content_json,created_by,updated_by,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${condition} AND (SELECT COUNT(*) FROM station_services WHERE device_id=?)<100 ON CONFLICT(device_id,id) DO NOTHING`).bind(deviceId,id,next.title,next.date,next.time,next.archived?1:0,revision,serialized,authority.user.id,authority.user.id,timestamp,timestamp,...params,deviceId):env.DB.prepare(`UPDATE station_services SET title=?,date=?,time=?,archived=?,revision=?,content_json=?,updated_by=?,updated_at=? WHERE device_id=? AND id=? AND revision=? AND ${condition}`).bind(next.title,next.date,next.time,next.archived?1:0,revision,serialized,authority.user.id,timestamp,deviceId,id,previousRevision,...params);
 const statements=[mutation,mutationAudit()];
 if(data.type==='create'||data.type==='duplicate')statements.push(env.DB.prepare(`INSERT INTO station_service_selections(device_id,service_id,updated_by,updated_at) SELECT ?,?,?,? WHERE ${audited.sql} ON CONFLICT(device_id) DO UPDATE SET service_id=excluded.service_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(deviceId,id,authority.user.id,timestamp,...audited.params));
 if(data.type==='archive'&&data.archived)statements.push(env.DB.prepare(`UPDATE station_service_selections SET service_id=NULL,updated_by=?,updated_at=? WHERE device_id=? AND service_id=? AND ${audited.sql}`).bind(authority.user.id,timestamp,deviceId,id,...audited.params));
 const result=await env.DB.batch(statements);if(!result[0].meta.changes)throw new HttpError(409,'The service, song library or your computer access changed, or the service storage is full. Refresh and try again.');
 return json({...await list(env,deviceId,authority),...(data.type==='import'?{imported:true}:{})});
}

type VersionRow={id:string;service_revision:number;content_hash:string;content_json:string;lyrics_json:string;approved_by:string;approved_by_label:string;approved_at:number};
export type VersionLyrics={songId:string;contentHash:string;title:string;filename:string;text:string;fontSize:number;available:boolean;matchesReference:boolean};
const MAX_VERSION_BYTES=1024*1024;
function versionSummary(row:VersionRow){return{id:row.id,serviceRevision:row.service_revision,approvedAt:row.approved_at,approvedBy:row.approved_by,approvedByLabel:row.approved_by_label,contentHash:row.content_hash};}
/** Internal binding helper. Callers must authorize readSongs for this station
 * first, and recheck their own authority/revision guard before any mutation. */
export async function loadLatestApproved(env:Env,deviceId:string,serviceId:string){
 const row=await env.DB.prepare('SELECT * FROM station_service_versions WHERE device_id=? AND service_id=? ORDER BY service_revision DESC LIMIT 1').bind(deviceId,serviceId).first<VersionRow>();
 return row?{...versionSummary(row),plan:JSON.parse(row.content_json) as Plan,lyrics:JSON.parse(row.lyrics_json) as VersionLyrics[]}:null;
}
async function versionLyrics(env:Env,deviceId:string,songs:Content['songs']):Promise<VersionLyrics[]>{
 const ids=[...new Set(songs.map(song=>song.songId))];if(!ids.length)return[];
 const rows=(await env.DB.prepare('SELECT song_id,title,filename,content_hash,text,font_size FROM station_catalog WHERE device_id=? AND song_id IN(SELECT value FROM json_each(?))').bind(deviceId,JSON.stringify(ids)).all<{song_id:string;title:string;filename:string;content_hash:string;text:string;font_size:number}>()).results,byId=new Map(rows.map(row=>[row.song_id,row]));
 return ids.map(songId=>{const reference=songs.find(song=>song.songId===songId)!,row=byId.get(songId),matchesReference=!!row&&songs.filter(song=>song.songId===songId).every(song=>song.contentHash===row.content_hash);return{songId,contentHash:row?.content_hash||reference.contentHash,title:row?.title||reference.title,filename:row?.filename||reference.filename,text:row?.text||'',fontSize:row?.font_size||96,available:!!row,matchesReference};});
}
export async function readStationServiceVersions(request:Request,env:Env,deviceId:string,serviceId:string,native=false){
 if(!z.string().uuid().safeParse(serviceId).success)throw new HttpError(400,'Choose a valid service.');
 const authority=await requireStationMinistry(request,env,deviceId,'readSongs',native),guard=stationMinistryGuard(authority,deviceId,'readSongs');
 const captured=new URL(request.url).searchParams.get('current')==='true'?await ensureSavedServiceVersion(env,deviceId,serviceId,authority):null;
 const current=await env.DB.prepare(`SELECT id,title,date,time,archived,revision,content_json FROM station_services WHERE device_id=? AND id=? AND ${guard.sql}`).bind(deviceId,serviceId,...guard.params).first<Stored>();if(!current)throw new HttpError(404,'Service unavailable.');if(captured&&captured.serviceRevision!==current.revision)throw new HttpError(409,'The saved service changed while its copy was being prepared. Refresh and try again.');
 const rows=(await env.DB.prepare(`SELECT id,service_revision,content_hash,approved_by,approved_by_label,approved_at FROM station_service_versions WHERE device_id=? AND service_id=? AND ${guard.sql} ORDER BY service_revision DESC LIMIT 50`).bind(deviceId,serviceId,...guard.params).all<VersionRow>()).results;
 const requested=new URL(request.url).searchParams.get('versionId');if(requested&&!z.string().uuid().safeParse(requested).success)throw new HttpError(400,'Choose a saved version.');
 const selected=requested||rows[0]?.id,row=selected?await env.DB.prepare(`SELECT * FROM station_service_versions WHERE device_id=? AND service_id=? AND id=? AND ${guard.sql}`).bind(deviceId,serviceId,selected,...guard.params).first<VersionRow>():null;
 if(requested&&!row)throw new HttpError(404,'Saved service version unavailable.');const plan=decode(current,null),lyrics=await versionLyrics(env,deviceId,plan.songs);
 if(new TextEncoder().encode(JSON.stringify({plan,lyrics})).length>MAX_VERSION_BYTES)throw new HttpError(413,'This service contains too much lyric text to compare at once. Split it into smaller services.');
 return json({versions:rows.map(versionSummary),latestApproved:rows[0]?versionSummary(rows[0]):null,snapshot:row?{...versionSummary(row),plan:JSON.parse(row.content_json),lyrics:JSON.parse(row.lyrics_json)}:null,current:{plan,lyrics},canApprove:authority.capabilities.planServices});
}
/** Capture the current saved revision automatically for file checks/offline copies.
 * This is a history copy, not an approval or a second authorization step. */
export async function ensureSavedServiceVersion(env:Env,deviceId:string,serviceId:string,authority:MinistryAuthority,expectedRevision?:number,capability:'readSongs'|'planServices'='readSongs'){
 const timestamp=now(),guard=stationMinistryGuard(authority,deviceId,capability,timestamp);
 const current=await env.DB.prepare(`SELECT id,title,date,time,archived,revision,content_json FROM station_services WHERE device_id=? AND id=? AND ${guard.sql}`).bind(deviceId,serviceId,...guard.params).first<Stored>();
 if(!current)throw new HttpError(404,'Service unavailable.');if(current.archived||expectedRevision!==undefined&&current.revision!==expectedRevision)throw new HttpError(409,'This service changed. Refresh the latest saved service.');
 const cachedGuard=stationMinistryGuard(authority,deviceId,capability),existing=await env.DB.prepare(`SELECT * FROM station_service_versions version WHERE version.device_id=? AND version.service_id=? AND version.service_revision=? AND ${cachedGuard.sql} AND EXISTS(SELECT 1 FROM station_services service WHERE service.device_id=? AND service.id=? AND service.revision=? AND service.archived=0 AND service.content_json=?)`).bind(deviceId,serviceId,current.revision,...cachedGuard.params,deviceId,serviceId,current.revision,current.content_json).first<VersionRow>();
 if(existing)return{...versionSummary(existing),plan:JSON.parse(existing.content_json) as Plan,lyrics:JSON.parse(existing.lyrics_json) as VersionLyrics[]};
 const source:Plan={...payload(decode(current,null)),id:current.id,revision:current.revision},observed=await versionLyrics(env,deviceId,source.songs),lyrics=observed.map(song=>song.matchesReference?song:{...song,contentHash:source.songs.find(ref=>ref.songId===song.songId)!.contentHash,text:'',available:false}),contentJson=JSON.stringify(source),lyricsJson=JSON.stringify(lyrics),bytes=new TextEncoder().encode(contentJson+lyricsJson).length;
 if(bytes>MAX_VERSION_BYTES)throw new HttpError(413,'This service contains too much lyric text for one saved copy. Split it into smaller services.');
 const id=crypto.randomUUID(),contentHash=await fingerprint(JSON.stringify({plan:source,lyrics})),label=authority.user.first_name+' '+authority.user.last_initial+'.';
 // Fence the exact catalog observation, including unavailable sources, without
 // requiring a person to approve or mark any song as reviewed.
 const catalogSql=`NOT EXISTS(SELECT 1 FROM json_each(?) saved LEFT JOIN station_catalog current ON current.device_id=? AND current.song_id=json_extract(saved.value,'$.songId') WHERE (json_extract(saved.value,'$.available')=0 AND current.song_id IS NOT NULL) OR (json_extract(saved.value,'$.available')=1 AND (current.song_id IS NULL OR current.content_hash<>json_extract(saved.value,'$.contentHash') OR current.text<>json_extract(saved.value,'$.text') OR current.title<>json_extract(saved.value,'$.title') OR current.filename<>json_extract(saved.value,'$.filename') OR current.font_size<>json_extract(saved.value,'$.fontSize'))))`;
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO station_service_versions(id,device_id,service_id,service_revision,content_hash,content_json,lyrics_json,approved_by,approved_by_label,approved_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql} AND EXISTS(SELECT 1 FROM station_services WHERE device_id=? AND id=? AND revision=? AND archived=0 AND content_json=?) AND ${catalogSql} AND (SELECT COUNT(*) FROM station_service_versions WHERE device_id=? AND service_id=?)<50 AND (SELECT COALESCE(SUM(length(CAST(content_json AS BLOB))+length(CAST(lyrics_json AS BLOB))),0) FROM station_service_versions WHERE device_id=?)+?<=? ON CONFLICT(device_id,service_id,service_revision) DO NOTHING`).bind(id,deviceId,serviceId,current.revision,contentHash,contentJson,lyricsJson,authority.user.id,label,timestamp,...guard.params,deviceId,serviceId,current.revision,current.content_json,JSON.stringify(observed),deviceId,deviceId,serviceId,deviceId,bytes,20*1024*1024),
  env.DB.prepare("INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,'station-service-snapshot',?,? WHERE changes()>0").bind(crypto.randomUUID(),authority.user.id,deviceId,timestamp),
 ]);
 const freshGuard=stationMinistryGuard(authority,deviceId,capability),row=await env.DB.prepare(`SELECT * FROM station_service_versions version WHERE version.device_id=? AND version.service_id=? AND version.service_revision=? AND ${freshGuard.sql} AND EXISTS(SELECT 1 FROM station_services WHERE device_id=? AND id=? AND revision=? AND archived=0)`).bind(deviceId,serviceId,current.revision,...freshGuard.params,deviceId,serviceId,current.revision).first<VersionRow>();
 if(!row)throw new HttpError(409,'The service, files or your access changed, or history storage is full. Refresh and try again.');return{...versionSummary(row),plan:JSON.parse(row.content_json) as Plan,lyrics:JSON.parse(row.lyrics_json) as VersionLyrics[]};
}
export async function saveStationServiceVersion(request:Request,env:Env,deviceId:string,serviceId:string,native=false){
 if(!z.string().uuid().safeParse(serviceId).success)throw new HttpError(400,'Choose a valid service.');const authority=await requireStationMinistry(request,env,deviceId,'planServices',native),data=await body(request,z.object({expectedRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1)}).strict());
 const saved=await ensureSavedServiceVersion(env,deviceId,serviceId,authority,data.expectedRevision,'planServices');return readStationServiceVersions(new Request(new URL('?versionId='+saved.id,request.url),{headers:request.headers}),env,deviceId,serviceId,native);
}
// Legacy server callers keep working; no product flow requires approval.
export const approveStationServiceVersion=saveStationServiceVersion;
