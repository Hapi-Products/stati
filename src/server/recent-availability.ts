import {z} from 'zod';
import {body,HttpError,json} from './core';
import {ministryAuthorityGuard,requireMinistryCapability} from './ministry-roles';
import {stationMinistryGuard} from './station-catalog';
import {groupMaterialAccess} from './worship-groups';
const uuid='[0-9a-fA-F-]{36}',groupPath=new RegExp('^/api/group-materials/('+uuid+')/file$'),taskPath=new RegExp('^/api/tasks/('+uuid+')/images/('+uuid+')$');
const identifier=z.string().uuid(),itemId=z.string().min(1).max(600);
const entry=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('song'),id:itemId,computerId:identifier,songId:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({kind:z.literal('file'),id:itemId,filePath:z.string().max(300)}).strict(),
]);
export async function recentAvailability(request:Request,env:Env){
 const authority=await requireMinistryCapability(request,env,'sendFiles'),data=await body(request,z.object({items:z.array(entry).max(80)}).strict());
 if(new Set(data.items.map(item=>item.id)).size!==data.items.length)throw new HttpError(400,'Refresh Recents before checking it again.');
 const statements=data.items.map(item=>{
  if(item.kind==='song'){
   if(item.id!=='song:'+item.computerId+':'+item.songId)throw new HttpError(400,'Choose a saved recent song.');
   const guard=stationMinistryGuard(authority,item.computerId,'readSongs');
   return env.DB.prepare(`SELECT 1 AS available FROM station_catalog WHERE device_id=? AND song_id=? AND ${guard.sql}`).bind(item.computerId,item.songId,...guard.params);
  }
  if(item.id!=='file::'+item.filePath)throw new HttpError(400,'Choose a saved recent file.');
  const group=item.filePath.match(groupPath),task=item.filePath.match(taskPath);
  if(group&&identifier.safeParse(group[1]).success){
   const guard=ministryAuthorityGuard(authority,'readSongs'),access=groupMaterialAccess(authority);
   return env.DB.prepare(`SELECT 1 AS available FROM group_materials material WHERE material.id=? AND material.state='active' AND ${guard.sql} AND ${access.sql}`).bind(group[1],...guard.params,...access.params);
  }
  if(task&&identifier.safeParse(task[1]).success&&identifier.safeParse(task[2]).success){
   const guard=ministryAuthorityGuard(authority,'sendFiles');
   return env.DB.prepare(`SELECT 1 AS available FROM feedback_task_images image JOIN feedback_tasks task ON task.id=image.task_id WHERE image.id=? AND image.task_id=? AND image.state='active' AND task.deleted_at IS NULL AND ${guard.sql}`).bind(task[2],task[1],...guard.params);
  }
  throw new HttpError(400,'This recent file link could not be checked. Existing history has been kept.');
 });
 const results=statements.length?await env.DB.batch(statements):[];
 return json({checkedIds:data.items.map(item=>item.id),availableIds:data.items.filter((_,index)=>results[index].results.length>0).map(item=>item.id)});
}
