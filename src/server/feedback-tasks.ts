import {listTaskImages} from './task-images';
import {z} from 'zod';
import {body,hash,HttpError,json,now} from './core';
import {requireStationMinistry,stationMinistryGuard} from './station-catalog';
import {ministryAuthorityGuard,requireMinistryCapability,type MinistryAuthority} from './ministry-roles';
import type {FeedbackTask,TaskNote,TaskStatus} from '../shared/feedback-tasks-types';

const uuid=z.string().uuid(),revision=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1);
const fields={title:z.string().trim().min(1).max(160),body:z.string().trim().min(1).max(5000),urgent:z.boolean()};
const actions=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),id:uuid,...fields}).strict(),
 z.object({action:z.literal('update'),id:uuid,revision,...fields,status:z.enum(['new','in-progress','complete'])}).strict(),
 z.object({action:z.literal('note'),id:uuid,revision,noteId:uuid,body:z.string().trim().min(1).max(2000)}).strict(),
 z.object({action:z.literal('delete'),id:uuid,revision}).strict(),
 z.object({action:z.literal('restore'),id:uuid,revision}).strict(),
 z.object({action:z.literal('delete-note'),id:uuid,revision,noteId:uuid}).strict(),
 z.object({action:z.literal('restore-note'),id:uuid,revision,noteId:uuid}).strict(),
]);
type Row={id:string;title:string;body:string;status:TaskStatus;urgent:number;revision:number;author_id:string;author_first:string;author_last:string;author_photo:string|null;created_at:number;updated_at:number;note_count:number};
const columns=`task.*,author.first_name AS author_first,author.last_initial AS author_last,author.photo_key AS author_photo,(SELECT COUNT(*) FROM feedback_task_notes note WHERE note.task_id=task.id AND note.deleted_at IS NULL) AS note_count`;
const joins='FROM feedback_tasks task JOIN users author ON author.id=task.author_id';
const staff=(authority:MinistryAuthority)=>authority.user.role==='admin'||['worship_leader','choir_director','pastor'].includes(authority.ministryRole||'');
const administrator=(authority:MinistryAuthority)=>authority.user.role==='admin';
function present(row:Row,authority:MinistryAuthority):FeedbackTask{return{id:row.id,title:row.title,body:row.body,status:row.status,urgent:!!row.urgent,revision:row.revision,authorId:row.author_id,authorName:row.author_first+' '+row.author_last+'.',...(row.author_photo?{authorPhotoUrl:'/api/members/'+row.author_id+'/photo'}:{}),createdAt:row.created_at,updatedAt:row.updated_at,noteCount:row.note_count,canManage:row.author_id===authority.user.id||staff(authority),canDelete:row.author_id===authority.user.id||administrator(authority)};}
async function detail(env:Env,authority:MinistryAuthority,id:string,deviceId?:string){
 const guard=deviceId?stationMinistryGuard(authority,deviceId,'sendFiles'):ministryAuthorityGuard(authority,'sendFiles');
 const [tasks,notes,count]=await env.DB.batch([
  env.DB.prepare(`SELECT ${columns} ${joins} WHERE task.id=? AND task.deleted_at IS NULL AND ${guard.sql}`).bind(id,...guard.params),
  env.DB.prepare(`SELECT note.id,note.author_id AS authorId,note.body,note.created_at AS createdAt,author.first_name||' '||author.last_initial||'.' AS authorName,author.photo_key AS authorPhotoKey FROM feedback_task_notes note JOIN users author ON author.id=note.author_id WHERE note.task_id=? AND note.deleted_at IS NULL AND EXISTS(SELECT 1 FROM feedback_tasks WHERE id=note.task_id AND deleted_at IS NULL) AND ${guard.sql} ORDER BY note.created_at DESC,note.id DESC LIMIT 100`).bind(id,...guard.params),
  env.DB.prepare(`SELECT COUNT(*) AS total FROM feedback_task_notes WHERE task_id=? AND deleted_at IS NULL AND ${guard.sql}`).bind(id,...guard.params),
 ]);
 const task=tasks.results[0] as Row|undefined;if(!task)throw new HttpError(404,'This task is unavailable. Refresh the board.');
 const items=notes.results.map(raw=>{const row=raw as {id:string;authorId:string;body:string;createdAt:number;authorName:string;authorPhotoKey:string|null};const {authorPhotoKey,...note}=row;return{...note,...(authorPhotoKey?{authorPhotoUrl:'/api/members/'+row.authorId+'/photo'}:{}),canDelete:row.authorId===authority.user.id||administrator(authority)} satisfies TaskNote;});
 return{task:present(task,authority),images:deviceId?[]:await listTaskImages(env,authority,id),notes:items.reverse(),noteTotal:Number((count.results[0] as {total:number}).total)};
}
export async function readFeedbackTasks(request:Request,env:Env,id?:string,deviceId?:string){
 const authority=deviceId?await requireStationMinistry(request,env,deviceId,'sendFiles',true):await requireMinistryCapability(request,env,'sendFiles');
 if(id){if(!uuid.safeParse(id).success)throw new HttpError(400,'Choose a task.');return json(await detail(env,authority,id,deviceId));}
 const input=z.coerce.number().int().min(0).max(1000000).safeParse(new URL(request.url).searchParams.get('offset')||0);if(!input.success)throw new HttpError(400,'Choose a valid board page.');
 const guard=deviceId?stationMinistryGuard(authority,deviceId,'sendFiles'):ministryAuthorityGuard(authority,'sendFiles'),offset=input.data;
 const [tasks,counts]=await env.DB.batch([
  env.DB.prepare(`SELECT ${columns} ${joins} WHERE task.deleted_at IS NULL AND ${guard.sql} ORDER BY CASE task.status WHEN 'new' THEN 0 WHEN 'in-progress' THEN 1 ELSE 2 END,task.urgent DESC,task.updated_at DESC,task.id LIMIT 150 OFFSET ?`).bind(...guard.params,offset),
  env.DB.prepare(`SELECT status,COUNT(*) AS total FROM feedback_tasks WHERE deleted_at IS NULL AND ${guard.sql} GROUP BY status`).bind(...guard.params),
 ]);
 const totals:Record<TaskStatus,number>={'new':0,'in-progress':0,'complete':0};for(const row of counts.results as {status:TaskStatus;total:number}[])totals[row.status]=Number(row.total);
 return json({items:(tasks.results as Row[]).map(row=>present(row,authority)),total:Object.values(totals).reduce((a,b)=>a+b,0),offset,counts:totals});
}
export async function changeFeedbackTask(request:Request,env:Env){
 const authority=await requireMinistryCapability(request,env,'sendFiles'),input=await body(request,actions),time=now(),guard=ministryAuthorityGuard(authority,'sendFiles',time);
 if(input.action==='create'){
  const digest=await hash(JSON.stringify({title:input.title,body:input.body,urgent:input.urgent}));
  const existing=await env.DB.prepare(`SELECT author_id,create_hash FROM feedback_tasks WHERE id=? AND ${guard.sql}`).bind(input.id,...guard.params).first<{author_id:string;create_hash:string}>();
  if(existing){if(existing.author_id!==authority.user.id||existing.create_hash!==digest)throw new HttpError(409,'This task identifier is already used. Refresh and try again.');return json(await detail(env,authority,input.id));}
  const result=await env.DB.prepare(`INSERT INTO feedback_tasks(id,title,body,status,urgent,revision,author_id,updated_by,create_hash,created_at,updated_at) SELECT ?,?,?,'new',?,1,?,?,?,?,? WHERE ${guard.sql} ON CONFLICT(id) DO NOTHING`).bind(input.id,input.title,input.body,input.urgent?1:0,authority.user.id,authority.user.id,digest,time,time,...guard.params).run();
  if(!result.meta.changes)throw new HttpError(409,'Your access or this task changed. Refresh and try again.');
 }else if(input.action==='update'){
  const result=await env.DB.prepare(`UPDATE feedback_tasks SET title=?,body=?,status=?,urgent=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND revision=? AND deleted_at IS NULL AND (author_id=? OR ?=1) AND ${guard.sql}`).bind(input.title,input.body,input.status,input.urgent?1:0,authority.user.id,time,input.id,input.revision,authority.user.id,staff(authority)?1:0,...guard.params).run();
  if(!result.meta.changes)throw new HttpError(409,'This task or your permission changed. Reload the saved version before trying again; your text has been kept.');
 }else if(input.action==='delete'||input.action==='restore'){
  const removing=input.action==='delete';
  const result=await env.DB.prepare(`UPDATE feedback_tasks SET deleted_at=?,deleted_by=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND revision=? AND deleted_at IS ${removing?'NULL':'NOT NULL'} AND (author_id=? OR ?=1) AND ${guard.sql}`).bind(removing?time:null,removing?authority.user.id:null,authority.user.id,time,input.id,input.revision,authority.user.id,administrator(authority)?1:0,...guard.params).run();
  if(!result.meta.changes){
   const retry=await env.DB.prepare(`SELECT revision FROM feedback_tasks WHERE id=? AND revision=? AND ${removing?'deleted_at IS NOT NULL AND deleted_by=?':'deleted_at IS NULL AND updated_by=?'} AND (author_id=? OR ?=1) AND ${guard.sql}`).bind(input.id,input.revision+1,authority.user.id,authority.user.id,administrator(authority)?1:0,...guard.params).first<{revision:number}>();
   if(!retry)throw new HttpError(409,'This task or your permission changed. Refresh and try again.');
  }
  if(removing)return json({deleted:true,id:input.id,revision:input.revision+1});
 }else if(input.action==='delete-note'||input.action==='restore-note'){
  const removing=input.action==='delete-note';
  const results=await env.DB.batch([
   env.DB.prepare(`UPDATE feedback_tasks SET revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND revision=? AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM feedback_task_notes WHERE id=? AND task_id=feedback_tasks.id AND deleted_at IS ${removing?'NULL':'NOT NULL'} AND (author_id=? OR ?=1)) AND ${guard.sql}`).bind(authority.user.id,time,input.id,input.revision,input.noteId,authority.user.id,administrator(authority)?1:0,...guard.params),
   env.DB.prepare(`UPDATE feedback_task_notes SET deleted_at=?,deleted_by=? WHERE id=? AND task_id=? AND changes()>0`).bind(removing?time:null,removing?authority.user.id:null,input.noteId,input.id),
  ]);
  if(!results[0].meta.changes||!results[1].meta.changes){
   const retry=await env.DB.prepare(`SELECT 1 FROM feedback_task_notes note JOIN feedback_tasks task ON task.id=note.task_id WHERE note.id=? AND note.task_id=? AND ${removing?'note.deleted_at IS NOT NULL AND note.deleted_by=?':'note.deleted_at IS NULL AND task.updated_by=?'} AND task.deleted_at IS NULL AND task.revision=? AND (note.author_id=? OR ?=1) AND ${guard.sql}`).bind(input.noteId,input.id,authority.user.id,input.revision+1,authority.user.id,administrator(authority)?1:0,...guard.params).first();
   if(!retry)throw new HttpError(409,'This comment or your permission changed. Refresh and try again.');
  }
 }else{
  const existing=await env.DB.prepare(`SELECT task_id,author_id,body FROM feedback_task_notes WHERE id=? AND deleted_at IS NULL AND ${guard.sql}`).bind(input.noteId,...guard.params).first<{task_id:string;author_id:string;body:string}>();
  if(existing){if(existing.task_id!==input.id||existing.author_id!==authority.user.id||existing.body!==input.body)throw new HttpError(409,'This comment identifier is already used.');return json(await detail(env,authority,input.id));}
  const results=await env.DB.batch([
   env.DB.prepare(`UPDATE feedback_tasks SET revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND revision=? AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM feedback_task_notes WHERE id=?) AND ${guard.sql}`).bind(authority.user.id,time,input.id,input.revision,input.noteId,...guard.params),
   env.DB.prepare(`INSERT INTO feedback_task_notes(id,task_id,author_id,body,created_at) SELECT ?,?,?,?,? WHERE changes()>0 AND EXISTS(SELECT 1 FROM feedback_tasks WHERE id=? AND revision=? AND updated_by=? AND deleted_at IS NULL)`).bind(input.noteId,input.id,authority.user.id,input.body,time,input.id,input.revision+1,authority.user.id),
  ]);
  if(!results[0].meta.changes||!results[1].meta.changes)throw new HttpError(409,'This task changed. Refresh before sending; your comment has been kept.');
 }
 return json(await detail(env,authority,input.id));
}
