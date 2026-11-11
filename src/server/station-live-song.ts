import {z} from 'zod';
import {body, HttpError, json, now} from './core';
import {requireStationMinistry, stationMinistryGuard} from './station-catalog';

const liveSong = z.object({
 serviceId: z.string().uuid(),
 songId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().nullable();

export async function publishStationLiveSong(request: Request, env: Env, deviceId: string) {
 const authority = await requireStationMinistry(request, env, deviceId, 'planServices', true);
 if (authority.kind !== 'operator') throw new HttpError(403,'Choose an authorized profile on the presentation computer.');
 const {live:position} = await body(request, z.object({live:liveSong}).strict());
 const time = now(), guard = stationMinistryGuard(authority, deviceId, 'planServices', time);
 if (!position) {
  await env.DB.prepare('DELETE FROM station_live_song WHERE device_id=? AND '+guard.sql).bind(deviceId,...guard.params).run();
  return json({ok:true});
 }
 const result = await env.DB.prepare(`INSERT INTO station_live_song(device_id,service_id,service_revision,song_id,song_title,expires_at)
  SELECT service.device_id,service.id,service.revision,?,json_extract(song.value,'$.title'),?
  FROM station_services service JOIN json_each(service.content_json,'$.songs') song
  WHERE service.device_id=? AND service.id=? AND service.archived=0
   AND json_extract(song.value,'$.songId')=? AND ${guard.sql}
  LIMIT 1
  ON CONFLICT(device_id) DO UPDATE SET service_id=excluded.service_id,service_revision=excluded.service_revision,
   song_id=excluded.song_id,song_title=excluded.song_title,expires_at=excluded.expires_at`)
  .bind(position.songId,time+65,deviceId,position.serviceId,position.songId,...guard.params).run();
 if (!result.meta.changes) throw new HttpError(409,'The song is unavailable in this service.');
 return json({ok:true});
}

export async function readStationLiveSong(request: Request, env: Env, deviceId: string) {
 const authority = await requireStationMinistry(request, env, deviceId, 'readSongs');
 const time = now(), guard = stationMinistryGuard(authority,deviceId,'readSongs',time);
 const live = await env.DB.prepare(`SELECT service.id AS serviceId,service.title AS serviceTitle,
   live.song_id AS songId,live.song_title AS songTitle,live.expires_at AS expiresAt
  FROM station_live_song live JOIN station_services service
   ON service.device_id=live.device_id AND service.id=live.service_id AND service.revision=live.service_revision
  WHERE live.device_id=? AND live.expires_at>? AND service.archived=0 AND ${guard.sql}`)
  .bind(deviceId,time,...guard.params).first();
 return json({live});
}
