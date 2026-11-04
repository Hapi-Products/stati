import {z} from 'zod';
import {body,hash,HttpError,json,now} from './core';
import {ministryAuthorityGuard,requireMinistryCapability,type MinistryAuthority} from './ministry-roles';
import {requireStationMinistry,stationMinistryGuard} from './station-catalog';
const edit=z.object({id:z.string().uuid(),location:z.number().int().min(0).max(1000000),length:z.number().int().min(1).max(1000),quote:z.string().min(1).max(1000),replacement:z.string().max(1000)}).strict();
const input=z.object({id:z.string().uuid(),songId:z.string().regex(/^[a-f0-9]{64}$/),contentHash:z.string().regex(/^[a-f0-9]{64}$/),message:z.string().trim().min(1).max(2000),quote:z.string().max(1000),replacement:z.string().max(1000),edits:z.array(edit).min(1).max(10).optional()}).strict().refine(value=>!value.replacement||!!value.quote,{message:'Select the lyrics for your suggested correction.'}).refine(value=>!value.edits||!value.quote&&!value.replacement&&new Set(value.edits.map(edit=>edit.id)).size===value.edits.length,{message:'Keep each selected passage separate.'}).refine(value=>!value.edits||value.message.length+value.edits.reduce((count,edit)=>count+edit.quote.length+edit.replacement.length,0)<=4000,{message:'Keep the comment, selected lyrics and suggestions together within 4,000 characters. Split longer corrections into another comment.'});
type Comment={id:string;device_id:string;song_id:string;content_hash:string;author_id:string;message:string;quoted_text:string;proposed_text:string;edits_json?:string;request_hash:string;created_at:number;status:string;song_title:string};
function present(row:Comment){return{id:row.id,computerId:row.device_id,songId:row.song_id,contentHash:row.content_hash,message:row.message,quote:row.quoted_text,replacement:row.proposed_text,edits:JSON.parse(row.edits_json||'[]'),createdAt:row.created_at,status:row.status,title:row.song_title};}
async function receipt(env:Env,authority:MinistryAuthority,id:string){
 const guard=ministryAuthorityGuard(authority,'commentSongs');
 return env.DB.prepare(`SELECT comment.*,task.status,task.title AS song_title FROM song_comments comment JOIN feedback_tasks task ON task.id=comment.id WHERE comment.id=? AND comment.author_id=? AND ${guard.sql}`).bind(id,authority.user.id,...guard.params).first<Comment>();
}
export async function readSongComment(request:Request,env:Env,id:string){
 const authority=await requireMinistryCapability(request,env,'commentSongs'),row=await receipt(env,authority,id);
 if(!row)throw new HttpError(404,'This song comment is unavailable.');const guard=ministryAuthorityGuard(authority,'commentSongs');const notes=await env.DB.prepare(`SELECT note.id,note.body,note.created_at AS createdAt,author.first_name||' '||author.last_initial||'.' AS authorName,CASE WHEN author.photo_key IS NOT NULL THEN '/api/members/'||author.id||'/photo' ELSE NULL END AS authorPhotoUrl,0 AS canDelete FROM feedback_task_notes note JOIN users author ON author.id=note.author_id WHERE note.task_id=? AND note.deleted_at IS NULL AND ${guard.sql} ORDER BY note.created_at,note.id LIMIT 50`).bind(id,...guard.params).all();return json({correction:present(row),notes:notes.results});
}
export async function songComments(request:Request,env:Env,computerId:string){
 const authority=await requireStationMinistry(request,env,computerId,'commentSongs'),guard=stationMinistryGuard(authority,computerId,'commentSongs');
 if(request.method==='GET'){
  const [comments,selected]=await env.DB.batch([
   env.DB.prepare(`SELECT comment.*,task.status,task.title AS song_title FROM song_comments comment JOIN feedback_tasks task ON task.id=comment.id WHERE comment.device_id=? AND comment.author_id=? AND ${guard.sql} ORDER BY comment.created_at DESC,comment.id DESC LIMIT 100`).bind(computerId,authority.user.id,...guard.params),
   env.DB.prepare(`SELECT service.id,service.title,service.content_json FROM station_service_selections selected JOIN station_services service ON service.id=selected.service_id AND service.device_id=selected.device_id WHERE selected.device_id=? AND service.archived=0 AND ${guard.sql}`).bind(computerId,...guard.params)
  ]);
  const service=selected.results[0] as {id:string;title:string;content_json:string}|undefined;
  const songs=service?(JSON.parse(service.content_json) as{songs?:unknown[]}).songs??[]:[];
  return json({items:(comments.results as Comment[]).map(present),service:service?{id:service.id,title:service.title,songs}:null});
 }
 if(request.method!=='POST')throw new HttpError(405,'Use the song comment form.');
 const data=await body(request,input,96*1024),fingerprint=await hash(JSON.stringify({computerId,...data})),existing=await receipt(env,authority,data.id);
 if(existing){if(existing.device_id!==computerId||existing.request_hash!==fingerprint)throw new HttpError(409,'This comment identifier belongs to different content.');return json({correction:present(existing)});}
 const source=await env.DB.prepare(`SELECT title,text FROM station_catalog WHERE device_id=? AND song_id=? AND content_hash=? AND ${guard.sql}`).bind(computerId,data.songId,data.contentHash,...guard.params).first<{title:string;text:string}>();
 if(!source||data.quote&&!source.text.includes(data.quote)||source&&data.edits?.some(edit=>{
  const end=edit.location+edit.length,startUnit=source.text.charCodeAt(edit.location),endUnit=source.text.charCodeAt(end);
  return end>source.text.length||startUnit>=0xdc00&&startUnit<=0xdfff||endUnit>=0xdc00&&endUnit<=0xdfff||source.text.slice(edit.location,end)!==edit.quote;
 }))throw new HttpError(409,'This song or selected lyrics changed. Reopen the current song before sending a correction.');
 const time=now(),title='Song: '+[...source.title].slice(0,150).join(''),details=['Song: '+[...source.title].slice(0,150).join(''),'Comment: '+data.message,...(data.quote?['Selected lyrics:\n'+data.quote]:[]),...(data.replacement?['Suggested correction:\n'+data.replacement]:[]),...(data.edits??[]).map((edit,index)=>'Correction '+(index+1)+'\nSelected lyrics:\n'+edit.quote+(edit.replacement?'\nSuggested correction:\n'+edit.replacement:''))].join('\n\n');
 const current=`EXISTS(SELECT 1 FROM station_catalog current WHERE current.device_id=? AND current.song_id=? AND current.content_hash=? AND (?='' OR instr(current.text,?)>0) AND current.text=?)`;
 const currentParams=[computerId,data.songId,data.contentHash,data.quote,data.quote,source.text];
 const results=await env.DB.batch([
  env.DB.prepare(`INSERT INTO feedback_tasks(id,title,body,status,urgent,revision,author_id,updated_by,create_hash,created_at,updated_at) SELECT ?,?,?,'new',0,1,?,?,?,?,? WHERE ${guard.sql} AND ${current} AND (SELECT COUNT(*) FROM song_comments WHERE author_id=? AND created_at>?)<20 ON CONFLICT(id) DO NOTHING`).bind(data.id,title,details,authority.user.id,authority.user.id,fingerprint,time,time,...guard.params,...currentParams,authority.user.id,time-86400),
  env.DB.prepare(`INSERT INTO song_comments(id,device_id,song_id,content_hash,author_id,message,quoted_text,proposed_text,edits_json,request_hash,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE changes()>0 AND ${guard.sql} AND ${current} ON CONFLICT(id) DO NOTHING`).bind(data.id,computerId,data.songId,data.contentHash,authority.user.id,data.message,data.quote,data.replacement,JSON.stringify(data.edits??[]),fingerprint,time,...guard.params,...currentParams),
  env.DB.prepare(`INSERT INTO requests(id,device_id,user_id,message,created_at,acknowledged_at) SELECT ?,?,?,?,?,NULL WHERE changes()>0 AND ${guard.sql} ON CONFLICT(id) DO NOTHING`).bind(data.id,computerId,authority.user.id,'Song correction: '+[...source.title].slice(0,170).join('')+'. Review Feedback & tasks.',time,...guard.params)
 ]);
 const saved=await receipt(env,authority,data.id);
 if(!saved||saved.request_hash!==fingerprint)throw new HttpError(409,'The song, your access or the comment changed. Your draft is kept; refresh before retrying.');
 return json({correction:present(saved)},results[1].meta.changes?201:200);
}
