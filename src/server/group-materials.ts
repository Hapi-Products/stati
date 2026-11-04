import {groupMaterialAccess,worshipGroupAccess} from './worship-groups';
import {editedFileObject,deleteGroupFileEdits} from './file-edits';
import {z} from 'zod';
import {body,HttpError,json,now,safeFilename} from './core';
import {ministryAuthorityGuard,requireMinistryCapability,type MinistryAuthority} from './ministry-roles';
import {requireStationMinistry,stationMinistryGuard} from './station-catalog';
import {prepareUploadStream} from './upload-stream';
import {MAX_GROUP_MATERIAL_BYTES,type GroupMaterial,type GroupMaterialList} from '../shared/group-materials-types';

type MaterialRow={id:string;object_key:string;upload_token:string;group_name:string;group_key:string;group_id:string|null;title:string;filename:string;bytes:number;content_type:GroupMaterial['contentType'];author_id:string;state:'uploading'|'active'|'deleting'|'retired';created_at:number;updated_at:number;upload_expires_at:number;named_group_name?:string|null;first_name?:string;last_initial?:string;content_version?:string;edited_filename?:string;edited_bytes?:number;edited_content_type?:GroupMaterial['contentType']};
const identifier=z.string().uuid();
const label=(max:number)=>z.string().normalize('NFKC').trim().min(1).max(max).refine(value=>!/[\u0000-\u001f\u007f]/.test(value),'Use a name without control characters.');
const metadata=z.object({title:label(160),groupName:label(80),filename:label(200)}).strict();
const allowedTypes=new Set(['application/pdf','image/jpeg','image/png','image/webp']);
const fileKey=(id:string)=>'group-materials/'+id;
const uncertain=()=>new HttpError(503,'The shared file save could not be confirmed. Refresh the library before trying again.');
function validId(value:string){if(!identifier.safeParse(value).success)throw new HttpError(400,'Choose a shared file from the library.');return value;}
function material(row:MaterialRow,authority:MinistryAuthority):GroupMaterial{
 const url='/api/group-materials/'+row.id+'/file';
 return{id:row.id,contentVersion:row.content_version??undefined,groupName:row.named_group_name??row.group_name,groupId:row.group_id??undefined,title:row.title,filename:row.edited_filename??row.filename,bytes:row.edited_bytes??row.bytes,contentType:row.edited_content_type??row.content_type,authorId:row.author_id,authorName:[row.first_name,row.last_initial?row.last_initial+'.':''].filter(Boolean).join(' ')||'Team member',createdAt:row.created_at,removalPending:row.state==='deleting',canDelete:authority.user.role==='admin'||row.author_id===authority.user.id,fileUrl:url,downloadUrl:url+'?download=1'};
}
async function cancel(body:ReadableStream<Uint8Array>|null){if(body&&!body.locked)await body.cancel().catch(()=>{});}

