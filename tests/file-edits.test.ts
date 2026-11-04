import {env,SELF} from 'cloudflare:test';
import {afterEach,expect,it} from 'vitest';
import {hash,now,token} from '../src/server/core';
import {fileEditRoute,cleanupFileEdits} from '../src/server/file-edits';
import photos from './fixtures/profile-photos.json';
const png=Uint8Array.from(atob(photos.fixtures.find(file=>file.extension==='png')!.base64),value=>value.charCodeAt(0));
const changed=()=>{const value=new Uint8Array(png.length+4);value.set(png);value.set([1,2,3,4],png.length);return value;};
const objects=new Set<string>();
afterEach(async()=>{if(objects.size)await env.FILES.delete([...objects]);objects.clear();});
async function actor(){const id=crypto.randomUUID(),session=token();await env.DB.batch([env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Markup','T','member','active',?)").bind(id,now()),env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+86400),env.DB.prepare("INSERT INTO user_ministry_roles VALUES(?,'worship_member',?,?)").bind(id,id,now())]);return{id,cookie:'stati_access=isolated-test-access; stati_session='+session};}
type Actor=Awaited<ReturnType<typeof actor>>;
async function call(path:string,owner:Actor,method='GET',bytes?:Uint8Array,headers:Record<string,string>={}){return SELF.fetch('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',Cookie:owner.cookie,...(bytes?{'Content-Length':String(bytes.length)}:{}),...headers},...(bytes?{body:bytes.slice().buffer}:{})});}
async function fixture(){const owner=await actor(),response=await call('/group-materials?title=Markup&groupName=Choir&filename=notes.png',owner,'POST',png);expect(response.status).toBe(201);const {id}=await response.json<{id:string}>();objects.add('group-materials/'+id);return{owner,id,path:'/file-edits/group/'+id,file:'/group-materials/'+id+'/file'};}
async function sha(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
async function edit(f:Awaited<ReturnType<typeof fixture>>,data=changed(),intent=crypto.randomUUID(),base?:string){objects.add('file-edits/group/'+f.id+'/'+intent);const response=await call(f.path,f.owner,'PUT',data,{'X-Edit-ID':intent,'X-Base-SHA256':base??await sha(png),'X-Content-SHA256':await sha(data),'X-Filename':'notes.png'});return{response,intent};}
it('updates the original URL while preserving prior bytes and replaying the same edit receipt',async()=>{const f=await fixture(),data=changed(),first=await edit(f,data);expect(first.response.status).toBe(200);expect(await first.response.json()).toMatchObject({ok:true,id:first.intent,sha256:await sha(data)});expect(new Uint8Array(await(await call(f.file,f.owner)).arrayBuffer())).toEqual(data);expect(new Uint8Array(await(await env.FILES.get('group-materials/'+f.id))!.arrayBuffer())).toEqual(png);expect((await edit(f,data,first.intent)).response.status).toBe(200);const info=await(await call(f.path+'?intent='+first.intent,f.owner)).json<{edit:{id:string;state:string}}>();expect(info.edit).toMatchObject({id:first.intent,state:'committed'});});
it('rejects stale edits and unauthorized replacement without altering the current original',async()=>{const f=await fixture();expect((await edit(f)).response.status).toBe(200);const stale=await edit(f,png);expect(stale.response.status).toBe(409);const other=await actor();expect((await call(f.path,other,'PUT',changed(),{'X-Edit-ID':crypto.randomUUID(),'X-Base-SHA256':await sha(png),'X-Content-SHA256':await sha(changed()),'X-Filename':'notes.png'})).status).toBe(403);expect(new Uint8Array(await(await call(f.file,f.owner)).arrayBuffer())).toEqual(changed());});
it('does not repurpose an edit identity for different bytes',async()=>{const f=await fixture(),first=await edit(f);expect(first.response.status).toBe(200);expect((await edit(f,png,first.intent)).response.status).toBe(409);});
it('lets only one concurrent edit replace a given base and keeps its exact bytes',async()=>{const f=await fixture();const results=await Promise.all([edit(f),edit(f)]);expect(results.filter(r=>r.response.status===200)).toHaveLength(1);expect(results.filter(r=>r.response.status===409)).toHaveLength(1);expect(new Uint8Array(await(await call(f.file,f.owner)).arrayBuffer())).toEqual(changed());});

it('keeps the same stable task-image URL and edited bytes through removal and Undo',async()=>{
 const owner=await actor(),taskId=crypto.randomUUID(),id=crypto.randomUUID();
 const task=await SELF.fetch('http://localhost:8787/api/tasks',{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:owner.cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'create',id:taskId,title:'Markup task',body:'Fixture',urgent:false})});expect(task.status).toBe(200);
 const imagePath='/tasks/'+taskId+'/images/'+id;objects.add('task-images/'+id);expect((await call(imagePath,owner,'PUT',png,{'X-Filename':'notes.png'})).status).toBe(201);
 const intent=crypto.randomUUID();objects.add('file-edits/task/'+id+'/'+intent);
 const edited=await call('/file-edits/task/'+id,owner,'PUT',changed(),{'X-Edit-ID':intent,'X-Base-SHA256':await sha(png),'X-Content-SHA256':await sha(changed()),'X-Filename':'notes.png'});expect(edited.status).toBe(200);
 expect(new Uint8Array(await(await call(imagePath,owner)).arrayBuffer())).toEqual(changed());
 expect((await call(imagePath,owner,'DELETE')).status).toBe(200);expect((await call(imagePath,owner)).status).toBe(404);expect((await call(imagePath,owner,'POST')).status).toBe(200);expect(new Uint8Array(await(await call(imagePath,owner)).arrayBuffer())).toEqual(changed());
 const detail=await(await call('/tasks/'+taskId,owner)).json<{images:{bytes:number}[]}>();expect(detail.images[0].bytes).toBe(changed().length);
});
it('removes edited group bytes with the shared original and retains cleanup tracking',async()=>{const f=await fixture(),saved=await edit(f);expect(saved.response.status).toBe(200);expect((await call('/group-materials/'+f.id,f.owner,'DELETE')).status).toBe(200);expect(await env.FILES.head('file-edits/group/'+f.id+'/'+saved.intent)).toBeNull();expect((await call(f.path,f.owner)).status).toBe(404);expect(await env.DB.prepare('SELECT state FROM file_edits WHERE id=?').bind(saved.intent).first()).toEqual({state:'failed'});});
async function raw(f:Awaited<ReturnType<typeof fixture>>,intent:string){objects.add('file-edits/group/'+f.id+'/'+intent);return new Request('http://localhost:8787/api'+f.path,{method:'PUT',headers:{Cookie:f.owner.cookie,'Content-Length':String(changed().length),'X-Edit-ID':intent,'X-Base-SHA256':await sha(png),'X-Content-SHA256':await sha(changed()),'X-Filename':'notes.png'},body:changed().slice().buffer});}
it('recovers a lost database acknowledgement without publishing another file version',async()=>{
 const f=await fixture(),intent=crypto.randomUUID();let batches=0;
 const DB=new Proxy(env.DB,{get(target,key){if(key==='batch')return async(...args:Parameters<D1Database['batch']>)=>{const result=await target.batch(...args);batches++;throw Error('Fixture lost committed reply');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 expect((await fileEditRoute(await raw(f,intent),{...env,DB},'group',f.id)).status).toBe(200);expect(batches).toBe(1);expect((await edit(f,changed(),intent)).response.status).toBe(200);expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM file_edits WHERE target_id=?').bind(f.id).first()).toEqual({count:1});
});
it('reconciles a stored object with a lost R2 reply using the same intent and bytes',async()=>{
 const f=await fixture(),intent=crypto.randomUUID();
 const FILES=new Proxy(env.FILES,{get(target,key){if(key==='put')return async(...args:Parameters<R2Bucket['put']>)=>{await target.put(...args);throw Error('Fixture lost object reply');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await expect(fileEditRoute(await raw(f,intent),{...env,FILES},'group',f.id)).rejects.toMatchObject({status:503});
 const info=await(await call(f.path+'?intent='+intent,f.owner)).json<{edit:{state:string}}>();expect(info.edit.state).toBe('uploading');expect((await edit(f,changed(),intent)).response.status).toBe(200);expect(new Uint8Array(await(await call(f.file,f.owner)).arrayBuffer())).toEqual(changed());
});
it('revocation while storing cannot publish edited content',async()=>{
 const f=await fixture(),intent=crypto.randomUUID();
 const FILES=new Proxy(env.FILES,{get(target,key){if(key==='put')return async(...args:Parameters<R2Bucket['put']>)=>{const result=await target.put(...args);await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.owner.id).run();return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await expect(fileEditRoute(await raw(f,intent),{...env,FILES},'group',f.id)).rejects.toMatchObject({status:409});expect(await env.DB.prepare('SELECT edit_id FROM file_edit_heads WHERE target_id=?').bind(f.id).first()).toBeNull();expect(new Uint8Array(await(await env.FILES.get('group-materials/'+f.id))!.arrayBuffer())).toEqual(png);
});
it('does not expire committed current or earlier versions while cleaning abandoned edits',async()=>{
 const f=await fixture(),first=await edit(f);expect(first.response.status).toBe(200);
 const next=await edit(f,png,crypto.randomUUID(),await sha(changed()));expect(next.response.status).toBe(200);
 await env.DB.prepare('UPDATE file_edits SET created_at=? WHERE target_id=?').bind(now()-10*86400,f.id).run();await cleanupFileEdits(env,now());
 expect(await env.FILES.head('file-edits/group/'+f.id+'/'+first.intent)).not.toBeNull();expect(await env.FILES.head('file-edits/group/'+f.id+'/'+next.intent)).not.toBeNull();
});
