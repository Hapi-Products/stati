import { z } from 'zod';
import { body, HttpError, json, now } from './core';
import { requireSongStation, stationMinistryGuard } from './station-catalog';

const position = z.strictObject({
  serviceId: z.string().uuid().nullable(),
  sessionId: z.string().uuid(),
  sequence: z.number().int().min(1).max(1_000_000_000),
  itemId: z.union([z.string().uuid(),z.string().regex(/^[a-f0-9]{64}$/)]),
  songHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  page: z.number().int().min(0).max(10_000),
  mode: z.enum(['slides', 'document', 'text']),
  transition: z.enum(['slide', 'pageTurn', 'fade', 'instant']),
  columns: z.union([z.literal(1), z.literal(2)]),
  slideSize: z.number().min(0).max(3),
  pageCount: z.number().int().min(1).max(10_001).optional(),
}).refine(value => value.serviceId === null ? !!value.songHash && value.itemId.length === 64 : !value.songHash && value.itemId.length === 36, {
  message: 'Choose a song from the library or service.',
}).refine(value => value.pageCount === undefined || (value.mode !== 'text' && value.page < value.pageCount), {
  message: 'Choose a page in the current song.',
});
const readAccess = `EXISTS(
 SELECT 1 FROM worship_groups wg JOIN worship_group_members gm ON gm.group_id=wg.id
 WHERE wg.id=? AND wg.archived_at IS NULL AND gm.user_id=?
)`;
const sessionInput = z.strictObject({sessionId:z.string().uuid()});
const standaloneLeader = `EXISTS(SELECT 1 FROM users host LEFT JOIN user_ministry_roles role ON role.user_id=host.id
 WHERE host.id=live.leader_id AND host.status='active'
 AND (host.role='admin' OR role.role IN ('worship_leader','choir_director','pastor')))`;
const currentHost = `((live.service_id IS NULL AND ${standaloneLeader}
 AND EXISTS(SELECT 1 FROM station_catalog c WHERE c.device_id=live.device_id AND c.song_id=live.song_id AND c.content_hash=live.song_hash))
 OR EXISTS(
 SELECT 1 FROM station_service_selections selection
 JOIN station_services service ON service.device_id=selection.device_id AND service.id=selection.service_id
 JOIN station_service_leadership leadership ON leadership.device_id=service.device_id AND leadership.service_id=service.id
 WHERE selection.device_id=live.device_id AND selection.service_id=live.service_id
 AND service.archived=0 AND service.revision=live.service_revision
 AND leadership.leader_id=live.leader_id AND leadership.revision=live.leadership_revision
))`;
const leaderAccess = `EXISTS(
 SELECT 1 FROM users host JOIN worship_group_members lm ON lm.user_id=host.id AND lm.group_id=live.group_id
 WHERE host.id=live.leader_id AND host.status='active'
 AND NOT EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=live.device_id AND removed.user_id=host.id)
 AND (host.role='admin' OR EXISTS(SELECT 1 FROM station_memberships sm
   WHERE sm.device_id=live.device_id AND sm.user_id=host.id AND sm.status='approved'))
)`;

const click = z.strictObject({
 sessionId:z.string().uuid(), itemId:position.shape.itemId,
 sequence:z.number().int().min(1).max(1_000_000_000),
 page:z.number().int().min(0).max(10_000), turn:z.string().uuid().nullable(),
 direction:z.union([z.literal(-1),z.literal(1)]),
});

const clickerPresenceSeconds = 12;
const preserveClickerPresence = `CASE WHEN worship_live_reader.session_id=excluded.session_id
 AND json_extract(worship_live_reader.position_json,'$.clickerUntil') IS NOT NULL
 THEN json_set(excluded.position_json,'$.clickerUntil',json_extract(worship_live_reader.position_json,'$.clickerUntil'))
 ELSE excluded.position_json END`;

function publicPosition(value:string){
 const {clickerUntil,...position}=JSON.parse(value) as Record<string,unknown>;
 return {position,clickerConnected:typeof clickerUntil==='number'&&clickerUntil>now()};
}

