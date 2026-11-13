import { z } from 'zod';
import { body, HttpError, json, now } from './core';
import { requireStationMinistry, stationMinistryGuard } from './station-catalog';

const position = z.strictObject({
  serviceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sequence: z.number().int().min(1).max(1_000_000_000),
  itemId: z.string().uuid(),
  page: z.number().int().min(0).max(10_000),
  mode: z.enum(['slides', 'document', 'text']),
  transition: z.enum(['slide', 'pageTurn', 'fade', 'instant']),
  columns: z.union([z.literal(1), z.literal(2)]),
  slideSize: z.number().min(0).max(3),
  pageCount: z.number().int().min(1).max(10_001).optional(),
}).refine(value => value.pageCount === undefined || (value.mode !== 'text' && value.page < value.pageCount), {
  message: 'Choose a page in the current song.',
});
const readAccess = `EXISTS(
 SELECT 1 FROM worship_groups wg JOIN worship_group_members gm ON gm.group_id=wg.id
 WHERE wg.id=? AND wg.archived_at IS NULL AND gm.user_id=?
)`;
const sessionInput = z.strictObject({sessionId:z.string().uuid()});
const currentHost = `EXISTS(
 SELECT 1 FROM station_service_selections selection
 JOIN station_services service ON service.device_id=selection.device_id AND service.id=selection.service_id
 JOIN station_service_leadership leadership ON leadership.device_id=service.device_id AND leadership.service_id=service.id
 WHERE selection.device_id=live.device_id AND selection.service_id=live.service_id
 AND service.archived=0 AND service.revision=live.service_revision
 AND leadership.leader_id=live.leader_id AND leadership.revision=live.leadership_revision
)`;

const click = z.strictObject({
 sessionId:z.string().uuid(), itemId:z.string().uuid(),
 sequence:z.number().int().min(1).max(1_000_000_000),
 page:z.number().int().min(0).max(10_000), turn:z.string().uuid().nullable(),
 direction:z.union([z.literal(-1),z.literal(1)]),
});

export async function worshipClicker(request:Request, env:Env, deviceId:string) {
 const authority = await requireStationMinistry(request,env,deviceId,'readSongs');
 const time = now(), userId = authority.user.id;
 const guard = stationMinistryGuard(authority,deviceId,'readSongs',time);
 const scope = `live.device_id=? AND live.leader_id=? AND live.expires_at>? AND ${currentHost}
  AND EXISTS(SELECT 1 FROM worship_groups wg JOIN worship_group_members gm ON gm.group_id=wg.id
    WHERE wg.id=live.group_id AND wg.archived_at IS NULL AND gm.user_id=live.leader_id)
  AND ${guard.sql}`;
 const params = [deviceId,userId,time,...guard.params];
 if (request.method === 'GET') {
  const live = await env.DB.prepare(`SELECT live.position_json AS position, service.title AS serviceTitle,
   json_extract(song.value,'$.title') AS songTitle
   FROM worship_live_reader live
   JOIN station_services service ON service.device_id=live.device_id AND service.id=live.service_id
   JOIN json_each(service.content_json,'$.songs') song ON json_extract(song.value,'$.id')=live.item_id
   WHERE ${scope} ORDER BY live.expires_at DESC, live.session_id LIMIT 1`).bind(...params)
   .first<{position:string;serviceTitle:string;songTitle:string}>();
  return json({live:live ? {position:JSON.parse(live.position),serviceTitle:live.serviceTitle,songTitle:live.songTitle} : null});
 }
 const input = await body(request,click,512), page = input.page + input.direction;
 const turn = crypto.randomUUID();
 const updated = await env.DB.prepare(`UPDATE worship_live_reader AS live
  SET position_json=json_set(position_json,'$.page',?,'$.clickerTurn',?)
  WHERE ${scope} AND live.session_id=? AND live.item_id=? AND live.sequence=?
    AND json_extract(position_json,'$.page')=? AND json_extract(position_json,'$.clickerTurn') IS ?
    AND json_extract(position_json,'$.mode')<>'text'
    AND ? >=0 AND ? < json_extract(position_json,'$.pageCount')
  RETURNING position_json AS position`).bind(page,turn,...params,input.sessionId,input.itemId,input.sequence,
   input.page,input.turn,page,page).first<{position:string}>();
 if (!updated) throw new HttpError(409,'The live page changed or is unavailable. Try again after it refreshes.');
 return json({position:JSON.parse(updated.position)});
}

