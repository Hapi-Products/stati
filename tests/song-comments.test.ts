import {env,createExecutionContext,waitOnExecutionContext} from 'cloudflare:test';
import {expect,it} from 'vitest';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';
async function person(role='commenter',admin=false){
 const id=crypto.randomUUID(),session=token();await env.DB.batch([env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Comment','T',?,'active',?)").bind(id,admin?'admin':'member',now()),env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+86400)]);
 if(role)await env.DB.prepare('INSERT INTO user_ministry_roles VALUES(?,?,NULL,?)').bind(id,role,now()).run();return{id,cookie:'stati_session='+session};
}
type Person=Awaited<ReturnType<typeof person>>;
async function call(path:string,user:Person,method='GET',data?:unknown,bindings=env){const ctx=createExecutionContext();const result=await worker.fetch(new Request('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access; '+user.cookie,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),bindings,ctx);await waitOnExecutionContext(ctx);return result;}
async function fixture(){
 const author=await person(),owner=await person('',true),id=crypto.randomUUID(),credential=token(),songId='a'.repeat(64),contentHash='b'.repeat(64);
 await env.DB.batch([env.DB.prepare("INSERT INTO devices(id,name,token_hash,owner_id,created_at,pair_expires,last_seen) VALUES(?,'Church PC',?,?,?,?,?)").bind(id,await hash(credential),owner.id,now(),now()+300,now()),env.DB.prepare("INSERT INTO station_memberships VALUES(?,?,'approved',?)").bind(id,author.id,now()),env.DB.prepare("INSERT INTO station_catalog(device_id,song_id,title,content_hash,filename,category,language,font_size,text,first_slide,added_at,modified_at,generation,search_text,payload_bytes) VALUES(?,?,'Song title',?,'song.pro','Worship','eng',96,'First lyric\nSecond lyric','First lyric',1,1,?,'first lyric second lyric',100)").bind(id,songId,contentHash,crypto.randomUUID())]);
 const input={id:crypto.randomUUID(),songId,contentHash,message:'Please check this line.',quote:'First lyric',replacement:'First corrected lyric'};
 return{author,owner,id,songId,contentHash,input,path:'/computers/'+id+'/song-comments'};
}
it('commenter can find songs and submit corrections but cannot send files, manage tasks, groups or services',async()=>{
 const f=await fixture();const profile=await(await call('/me',f.author)).json() as{user:{capabilities:Record<string,boolean>}};
 expect(profile.user.capabilities).toMatchObject({readSongs:true,commentSongs:true,sendFiles:false,planServices:false,createSlides:false,manageTeam:false,manageWorship:false,editLyrics:false});
 expect((await call('/computers/'+f.id+'/songs',f.author)).status).toBe(200);
 expect((await call('/computers/'+f.id+'/services',f.author)).status).toBe(403);
 expect((await call('/tasks',f.author)).status).toBe(403);expect((await call('/group-materials',f.author)).status).toBe(403);
 expect((await call('/requests',f.author,'POST',{deviceId:f.id,message:'Unrelated send request'})).status).toBe(403);
 expect((await call('/computers/'+f.id+'/services',f.author,'POST',{type:'create',title:'Not allowed',date:'2026-11-01',time:'10:00'})).status).toBe(403);
});
it('a correction preserves the song, retries the same receipt, and creates one operator review task and alert',async()=>{
 const f=await fixture();expect((await call(f.path,f.author,'POST',f.input)).status).toBe(201);
 const repeated=await call(f.path,f.author,'POST',f.input);expect(repeated.status).toBe(200);
 expect((await call(f.path,f.author,'POST',{...f.input,message:'Different request'})).status).toBe(409);
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM feedback_tasks WHERE id=?').bind(f.input.id).first<{count:number}>())?.count).toBe(1);
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM requests WHERE id=?').bind(f.input.id).first<{count:number}>())?.count).toBe(1);
 expect((await env.DB.prepare('SELECT text FROM station_catalog WHERE device_id=? AND song_id=?').bind(f.id,f.songId).first<{text:string}>())?.text).toBe('First lyric\nSecond lyric');
 const review=await(await call('/tasks/'+f.input.id,f.owner)).json() as{task:{body:string;revision:number}};expect(review.task.body).toContain(f.input.quote);expect(review.task.body).toContain(f.input.replacement);
 const receipt=await(await call('/song-comments/'+f.input.id,f.author)).json() as{correction:{id:string;status:string}};expect(receipt.correction).toMatchObject({id:f.input.id,status:'new'});
});
it('song/hash/quoted-section checks reject stale or foreign corrections without creating work',async()=>{
 const f=await fixture();expect((await call(f.path,f.author,'POST',{...f.input,contentHash:'c'.repeat(64)})).status).toBe(409);
 expect((await call(f.path,f.author,'POST',{...f.input,quote:'Not in this song'})).status).toBe(409);
 const other=await person();expect((await call(f.path,other,'POST',f.input)).status).toBe(403);
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM feedback_tasks WHERE id=?').bind(f.input.id).first<{count:number}>())?.count).toBe(0);
});
it('a commenter cannot read another author’s corrections or task images',async()=>{
 const f=await fixture();expect((await call(f.path,f.author,'POST',f.input)).status).toBe(201);const other=await person();
 expect((await call('/song-comments/'+f.input.id,other)).status).toBe(404);expect((await call('/tasks/'+f.input.id+'/images',other)).status).toBe(404);
 expect((await call('/tasks/'+f.input.id+'/images',f.author)).status).toBe(200);
});
it('role revocation between validation and insertion cannot create a correction or alert',async()=>{
 const f=await fixture();let changed=false;const DB=new Proxy(env.DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{if(!changed){changed=true;await target.prepare('DELETE FROM user_ministry_roles WHERE user_id=?').bind(f.author.id).run();}return target.batch(statements);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 expect((await call(f.path,f.author,'POST',f.input,{...env,DB})).status).toBeGreaterThanOrEqual(400);
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM feedback_tasks WHERE id=?').bind(f.input.id).first<{count:number}>())?.count).toBe(0);expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM requests WHERE id=?').bind(f.input.id).first<{count:number}>())?.count).toBe(0);
});

it('commenter images are available to their author and reviewers without opening unrelated tasks',async()=>{
 const f=await fixture();expect((await call(f.path,f.author,'POST',f.input)).status).toBe(201);
 const imageId=crypto.randomUUID(),bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG0kAAAAASUVORK5CYII='),value=>value.charCodeAt(0));
 const ctx=createExecutionContext(),uploaded=await worker.fetch(new Request('http://localhost:8787/api/tasks/'+f.input.id+'/images/'+imageId,{method:'PUT',headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access; '+f.author.cookie,'X-Filename':'correction.png','Content-Length':String(bytes.length)},body:bytes}),env,ctx);await waitOnExecutionContext(ctx);expect(uploaded.status).toBe(201);
 const digest=async(value:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');
 const original=await digest(bytes),updated=new Uint8Array([...bytes,0]),edited=await digest(updated),editContext=createExecutionContext();
 const changed=await worker.fetch(new Request('http://localhost:8787/api/file-edits/task/'+imageId,{method:'PUT',headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access; '+f.owner.cookie,'X-Edit-ID':crypto.randomUUID(),'X-Base-SHA256':original,'X-Content-SHA256':edited,'X-Filename':'correction.png','Content-Length':String(updated.length)},body:updated}),env,editContext);await waitOnExecutionContext(editContext);expect(changed.status).toBe(200);
 const receipt=await(await call('/tasks/'+f.input.id+'/images',f.author)).json() as{images:Record<string,unknown>[]};
 expect(receipt.images[0]).toMatchObject({id:imageId,sha256:edited,uploadFilename:'correction.png',uploadBytes:bytes.length,uploadSha256:original});

 expect((await call('/tasks/'+f.input.id+'/images/'+imageId,f.author)).status).toBe(200);expect((await call('/tasks/'+f.input.id+'/images/'+imageId,f.owner)).status).toBe(200);
 expect((await call('/file-edits/task/'+imageId,f.author)).status).toBe(200);const other=await person();expect((await call('/file-edits/task/'+imageId,other)).status).toBe(404);
});

it('multiple independent lyric passages are validated, reviewed together and retried immutably',async()=>{
 const f=await fixture();const edits=[{id:crypto.randomUUID(),location:0,length:5,quote:'First',replacement:'Opening'},{id:crypto.randomUUID(),location:12,length:6,quote:'Second',replacement:'Next'}];
 const input={...f.input,quote:'',replacement:'',edits};const first=await call(f.path,f.author,'POST',input);expect(first.status).toBe(201);
 expect((await first.json() as{correction:{edits:unknown[]}}).correction.edits).toEqual(edits);
 expect((await call(f.path,f.author,'POST',input)).status).toBe(200);
 expect((await call(f.path,f.author,'POST',{...input,edits:[edits[0],{...edits[1],replacement:'Different'}]})).status).toBe(409);
 const review=await(await call('/tasks/'+input.id,f.owner)).json() as{task:{body:string}};expect(review.task.body).toContain('Opening');expect(review.task.body).toContain('Next');
});
it('invalid or duplicated correction ranges never create an operator task',async()=>{
 const f=await fixture();const edit={id:crypto.randomUUID(),location:0,length:5,quote:'Wrong',replacement:'Fix'};
 for(const edits of [[edit],[{...edit,quote:'First',location:99}],[{...edit,quote:'First'},{...edit,quote:'First'}]]){
  const input={...f.input,id:crypto.randomUUID(),quote:'',replacement:'',edits};expect((await call(f.path,f.author,'POST',input)).status).toBeGreaterThanOrEqual(400);expect(await env.DB.prepare('SELECT id FROM feedback_tasks WHERE id=?').bind(input.id).first()).toBeNull();
 }
});
it('correction positions distinguish repeated Unicode passages by UTF16 offset',async()=>{
 const f=await fixture();const text='🎵 Har și pace\nHar și pace';await env.DB.prepare('UPDATE station_catalog SET text=? WHERE device_id=? AND song_id=?').bind(text,f.id,f.songId).run();
 const edit={id:crypto.randomUUID(),location:text.lastIndexOf('Har'),length:3,quote:'Har',replacement:'Harul'};
 const result=await call(f.path,f.author,'POST',{...f.input,quote:'',replacement:'',edits:[edit]});expect(result.status).toBe(201);expect((await result.json() as{correction:{edits:unknown[]}}).correction.edits).toEqual([edit]);
});

it('a source change between range validation and insertion creates no partial work',async()=>{
 const f=await fixture();let changed=false;
 const DB=new Proxy(env.DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{if(!changed){changed=true;await target.prepare('UPDATE station_catalog SET text=? WHERE device_id=? AND song_id=?').bind('Changed lyrics',f.id,f.songId).run();}return target.batch(statements);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const edits=[{id:crypto.randomUUID(),location:0,length:5,quote:'First',replacement:'Opening'}];
 expect((await call(f.path,f.author,'POST',{...f.input,quote:'',replacement:'',edits},{...env,DB})).status).toBe(409);
 for(const table of ['feedback_tasks','song_comments','requests'])expect(await env.DB.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(f.input.id).first()).toBeNull();
});
it('ten Unicode corrections remain exact and the generated review stays editable',async()=>{
 const f=await fixture(),quote='Ș'.repeat(100);await env.DB.prepare('UPDATE station_catalog SET text=?,title=? WHERE device_id=? AND song_id=?').bind(quote,'🎵'.repeat(160),f.id,f.songId).run();
 const edits=Array.from({length:10},()=>({id:crypto.randomUUID(),location:0,length:100,quote,replacement:'Ț'.repeat(100)}));
 const result=await call(f.path,f.author,'POST',{...f.input,quote:'',replacement:'',message:'M'.repeat(1000),edits});expect(result.status).toBe(201);expect((await result.json() as{correction:{edits:unknown[]}}).correction.edits).toEqual(edits);
 const review=await(await call('/tasks/'+f.input.id,f.owner)).json() as{task:{title:string;body:string;revision:number}};expect(review.task.body.length).toBeLessThanOrEqual(5000);
 expect((await call('/tasks',f.owner,'POST',{action:'update',id:f.input.id,revision:review.task.revision,title:review.task.title,body:review.task.body,status:'complete',urgent:false})).status).toBe(200);
});

it('over-budget combined corrections leave no uneditable review task',async()=>{
 const f=await fixture();const edits=Array.from({length:3},()=>({id:crypto.randomUUID(),location:0,length:5,quote:'First',replacement:'X'.repeat(1000)}));
 const result=await call(f.path,f.author,'POST',{...f.input,quote:'',replacement:'',message:'M'.repeat(2000),edits});expect(result.status).toBe(400);expect(await env.DB.prepare('SELECT id FROM feedback_tasks WHERE id=?').bind(f.input.id).first()).toBeNull();
});