export async function listGroupMaterials(request:Request,env:Env){
 const query=new URL(request.url).searchParams,computerId=query.get('computerId'),songId=query.get('songId');
 if((computerId===null)!==(songId===null)||computerId!==null&&(!identifier.safeParse(computerId).success||!songId||!/^[a-f0-9]{64}$/.test(songId)))throw new HttpError(400,'Choose a saved song and its computer.');
 const linkContext=computerId&&songId?{computerId,songId}:null;
 const authority=linkContext?await requireStationMinistry(request,env,linkContext.computerId,'readSongs'):await requireMaterialAuthority(request,env);
 const guard=linkContext?stationMinistryGuard(authority,linkContext.computerId,'readSongs'):ministryAuthorityGuard(authority,'readSongs');
 const linkedSQL=linkContext?' AND EXISTS(SELECT 1 FROM group_material_song_links song_link WHERE song_link.material_id=material.id AND song_link.device_id=? AND song_link.song_id=?)':'',linkedParams=linkContext?[linkContext.computerId,linkContext.songId]:[];
 const privateAccess=groupMaterialAccess(authority),groupId=query.get('groupId');
 if(groupId!==null&&!identifier.safeParse(groupId).success)throw new HttpError(400,'Choose a saved worship group.');
 const groupSQL=groupId?' AND material.group_id=?':'',groupParams=groupId?[groupId]:[];
 const rawGroup=query.get('groupName')||'',group=rawGroup?label(80).safeParse(rawGroup):null;
 if(group&&!group.success)throw new HttpError(400,'Use a group name up to 80 characters.');
 const before=query.get('before');let cursor:{time:number;id:string}|null=null;
 if(before){const match=before.match(/^(\d{1,12}):([a-f\d-]{36})$/i);if(!match||!identifier.safeParse(match[2]).success)throw new HttpError(400,'Refresh the shared file list.');cursor={time:Number(match[1]),id:match[2]};}
 const rows=await env.DB.prepare(`SELECT material.*,named.name AS named_group_name,author.first_name,author.last_initial,edit.id AS content_version,edit.filename AS edited_filename,edit.bytes AS edited_bytes,edit.content_type AS edited_content_type FROM group_materials material JOIN users author ON author.id=material.author_id LEFT JOIN worship_groups named ON named.id=material.group_id LEFT JOIN file_edit_heads head ON head.target_kind='group' AND head.target_id=material.id LEFT JOIN file_edits edit ON edit.id=head.edit_id AND edit.state='committed'
 WHERE material.state IN ('active','deleting') AND ${guard.sql} AND ${privateAccess.sql}${groupSQL}${linkedSQL}${group?.success?' AND material.group_id IS NULL AND material.group_key=?':''}${cursor?' AND (material.created_at<? OR (material.created_at=? AND material.id<?))':''}
 ORDER BY material.created_at DESC,material.id DESC LIMIT 41`).bind(...guard.params,...privateAccess.params,...groupParams,...linkedParams,...(group?.success?[group.data.toLowerCase()]:[]),...(cursor?[cursor.time,cursor.time,cursor.id]:[])).all<MaterialRow>();
 const groups=await env.DB.prepare(`SELECT MIN(group_name) AS name FROM group_materials material WHERE state IN ('active','deleting') AND material.group_id IS NULL AND ${guard.sql} AND ${privateAccess.sql}${groupSQL}${linkedSQL} GROUP BY group_key ORDER BY name COLLATE NOCASE LIMIT 200`).bind(...guard.params,...privateAccess.params,...groupParams,...linkedParams).all<{name:string}>();
 const visible=rows.results.slice(0,40),last=visible.at(-1);
 return json({materials:visible.map(row=>material(row,authority)),groups:groups.results.map(row=>row.name),nextCursor:rows.results.length>40&&last?last.created_at+':'+last.id:null,canUpload:authority.capabilities.planServices,...(linkContext?{linkContext}:{})} satisfies GroupMaterialList);
}

async function storeObject(env:Env,key:string,uploadToken:string,stream:ReadableStream<Uint8Array>,bytes:number,contentType:string,signal:AbortSignal){
 const fixed=new FixedLengthStream(bytes),abort=new AbortController();
 const put=env.FILES.put(key,fixed.readable,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType,cacheControl:'private, no-store'},customMetadata:{statiMaterialUpload:uploadToken}}).then(stored=>{if(!stored)abort.abort(new Error('Object already exists.'));return stored;}).catch(error=>{abort.abort(error);throw error;});
 const pipe=stream.pipeTo(fixed.writable,{signal:AbortSignal.any([signal,abort.signal])});
 const [stored,piped]=await Promise.allSettled([put,pipe]);
 if(stored.status==='fulfilled'&&stored.value&&piped.status==='fulfilled'&&stored.value.size===bytes)return;
 if(stored.status==='fulfilled'&&stored.value===null)throw new HttpError(409,'This storage location already exists. Choose the file again; the existing file was kept.');
 throw new HttpError(400,'The file upload was interrupted or did not match its size. Refresh and try again.');
}