export async function worshipLiveReader(request: Request, env: Env, deviceId: string, groupId: string) {
 const authority = await requireStationMinistry(request, env, deviceId, 'readSongs');
 const userId = authority.user.id;
 const time = now(), guard = stationMinistryGuard(authority, deviceId, 'readSongs', time);
 if (!await env.DB.prepare('SELECT 1 WHERE ' + readAccess).bind(groupId, userId).first()) {
  throw new HttpError(403, 'Choose a worship group you belong to.');
 }

 if (request.method === 'GET') {
  const row = await env.DB.prepare(`
   SELECT live.position_json AS position, live.leader_id AS leader,
    live.expires_at AS expiry, CASE WHEN leader_user.id IS NOT NULL
     AND EXISTS(SELECT 1 FROM worship_group_members lm WHERE lm.group_id=live.group_id AND lm.user_id=leader_user.id)
     AND NOT EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=live.device_id AND removed.user_id=leader_user.id)
     AND (leader_user.role='admin' OR EXISTS(SELECT 1 FROM station_memberships sm
      WHERE sm.device_id=live.device_id AND sm.user_id=leader_user.id AND sm.status='approved'))
     THEN leader.revision END AS currentLeadership, live.leadership_revision AS leadership,
    service.revision AS currentService, live.service_revision AS service
   FROM worship_live_reader live
   JOIN station_service_selections selection ON selection.device_id=live.device_id AND selection.service_id=live.service_id
   JOIN station_services service ON service.device_id=live.device_id AND service.id=live.service_id AND service.archived=0
   LEFT JOIN station_service_leadership leader ON leader.device_id=live.device_id AND leader.service_id=live.service_id
    AND leader.leader_id=live.leader_id
   LEFT JOIN users leader_user ON leader_user.id=leader.leader_id AND leader_user.status='active'
   WHERE live.device_id=? AND live.group_id=? AND ${readAccess} AND ${guard.sql}
  `).bind(deviceId,groupId,groupId,userId,...guard.params).first<{
   position:string;leader:string;expiry:number;currentLeadership:number|null;leadership:number;currentService:number;service:number
  }>();
  if (!row) {
   const active = await env.DB.prepare(`
    SELECT 1 FROM station_service_selections selection
    JOIN station_services service ON service.device_id=selection.device_id AND service.id=selection.service_id
    WHERE selection.device_id=? AND service.archived=0 AND ${readAccess} AND ${guard.sql}
   `).bind(deviceId,groupId,userId,...guard.params).first();
   return json({ state: active ? 'waiting' : 'idle' });
  }
  if (row.expiry<=time || row.currentLeadership!==row.leadership || row.currentService!==row.service) {
   return json({ state: 'waiting' });
  }
  return json({ state: 'live', isLeader: row.leader===userId, position: JSON.parse(row.position) });
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
   sequence=excluded.sequence,item_id=excluded.item_id,position_json=excluded.position_json,expires_at=excluded.expires_at
  WHERE (worship_live_reader.session_id=excluded.session_id AND worship_live_reader.expires_at>?
     AND worship_live_reader.sequence<excluded.sequence)
     OR (excluded.sequence=1 AND (worship_live_reader.expires_at<=?
      OR worship_live_reader.service_id<>excluded.service_id
      OR worship_live_reader.leader_id<>excluded.leader_id))
 `).bind(groupId,update.sessionId,update.sequence,update.itemId,JSON.stringify(update),time+24,
  deviceId,update.serviceId,userId,update.itemId,groupId,userId,...guard.params,time,time).run();
 if (!result.meta.changes) throw new HttpError(409, 'The active service, leader, or group access changed.');
 return json({ok:true});
}
