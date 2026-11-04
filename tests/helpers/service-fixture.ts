import {env} from 'cloudflare:test';
import {expect} from 'vitest';
import {hash,now,token} from '../../src/server/core';
import {changeStationService,readStationServices} from '../../src/server/station-services';
import {activatePhoneOperator,beginPhoneOperator} from '../../src/server/operator-selection';
import type {MinistryRole} from '../../src/server/ministry-roles';

// Real isolated D1 and module calls; no production accounts, station or songs.
export async function fixture(role:MinistryRole|null='worship_member',administrator=false){
 const owner=crypto.randomUUID(),user=crypto.randomUUID(),deviceId=crypto.randomUUID(),credential=token(),session=token(),timestamp=now(),songId=await hash(token()),contentHash=await hash(token());
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Owner','T','admin','active',?)").bind(owner,timestamp),
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Planner','T',?,'active',?)").bind(user,administrator?'admin':'member',timestamp),
  env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await hash(session),user,timestamp+3600),
  env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(deviceId,await hash(credential),'Isolated station',owner,timestamp,timestamp+600,timestamp),
  env.DB.prepare("INSERT INTO station_memberships(device_id,user_id,status,updated_at) VALUES(?,?,'approved',?)").bind(deviceId,user,timestamp),
  env.DB.prepare('INSERT INTO station_catalog(device_id,song_id,title,content_hash,filename,category,language,font_size,text,first_slide,added_at,modified_at,generation,search_text,payload_bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(deviceId,songId,'Împreună cântăm',contentHash,'song.pro','Worship','ron',72,'Împreună cântăm','Împreună cântăm',timestamp,timestamp,crypto.randomUUID(),'impreuna cantam',200),
 ]);
 if(role)await env.DB.prepare('INSERT INTO user_ministry_roles(user_id,role,assigned_by,updated_at) VALUES(?,?,?,?)').bind(user,role,owner,timestamp).run();
 const request=(data?:unknown,headers:Record<string,string>={})=>new Request('http://localhost:8787/api/computers/'+deviceId+'/services',{method:data===undefined?'GET':'POST',headers:{Cookie:'stati_session='+session,...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const change=async(data:unknown,bindings=env)=>changeStationService(request(data),bindings,deviceId).then(response=>response.json() as Promise<any>);
 const read=async()=>readStationServices(request(),env,deviceId).then(response=>response.json() as Promise<any>);
 const create=async()=>{const result=await change({type:'create',title:'Tuesday worship',date:'2026-10-27',time:'21:00'});return result.plans.find((plan:any)=>plan.active);};
 const song=(id=crypto.randomUUID())=>({id,songId,contentHash,title:'Untrusted title',filename:'untrusted.pro',reviewed:false});
 return{owner,user,deviceId,credential,session,songId,contentHash,timestamp,request,change,read,create,song};
}
export async function rejected(task:Promise<unknown>,status:number){await expect(task).rejects.toMatchObject({status});}
export function beforeBatch(change:()=>Promise<unknown>){let calls=0;const DB=new Proxy(env.DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{calls++;await change();return target.batch(statements);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});return{bindings:{...env,DB},calls:()=>calls};}
export async function native(f:Awaited<ReturnType<typeof fixture>>){const context={deviceId:f.deviceId,deviceTokenHash:await hash(f.credential)},pending=await beginPhoneOperator(env,context,f.user,token());await env.DB.prepare('UPDATE operator_unlocks SET approved=1 WHERE token_hash=?').bind(await hash(pending.token)).run();const active=await activatePhoneOperator(env,context,pending);if(!active)throw Error('Synthetic passkey proof was not activated.');const request=(data?:unknown)=>new Request('http://localhost:8787/api/station/services',{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+f.credential,'X-Stati-Operator-Lease':active.lease,'X-Stati-Operator':active.proof},...(data===undefined?{}:{body:JSON.stringify(data)})});return{request,change:async(data:unknown)=>changeStationService(request(data),env,f.deviceId,true).then(response=>response.json() as Promise<any>)};}