async function retireUpload(env:Env,id:string){
 const row=await env.DB.prepare("UPDATE group_materials SET state='retired',updated_at=? WHERE id=? AND state='uploading' RETURNING object_key,upload_token").bind(now(),id).first<{object_key:string;upload_token:string}>();
 if(row&&row.object_key===fileKey(id)){
  const object=await env.FILES.head(row.object_key);
  if(object?.customMetadata?.statiMaterialUpload===row.upload_token)await env.FILES.delete(row.object_key);
 }
}
export async function uploadGroupMaterial(request:Request,env:Env){
 let uploadAuthority:MinistryAuthority|undefined;
 let id:string|undefined,putStarted=false,preparedStream:ReadableStream<Uint8Array>|undefined;
 try{
  const authority=await requireMinistryCapability(request,env,'planServices'),query=new URL(request.url).searchParams;
  uploadAuthority=authority;
  const parsed=metadata.safeParse({title:query.get('title'),groupName:query.get('groupName'),filename:query.get('filename')});
  if(!parsed.success)throw new HttpError(400,'Add a song title, group name, and file name before sharing.');
  const data=parsed.data,filename=safeFilename(data.filename),groupId=query.get('groupId');
  if(groupId!==null&&!identifier.safeParse(groupId).success)throw new HttpError(400,'Choose a saved worship group.');
  const named=groupId?worshipGroupAccess(authority,'?'):null,uploadAccess=named?{sql:named.sql,params:[groupId,...named.params]}:{sql:'1',params:[]};
  if(named&&!await env.DB.prepare('SELECT 1 WHERE '+uploadAccess.sql).bind(...uploadAccess.params).first())throw new HttpError(404,'This worship group is no longer available to your account.');
  if(!/\.(?:pdf|jpe?g|png|webp)$/i.test(filename))throw new HttpError(415,'Share a PDF, JPG, PNG or WebP chord sheet or lyric image.');
  const raw=request.headers.get('content-length'),bytes=raw&&/^\d+$/.test(raw)?Number(raw):NaN;
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>MAX_GROUP_MATERIAL_BYTES)throw new HttpError(413,'Choose a non-empty shared file up to 12 MB.');
  if(!request.body)throw new HttpError(400,'Choose a file to share.');
  const prepared=await prepareUploadStream(request.body,filename,bytes);
  preparedStream=prepared.stream;
  if(!allowedTypes.has(prepared.contentType)){await cancel(prepared.stream);throw new HttpError(415,'Share a PDF, JPG, PNG or WebP chord sheet or lyric image.');}
  id=crypto.randomUUID();const key=fileKey(id),uploadToken=crypto.randomUUID(),created=now(),guard=ministryAuthorityGuard(authority,'planServices',created);
  try{
   const inserted=await env.DB.prepare(`INSERT INTO group_materials(id,object_key,upload_token,group_name,group_key,title,filename,bytes,content_type,author_id,state,created_at,updated_at,upload_expires_at,group_id)
    SELECT ?,?,?,?,?,?,?,?,?,?,'uploading',?,?,?,? WHERE ${guard.sql} AND ${uploadAccess.sql}`).bind(id,key,uploadToken,data.groupName,data.groupName.toLowerCase(),data.title,filename,bytes,prepared.contentType,authority.user.id,created,created,created+600,groupId,...guard.params,...uploadAccess.params).run();
   if(!inserted.meta.changes)throw new HttpError(409,'Your access changed before the file was shared. Refresh and try again.');
  }catch(error){await cancel(prepared.stream);id=undefined;throw error;}
  request.signal.throwIfAborted();putStarted=true;
  try{await storeObject(env,key,uploadToken,prepared.stream,bytes,prepared.contentType,request.signal);}
  catch(error){
   // Conditional failure proves the existing object was not ours to delete.
   if(error instanceof HttpError&&error.status===409){await env.DB.prepare("DELETE FROM group_materials WHERE id=? AND state='uploading'").bind(id).run();id=undefined;}
   throw error;
  }
  request.signal.throwIfAborted();
  const time=now(),commitGuard=ministryAuthorityGuard(authority,'planServices',time),commitAccess=groupMaterialAccess(authority,'group_materials'),auditId=crypto.randomUUID();
  const result=await env.DB.batch([
   env.DB.prepare(`UPDATE group_materials SET state='active',updated_at=? WHERE id=? AND state='uploading' AND upload_expires_at>? AND ${commitGuard.sql} AND ${commitAccess.sql}`).bind(time,id,time,...commitGuard.params,...commitAccess.params),
   env.DB.prepare("INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,'share-group-material',?,? WHERE changes()>0").bind(auditId,authority.user.id,id,time),
  ]);
  if(!result[0].meta.changes)throw new HttpError(409,'Your access changed or the upload expired before sharing. Refresh and try again.');
  return json({ok:true,id},201);
 }catch(error){
  if(id){
   let row:MaterialRow|null;
   try{row=await env.DB.prepare('SELECT * FROM group_materials WHERE id=?').bind(id).first<MaterialRow>();}catch{throw uncertain();}
   // A committed save can lose its database response. Retain published bytes.
   if(row?.state==='active'){
    if(!uploadAuthority)throw uncertain();
    const fresh=ministryAuthorityGuard(uploadAuthority,'planServices'),access=groupMaterialAccess(uploadAuthority,'group_materials');
    if(!await env.DB.prepare(`SELECT id FROM group_materials WHERE id=? AND state='active' AND ${fresh.sql} AND ${access.sql}`).bind(id,...fresh.params,...access.params).first())throw new HttpError(403,'The shared file was saved, but your access changed. Its stored bytes have been kept.');
    return json({ok:true,id},201);
   }
   try{await retireUpload(env,id);}catch{console.error(JSON.stringify({event:'group_material_upload_cleanup_failed'}));}
  }
  await cancel(preparedStream||null);
  if(!putStarted)await cancel(request.body);
  if(error instanceof HttpError)throw error;
  if(request.signal.aborted)throw new HttpError(400,'Sharing stopped. Refresh the library before trying again.');
  throw uncertain();
 }
}

