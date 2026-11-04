import {afterEach,expect,it} from 'vitest';
import {createExecutionContext,env} from 'cloudflare:test';
import worker from '../src/server/index';
import {hash,now,token,type User} from '../src/server/core';
import {cleanupGroupMaterialUploads} from '../src/server/group-materials';
import {cleanupTransfers} from '../src/server/transfer-cleanup';
import {MAX_GROUP_MATERIAL_BYTES,type GroupMaterialList} from '../src/shared/group-materials-types';
import type {MinistryRole} from '../src/server/ministry-roles';
import photos from './fixtures/profile-photos.json';

// Every identity and byte here is isolated Vitest D1/R2 data.
const objects=new Set<string>();
afterEach(async()=>{if(objects.size)await env.FILES.delete([...objects]);objects.clear();await env.DB.prepare('DELETE FROM group_materials').run();});
const png=()=>Uint8Array.from(atob(photos.fixtures.find(photo=>photo.extension==='png')!.base64),character=>character.charCodeAt(0));
const pdf=()=>new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
async function person(ministryRole:MinistryRole|null='worship_member',role:User['role']='member',status:User['status']='active'){
 const id=crypto.randomUUID(),session=token();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Isolated','T',?,?,?)").bind(id,role,status,now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+86400),
 ]);
 if(ministryRole)await env.DB.prepare('INSERT INTO user_ministry_roles VALUES(?,?,?,?)').bind(id,ministryRole,id,now()).run();
 return{id,session,cookie:'stati_session='+session};
}
type Person=Awaited<ReturnType<typeof person>>;
type Hooks={put?:(key:string,stored:R2Object|null)=>Promise<void>;get?:(key:string)=>Promise<void>;delete?:(key:string)=>Promise<void>;collision?:boolean;db?:D1Database};
function bindings(hooks:Hooks={}){
 const files=new Proxy(env.FILES,{get(target,property){
  if(property==='put')return async(...args:Parameters<R2Bucket['put']>)=>{
   const key=String(args[0]);objects.add(key);
   if(hooks.collision)await target.put(key,'Keep pre-existing bytes.');
   const result=await target.put(...args);await hooks.put?.(key,result);return result;
  };
  if(property==='get')return async(...args:Parameters<R2Bucket['get']>)=>{const result=await target.get(...args);await hooks.get?.(String(args[0]));return result;};
  if(property==='delete')return async(key:string|string[])=>{for(const item of typeof key==='string'?[key]:key)await hooks.delete?.(item);return target.delete(key);};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 return{...env,DB:hooks.db||env.DB,FILES:files};
}
async function call(path:string,{actor,method='GET',body,headers={},hooks={}}:{actor?:Person;method?:string;body?:BodyInit;headers?:Record<string,string>;hooks?:Hooks}={}){
 return worker.fetch(new Request('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access'+(actor?'; '+actor.cookie:''),...headers},...(body!==undefined?{body}:{})}),bindings(hooks),createExecutionContext());
}
async function upload(actor:Person,bytes=png(),{title='Shared song',groupName='First group',filename='chords.png',hooks={}}:{title?:string;groupName?:string;filename?:string;hooks?:Hooks}={}){
 return call('/group-materials?'+new URLSearchParams({title,groupName,filename}),{actor,method:'POST',body:bytes,headers:{'Content-Length':String(bytes.length)},hooks});
}
const list=async(actor:Person,query='')=>(await(await call('/group-materials'+query,{actor})).json()) as GroupMaterialList;
const stored=async(id:string)=>env.DB.prepare('SELECT * FROM group_materials WHERE id=?').bind(id).first<{id:string;object_key:string;state:string;upload_token:string}>();
const save=async(actor:Person,bytes=png(),options:Parameters<typeof upload>[2]={})=>{const response=await upload(actor,bytes,options);expect(response.status).toBe(201);return(await response.json()) as{id:string};};

it.each([['chords.png',png,'image/png'],['lyrics.pdf',pdf,'application/pdf']] as const)('shares exact %s bytes persistently and serves authenticated view and download responses',async(filename,data,type)=>{
 const author=await person(),viewer=await person('pastor'),bytes=data(),saved=await save(author,bytes,{filename}),row=await stored(saved.id);
 expect(row?.state).toBe('active');expect(row?.object_key).toBe('group-materials/'+saved.id);
 const listing=await list(viewer);expect(listing.materials).toHaveLength(1);expect(listing.materials[0]).toMatchObject({id:saved.id,title:'Shared song',groupName:'First group',filename,contentType:type,bytes:bytes.length,canDelete:false});expect(listing.canUpload).toBe(false);
 for(const suffix of ['/file','/file?download=1']){
  const response=await call('/group-materials/'+saved.id+suffix,{actor:viewer});expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toBe(type);expect(response.headers.get('Content-Length')).toBe(String(bytes.length));expect(response.headers.get('Cache-Control')).toBe('no-store');expect(response.headers.get('Content-Disposition')).toMatch(suffix.includes('download')?/^attachment/:/^inline/);expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
 }
 await cleanupTransfers(env,now()+86400*100);await cleanupGroupMaterialUploads(env,now()+86400*100);
 expect(await env.FILES.head(row!.object_key)).not.toBeNull();expect((await stored(saved.id))?.state).toBe('active');
});

it('keeps same-name uploads as separate immutable objects and group labels are filters rather than hidden access groups',async()=>{
 const author=await person(),other=await person('choir_director');
 const first=await save(author,png(),{groupName:'Jason’s group'}),second=await save(author,pdf(),{groupName:'Choir',filename:'chords.pdf'});
 expect(first.id).not.toBe(second.id);expect((await list(other)).materials.map(item=>item.id).sort()).toEqual([first.id,second.id].sort());
 expect((await list(other,'?groupName='+encodeURIComponent('JASON’S GROUP'))).materials.map(item=>item.id)).toEqual([first.id]);
 expect((await list(author)).materials.every(item=>item.canDelete)).toBe(true);
 expect(await env.FILES.head('group-materials/'+first.id)).not.toBeNull();expect(await env.FILES.head('group-materials/'+second.id)).not.toBeNull();
});

it('rejects anonymous, ordinary, pending, removed and expired-session reads and writes',async()=>{
 const author=await person(),saved=await save(author);
 const unauthorized=[undefined,await person(null),await person('worship_member','member','pending'),await person('worship_member','member','removed'),await person()];
 await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(unauthorized.at(-1)!.id).run();
 for(const actor of unauthorized){
  expect((await call('/group-materials',{actor})).status).toBeGreaterThanOrEqual(400);
  expect((await call('/group-materials/'+saved.id+'/file',{actor})).status).toBeGreaterThanOrEqual(400);
  expect((await call('/group-materials?title=A&groupName=B&filename=a.png',{actor,method:'POST',body:png(),headers:{'Content-Length':String(png().length)}})).status).toBeGreaterThanOrEqual(400);
 }
 expect(await env.FILES.head('group-materials/'+saved.id)).not.toBeNull();
});

it('allows ministry planners to upload and keeps read-only pastor upload denied',async()=>{
 for(const ministry of ['worship_member','worship_leader','choir_director'] as const)expect((await upload(await person(ministry))).status).toBe(201);
 expect((await upload(await person('pastor'))).status).toBe(403);
 expect((await upload(await person(null,'admin'))).status).toBe(201);
});

it('rejects malformed signatures, wrong formats and missing/oversized declarations without changing existing files',async()=>{
 const author=await person(),saved=await save(author),key='group-materials/'+saved.id;
 for(const [bytes,filename] of [[new TextEncoder().encode('<svg>not a PNG</svg>'),'bad.png'],[png(),'wrong.pdf'],[pdf(),'bad.txt'],[pdf(),'bad.pro']] as const){
  const response=await upload(author,bytes,{filename});expect(response.status).toBe(415);
 }
 for(const length of [undefined,'0','-1','bad',String(MAX_GROUP_MATERIAL_BYTES+1)]){
  const response=await call('/group-materials?title=A&groupName=B&filename=chords.png',{actor:author,method:'POST',body:png(),headers:length===undefined?{}:{'Content-Length':length}});expect(response.status).toBe(413);
 }
 for(const query of ['title=&groupName=A&filename=a.png','title=A&groupName=&filename=a.png','title=A&groupName='+encodeURIComponent('x'.repeat(81))+'&filename=a.png'])expect((await call('/group-materials?'+query,{actor:author,method:'POST',body:png(),headers:{'Content-Length':String(png().length)}})).status).toBe(400);
 expect((await list(author)).materials).toHaveLength(1);expect(await env.FILES.head(key)).not.toBeNull();
});

it.each(['short','long','broken'] as const)('rejects a %s streamed body and publishes no material',async mode=>{
 const author=await person(),bytes=png();let step=0,cancelled=false;
 const chunks=mode==='short'?[bytes.subarray(0,36)]:mode==='long'?[bytes,new Uint8Array([1])]:[bytes.subarray(0,36)];
 const source=new ReadableStream<Uint8Array>({pull(controller){if(step<chunks.length)controller.enqueue(chunks[step++]);else if(mode==='broken')controller.error(Error('Connection lost'));else controller.close();},cancel(){cancelled=true;}},{highWaterMark:0});
 const response=await call('/group-materials?title=A&groupName=B&filename=chords.png',{actor:author,method:'POST',body:source,headers:{'Content-Length':String(bytes.length)}});
 expect(response.status).toBe(400);expect((await list(author)).materials).toEqual([]);expect(source.locked).toBe(false);
 for(const key of objects)expect(await env.FILES.head(key)).toBeNull();if(mode==='long')expect(cancelled).toBe(true);
});

it('rechecks role/session authority after the actual upload and removes only its uncommitted object',async()=>{
 const author=await person(),old=await save(author);
 const response=await upload(author,png(),{title:'Blocked late upload',hooks:{put:async()=>{await env.DB.prepare('DELETE FROM user_ministry_roles WHERE user_id=?').bind(author.id).run();}}});
 expect(response.status).toBe(409);
 const admin=await person(null,'admin');expect((await list(admin)).materials.map(item=>item.id)).toEqual([old.id]);
 for(const key of objects){if(key==='group-materials/'+old.id)expect(await env.FILES.head(key)).not.toBeNull();else expect(await env.FILES.head(key)).toBeNull();}
});

it('does not release an R2 body to a viewer whose session is revoked during the read',async()=>{
 const author=await person(),viewer=await person('pastor'),saved=await save(author);
 const response=await call('/group-materials/'+saved.id+'/file',{actor:viewer,hooks:{get:async()=>{await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(viewer.id).run();}}});
 expect(response.status).toBe(403);expect(await env.FILES.head('group-materials/'+saved.id)).not.toBeNull();
});

it('a committed save with a lost database response retains the published file and reconciles success',async()=>{
 const author=await person();let fail=true;
 const db=new Proxy(env.DB,{get(target,property){
  if(property==='batch')return async(...args:Parameters<D1Database['batch']>)=>{const result=await target.batch(...args);if(fail){fail=false;throw Error('Lost commit response');}return result;};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 const response=await upload(author,png(),{hooks:{db}});expect(response.status).toBe(201);
 const saved=await response.json() as{id:string};expect((await stored(saved.id))?.state).toBe('active');expect(await env.FILES.head('group-materials/'+saved.id)).not.toBeNull();
});

it('conditional storage collisions preserve pre-existing bytes and cancel the upload stream',async()=>{
 const author=await person(),response=await upload(author,png(),{hooks:{collision:true}});expect(response.status).toBe(409);expect((await list(author)).materials).toEqual([]);
 for(const key of objects)expect(await(await env.FILES.get(key))!.text()).toBe('Keep pre-existing bytes.');
 await cleanupGroupMaterialUploads(env,now()+86400*8);
 for(const key of objects)expect(await(await env.FILES.get(key))!.text()).toBe('Keep pre-existing bytes.');
});

it('only the uploader or an administrator may deliberately remove a shared copy',async()=>{
 const author=await person(),other=await person('worship_leader'),admin=await person(null,'admin'),saved=await save(author);
 expect((await call('/group-materials/'+saved.id,{actor:other,method:'DELETE'})).status).toBe(403);expect(await env.FILES.head('group-materials/'+saved.id)).not.toBeNull();
 expect((await call('/group-materials/'+saved.id,{actor:admin,method:'DELETE'})).status).toBe(200);expect(await env.FILES.head('group-materials/'+saved.id)).toBeNull();expect(await stored(saved.id)).toBeNull();
 const own=await save(author);expect((await call('/group-materials/'+own.id,{actor:author,method:'DELETE'})).status).toBe(200);
});

it('revocation at the deletion mutation blocks object removal without trusting an earlier profile read',async()=>{
 const author=await person(),saved=await save(author);let deleted=false,intercept=true;
 const db=new Proxy(env.DB,{get(target,property){
  if(property==='batch')return async(...args:Parameters<D1Database['batch']>)=>{if(intercept){intercept=false;await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(author.id).run();}return target.batch(...args);};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 const response=await call('/group-materials/'+saved.id,{actor:author,method:'DELETE',hooks:{db,delete:async()=>{deleted=true;}}});
 expect(response.status).toBe(403);expect(deleted).toBe(false);expect((await stored(saved.id))?.state).toBe('active');expect(await env.FILES.head('group-materials/'+saved.id)).not.toBeNull();
});

it('failed removal retains bytes and a visible retry entry; retry targets the same immutable copy',async()=>{
 const author=await person(),saved=await save(author),key='group-materials/'+saved.id;
 const failed=await call('/group-materials/'+saved.id,{actor:author,method:'DELETE',hooks:{delete:async()=>{throw Error('Storage unavailable');}}});
 expect(failed.status).toBe(503);expect(await env.FILES.head(key)).not.toBeNull();expect((await list(author)).materials[0]).toMatchObject({id:saved.id,removalPending:true,canDelete:true});
 expect((await call('/group-materials/'+saved.id+'/file',{actor:author})).status).toBe(404);
 expect((await call('/group-materials/'+saved.id,{actor:author,method:'DELETE'})).status).toBe(200);expect(await env.FILES.head(key)).toBeNull();expect(await stored(saved.id)).toBeNull();
});

it('same-origin mutation enforcement rejects cross-site requests before any sharing side effect',async()=>{
 const author=await person(),response=await call('/group-materials?title=A&groupName=B&filename=chords.png',{actor:author,method:'POST',body:png(),headers:{Origin:'https://elsewhere.invalid','Content-Length':String(png().length)}});
 expect(response.status).toBe(403);expect((await list(author)).materials).toEqual([]);
});

it('lists bounded pages with no repeated material and validates cursors',async()=>{
 const author=await person();
 const ids=[];
 for(let index=0;index<42;index++)ids.push((await save(author,png(),{title:'Song '+index})).id);
 const first=await list(author);expect(first.materials).toHaveLength(40);expect(first.nextCursor).not.toBeNull();
 const second=await list(author,'?before='+encodeURIComponent(first.nextCursor!));expect(second.materials).toHaveLength(2);expect(second.nextCursor).toBeNull();
 expect(new Set([...first.materials,...second.materials].map(item=>item.id)).size).toBe(42);
 expect((await call('/group-materials?before=not-a-cursor',{actor:author})).status).toBe(400);
});

it('revocation after the deletion claim leaves a pending entry for an administrator without falsely confirming removal',async()=>{
 const author=await person(),saved=await save(author);let intercept=true;
 const db=new Proxy(env.DB,{get(target,property){
  if(property==='batch')return async(...args:Parameters<D1Database['batch']>)=>{const result=await target.batch(...args);if(intercept){intercept=false;await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(author.id).run();}return result;};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 const response=await call('/group-materials/'+saved.id,{actor:author,method:'DELETE',hooks:{db}});
 expect(response.status).toBe(403);expect(await env.FILES.head('group-materials/'+saved.id)).not.toBeNull();expect((await stored(saved.id))?.state).toBe('deleting');
 const admin=await person(null,'admin');expect((await list(admin)).materials[0]).toMatchObject({id:saved.id,removalPending:true});expect((await call('/group-materials/'+saved.id,{actor:admin,method:'DELETE'})).status).toBe(200);
});

async function linkedSongFixture(){
 const owner=await person(null,'admin'),author=await person(),deviceId=crypto.randomUUID(),credential=token(),songId='c'.repeat(64);
 await env.DB.prepare("INSERT INTO devices(id,name,token_hash,owner_id,created_at,pair_expires,last_seen) VALUES(?,'Linked notes PC',?,?,?,?,?)").bind(deviceId,await hash(credential),owner.id,now(),now()+300,now()).run();
 await env.DB.prepare("INSERT INTO station_memberships VALUES(?,?,'approved',?)").bind(deviceId,author.id,now()).run();
 const generation=crypto.randomUUID(),entry={id:songId,contentHash:'d'.repeat(64),title:'Linked song',filename:'linked.pro',category:'Worship',language:'eng',fontSize:96,text:'Real isolated lyrics',firstSlide:'Real isolated lyrics',addedAt:1000,modifiedAt:2000};
 for(const data of [{action:'begin',generation,count:1,unreadable:0},{action:'chunk',generation,songs:[entry]},{action:'finish',generation}])expect((await call('/station/catalog',{actor:owner,method:'POST',body:JSON.stringify(data),headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'}})).status).toBe(200);
 const material=await save(author);
 return{owner,author,deviceId,songId,material};
}
async function changeSongLink(f:Awaited<ReturnType<typeof linkedSongFixture>>,action:'link'|'unlink'='link',actor=f.author,hooks:Hooks={}){
 return call('/group-materials/'+f.material.id+'/song-links',{actor,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,computerId:f.deviceId,songId:f.songId}),hooks});
}
const songFiles=(f:Awaited<ReturnType<typeof linkedSongFixture>>,actor=f.author)=>list(actor,'?'+new URLSearchParams({computerId:f.deviceId,songId:f.songId}));

it('persists explicit song links, reconciles repeat links and does not match unrelated files by title',async()=>{
 const f=await linkedSongFixture();await save(f.author,png(),{title:'Shared song',filename:'same-title.png'});
 expect((await songFiles(f)).materials).toEqual([]);
 for(let retry=0;retry<2;retry++)expect((await changeSongLink(f)).status).toBe(200);
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM group_material_song_links WHERE material_id=?').bind(f.material.id).first<{count:number}>())?.count).toBe(1);
 expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM audit WHERE action='link-group-material-song' AND subject_id=?").bind(f.material.id).first<{count:number}>())?.count).toBe(1);
 const linked=await songFiles(f);expect(linked.linkContext).toEqual({computerId:f.deviceId,songId:f.songId});expect(linked.materials.map(row=>row.id)).toEqual([f.material.id]);expect((await list(f.author)).materials).toHaveLength(2);
});

it('unlinks idempotently while keeping the shared original and its exact bytes',async()=>{
 const f=await linkedSongFixture();expect((await changeSongLink(f)).status).toBe(200);
 for(let retry=0;retry<2;retry++)expect((await changeSongLink(f,'unlink')).status).toBe(200);
 expect((await songFiles(f)).materials).toEqual([]);expect((await list(f.author)).materials.map(row=>row.id)).toContain(f.material.id);
 const file=await call('/group-materials/'+f.material.id+'/file',{actor:f.author});expect(new Uint8Array(await file.arrayBuffer())).toEqual(png());
});

it('uses current computer/ministry access for linked reads and keeps file management with its uploader or an admin',async()=>{
 const f=await linkedSongFixture(),pastor=await person('pastor'),other=await person();
 for(const actor of [pastor,other])await env.DB.prepare("INSERT INTO station_memberships VALUES(?,?,'approved',?)").bind(f.deviceId,actor.id,now()).run();
 expect((await changeSongLink(f,'link',pastor)).status).toBe(403);
 expect((await changeSongLink(f,'link',other)).status).toBe(409);
 expect((await changeSongLink(f,'link',f.owner)).status).toBe(200);
 expect((await songFiles(f,pastor)).materials.map(row=>row.id)).toEqual([f.material.id]);
 await env.DB.prepare("UPDATE station_memberships SET status='denied' WHERE device_id=? AND user_id=?").bind(f.deviceId,pastor.id).run();
 expect((await call('/group-materials?'+new URLSearchParams({computerId:f.deviceId,songId:f.songId}),{actor:pastor})).status).toBe(403);
 expect((await list(pastor)).materials).toHaveLength(1);
});

it('rechecks membership in the link transaction and records no mutation after revocation',async()=>{
 const f=await linkedSongFixture();let changed=false;
 const db=new Proxy(env.DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{if(!changed){changed=true;await env.DB.prepare("UPDATE station_memberships SET status='denied' WHERE device_id=? AND user_id=?").bind(f.deviceId,f.author.id).run();}return target.batch(statements);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 expect((await changeSongLink(f,'link',f.author,{db})).status).toBe(409);expect(changed).toBe(true);
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM group_material_song_links WHERE material_id=?').bind(f.material.id).first<{count:number}>())?.count).toBe(0);
 expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM audit WHERE action='link-group-material-song' AND subject_id=?").bind(f.material.id).first<{count:number}>())?.count).toBe(0);
});

it('validates link identifiers and keeps links when a complete catalog is republished',async()=>{
 const f=await linkedSongFixture();expect((await changeSongLink(f)).status).toBe(200);
 const song=await env.DB.prepare('SELECT * FROM station_catalog WHERE device_id=? AND song_id=?').bind(f.deviceId,f.songId).first<Record<string,unknown>>();expect(song).not.toBeNull();
 // The PC commits by replacing catalog rows. Notes must survive that replacement.
 await env.DB.prepare('DELETE FROM station_catalog WHERE device_id=?').bind(f.deviceId).run();
 const columns=Object.keys(song!);expect(columns.every(column=>/^[a-z_]+$/.test(column))).toBe(true);
 await env.DB.prepare('INSERT INTO station_catalog('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').bind(...columns.map(column=>song![column])).run();
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM group_material_song_links WHERE material_id=?').bind(f.material.id).first<{count:number}>())?.count).toBe(1);
 expect((await songFiles(f)).materials.map(row=>row.id)).toEqual([f.material.id]);
 for(const query of ['?computerId='+f.deviceId,'?songId='+f.songId,'?computerId=invalid&songId='+f.songId])expect((await call('/group-materials'+query,{actor:f.author})).status).toBe(400);
 expect((await call('/group-materials/'+f.material.id+'/song-links',{actor:f.author,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'link',computerId:f.deviceId,songId:'bad'})})).status).toBe(400);
});

it('private song links and linked notes recheck selected-group membership independently of PC access',async()=>{
 const f=await linkedSongFixture(),selected=await person(),outsider=await person();
 for(const actor of [selected,outsider])await env.DB.prepare("INSERT INTO station_memberships VALUES(?,?,'approved',?)").bind(f.deviceId,actor.id,now()).run();
 const groupId=crypto.randomUUID();expect((await call('/worship-groups',{actor:f.owner,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:groupId,name:'Private service group',memberIds:[f.author.id,selected.id]})})).status).toBe(201);
 expect((await call('/group-materials/'+f.material.id+'/group',{actor:f.owner,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groupId,expectedGroupId:null})})).status).toBe(200);
 expect((await changeSongLink(f)).status).toBe(200);
 expect((await songFiles(f,selected)).materials.map(item=>item.id)).toEqual([f.material.id]);expect((await songFiles(f,outsider)).materials).toEqual([]);
 expect((await call('/worship-groups/'+groupId,{actor:f.owner,method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Private service group',memberIds:[selected.id],revision:1})})).status).toBe(200);
 expect((await songFiles(f)).materials).toEqual([]);expect((await changeSongLink(f,'unlink')).status).toBe(409);
 expect((await songFiles(f,selected)).materials.map(item=>item.id)).toEqual([f.material.id]);
});
