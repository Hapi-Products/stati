import {z} from 'zod';
import {body,cookie,hash,HttpError,json,now,type Device,type User} from './core';
import {requireMinistryCapability,ministryAuthorityGuard,ministryCapabilities,type MinistryAuthority,type MinistryCapability,type MinistryRole} from './ministry-roles';

// Callers supply SQL expressions for the authenticated actor, never request input.
function stationConnectionCheck(actorId:string,actorRole:string){
 return `EXISTS(SELECT 1 FROM devices computer JOIN users owner ON owner.id=computer.owner_id
 WHERE computer.id=? AND NOT EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=computer.id AND removed.user_id=${actorId}) AND computer.revoked_at IS NULL AND owner.status='active'
 AND (${actorRole}='admin' OR EXISTS(SELECT 1 FROM station_memberships membership WHERE membership.device_id=computer.id AND membership.user_id=${actorId} AND membership.status='approved')))`;
}
export function stationMinistryGuard(authority:MinistryAuthority,deviceId:string,capability:MinistryCapability,time=now()){
 const access=ministryAuthorityGuard(authority,capability,time);
 return{sql:`${access.sql} AND ${stationConnectionCheck('?','?')}`,params:[...access.params,deviceId,authority.user.id,authority.user.role,authority.user.id]};
}
export async function requireStationMinistry(request:Request,env:Env,deviceId:string,capability:MinistryCapability,native=false){
 const authority=await requireMinistryCapability(request,env,capability,native?deviceId:undefined),guard=stationMinistryGuard(authority,deviceId,capability);
 if(!authority.capabilities.sendFiles&&new URL(request.url).pathname.includes('/services'))throw new HttpError(403,'Your role allows song comments only.');
 if(!await env.DB.prepare('SELECT 1 WHERE '+guard.sql).bind(...guard.params).first())throw new HttpError(403,'Connect to this computer and wait for approval first.');
 return authority;
}
// Authenticate and check the computer and group together. The read/write
// statements below still recheck access in case it changes during a request.
export async function requireSongStation(request:Request,env:Env,deviceId:string,groupId?:string):Promise<MinistryAuthority> {
 const raw = cookie(request,'stati_session');
 if (!raw) throw new HttpError(401,'Sign in with your passkey to continue.');
 const sessionHash = await hash(raw);
 const groupCheck = groupId === undefined ? '1' : `EXISTS(
  SELECT 1 FROM worship_groups wg JOIN worship_group_members gm ON gm.group_id=wg.id
  WHERE wg.id=? AND wg.archived_at IS NULL AND gm.user_id=actor.id
 )`;
 const args = groupId === undefined ? [deviceId] : [deviceId,groupId];
 const row = await env.DB.prepare(`SELECT actor.*, ministry.role AS ministryRole,
   ${stationConnectionCheck('actor.id','actor.role')} AS stationAccess, ${groupCheck} AS groupAccess
  FROM sessions authentication JOIN users actor ON actor.id=authentication.user_id
  LEFT JOIN user_ministry_roles ministry ON ministry.user_id=actor.id
  WHERE authentication.token_hash=? AND authentication.expires_at>? AND actor.status<>'removed'`)
  .bind(...args,sessionHash,now()).first<User & {ministryRole:MinistryRole|null;stationAccess:number;groupAccess:number}>();
 if (!row) throw new HttpError(401,'Sign in with your passkey to continue.');
 if (row.status !== 'active') throw new HttpError(403,'An administrator or worship leader needs to approve your account.');
 const {ministryRole,stationAccess,groupAccess,...user} = row;
 const capabilities = ministryCapabilities(user,ministryRole);
 if (!capabilities.readSongs) throw new HttpError(403,'Your role does not allow this action.');
 if (!stationAccess) throw new HttpError(403,'Connect to this computer and wait for approval first.');
 if (!groupAccess) throw new HttpError(403,'Choose a worship group you belong to.');
 return {user,ministryRole,capabilities,kind:'session',sessionHash,operator:null};
}

