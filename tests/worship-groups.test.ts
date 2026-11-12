import {expect,it} from 'vitest';
import {createExecutionContext,env} from 'cloudflare:test';
import worker from '../src/server/index';
import {hash,now,token,type User} from '../src/server/core';
import type {MinistryRole} from '../src/server/ministry-roles';

async function person(ministryRole:MinistryRole|null='worship_member',role:User['role']='member',status:User['status']='active') {
 const id=crypto.randomUUID(),session=token();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Isolated','G',?,?,?)").bind(id,role,status,now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+86400),
 ]);
 if(ministryRole)await env.DB.prepare('INSERT INTO user_ministry_roles VALUES(?,?,?,?)').bind(id,ministryRole,id,now()).run();
 return{id,cookie:'stati_session='+session};
}
type Person=Awaited<ReturnType<typeof person>>;
async function call(path:string,actor:Person,method='GET',data?:unknown,db=env.DB) {
 return worker.fetch(new Request('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access; '+actor.cookie,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),{...env,DB:db},createExecutionContext());
}
async function create(actor:Person,members:string[]=[],name='Sunday worship',id=crypto.randomUUID()) {
 return{response:await call('/worship-groups',actor,'POST',{id,name,memberIds:members}),id};
}
it('leader creates a named group visible only to chosen members, owner and administrators',async()=>{
 const leader=await person('worship_leader'),selected=await person(),outsider=await person(),admin=await person(null,'admin');
 const saved=await create(leader,[selected.id]);expect(saved.response.status).toBe(201);
 for(const actor of [leader,selected,admin]) {
  const response=await call('/worship-groups',actor);expect(response.status).toBe(200);
  const value=await response.json() as{groups:{id:string;name:string;canManage:boolean}[]};
  expect(value.groups).toHaveLength(1);expect(value.groups[0]).toMatchObject({id:saved.id,name:'Sunday worship',canManage:actor!==selected});
 }
 expect((await(await call('/worship-groups',outsider)).json() as{groups:unknown[]}).groups).toEqual([]);
 expect((await call('/worship-groups/'+saved.id,outsider)).status).toBe(404);
 const detail=await(await call('/worship-groups/'+saved.id,selected)).json() as{group:{members:{id:string}[]}};
 expect(detail.group.members.map(member=>member.id).sort()).toEqual([leader.id,selected.id].sort());
});
it('members cannot create groups and unrelated leaders cannot change another leaders group',async()=>{
 const owner=await person('worship_leader'),other=await person('worship_leader'),member=await person();
 expect((await create(member)).response.status).toBe(403);
 const saved=await create(owner);expect(saved.response.status).toBe(201);
 expect((await call('/worship-groups/'+saved.id,other,'PATCH',{name:'Taken over',memberIds:[other.id],revision:1})).status).toBeGreaterThanOrEqual(400);
});
it('only approved worship members can be selected and invalid names do not create groups',async()=>{
 const leader=await person('worship_leader');
 for(const member of [await person('worship_member','member','pending'),await person('worship_member','member','removed'),await person('pastor'),await person(null)])expect((await create(leader,[member.id])).response.status).toBe(400);
 for(const name of ['', 'x'.repeat(81), 'Bad\u0000name'])expect((await create(leader,[],name)).response.status).toBe(400);
});
it('member edits require current revision and remove former members immediately',async()=>{
 const leader=await person('worship_leader'),first=await person(),second=await person();
 const saved=await create(leader,[first.id]);expect(saved.response.status).toBe(201);
 const updated=await call('/worship-groups/'+saved.id,leader,'PATCH',{name:'Evening worship',memberIds:[second.id],revision:1});expect(updated.status).toBe(200);
 expect((await call('/worship-groups/'+saved.id,first)).status).toBe(404);
 const detail=await(await call('/worship-groups/'+saved.id,second)).json() as{group:{name:string;revision:number;members:{id:string}[]}};
 expect(detail.group).toMatchObject({name:'Evening worship',revision:2});expect(detail.group.members.map(item=>item.id).sort()).toEqual([leader.id,second.id].sort());
 expect((await call('/worship-groups/'+saved.id,leader,'PATCH',{name:'Stale',memberIds:[first.id],revision:1})).status).toBe(409);
 expect((await call('/worship-groups/'+saved.id,first)).status).toBe(404);
});
it('administrator can manage a group while ordinary selected members cannot replace membership',async()=>{
 const leader=await person('worship_leader'),member=await person(),admin=await person(null,'admin');const saved=await create(leader,[member.id]);expect(saved.response.status).toBe(201);
 expect((await call('/worship-groups/'+saved.id,member,'PATCH',{name:'Wrong',memberIds:[],revision:1})).status).toBe(403);
 expect((await call('/worship-groups/'+saved.id,admin,'PATCH',{name:'Admin edited',memberIds:[],revision:1})).status).toBe(200);
 expect((await call('/worship-groups/'+saved.id,member)).status).toBe(404);
});
it('repeating an acknowledged creation reuses its identity and rejects a different intent',async()=>{
 const leader=await person('worship_leader'),member=await person(),id=crypto.randomUUID();
 expect((await create(leader,[member.id],'Same name',id)).response.status).toBe(201);
 expect((await create(leader,[member.id],'Same name',id)).response.status).toBe(200);
 expect((await create(leader,[],'Different',id)).response.status).toBe(409);
 const value=await(await call('/worship-groups',leader)).json() as{groups:unknown[]};expect(value.groups).toHaveLength(1);
});
it('revocation at the membership mutation cannot overwrite group membership',async()=>{
 const leader=await person('worship_leader'),member=await person();const saved=await create(leader,[member.id]);expect(saved.response.status).toBe(201);let intercept=true;
 const db=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(...args:Parameters<D1Database['batch']>)=>{if(intercept){intercept=false;await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(leader.id).run();}return target.batch(...args);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 expect((await call('/worship-groups/'+saved.id,leader,'PATCH',{name:'Revoked edit',memberIds:[],revision:1},db)).status).toBeGreaterThanOrEqual(400);
 const detail=await(await call('/worship-groups/'+saved.id,member)).json() as{group:{revision:number;name:string}};expect(detail.group).toMatchObject({revision:1,name:'Sunday worship'});
});

const pdf=new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
async function fileCall(path:string,actor:Person,method='GET',bytes?:Uint8Array,files=env.FILES,headers:Record<string,string>={}){
 return worker.fetch(new Request('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access; '+actor.cookie,...(bytes?{'Content-Length':String(bytes.length)}:{}),...headers},...(bytes?{body:bytes.slice().buffer}:{})}),{...env,FILES:files},createExecutionContext());
}
async function privateFile(actor:Person,groupId:string){
 const response=await fileCall('/group-materials?'+new URLSearchParams({title:'Private notes',groupName:'Choir',filename:'notes.pdf',groupId}),actor,'POST',pdf);
 expect(response.status).toBe(201);return response.json() as Promise<{id:string}>;
}
it('private files and their labels stay hidden from nonmembers even when a legacy label matches',async()=>{
 const leader=await person('worship_leader'),member=await person(),outsider=await person(),admin=await person(null,'admin');const group=await create(leader,[member.id]);expect(group.response.status).toBe(201);
 const file=await privateFile(leader,group.id);
 for(const viewer of [leader,member,admin]){
  const list=await(await call('/group-materials',viewer)).json() as{materials:{id:string;groupId?:string}[]};expect(list.materials).toEqual([expect.objectContaining({id:file.id,groupId:group.id})]);
  expect((await fileCall('/group-materials/'+file.id+'/file',viewer)).status).toBe(200);
  expect((await call('/file-edits/group/'+file.id,viewer)).status).toBe(200);
 }
 const hidden=await(await call('/group-materials?groupName=Choir',outsider)).json() as{materials:unknown[];groups:string[]};expect(hidden).toMatchObject({materials:[],groups:[]});
 expect((await fileCall('/group-materials/'+file.id+'/file?download=1',outsider)).status).toBe(404);
 expect((await call('/file-edits/group/'+file.id,outsider)).status).toBe(404);
});
it('uploading into a private group requires explicit current membership or administrator access',async()=>{
 const leader=await person('worship_leader'),outsider=await person();const group=await create(leader);expect(group.response.status).toBe(201);
 const response=await fileCall('/group-materials?'+new URLSearchParams({title:'Wrong',groupName:'Choir',filename:'notes.pdf',groupId:group.id}),outsider,'POST',pdf);expect(response.status).toBeGreaterThanOrEqual(400);
 expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM group_materials WHERE group_id=?').bind(group.id).first()).toEqual({count:0});
});
it('a removed uploader loses list, download, edit metadata and delete access without losing stored bytes',async()=>{
 const leader=await person('worship_leader'),member=await person();const group=await create(leader,[member.id]);expect(group.response.status).toBe(201);const file=await privateFile(member,group.id);
 expect((await call('/worship-groups/'+group.id,leader,'PATCH',{name:'Sunday worship',memberIds:[],revision:1})).status).toBe(200);
 expect((await(await call('/group-materials',member)).json() as{materials:unknown[]}).materials).toEqual([]);
 for(const path of ['/group-materials/'+file.id+'/file','/file-edits/group/'+file.id])expect((await fileCall(path,member)).status).toBe(404);
 expect((await fileCall('/group-materials/'+file.id,member,'DELETE')).status).toBeGreaterThanOrEqual(400);
 expect(await env.FILES.head('group-materials/'+file.id)).not.toBeNull();
});
it('membership revoked while reading bytes cannot escape in the download response',async()=>{
 const leader=await person('worship_leader'),member=await person();const group=await create(leader,[member.id]);expect(group.response.status).toBe(201);const file=await privateFile(leader,group.id);
 const files=new Proxy(env.FILES,{get(target,key){if(key==='get')return async(...args:Parameters<R2Bucket['get']>)=>{const result=await target.get(...args);await env.DB.prepare('DELETE FROM worship_group_members WHERE group_id=? AND user_id=?').bind(group.id,member.id).run();return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 expect((await fileCall('/group-materials/'+file.id+'/file',member,'GET',undefined,files)).status).toBe(403);
});
it('membership revoked while storing bytes cannot publish a private upload',async()=>{
 const leader=await person('worship_leader'),member=await person();const group=await create(leader,[member.id]);expect(group.response.status).toBe(201);
 const files=new Proxy(env.FILES,{get(target,key){if(key==='put')return async(...args:Parameters<R2Bucket['put']>)=>{const result=await target.put(...args);await env.DB.prepare('DELETE FROM worship_group_members WHERE group_id=? AND user_id=?').bind(group.id,member.id).run();return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const response=await fileCall('/group-materials?'+new URLSearchParams({title:'Removed',groupName:'Choir',filename:'notes.pdf',groupId:group.id}),member,'POST',pdf,files);expect(response.status).toBe(409);
 expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM group_materials WHERE group_id=? AND state='active'").bind(group.id).first()).toEqual({count:0});
});
it('named-group filtering uses stable IDs instead of matching legacy labels',async()=>{
 const leader=await person('worship_leader');const a=await create(leader,[],'Same label'),b=await create(leader,[],'Same label');expect(a.response.status).toBe(201);expect(b.response.status).toBe(201);
 const first=await privateFile(leader,a.id);await privateFile(leader,b.id);
 const response=await call('/group-materials?groupId='+a.id,leader);expect(response.status).toBe(200);expect((await response.json() as{materials:{id:string}[]}).materials.map(file=>file.id)).toEqual([first.id]);
 expect((await call('/group-materials?groupId=invalid',leader)).status).toBe(400);
});
it('only group managers can list approved worship candidates, with explicit pagination',async()=>{
 const leader=await person('worship_leader'),member=await person(),pending=await person('worship_member','member','pending'),pastor=await person('pastor');
 expect((await call('/worship-groups/candidates',member)).status).toBe(403);
 const response=await call('/worship-groups/candidates',leader);expect(response.status).toBe(200);
 const value=await response.json() as{members:{id:string}[];nextCursor:string|null};expect(value).toHaveProperty('nextCursor');expect(value.members.map(item=>item.id)).toEqual(expect.arrayContaining([leader.id,member.id]));expect(value.members.map(item=>item.id)).not.toEqual(expect.arrayContaining([pending.id]));expect(value.members.map(item=>item.id)).not.toEqual(expect.arrayContaining([pastor.id]));
});

async function digest(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer)),v=>v.toString(16).padStart(2,'0')).join('');}
async function privateEdit(id:string,actor:Person,intent=crypto.randomUUID(),files=env.FILES){
 const bytes=new Uint8Array(pdf.length+4);bytes.set(pdf);bytes.set([1,2,3,4],pdf.length);
 return{intent,response:await fileCall('/file-edits/group/'+id,actor,'PUT',bytes,files,{'X-Edit-ID':intent,'X-Base-SHA256':await digest(pdf),'X-Content-SHA256':await digest(bytes),'X-Filename':'notes.pdf'})};
}
it('selected members can read private originals but cannot overwrite another uploader',async()=>{
 const leader=await person('worship_leader'),member=await person();const group=await create(leader,[member.id]);expect(group.response.status).toBe(201);const file=await privateFile(leader,group.id);
 expect((await privateEdit(file.id,member)).response.status).toBe(403);
 expect(new Uint8Array(await(await fileCall('/group-materials/'+file.id+'/file',leader)).arrayBuffer())).toEqual(pdf);
});
it('membership revoked during Markup storage cannot publish a new private file version',async()=>{
 const leader=await person('worship_leader'),member=await person();const group=await create(leader,[member.id]);expect(group.response.status).toBe(201);const file=await privateFile(member,group.id);
 const files=new Proxy(env.FILES,{get(target,key){if(key==='put')return async(...args:Parameters<R2Bucket['put']>)=>{const result=await target.put(...args);await env.DB.prepare('DELETE FROM worship_group_members WHERE group_id=? AND user_id=?').bind(group.id,member.id).run();return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 expect((await privateEdit(file.id,member,crypto.randomUUID(),files)).response.status).toBe(409);
 expect(await env.DB.prepare('SELECT edit_id FROM file_edit_heads WHERE target_id=?').bind(file.id).first()).toBeNull();
 expect(new Uint8Array(await(await fileCall('/group-materials/'+file.id+'/file',leader)).arrayBuffer())).toEqual(pdf);
});
it('removed uploaders cannot recover private edit metadata or replay a committed receipt',async()=>{
 const leader=await person('worship_leader'),member=await person();const group=await create(leader,[member.id]);expect(group.response.status).toBe(201);const file=await privateFile(member,group.id),saved=await privateEdit(file.id,member);expect(saved.response.status).toBe(200);
 expect((await call('/worship-groups/'+group.id,leader,'PATCH',{name:'Sunday worship',memberIds:[],revision:1})).status).toBe(200);
 expect((await fileCall('/file-edits/group/'+file.id+'?intent='+saved.intent,member)).status).toBe(404);
 expect((await privateEdit(file.id,member,saved.intent)).response.status).toBe(404);
 expect((await fileCall('/group-materials/'+file.id+'/file',leader)).status).toBe(200);
});
it('explicit reassignment requires the uploader or admin and access to both groups',async()=>{
 const leader=await person('worship_leader'),member=await person(),other=await person('worship_leader'),admin=await person(null,'admin');const first=await create(leader,[member.id]),second=await create(other);expect(first.response.status).toBe(201);expect(second.response.status).toBe(201);const file=await privateFile(member,first.id);
 expect((await call('/group-materials/'+file.id+'/group',leader,'POST',{groupId:second.id,expectedGroupId:first.id})).status).toBeGreaterThanOrEqual(400);
 expect((await call('/group-materials/'+file.id+'/group',member,'POST',{groupId:second.id,expectedGroupId:first.id})).status).toBeGreaterThanOrEqual(400);
 expect((await call('/group-materials/'+file.id+'/group',admin,'POST',{groupId:second.id,expectedGroupId:first.id})).status).toBe(200);
 expect((await fileCall('/group-materials/'+file.id+'/file',member)).status).toBe(404);
 expect((await fileCall('/group-materials/'+file.id+'/file',other)).status).toBe(200);
 expect((await call('/group-materials/'+file.id+'/group',admin,'POST',{groupId:null,expectedGroupId:second.id})).status).toBe(400);
});

it('Recents availability stops exposing removed or deleted private files',async()=>{
 const leader=await person('worship_leader'),member=await person();const group=await create(leader,[member.id]);expect(group.response.status).toBe(201);const file=await privateFile(leader,group.id),filePath='/api/group-materials/'+file.id+'/file',id='file::'+filePath;
 const check=(actor:Person)=>call('/recents/availability',actor,'POST',{items:[{kind:'file',id,filePath}]});
 expect(await(await check(member)).json()).toMatchObject({checkedIds:[id],availableIds:[id]});
 expect((await call('/worship-groups/'+group.id,leader,'PATCH',{name:'Sunday worship',memberIds:[],revision:1})).status).toBe(200);
 expect(await(await check(member)).json()).toMatchObject({checkedIds:[id],availableIds:[]});
 expect((await fileCall('/group-materials/'+file.id,leader,'DELETE')).status).toBe(200);
 expect(await(await check(leader)).json()).toMatchObject({checkedIds:[id],availableIds:[]});
});
it('Recents availability rejects duplicate identities and unrelated file URLs',async()=>{
 const leader=await person('worship_leader'),id='file::/api/other/file',item={kind:'file',id,filePath:'/api/other/file'};
 expect((await call('/recents/availability',leader,'POST',{items:[item]})).status).toBe(400);
 const valid={kind:'file',id:'file::/api/group-materials/'+crypto.randomUUID()+'/file',filePath:''};valid.filePath=valid.id.slice(6);
 expect((await call('/recents/availability',leader,'POST',{items:[valid,valid]})).status).toBe(400);
});
it('archives a group only for an authorized manager at the current revision and keeps its membership records',async()=>{
 const leader=await person('worship_leader'),member=await person(),other=await person('worship_leader'),admin=await person(null,'admin');
 const {id,response}=await create(leader,[member.id]);expect(response.status).toBe(201);
 const path='/worship-groups/'+id;
 expect((await call(path,member,'DELETE',{revision:1})).status).toBe(403);
 expect((await call(path,other,'DELETE',{revision:1})).status).toBe(409);
 expect((await call(path,admin,'DELETE',{revision:2})).status).toBe(409);
 expect((await call(path,admin,'DELETE',{revision:1})).status).toBe(200);
 expect((await call(path,member)).status).toBe(404);
 expect((await call(path,admin)).status).toBe(404);
 expect((await(await call('/worship-groups',admin)).json() as{groups:{id:string}[]}).groups.some(group=>group.id===id)).toBe(false);
 const stored=await env.DB.prepare('SELECT archived_at,revision FROM worship_groups WHERE id=?').bind(id).first<{archived_at:number;revision:number}>();
 expect(stored?.archived_at).toBeGreaterThan(0);
 expect(stored?.revision).toBe(2);
 expect(await env.DB.prepare('SELECT COUNT(*) FROM worship_group_members WHERE group_id=?').bind(id).first<number>('COUNT(*)')).toBe(2);
});
