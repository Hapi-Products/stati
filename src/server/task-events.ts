import {DurableObject} from 'cloudflare:workers';
import {HttpError,now} from './core';
import type {WorkspaceMessage} from '../shared/workspace-events';
import {requireMinistryAuthority} from './ministry-roles';

type Subscriber={userId:string;sessionHash:string};
const room=(env:Env)=>env.TASK_EVENTS.getByName('ministry-tasks:'+new URL(env.APP_ORIGIN).origin);
const validSubscriber=(value:unknown):value is Subscriber=>!!value&&typeof value==='object'&&'userId'in value&&'sessionHash'in value&&typeof value.userId==='string'&&/^[0-9a-f-]{36}$/i.test(value.userId)&&typeof value.sessionHash==='string'&&/^[a-f0-9]{64}$/.test(value.sessionHash);

/** Per-deployment ministry notification room. No task, song, group or file contents, names or identifiers travel on it. */
export class TaskEvents extends DurableObject<Env>{
 async fetch(request:Request){
  if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required',{status:426});
  const subscriber={userId:request.headers.get('X-Task-User')||'',sessionHash:request.headers.get('X-Task-Session')||''};
  if(!validSubscriber(subscriber)||!await this.allowed(subscriber))return new Response('Sign in again',{status:403});
  if(this.ctx.getWebSockets(subscriber.userId).length>=5||this.ctx.getWebSockets().length>=1000)return new Response('Too many active task connections',{status:429});
  const [client,server]=Object.values(new WebSocketPair());
  this.ctx.acceptWebSocket(server,[subscriber.userId]);server.serializeAttachment(subscriber);server.send(JSON.stringify({type:'tasks-ready'}));
  return new Response(null,{status:101,webSocket:client});
 }
 private async allowed(value:Subscriber){return!!await this.env.DB.prepare("SELECT 1 FROM sessions authentication JOIN users actor ON actor.id=authentication.user_id WHERE authentication.token_hash=? AND authentication.user_id=? AND authentication.expires_at>? AND actor.status='active'").bind(value.sessionHash,value.userId,now()).first();}
 async changed(type:WorkspaceMessage='tasks-changed'){
  if(!['tasks-changed','catalog-changed','services-changed','groups-changed','files-changed','account-changed','live-reader-changed'].includes(type))return;
  const connections=this.ctx.getWebSockets(),subscribers=connections.map(socket=>({socket,value:socket.deserializeAttachment() as unknown}));
  const hashes=[...new Set(subscribers.flatMap(({value})=>validSubscriber(value)?[value.sessionHash]:[]))];
  if(!hashes.length)return;
  const rows=await this.env.DB.prepare("SELECT authentication.token_hash AS session_hash,authentication.user_id FROM sessions authentication JOIN users actor ON actor.id=authentication.user_id WHERE authentication.token_hash IN(SELECT value FROM json_each(?)) AND authentication.expires_at>? AND actor.status='active'").bind(JSON.stringify(hashes),now()).all<{session_hash:string;user_id:string}>();
  const allowed=new Set(rows.results.map(row=>row.user_id+':'+row.session_hash));
  for(const {socket,value} of subscribers){
   try{if(!validSubscriber(value)||!allowed.has(value.userId+':'+value.sessionHash))socket.close(1008,'Sign in again');else socket.send(JSON.stringify({type}));}
   catch{try{socket.close(1011,'Reconnect to tasks');}catch{}}
  }
 }
 webSocketMessage(socket:WebSocket){socket.close(1008,'Task notifications are read-only');}
 webSocketClose(){} // Current compatibility date auto-replies to Close frames.
 webSocketError(socket:WebSocket){try{socket.close(1011,'Reconnect to tasks');}catch{}}
}
export async function subscribeTaskEvents(request:Request,env:Env){
 if(request.headers.get('Origin')!==env.APP_ORIGIN)throw new HttpError(403,'Open tasks from Stați.');
 if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')throw new HttpError(426,'Use a task notification connection.');
 const authority=await requireMinistryAuthority(request,env);if(!authority.capabilities.sendFiles&&!authority.capabilities.commentSongs)throw new HttpError(403,'Your role does not allow this connection.');
 if(!authority.sessionHash)throw new HttpError(401,'Sign in with your passkey.');
 return room(env).fetch(new Request('https://task-events/subscribe',{headers:{Upgrade:'websocket','X-Task-User':authority.user.id,'X-Task-Session':authority.sessionHash}}));
}
export async function notifyTaskChange(env:Env){
 await notifyWorkspaceChange(env,'tasks-changed');
}

export async function notifyWorkspaceChange(env:Env,type:WorkspaceMessage){
 try{await room(env).changed(type);}catch(error){console.error(JSON.stringify({event:'workspace_notification_failed',type:error instanceof Error?error.name:'unknown'}));}
}
