import {z} from 'zod';
import {body,HttpError,json,now} from './core';
import {requireSongStation,stationMinistryGuard} from './station-catalog';

const change=z.strictObject({
 pitch:z.number().int().min(0).max(11).nullable(),
 contentHash:z.string().regex(/^[a-f0-9]{64}$/),
 revision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),
});

export async function serviceSongKey(request:Request,env:Env,device:string,service:string,item:string){
 const authority=await requireSongStation(request,env,device);
 const user=authority.user.id,time=now(),guard=stationMinistryGuard(authority,device,'readSongs',time);
 const current=`SELECT json_extract(song.value,'$.contentHash') AS contentHash,
  CASE WHEN saved.content_hash=json_extract(song.value,'$.contentHash') THEN saved.pitch ELSE NULL END AS pitch,COALESCE(saved.revision,0) AS revision,COALESCE(leader.leader_id=?,0) AS canEdit
  FROM station_services plan JOIN json_each(plan.content_json,'$.songs') song
  LEFT JOIN station_service_leadership leader ON leader.device_id=plan.device_id AND leader.service_id=plan.id
  LEFT JOIN station_service_song_keys saved ON saved.device_id=plan.device_id AND saved.service_id=plan.id
   AND saved.item_id=json_extract(song.value,'$.id')
  WHERE plan.device_id=? AND plan.id=? AND plan.archived=0 AND json_extract(song.value,'$.id')=? AND ${guard.sql}`;
 const params=[user,device,service,item,...guard.params];
 if(request.method==='GET'){
  const row=await env.DB.prepare(current).bind(...params).first<{contentHash:string;pitch:number|null;revision:number;canEdit:number}>();
  if(!row)throw new HttpError(404,'This service song is unavailable.');
  return json({...row,canEdit:row.canEdit===1});
 }
 const input=await body(request,change,256);
 const saved=await env.DB.prepare(`INSERT INTO station_service_song_keys(device_id,service_id,item_id,content_hash,pitch,revision)
  SELECT ?,?,?,?,?,revision+1 FROM (${current}) WHERE canEdit=1 AND contentHash=? AND revision=?
  ON CONFLICT(device_id,service_id,item_id) DO UPDATE SET content_hash=excluded.content_hash,pitch=excluded.pitch,revision=excluded.revision
  RETURNING pitch,revision`).bind(device,service,item,input.contentHash,input.pitch,...params,input.contentHash,input.revision)
  .first<{pitch:number|null;revision:number}>();
 if(!saved)throw new HttpError(409,'Only the current service leader can save the key. Refresh if the song or key changed.');
 return json({...saved,contentHash:input.contentHash,canEdit:true});
}