const entry=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),contentHash:z.string().regex(/^[a-f0-9]{64}$/),title:z.string().min(1).max(300),filename:z.string().max(255),category:z.string().max(100),language:z.enum(['eng','ron','unknown']),fontSize:z.number().int().min(32).max(160),text:z.string().max(100000),firstSlide:z.string().max(2000),addedAt:z.number().int().nonnegative(),modifiedAt:z.number().int().nonnegative(),groupName:z.string().trim().min(1).max(80).nullable().optional(),sourceSongId:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional()}).strict();
const snapshot=z.discriminatedUnion('action',[
 z.object({action:z.literal('begin'),generation:z.string().uuid(),count:z.number().int().min(0).max(10000),unreadable:z.number().int().min(0).max(10000)}).strict(),
 z.object({action:z.literal('chunk'),generation:z.string().uuid(),songs:z.array(entry).min(1).max(40)}).strict(),
 z.object({action:z.literal('finish'),generation:z.string().uuid()}).strict(),
]);
function deviceGuard(deviceId:string,credentialHash:string){return{sql:"EXISTS(SELECT 1 FROM devices computer JOIN users owner ON owner.id=computer.owner_id WHERE computer.id=? AND computer.token_hash=? AND computer.revoked_at IS NULL AND owner.status='active')",params:[deviceId,credentialHash]};}
export async function publishStationCatalog(request:Request,env:Env,device:Device,onCommitted?:()=>void){
 const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer ')||!authorization.slice(7))throw new HttpError(401,'Pair this computer first.');
 const data=await body(request,snapshot,512*1024),credentialHash=await hash(authorization.slice(7)),deviceAccess=deviceGuard(device.id,credentialHash),time=now();
 const live={sql:`EXISTS(SELECT 1 FROM station_catalog_snapshots snapshot WHERE snapshot.device_id=? AND snapshot.generation=? AND snapshot.status='pending' AND snapshot.updated_at>? AND ${deviceAccess.sql})`,params:[device.id,data.generation,time-3600,...deviceAccess.params]};
 if(data.action==='begin'){
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT INTO station_catalog_snapshots(device_id,generation,expected_count,unreadable,status,updated_at) SELECT ?,?,?,?,'pending',? WHERE ${deviceAccess.sql} ON CONFLICT(device_id) DO UPDATE SET generation=excluded.generation,expected_count=excluded.expected_count,unreadable=excluded.unreadable,status='pending',updated_at=excluded.updated_at`).bind(device.id,data.generation,data.count,data.unreadable,time,...deviceAccess.params),
   env.DB.prepare(`DELETE FROM station_catalog_staging WHERE device_id=? AND ${deviceAccess.sql}`).bind(device.id,...deviceAccess.params),
  ]);
  if(!result[0].meta.changes)throw new HttpError(409,'The computer connection changed.');
 }else if(data.action==='chunk'){
  if(new Set(data.songs.map(song=>song.id)).size!==data.songs.length)throw new HttpError(400,'Use unique song identifiers in each catalog chunk.');
  const entries=data.songs.map(song=>({...song,searchText:normalize(song.title+' '+song.text+' '+(song.groupName||'')),payloadBytes:new TextEncoder().encode(JSON.stringify(song)).byteLength})),encoded=JSON.stringify(entries);
  // All chunk-wide aggregates are uncorrelated scalar subqueries: evaluate once
  // for up to 40 songs, rather than rescanning the entire staging table per song.
  const [result]=await env.DB.batch([env.DB.prepare(`INSERT INTO station_catalog_staging(device_id,song_id,title,content_hash,filename,category,language,font_size,text,first_slide,added_at,modified_at,generation,search_text,payload_bytes,group_name,source_song_id)
   SELECT ?,json_extract(incoming.value,'$.id'),json_extract(incoming.value,'$.title'),json_extract(incoming.value,'$.contentHash'),json_extract(incoming.value,'$.filename'),json_extract(incoming.value,'$.category'),json_extract(incoming.value,'$.language'),json_extract(incoming.value,'$.fontSize'),json_extract(incoming.value,'$.text'),json_extract(incoming.value,'$.firstSlide'),json_extract(incoming.value,'$.addedAt'),json_extract(incoming.value,'$.modifiedAt'),?,json_extract(incoming.value,'$.searchText'),json_extract(incoming.value,'$.payloadBytes'),json_extract(incoming.value,'$.groupName'),json_extract(incoming.value,'$.sourceSongId') FROM json_each(?) incoming
   WHERE ${live.sql}
   AND (SELECT COUNT(*) FROM station_catalog_staging WHERE device_id=? AND generation=?)
    +(SELECT COUNT(*) FROM json_each(?) item LEFT JOIN station_catalog_staging old ON old.device_id=? AND old.generation=? AND old.song_id=json_extract(item.value,'$.id') WHERE old.song_id IS NULL)
    <=(SELECT expected_count FROM station_catalog_snapshots WHERE device_id=? AND generation=?)
   AND (SELECT COALESCE(SUM(payload_bytes),0) FROM station_catalog_staging WHERE device_id=? AND generation=?)
    -(SELECT COALESCE(SUM(old.payload_bytes),0) FROM station_catalog_staging old WHERE old.device_id=? AND old.generation=? AND old.song_id IN(SELECT json_extract(value,'$.id') FROM json_each(?)))
    +(SELECT SUM(json_extract(value,'$.payloadBytes')) FROM json_each(?))<=8388608
   ON CONFLICT(device_id,generation,song_id) DO UPDATE SET title=excluded.title,content_hash=excluded.content_hash,filename=excluded.filename,category=excluded.category,language=excluded.language,font_size=excluded.font_size,text=excluded.text,first_slide=excluded.first_slide,added_at=excluded.added_at,modified_at=excluded.modified_at,search_text=excluded.search_text,payload_bytes=excluded.payload_bytes,group_name=excluded.group_name,source_song_id=excluded.source_song_id`)
   .bind(device.id,data.generation,encoded,...live.params,device.id,data.generation,encoded,device.id,data.generation,device.id,data.generation,device.id,data.generation,device.id,data.generation,encoded,encoded)]);
  if(result.meta.changes!==data.songs.length)throw new HttpError(409,'This library update expired, was replaced or exceeded its limits.');
 }else{
  const committing={sql:"EXISTS(SELECT 1 FROM station_catalog_snapshots snapshot WHERE snapshot.device_id=? AND snapshot.generation=? AND snapshot.status='committing')",params:[device.id,data.generation]};
  const result=await env.DB.batch([
   env.DB.prepare(`UPDATE station_catalog_snapshots SET status='committing',updated_at=? WHERE device_id=? AND generation=? AND status='pending' AND updated_at>? AND expected_count=(SELECT COUNT(*) FROM station_catalog_staging song WHERE song.device_id=? AND song.generation=?) AND (expected_count>0 OR unreadable=0) AND ${deviceAccess.sql}`).bind(time,device.id,data.generation,time-3600,device.id,data.generation,...deviceAccess.params),
   env.DB.prepare('DELETE FROM station_catalog WHERE device_id=? AND '+committing.sql).bind(device.id,...committing.params),
   env.DB.prepare('INSERT INTO station_catalog SELECT * FROM station_catalog_staging WHERE device_id=? AND generation=? AND '+committing.sql).bind(device.id,data.generation,...committing.params),
   env.DB.prepare("UPDATE station_catalog_snapshots SET status='ready',ready_at=updated_at,ready_unreadable=unreadable WHERE device_id=? AND generation=? AND status='committing'").bind(device.id,data.generation),
   env.DB.prepare("DELETE FROM station_catalog_staging WHERE device_id=? AND generation=? AND EXISTS(SELECT 1 FROM station_catalog_snapshots snapshot WHERE snapshot.device_id=? AND snapshot.generation=? AND snapshot.status='ready')").bind(device.id,data.generation,device.id,data.generation),
  ]);
  if(!result[0].meta.changes)throw new HttpError(409,'The complete library has not arrived. The previous library has been kept.');
  onCommitted?.();
 }
 return json({ok:true});
}
export async function readStationCatalog(request:Request,env:Env,deviceId:string,songId?:string){
 const authority=songId ? await requireSongStation(request,env,deviceId) : await requireStationMinistry(request,env,deviceId,'readSongs');
 const guard=stationMinistryGuard(authority,deviceId,'readSongs'),url=new URL(request.url);
 if(songId){const song=await env.DB.prepare(`SELECT song_id AS id,content_hash AS contentHash,title,filename,category,language,font_size AS fontSize,text,first_slide AS firstSlide,added_at AS addedAt,modified_at AS modifiedAt,group_name AS groupName,source_song_id AS sourceSongId FROM station_catalog WHERE device_id=? AND song_id=? AND ${guard.sql}`).bind(deviceId,songId,...guard.params).first();if(!song)throw new HttpError(404,'This song is unavailable.');return json(song);}
 const data=z.object({includeText:z.enum(['0','1']),limit:z.coerce.number().int().min(1).max(500),query:z.string().max(200),offset:z.coerce.number().int().min(0).max(10000),language:z.enum(['all','eng','ron']),category:z.string().max(100),groupName:z.string().max(80)}).safeParse({includeText:url.searchParams.get('includeText')||'0',limit:url.searchParams.get('limit')??'50',query:url.searchParams.get('query')||'',offset:url.searchParams.get('offset')||0,language:url.searchParams.get('language')||'all',category:url.searchParams.get('category')||'',groupName:url.searchParams.get('groupName')||''});
 if(!data.success)throw new HttpError(400,'Choose valid song filters.');
 const {query,offset,language,category,groupName,includeText,limit}=data.data,words=[...new Set(normalize(query).split(' ').filter(Boolean))];if(words.length>32)throw new HttpError(400,'Search with up to 32 words.');
 const where=`device_id=? AND ${guard.sql} AND (?='all' OR language=?) AND (?='' OR category=?) AND (?='' OR (?='__generic__' AND group_name IS NULL) OR group_name=?) ${words.map(()=>"AND instr(search_text,?)>0").join(' ')}`,params=[deviceId,...guard.params,language,language,category,category,groupName,groupName,groupName,...words];
 const [songs,count,categories,state,groups]=await env.DB.batch([
  env.DB.prepare(`SELECT song_id AS id,content_hash AS contentHash,title,filename,category,language,font_size AS fontSize,${includeText==='1'?'text,':''}first_slide AS firstSlide,substr(text,1,600) AS lyricPreview,added_at AS addedAt,modified_at AS modifiedAt,group_name AS groupName,source_song_id AS sourceSongId FROM station_catalog WHERE ${where} ORDER BY title,song_id LIMIT ? OFFSET ?`).bind(...params,limit,offset),
  env.DB.prepare(`SELECT COUNT(*) AS total FROM station_catalog WHERE ${where}`).bind(...params),
  env.DB.prepare(`SELECT DISTINCT category FROM station_catalog WHERE device_id=? AND ${guard.sql} ORDER BY category LIMIT 500`).bind(deviceId,...guard.params),
  env.DB.prepare('SELECT ready_unreadable AS unreadable,ready_at AS updatedAt FROM station_catalog_snapshots WHERE device_id=? AND '+guard.sql).bind(deviceId,...guard.params),
  env.DB.prepare(`SELECT DISTINCT group_name AS name FROM station_catalog WHERE device_id=? AND group_name IS NOT NULL AND ${guard.sql} ORDER BY group_name LIMIT 500`).bind(deviceId,...guard.params),
 ]);
 const total=Number((count.results[0] as {total:number}).total),songRows=songs.results as Record<string,string|number>[],categoryRows=categories.results as {category:string}[],snapshotRow=state.results[0] as {unreadable:number;updatedAt:number|null}|undefined;
 return json({items:songRows.map(song=>({...song,bytes:0,firstLine:String(song.firstSlide||'').split('\n')[0]||'',editable:true,favorite:false})),total,offset,categories:categoryRows.map(row=>row.category),groups:(groups.results as {name:string}[]).map(row=>row.name),scanned:total,unreadable:snapshotRow?.unreadable||0,warnings:[],updatedAt:snapshotRow?.updatedAt||null});
}
function normalize(text:string){return text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