export async function worshipClicker(request:Request, env:Env, deviceId:string) {
 const authority = await requireSongStation(request,env,deviceId);
 const time = now(), userId = authority.user.id;
 const guard = stationMinistryGuard(authority,deviceId,'readSongs',time);
 const scope = `live.device_id=? AND live.leader_id=? AND live.expires_at>? AND ${currentHost}
  AND EXISTS(SELECT 1 FROM worship_groups wg JOIN worship_group_members gm ON gm.group_id=wg.id
    WHERE wg.id=live.group_id AND wg.archived_at IS NULL AND gm.user_id=live.leader_id)
  AND ${guard.sql}`;
 const params = [deviceId,userId,time,...guard.params];
 if (request.method === 'GET') {
  const live = await env.DB.prepare(`SELECT live.position_json AS position, COALESCE(service.title,'Live worship') AS serviceTitle,
   COALESCE(catalog.title,json_extract(song.value,'$.title')) AS songTitle,
   COALESCE(live.song_id,json_extract(song.value,'$.songId')) AS songId,
   COALESCE(live.song_hash,json_extract(song.value,'$.contentHash')) AS contentHash
   FROM worship_live_reader live
   LEFT JOIN station_services service ON service.device_id=live.device_id AND service.id=live.service_id
   LEFT JOIN json_each(service.content_json,'$.songs') song ON json_extract(song.value,'$.id')=live.item_id
   LEFT JOIN station_catalog catalog ON catalog.device_id=live.device_id AND catalog.song_id=live.song_id AND catalog.content_hash=live.song_hash
   WHERE ${scope} ORDER BY live.expires_at DESC, live.session_id LIMIT 1`).bind(...params)
   .first<{position:string;serviceTitle:string;songTitle:string;songId:string;contentHash:string}>();
  return json({live:live ? {...live,position:publicPosition(live.position).position} : null});
 }
 if (request.method === 'PATCH') {
  const {sessionId} = await body(request,sessionInput,128);
  const result = await env.DB.prepare(`UPDATE worship_live_reader AS live
   SET position_json=json_set(position_json,'$.clickerUntil',?)
   WHERE ${scope} AND live.session_id=? AND json_extract(position_json,'$.pageCount') IS NOT NULL
   AND json_extract(position_json,'$.mode')<>'text'`).bind(time+clickerPresenceSeconds,...params,sessionId).run();
  if (!result.meta.changes) throw new HttpError(409,'The live reader is no longer available.');
  return json({ok:true});
 }
 const input = await body(request,click,512), page = input.page + input.direction;
 const turn = crypto.randomUUID();
 const updated = await env.DB.prepare(`UPDATE worship_live_reader AS live
  SET position_json=json_set(position_json,'$.page',?,'$.clickerTurn',?,'$.clickerUntil',?)
  WHERE ${scope} AND live.session_id=? AND live.item_id=? AND live.sequence=?
    AND json_extract(position_json,'$.page')=? AND json_extract(position_json,'$.clickerTurn') IS ?
    AND json_extract(position_json,'$.mode')<>'text'
    AND ? >=0 AND ? < json_extract(position_json,'$.pageCount')
  RETURNING position_json AS position`).bind(page,turn,time+clickerPresenceSeconds,...params,input.sessionId,input.itemId,input.sequence,
   input.page,input.turn,page,page).first<{position:string}>();
 if (!updated) throw new HttpError(409,'The live page changed or is unavailable. Try again after it refreshes.');
 return json({position:publicPosition(updated.position).position});
}