export async function readGroupMaterial(request:Request,env:Env,id:string){
 validId(id);
 const authority=await requireMaterialAuthority(request,env),guard=ministryAuthorityGuard(authority,'readSongs'),access=groupMaterialAccess(authority,'group_materials');
 const row=await env.DB.prepare(`SELECT * FROM group_materials WHERE id=? AND state='active' AND ${guard.sql} AND ${access.sql}`).bind(id,...guard.params,...access.params).first<MaterialRow>();
 if(!row||row.object_key!==fileKey(id))throw new HttpError(404,'This shared file is no longer available.');
 const edited=await editedFileObject(env,'group',id);
 const object=edited?.object??await env.FILES.get(row.object_key);
 if(!object)throw new HttpError(503,'This shared file is temporarily unavailable. Refresh or ask its uploader.');
 const current=ministryAuthorityGuard(authority,'readSongs'),freshAccess=groupMaterialAccess(authority,'group_materials');
 const allowed=await env.DB.prepare(`SELECT id FROM group_materials WHERE id=? AND state='active' AND ${current.sql} AND ${freshAccess.sql}`).bind(id,...current.params,...freshAccess.params).first();
 if(!allowed||object.size!==(edited?.edit.bytes??row.bytes)){await cancel(object.body);throw new HttpError(allowed?503:403,allowed?'The shared file could not be verified. Ask its uploader.':'Your access changed. Sign in again.');}
 const disposition=new URL(request.url).searchParams.get('download')==='1'?'attachment':'inline';
 return new Response(object.body,{headers:{'Content-Type':edited?.edit.content_type??row.content_type,'Content-Length':String(edited?.edit.bytes??row.bytes),'Content-Disposition':disposition+`; filename*=UTF-8''${encodeURIComponent(edited?.edit.filename??row.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}

export async function deleteGroupMaterial(request:Request,env:Env,id:string){
 validId(id);
 const authority=await requireMaterialAuthority(request,env),guard=ministryAuthorityGuard(authority,'readSongs'),access=groupMaterialAccess(authority,'group_materials'),time=now();
 const result=await env.DB.batch([
  env.DB.prepare(`UPDATE group_materials SET state='deleting',updated_at=? WHERE id=? AND state='active' AND (author_id=? OR ?='admin') AND ${guard.sql} AND ${access.sql}`).bind(time,id,authority.user.id,authority.user.role,...guard.params,...access.params),
  env.DB.prepare("INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,'remove-group-material',?,? WHERE changes()>0").bind(crypto.randomUUID(),authority.user.id,id,time),
 ]);
 const currentGuard=ministryAuthorityGuard(authority,'readSongs'),currentAccess=groupMaterialAccess(authority,'group_materials');
 const row=await env.DB.prepare(`SELECT * FROM group_materials WHERE id=? AND state='deleting' AND (author_id=? OR ?='admin') AND ${currentGuard.sql} AND ${currentAccess.sql}`).bind(id,authority.user.id,authority.user.role,...currentGuard.params,...currentAccess.params).first<MaterialRow>();
 if(!row||row.object_key!==fileKey(id)){
  if(result[0].meta.changes&&!await env.DB.prepare('SELECT id FROM group_materials WHERE id=?').bind(id).first())return json({ok:true}); // Another confirmed remover finished the same immutable object.
  throw new HttpError(403,'Only the uploader or an administrator can remove this shared file. Refresh if your access changed.');
 }
 try{
  await deleteGroupFileEdits(env,id);
  await env.FILES.delete(row.object_key);
  await env.DB.prepare("DELETE FROM group_materials WHERE id=? AND object_key=? AND state='deleting'").bind(id,row.object_key).run();
 }catch{throw new HttpError(503,'Removal could not be confirmed. Refresh and retry Remove; the original on your device is unchanged.');}
 return json({ok:true});
}

/** Only abandoned uploads are reclaimed. Published files have no automatic expiry. */
export async function cleanupGroupMaterialUploads(env:Env,time=now()){
 const candidates=await env.DB.prepare("UPDATE group_materials SET state='retired',updated_at=? WHERE id IN (SELECT id FROM group_materials WHERE state='retired' OR (state='uploading' AND upload_expires_at<=?) ORDER BY updated_at,id LIMIT 20) RETURNING id,object_key,upload_token,upload_expires_at").bind(time,time).all<{id:string;object_key:string;upload_token:string;upload_expires_at:number}>();
 let failed=0;const completed:string[]=[];
 for(const row of candidates.results){
  if(row.object_key!==fileKey(row.id)){failed++;continue;}
  try{
   const object=await env.FILES.head(row.object_key);
   if(object?.customMetadata?.statiMaterialUpload===row.upload_token)await env.FILES.delete(row.object_key);
   if(row.upload_expires_at<time-7*86400)completed.push(row.id);
  }catch{failed++;}
 }
 if(completed.length)try{await env.DB.prepare("DELETE FROM group_materials WHERE id IN (SELECT value FROM json_each(?)) AND state='retired'").bind(JSON.stringify(completed)).run();}catch{failed+=completed.length;}
 return{attempted:candidates.results.length,failed};
}

/** A stable explicit destination never converts a private file to a public label. */
export async function assignGroupMaterial(request:Request,env:Env,id:string){
 validId(id);
 const data=await body(request,z.object({groupId:identifier,expectedGroupId:identifier.nullable()}).strict());
 const authority=await requireMinistryCapability(request,env,'planServices'),guard=ministryAuthorityGuard(authority,'planServices'),source=groupMaterialAccess(authority,'group_materials'),destination=worshipGroupAccess(authority,'?'),time=now();
 const destParams=[data.groupId,...destination.params];
 await env.DB.batch([
  env.DB.prepare(`UPDATE group_materials SET group_id=?,updated_at=? WHERE id=? AND state='active' AND group_id IS ? AND (author_id=? OR ?='admin') AND ${guard.sql} AND ${source.sql} AND ${destination.sql}`)
  .bind(data.groupId,time,id,data.expectedGroupId,authority.user.id,authority.user.role,...guard.params,...source.params,...destParams),
  env.DB.prepare("INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,'assign-group-material',?,? WHERE changes()>0").bind(crypto.randomUUID(),authority.user.id,id,time),
 ]);
 const fresh=ministryAuthorityGuard(authority,'planServices'),access=groupMaterialAccess(authority,'group_materials');
 const confirmed=await env.DB.prepare(`SELECT id FROM group_materials WHERE id=? AND group_id=? AND state='active' AND (author_id=? OR ?='admin') AND ${fresh.sql} AND ${access.sql}`).bind(id,data.groupId,authority.user.id,authority.user.role,...fresh.params,...access.params).first();
 if(!confirmed)throw new HttpError(409,'The file, destination or your access changed. Refresh before moving it again.');
 return json({ok:true,id,groupId:data.groupId});
}

async function requireMaterialAuthority(request:Request,env:Env){const authority=await requireMinistryCapability(request,env,'readSongs');if(!authority.capabilities.sendFiles)throw new HttpError(403,'Your role does not allow group files.');return authority;}
