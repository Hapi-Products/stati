import {createExecutionContext,env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';
import type {TaskDetail,TaskBoardSnapshot} from '../src/shared/feedback-tasks-types';
async function person(role='member',ministry:string|null=null,status='active'){
 const id=crypto.randomUUID(),session=token();await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Task','T',?,?,?)").bind(id,role,status,now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+3600),
 ]);if(ministry)await env.DB.prepare('INSERT INTO user_ministry_roles VALUES(?,?,?,?)').bind(id,ministry,id,now()).run();return{id,session};
}
type Person=Awaited<ReturnType<typeof person>>;
async function call(actor?:Person,data?:unknown,path='/tasks',bindings=env){return worker.fetch(new Request('http://localhost:8787/api'+path,{method:data?'POST':'GET',headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access'+(actor?'; stati_session='+actor.session:''),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined}),bindings,createExecutionContext());}
async function create(actor:Person){const input={action:'create',id:crypto.randomUUID(),title:'Fix microphone cable',body:'Check the cable near the choir.',urgent:true};const response=await call(actor,input);expect(response.status).toBe(200);return{input,...await response.json<TaskDetail>()};}
it('shares a real persisted board with active members, with idempotent creation',async()=>{
 const author=await person(),other=await person(),created=await create(author);expect(created.task).toMatchObject({status:'new',revision:1,urgent:true,canManage:true});
 expect((await call(author,created.input)).status).toBe(200);
 const board=await(await call(other)).json<TaskBoardSnapshot>();expect(board.total).toBe(1);expect(board.counts).toEqual({'new':1,'in-progress':0,'complete':0});expect(board.items[0]).toMatchObject({id:created.task.id,canManage:false});
});
it('rejects guests, pending users, removed users and cross-site writes',async()=>{
 expect((await call()).status).toBe(401);
 for(const state of ['pending','removed'])expect((await call(await person('member',null,state))).status).toBeGreaterThanOrEqual(400);
 const actor=await person();const response=await worker.fetch(new Request('http://localhost:8787/api/tasks',{method:'POST',headers:{Origin:'https://unrelated.example',Cookie:'stati_session='+actor.session},body:'{}'}),env,createExecutionContext());expect(response.status).toBe(403);
});
it('allows author and team leaders to move tasks both directions, blocking unrelated member changes',async()=>{
 const author=await person(),member=await person(),pastor=await person('member','pastor'),created=await create(author),task=created.task;
 const change={action:'update',id:task.id,revision:task.revision,title:task.title,body:task.body,urgent:false,status:'in-progress'};
 expect((await call(member,change)).status).toBe(409);
 const response=await call(author,change);expect(response.status).toBe(200);const updated=(await response.json<TaskDetail>()).task;expect(updated.status).toBe('in-progress');
 expect((await call(author,change)).status).toBe(409);
 const complete=await call(pastor,{...change,revision:updated.revision,status:'complete'});expect(complete.status).toBe(200);
 const reopened=await call(author,{...change,revision:(await complete.json<TaskDetail>()).task.revision,status:'new'});expect(reopened.status).toBe(200);
});
it('persists replies for the submitter and avoids duplicate notes after a retry',async()=>{
 const author=await person(),member=await person(),created=await create(author),input={action:'note',id:created.task.id,revision:1,noteId:crypto.randomUUID(),body:'A replacement cable is ready.'};
 const response=await call(member,input);expect(response.status).toBe(200);expect((await response.json<TaskDetail>()).notes).toMatchObject([{authorId:member.id,body:input.body}]);
 expect((await call(member,input)).status).toBe(200);
 const data=await(await call(author,undefined,'/tasks/'+created.task.id)).json<TaskDetail>();expect(data.noteTotal).toBe(1);expect(data.task.revision).toBe(2);
 expect((await call(author,{...input,noteId:crypto.randomUUID()})).status).toBe(409);
});
it('does not mutate after a session is revoked between authorization and the write',async()=>{
 const actor=await person(),created=await create(actor);let changed=false;
 const database={prepare(sql:string){const statement=env.DB.prepare(sql);if(sql.startsWith('UPDATE feedback_tasks SET title='))return{bind(...values:unknown[]){const bound=statement.bind(...values);return{async run(){if(!changed){changed=true;await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(actor.id).run();}return bound.run();}};}};return statement;},batch:env.DB.batch.bind(env.DB)};
 const response=await call(actor,{action:'update',id:created.task.id,revision:1,title:'Changed',body:'Changed',urgent:false,status:'complete'},'/tasks',{...env,DB:database as D1Database});
 expect(response.status).toBe(409);expect(await env.DB.prepare('SELECT title,status,revision FROM feedback_tasks WHERE id=?').bind(created.task.id).first()).toMatchObject({title:created.task.title,status:'new',revision:1});
});
it('shows actual author photo URLs and limits deletion to the author or an administrator',async()=>{
 const author=await person(),member=await person(),pastor=await person('member','pastor'),admin=await person('admin');
 await env.DB.prepare('UPDATE users SET photo_key=? WHERE id=?').bind('profile-photos/'+author.id,author.id).run();
 const created=await create(author);expect(created.task).toMatchObject({canDelete:true,authorPhotoUrl:'/api/members/'+author.id+'/photo'});expect('updatedByName' in created.task).toBe(false);
 for(const actor of [member,pastor]){
  const read=await(await call(actor,undefined,'/tasks/'+created.task.id)).json<TaskDetail>();expect(read.task.canDelete).toBe(false);
  expect((await call(actor,{action:'delete',id:created.task.id,revision:1})).status).toBe(409);
 }
 const response=await call(admin,{action:'delete',id:created.task.id,revision:1});expect(response.status).toBe(200);expect(await response.json()).toEqual({deleted:true,id:created.task.id,revision:2});
 expect((await call(author,undefined,'/tasks/'+created.task.id)).status).toBe(404);
 const board=await(await call(author)).json<TaskBoardSnapshot>();expect(board.items.some(item=>item.id===created.task.id)).toBe(false);expect(Object.values(board.counts).reduce((sum,count)=>sum+count,0)).toBe(board.total);
 expect(await env.DB.prepare('SELECT title,deleted_at FROM feedback_tasks WHERE id=?').bind(created.task.id).first()).toMatchObject({title:created.task.title,deleted_at:now()});
 expect((await call(admin,{action:'delete',id:created.task.id,revision:1})).status).toBe(200);
 const restored=await call(author,{action:'restore',id:created.task.id,revision:2});expect(restored.status).toBe(200);expect((await restored.json<TaskDetail>()).task).toMatchObject({title:created.task.title,revision:3});expect((await call(author,{action:'restore',id:created.task.id,revision:2})).status).toBe(200);
});
it('soft-deletes and restores a comment without deleting its content or another person’s comment',async()=>{
 const author=await person(),commenter=await person(),other=await person(),admin=await person('admin'),created=await create(author),noteId=crypto.randomUUID();
 await env.DB.prepare('UPDATE users SET photo_key=? WHERE id=?').bind('profile-photos/'+commenter.id,commenter.id).run();
 const added=await call(commenter,{action:'note',id:created.task.id,revision:1,noteId,body:'Preserve this comment.'});expect(added.status).toBe(200);
 const own=(await added.json<TaskDetail>()).notes[0];expect(own).toMatchObject({canDelete:true,authorPhotoUrl:'/api/members/'+commenter.id+'/photo'});
 const read=await(await call(author,undefined,'/tasks/'+created.task.id)).json<TaskDetail>();expect(read.notes[0].canDelete).toBe(false);
 for(const actor of [author,other])expect((await call(actor,{action:'delete-note',id:created.task.id,revision:2,noteId})).status).toBe(409);
 const removed=await call(commenter,{action:'delete-note',id:created.task.id,revision:2,noteId});expect(removed.status).toBe(200);expect(await removed.json<TaskDetail>()).toMatchObject({task:{revision:3,noteCount:0},notes:[],noteTotal:0});
 expect((await call(commenter,{action:'delete-note',id:created.task.id,revision:2,noteId})).status).toBe(200);
 expect(await env.DB.prepare('SELECT body,deleted_at FROM feedback_task_notes WHERE id=?').bind(noteId).first()).toMatchObject({body:'Preserve this comment.',deleted_at:now()});
 expect((await call(commenter,{action:'note',id:created.task.id,revision:3,noteId,body:'Preserve this comment.'})).status).toBe(409);
 const restored=await call(admin,{action:'restore-note',id:created.task.id,revision:3,noteId});expect(restored.status).toBe(200);expect(await restored.json<TaskDetail>()).toMatchObject({task:{revision:4,noteCount:1},notes:[{id:noteId,body:'Preserve this comment.'}],noteTotal:1});expect((await call(admin,{action:'restore-note',id:created.task.id,revision:3,noteId})).status).toBe(200);
});
it('rejects edits and comments while a task is deleted and keeps original children for restoration',async()=>{
 const author=await person(),created=await create(author),noteId=crypto.randomUUID();await call(author,{action:'note',id:created.task.id,revision:1,noteId,body:'Original comment'});
 expect((await call(author,{action:'delete',id:created.task.id,revision:2})).status).toBe(200);
 expect((await call(author,{action:'update',id:created.task.id,revision:3,title:'Overwrite',body:'Overwrite',urgent:false,status:'complete'})).status).toBe(409);
 expect((await call(author,{action:'note',id:created.task.id,revision:3,noteId:crypto.randomUUID(),body:'A new comment'})).status).toBe(409);
 expect((await call(author,{action:'delete-note',id:created.task.id,revision:3,noteId})).status).toBe(409);
 const restored=await call(author,{action:'restore',id:created.task.id,revision:3});expect(restored.status).toBe(200);expect(await restored.json<TaskDetail>()).toMatchObject({task:{title:created.task.title,revision:4,noteCount:1},notes:[{id:noteId,body:'Original comment'}]});
});
it('does not delete a task after access is revoked during the write',async()=>{
 const author=await person(),created=await create(author);let changed=false;
 const database={prepare(sql:string){const statement=env.DB.prepare(sql);if(sql.startsWith('UPDATE feedback_tasks SET deleted_at='))return{bind(...values:unknown[]){const bound=statement.bind(...values);return{async run(){if(!changed){changed=true;await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(author.id).run();}return bound.run();}};}};return statement;},batch:env.DB.batch.bind(env.DB)};
 expect((await call(author,{action:'delete',id:created.task.id,revision:1},'/tasks',{...env,DB:database as D1Database})).status).toBe(409);
 expect(await env.DB.prepare('SELECT revision,deleted_at FROM feedback_tasks WHERE id=?').bind(created.task.id).first()).toEqual({revision:1,deleted_at:null});
});