export async function worshipLiveReader(request: Request, env: Env, deviceId: string, groupId: string) {
 const authority = await requireSongStation(request,env,deviceId,groupId);
 const userId = authority.user.id;
 const time = now(), guard = stationMinistryGuard(authority, deviceId, 'readSongs', time);

 if (request.method === 'GET') {
  const row = await env.DB.prepare(`
   SELECT live.position_json AS position, live.leader_id AS leader, live.service_id AS service,
    catalog.title AS songTitle
   FROM worship_live_reader live
   LEFT JOIN station_catalog catalog ON catalog.device_id=live.device_id AND catalog.song_id=live.song_id AND catalog.content_hash=live.song_hash
   WHERE live.device_id=? AND live.group_id=? AND live.expires_at>? AND ${currentHost}
    AND ${leaderAccess} AND ${readAccess} AND ${guard.sql}
  `).bind(deviceId,groupId,time,groupId,userId,...guard.params)
   .first<{position:string;leader:string;service:string|null;songTitle:string|null}>();
  if (!row) {
   const active = await env.DB.prepare(`
    SELECT 1 FROM station_service_selections selection
    JOIN station_services service ON service.device_id=selection.device_id AND service.id=selection.service_id
    WHERE selection.device_id=? AND service.archived=0 AND ${readAccess} AND ${guard.sql}
   `).bind(deviceId,groupId,userId,...guard.params).first();
   return json({ state: active ? 'waiting' : 'idle' });
  }
  const {position,clickerConnected} = publicPosition(row.position);
  const canTurn = typeof position.pageCount === 'number' && position.mode !== 'text';
  return json({ state: 'live', isLeader: row.leader===userId, position,
   ...(row.leader===userId&&new URL(request.url).searchParams.get('clicker')==='1' ? {clickerConnected:clickerConnected&&canTurn} : {}),
   ...(row.service===null ? {songTitle:row.songTitle} : {}) });
 }

 if (request.method === 'PATCH') {
  const {sessionId} = await body(request,sessionInput,128);
  const result = await env.DB.prepare(`
   UPDATE worship_live_reader AS live SET expires_at=?
   WHERE device_id=? AND group_id=? AND leader_id=? AND session_id=? AND expires_at>?
   AND ${currentHost} AND ${readAccess} AND ${guard.sql}
  `).bind(time+24,deviceId,groupId,userId,sessionId,time,groupId,userId,...guard.params).run();
  if (!result.meta.changes) throw new HttpError(409,'The active service, leader, or group access changed.');
  return json({ok:true});
 }

 if (request.method === 'DELETE') {
  const stop = await body(request, sessionInput);
  await env.DB.prepare(`
   UPDATE worship_live_reader SET expires_at=0
   WHERE device_id=? AND group_id=? AND leader_id=? AND session_id=? AND ${readAccess} AND ${guard.sql}
  `).bind(deviceId,groupId,userId,stop.sessionId,groupId,userId,...guard.params).run();
  return json({ok:true});
 }

 const update = await body(request, position);
 if (update.serviceId === null) {
  if (authority.user.role !== 'admin' && !['worship_leader','choir_director','pastor'].includes(authority.ministryRole ?? '')) {
   throw new HttpError(403,'A worship leader is required to lead a song.');
  }
  const standalone = await env.DB.prepare(`
   INSERT INTO worship_live_reader(device_id,group_id,service_id,service_revision,leadership_revision,leader_id,
    session_id,sequence,item_id,position_json,expires_at,song_id,song_hash)
   SELECT c.device_id,?,NULL,0,0,?,?,?,?,?,?,c.song_id,c.content_hash
   FROM station_catalog c WHERE c.device_id=? AND c.song_id=? AND c.content_hash=? AND ${readAccess} AND ${guard.sql}
   ON CONFLICT(device_id,group_id) DO UPDATE SET service_id=NULL,service_revision=0,leadership_revision=0,
    leader_id=excluded.leader_id,session_id=excluded.session_id,sequence=excluded.sequence,item_id=excluded.item_id,
    position_json=${preserveClickerPresence},expires_at=excluded.expires_at,song_id=excluded.song_id,song_hash=excluded.song_hash
   WHERE (worship_live_reader.session_id=excluded.session_id AND worship_live_reader.leader_id=excluded.leader_id
    AND worship_live_reader.service_id IS NULL AND worship_live_reader.expires_at>? AND worship_live_reader.sequence<excluded.sequence)
    OR (excluded.sequence=1 AND worship_live_reader.expires_at<=?)
  `).bind(groupId,userId,update.sessionId,update.sequence,update.itemId,JSON.stringify(update),time+24,
   deviceId,update.itemId,update.songHash,groupId,userId,...guard.params,time,time).run();
  if (!standalone.meta.changes) throw new HttpError(409,'The song changed or your worship group already has a live reader.');
  return json({ok:true});
 }
 const result = await env.DB.prepare(`
  INSERT INTO worship_live_reader(device_id,group_id,service_id,service_revision,leadership_revision,leader_id,
     session_id,sequence,item_id,position_json,expires_at)
  SELECT service.device_id,?,service.id,service.revision,leader.revision,leader.leader_id,?,?,?,?,?
  FROM station_services service
  JOIN station_service_selections selection ON selection.device_id=service.device_id AND selection.service_id=service.id
  JOIN station_service_leadership leader ON leader.device_id=service.device_id AND leader.service_id=service.id
  WHERE service.device_id=? AND service.id=? AND service.archived=0 AND leader.leader_id=?
    AND EXISTS(SELECT 1 FROM json_each(service.content_json,'$.songs') item
      JOIN station_catalog song ON song.device_id=service.device_id AND song.song_id=json_extract(item.value,'$.songId')
        AND song.content_hash=json_extract(item.value,'$.contentHash')
      WHERE json_extract(item.value,'$.id')=?)
    AND ${readAccess} AND ${guard.sql}
  ON CONFLICT(device_id,group_id) DO UPDATE SET service_id=excluded.service_id,service_revision=excluded.service_revision,
   leadership_revision=excluded.leadership_revision,leader_id=excluded.leader_id,session_id=excluded.session_id,
   sequence=excluded.sequence,item_id=excluded.item_id,position_json=${preserveClickerPresence},expires_at=excluded.expires_at,
   song_id=NULL,song_hash=NULL
  WHERE (worship_live_reader.session_id=excluded.session_id AND worship_live_reader.expires_at>?
     AND worship_live_reader.sequence<excluded.sequence)
     OR (excluded.sequence=1 AND (worship_live_reader.expires_at<=?
      OR (worship_live_reader.service_id IS NOT NULL AND (worship_live_reader.service_id<>excluded.service_id
      OR worship_live_reader.leader_id<>excluded.leader_id))))
 `).bind(groupId,update.sessionId,update.sequence,update.itemId,JSON.stringify(update),time+24,
  deviceId,update.serviceId,userId,update.itemId,groupId,userId,...guard.params,time,time).run();
 if (!result.meta.changes) throw new HttpError(409, 'The active service, leader, or group access changed.');
 return json({ok:true});
}
