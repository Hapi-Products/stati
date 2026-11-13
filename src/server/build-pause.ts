import {z} from 'zod';
import {body,cookie,hash,HttpError,json,now,type User} from './core';
import {scheduledServiceEnd} from '../shared/services';

const pauseKey='release_manual_pause';
const pauseInput=z.object({paused:z.boolean()}).strict();

export async function buildPauseStatus(env:Env){
 const row=await env.DB.prepare(`SELECT
  COALESCE((SELECT value FROM settings WHERE key=?),'0') AS manual,
  EXISTS(SELECT 1 FROM station_service_selections selection
   JOIN station_services plan ON plan.device_id=selection.device_id AND plan.id=selection.service_id AND plan.archived=0
   JOIN devices station ON station.id=selection.device_id AND station.revoked_at IS NULL
   JOIN users owner ON owner.id=station.owner_id AND owner.status='active') AS selected`).bind(pauseKey)
  .first<{manual:string;selected:number}>();
 if(!row||!['0','1'].includes(row.manual)||(row.selected!==0&&row.selected!==1))throw new HttpError(503,'Build status is unavailable.');
 const manualPaused=row.manual==='1',activeService=row.selected===1,scheduledUntil=scheduledServiceEnd();
 return {manualPaused,activeService,scheduledUntil,allowed:!manualPaused&&!activeService&&scheduledUntil===null};
}

export async function buildPauseAdmin(request:Request,env:Env,admin:User){
 if(request.method==='GET')return json(await buildPauseStatus(env));
 if(request.headers.get('origin')!==env.APP_ORIGIN)throw new HttpError(403,'A same-origin request is required.');
 const {paused}=await body(request,pauseInput,128);
 const raw=cookie(request,'stati_session');
 if(!raw)throw new HttpError(401,'Sign in to continue.');
 const time=now();
 const result=await env.DB.batch([
  env.DB.prepare(`INSERT INTO settings(key,value) SELECT ?,? WHERE EXISTS(
   SELECT 1 FROM sessions session JOIN users actor ON actor.id=session.user_id
   WHERE session.token_hash=? AND session.expires_at>? AND actor.id=? AND actor.role='admin' AND actor.status='active'
  ) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(pauseKey,paused?'1':'0',await hash(raw),time,admin.id),
  env.DB.prepare('INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,?,?,? WHERE changes()>0')
   .bind(crypto.randomUUID(),admin.id,paused?'pause-builds':'resume-builds',pauseKey,time)
 ]);
 if(result[0].meta.changes!==1)throw new HttpError(403,'An active administrator is required.');
 return json(await buildPauseStatus(env));
}
