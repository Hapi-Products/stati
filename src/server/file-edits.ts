import {groupMaterialAccess} from './worship-groups';
import {fileType,HttpError,json,now,safeFilename} from './core';
import {ministryAuthorityGuard,requireMinistryAuthority,type MinistryAuthority} from './ministry-roles';
import {profilePhotoType} from './profile-photo';
export type FileEditKind='group'|'task';
type EditRow={id:string;target_kind:FileEditKind;target_id:string;author_id:string;base_sha256:string;sha256:string;filename:string;bytes:number;content_type:string;object_key:string;state:'uploading'|'committed'|'failed';created_at:number};
type Target={id:string;author_id:string;filename:string;bytes:number;content_type:string;object_key:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,digest=/^[a-f0-9]{64}$/;
const objectKey=(kind:FileEditKind,id:string,intent:string)=>'file-edits/'+kind+'/'+id+'/'+intent;
const sha=async(bytes:ArrayBuffer|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes instanceof ArrayBuffer?bytes:new Uint8Array(bytes).buffer)),v=>v.toString(16).padStart(2,'0')).join('');
function targetGuard(authority:MinistryAuthority,kind:FileEditKind,id:string,editing=false){
 const narrow=kind==='task'&&!authority.capabilities.sendFiles,guard=ministryAuthorityGuard(authority,kind==='group'?'readSongs':narrow?'commentSongs':'sendFiles');
 const source=kind==='group'?"SELECT 1 FROM group_materials source WHERE source.id=? AND source.state='active'":"SELECT 1 FROM feedback_task_images source JOIN feedback_tasks task ON task.id=source.task_id WHERE source.id=? AND source.state='active' AND task.deleted_at IS NULL";
 const privateAccess=kind==='group'?groupMaterialAccess(authority,'source'):narrow?{sql:'task.author_id=? AND EXISTS(SELECT 1 FROM song_comments comment WHERE comment.id=task.id AND comment.author_id=task.author_id)',params:[authority.user.id]}:{sql:'1',params:[]};
 return{sql:`EXISTS(${source}${editing?' AND (source.author_id=? OR ?=1)':''} AND ${guard.sql} AND ${privateAccess.sql})`,params:[id,...(editing?[authority.user.id,authority.user.role==='admin'?1:0]:[]),...guard.params,...privateAccess.params]};
}
async function target(env:Env,authority:MinistryAuthority,kind:FileEditKind,id:string){
 const table=kind==='group'?'group_materials':'feedback_task_images',guard=targetGuard(authority,kind,id);
 const row=await env.DB.prepare(`SELECT id,author_id,filename,bytes,content_type,object_key FROM ${table} WHERE id=? AND ${guard.sql}`).bind(id,...guard.params).first<Target>();
 if(!row||row.object_key!==(kind==='group'?'group-materials/':'task-images/')+id)throw new HttpError(404,'This file is no longer available.');return row;
}
export async function currentFileEdit(env:Env,kind:FileEditKind,id:string){
 const edit=await env.DB.prepare("SELECT edit.* FROM file_edit_heads head JOIN file_edits edit ON edit.id=head.edit_id WHERE head.target_kind=? AND head.target_id=? AND edit.state='committed'").bind(kind,id).first<EditRow>();
 if(edit&&(edit.target_kind!==kind||edit.target_id!==id||edit.object_key!==objectKey(kind,id,edit.id)))throw new HttpError(503,'The saved file could not be verified.');return edit;
}
export async function editedFileObject(env:Env,kind:FileEditKind,id:string){
 const edit=await currentFileEdit(env,kind,id);if(!edit)return null;
 const object=await env.FILES.get(edit.object_key);
 if(!object||object.size!==edit.bytes||object.customMetadata?.sha256!==edit.sha256){if(object)await object.body.cancel();throw new HttpError(503,'The edited file is temporarily unavailable. Your earlier version is retained.');}
 return{edit,object};
}
async function currentDescription(env:Env,row:Target,kind:FileEditKind){
 const edit=await currentFileEdit(env,kind,row.id);if(edit)return{editId:edit.id,sha256:edit.sha256,filename:edit.filename,bytes:edit.bytes,contentType:edit.content_type};
 const object=await env.FILES.get(row.object_key);
 if(!object||object.size!==row.bytes||object.size>12*1024*1024){if(object)await object.body.cancel();throw new HttpError(503,'This file is temporarily unavailable.');}
 return{editId:null,sha256:await sha(await object.arrayBuffer()),filename:row.filename,bytes:row.bytes,contentType:row.content_type};
}
function receipt(edit:EditRow){return{ok:true,id:edit.id,targetKind:edit.target_kind,targetId:edit.target_id,baseSha256:edit.base_sha256,sha256:edit.sha256,bytes:edit.bytes,filename:edit.filename,state:edit.state};}
async function confirmedReceipt(env:Env,authority:MinistryAuthority,kind:FileEditKind,id:string,edit:EditRow){
 const fresh=targetGuard(authority,kind,id,true);
 if(!await env.DB.prepare('SELECT 1 WHERE '+fresh.sql).bind(...fresh.params).first())throw new HttpError(403,'Your access or this file changed. Its saved edit is retained.');
 return json(receipt(edit));
}
async function boundedBytes(request:Request,max:number){
 const raw=request.headers.get('content-length'),length=raw&&/^\d+$/.test(raw)?Number(raw):NaN;
 if(!Number.isSafeInteger(length)||length<1||length>max)throw new HttpError(413,'The edited file exceeds its size limit.');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Choose an edited file.');
 const chunks:Uint8Array[]=[];let total=0;
 try{while(true){request.signal.throwIfAborted();const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>length)throw new HttpError(413,'The edited file exceeded its declared size.');chunks.push(part.value);}if(total!==length)throw new HttpError(400,'The edited file upload was incomplete.');}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}return bytes;
}
export async function fileEditRoute(request:Request,env:Env,kind:FileEditKind,id:string){
 if(!uuid.test(id))throw new HttpError(400,'Choose a saved file.');
 const authority=await requireMinistryAuthority(request,env);if(kind==='group'?(!authority.capabilities.readSongs||!authority.capabilities.sendFiles):(!authority.capabilities.sendFiles&&!authority.capabilities.commentSongs))throw new HttpError(403,'Your role does not allow this file.');
 const row=await target(env,authority,kind,id),canEdit=row.author_id===authority.user.id||authority.user.role==='admin';
 if(request.method==='GET'){
  const intent=new URL(request.url).searchParams.get('intent');if(intent&&!uuid.test(intent))throw new HttpError(400,'Choose a saved edit.');
  const edit=intent?await env.DB.prepare('SELECT * FROM file_edits WHERE id=? AND target_kind=? AND target_id=? AND author_id=?').bind(intent,kind,id,authority.user.id).first<EditRow>():null;
  const file=await currentDescription(env,row,kind),fresh=targetGuard(authority,kind,id);
  if(!await env.DB.prepare('SELECT 1 WHERE '+fresh.sql).bind(...fresh.params).first())throw new HttpError(403,'Your access changed.');
  return json({file,canEdit,edit:edit?receipt(edit):null});
 }
 if(request.method!=='PUT')throw new HttpError(405,'Use Markup to edit this file.');
 if(!canEdit)throw new HttpError(403,'Only the uploader or an administrator can change the shared original.');
 const intent=request.headers.get('x-edit-id')||'',base=request.headers.get('x-base-sha256')||'',expected=request.headers.get('x-content-sha256')||'';
 if(!uuid.test(intent)||!digest.test(base)||!digest.test(expected))throw new HttpError(400,'Reopen this file before saving Markup.');
 let name:string;try{name=safeFilename(decodeURIComponent(request.headers.get('x-filename')||''));}catch{throw new HttpError(400,'Use a valid file name.');}
 if(!/\.(pdf|png|jpe?g|webp)$/i.test(name)||kind==='task'&&/\.pdf$/i.test(name))throw new HttpError(415,'Save Markup as a supported image or PDF.');
 const bytes=await boundedBytes(request,kind==='task'?8*1024*1024:12*1024*1024),contentType=/\.pdf$/i.test(name)?fileType(name,bytes.subarray(0,32)):profilePhotoType(name,bytes),checksum=await sha(bytes);
 if(checksum!==expected)throw new HttpError(400,'The edited file checksum did not match. Its local copy has been kept.');
 let prior=await env.DB.prepare('SELECT * FROM file_edits WHERE id=?').bind(intent).first<EditRow>();
 const matching=(edit:EditRow)=>edit.author_id===authority.user.id&&edit.target_kind===kind&&edit.target_id===id&&edit.base_sha256===base&&edit.sha256===checksum&&edit.filename===name&&edit.bytes===bytes.length;
 if(prior){if(!matching(prior))throw new HttpError(409,'This edit identity already belongs to different content.');if(prior.state==='committed')return confirmedReceipt(env,authority,kind,id,prior);if(prior.state==='failed')throw new HttpError(409,'This edit conflicts with a newer version. Reopen the current file; your local edit has been kept.');}
 const current=await currentDescription(env,row,kind);
 if(current.sha256!==base)throw new HttpError(409,'This file changed on another device. Your Markup is kept locally; reopen the current file before replacing it.');
 const guard=targetGuard(authority,kind,id,true),time=now(),key=objectKey(kind,id,intent);
 if(!prior){
  await env.DB.prepare(`INSERT INTO file_edits(id,target_kind,target_id,author_id,base_sha256,sha256,filename,bytes,content_type,object_key,state,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,'uploading',? WHERE ${guard.sql} AND (SELECT COUNT(*) FROM file_edits WHERE author_id=? AND created_at>?)<100 ON CONFLICT(id) DO NOTHING`).bind(intent,kind,id,authority.user.id,base,checksum,name,bytes.length,contentType,key,time,...guard.params,authority.user.id,time-86400).run();
  prior=await env.DB.prepare('SELECT * FROM file_edits WHERE id=?').bind(intent).first<EditRow>();
  if(!prior||!matching(prior))throw new HttpError(409,'The file or your access changed. Reopen the file before saving.');
 }
 try{
  const stored=await env.FILES.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType,cacheControl:'private, no-store'},customMetadata:{editId:intent,sha256:checksum}});
  if(!stored){const existing=await env.FILES.head(key);if(existing?.customMetadata?.editId!==intent||existing.customMetadata.sha256!==checksum||existing.size!==bytes.length)throw new HttpError(409,'The edit storage identity is already used. Your existing bytes were kept.');}
  request.signal.throwIfAborted();
  const fresh=targetGuard(authority,kind,id,true);
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO file_edit_heads(target_kind,target_id,edit_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM file_edits WHERE id=? AND state='uploading') AND ${fresh.sql} ON CONFLICT(target_kind,target_id) DO UPDATE SET edit_id=excluded.edit_id WHERE file_edit_heads.edit_id=? AND ${fresh.sql}`).bind(kind,id,intent,intent,...fresh.params,current.editId,...fresh.params),
   env.DB.prepare("UPDATE file_edits SET state='committed',committed_at=? WHERE id=? AND state='uploading' AND EXISTS(SELECT 1 FROM file_edit_heads WHERE target_kind=? AND target_id=? AND edit_id=?)").bind(now(),intent,kind,id,intent),
   env.DB.prepare("INSERT OR IGNORE INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,'edit-shared-file',?,? WHERE EXISTS(SELECT 1 FROM file_edits WHERE id=? AND state='committed')").bind(intent,authority.user.id,id,now(),intent),
  ]);
 }catch(error){
  const committed=await env.DB.prepare('SELECT * FROM file_edits WHERE id=?').bind(intent).first<EditRow>();
  if(committed?.state==='committed')return confirmedReceipt(env,authority,kind,id,committed);
  if(error instanceof HttpError)throw error;
  throw new HttpError(503,'Saving was not confirmed. Your edit is kept on this device. Check its saved edit before retrying.');
 }
 const saved=await env.DB.prepare('SELECT * FROM file_edits WHERE id=?').bind(intent).first<EditRow>();
 if(saved?.state==='committed')return confirmedReceipt(env,authority,kind,id,saved);
 await env.DB.prepare("UPDATE file_edits SET state='failed' WHERE id=? AND state='uploading'").bind(intent).run();
 throw new HttpError(409,'The file or your access changed while saving. Your Markup is kept locally.');
}
export async function deleteGroupFileEdits(env:Env,id:string){
 const rows=await env.DB.prepare("SELECT id,object_key FROM file_edits WHERE target_kind='group' AND target_id=?").bind(id).all<{id:string;object_key:string}>();
 for(const row of rows.results){if(row.object_key!==objectKey('group',id,row.id))throw new HttpError(503,'An earlier file version could not be verified for removal.');await env.FILES.delete(row.object_key);}
 await env.DB.batch([env.DB.prepare("DELETE FROM file_edit_heads WHERE target_kind='group' AND target_id=?").bind(id),env.DB.prepare("UPDATE file_edits SET state='failed',cleanup_checked_at=0 WHERE target_kind='group' AND target_id=?").bind(id)]);
}

/** Failed and interrupted edits only; committed prior versions never expire here. */
export async function cleanupFileEdits(env:Env,time=now()){
 const rows=await env.DB.prepare("UPDATE file_edits SET state='failed' WHERE id IN (SELECT id FROM file_edits edit WHERE state IN ('uploading','failed') AND created_at<? AND NOT EXISTS(SELECT 1 FROM file_edit_heads head WHERE head.edit_id=edit.id) ORDER BY cleanup_checked_at,created_at,id LIMIT 20) RETURNING id,target_kind,target_id,object_key,sha256").bind(time-7*86400).all<Pick<EditRow,'id'|'target_kind'|'target_id'|'object_key'|'sha256'>>();
 let failed=0;
 for(const row of rows.results){
  try{if(row.object_key!==objectKey(row.target_kind,row.target_id,row.id))throw Error('Unverified edit key');const object=await env.FILES.head(row.object_key);if(object&&(object.customMetadata?.editId!==row.id||object.customMetadata.sha256!==row.sha256))throw Error('Unverified edit owner');if(object)await env.FILES.delete(row.object_key);}
  catch{failed++;}
  finally{await env.DB.prepare("UPDATE file_edits SET cleanup_checked_at=? WHERE id=? AND state='failed'").bind(time,row.id).run();}
 }
 return{attempted:rows.results.length,failed};
}
