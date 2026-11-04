import {groupMaterialAccess} from './worship-groups';
import {z} from 'zod';
import {body,HttpError,json,now} from './core';
import {requireStationMinistry,stationMinistryGuard} from './station-catalog';

const linkInput=z.object({action:z.enum(['link','unlink']),computerId:z.string().uuid(),songId:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export async function changeGroupMaterialSongLink(request:Request,env:Env,materialId:string){
 if(!z.string().uuid().safeParse(materialId).success)throw new HttpError(400,'Choose a shared file from the library.');
 const data=await body(request,linkInput),authority=await requireStationMinistry(request,env,data.computerId,'planServices');
 const guard=stationMinistryGuard(authority,data.computerId,'planServices'),time=now();
 const privateAccess=groupMaterialAccess(authority);
 const materialSQL=`EXISTS(SELECT 1 FROM group_materials material WHERE material.id=? AND material.state='active' AND (material.author_id=? OR ?='admin') AND ${privateAccess.sql})`,materialParams=[materialId,authority.user.id,authority.user.role,...privateAccess.params];
 const accessSQL=guard.sql+' AND '+materialSQL,accessParams=[...guard.params,...materialParams];
 const tuple=[materialId,data.computerId,data.songId];
 const change=data.action==='link'
  ?env.DB.prepare(`INSERT INTO group_material_song_links(material_id,device_id,song_id,created_by,created_at)
    SELECT ?,?,?,?,? WHERE ${accessSQL}
    AND EXISTS(SELECT 1 FROM station_catalog song WHERE song.device_id=? AND song.song_id=?)
    AND ((SELECT COUNT(*) FROM group_material_song_links WHERE material_id=?)<100 OR EXISTS(SELECT 1 FROM group_material_song_links WHERE material_id=? AND device_id=? AND song_id=?))
    ON CONFLICT(material_id,device_id,song_id) DO NOTHING`).bind(...tuple,authority.user.id,time,...accessParams,data.computerId,data.songId,materialId,...tuple)
  :env.DB.prepare(`DELETE FROM group_material_song_links WHERE material_id=? AND device_id=? AND song_id=? AND ${accessSQL}`).bind(...tuple,...accessParams);
 await env.DB.batch([
  change,
  env.DB.prepare('INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,?,?,? WHERE changes()>0').bind(crypto.randomUUID(),authority.user.id,data.action==='link'?'link-group-material-song':'unlink-group-material-song',materialId,time),
 ]);
 // Verify the requested state even after an idempotent no-op, with current authority.
 const current=stationMinistryGuard(authority,data.computerId,'planServices');
 const verified=await env.DB.prepare(`SELECT EXISTS(SELECT 1 FROM group_material_song_links WHERE material_id=? AND device_id=? AND song_id=?) AS linked WHERE ${current.sql} AND ${materialSQL}`).bind(...tuple,...current.params,...materialParams).first<{linked:number}>();
 if(!verified||Boolean(verified.linked)!==(data.action==='link'))throw new HttpError(409,'The song link could not be confirmed. Refresh the song and check your access before trying again.');
 return json({ok:true,linked:Boolean(verified.linked),materialId,computerId:data.computerId,songId:data.songId});
}
