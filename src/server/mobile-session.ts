import {z} from 'zod';
import {body,cookie,hash,HttpError,json,now,setCookie,token} from './core';
const challenge=z.string().regex(/^[A-Za-z0-9_-]{43}$/),verifier=z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
export async function mobileSession(request:Request,env:Env,issue:boolean){
 if(request.method!=='POST')throw new HttpError(405,'Use the secure app sign-in flow.');
 if(issue){
  const input=await body(request,z.object({challenge,state:z.string().regex(/^[A-Za-z0-9_-]{16,100}$/)}).strict());
  const raw=cookie(request,'stati_session');if(!raw)throw new HttpError(401,'Sign in with your passkey first.');const source=await hash(raw),time=now(),code=token();
  const inserted=await env.DB.prepare("INSERT INTO challenges(id,kind,challenge,payload,expires_at) SELECT ?,'mobile-session',?,json_object('userId',u.id,'sourceSession',s.token_hash),? FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status!='removed'").bind(await hash(code),input.challenge,time+60,source,time).run();
  if(!inserted.meta.changes)throw new HttpError(401,'Please sign in again.');
  return json({callback:'stati-ios://signin?code='+encodeURIComponent(code)+'&state='+encodeURIComponent(input.state)});
 }
 const input=await body(request,z.object({code:z.string().regex(/^[A-Za-z0-9_-]{43}$/),verifier}).strict());
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.verifier))),expected=btoa(String.fromCharCode(...digest)).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''),time=now();
 const grant=await env.DB.prepare("DELETE FROM challenges WHERE id=? AND kind='mobile-session' AND challenge=? AND expires_at>? AND EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=json_extract(challenges.payload,'$.sourceSession') AND s.user_id=json_extract(challenges.payload,'$.userId') AND s.expires_at>? AND u.status!='removed') RETURNING payload").bind(await hash(input.code),expected,time,time).first<{payload:string}>();
 if(!grant)throw new HttpError(401,'This app sign-in expired or was already used. Start again.');
 const source=z.object({userId:z.string().uuid(),sourceSession:z.string().regex(/^[a-f0-9]{64}$/)}).parse(JSON.parse(grant.payload)),session=token();
 const result=await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,u.id,? FROM users u JOIN sessions source ON source.user_id=u.id WHERE u.id=? AND u.status!='removed' AND source.token_hash=? AND source.expires_at>?").bind(await hash(session),time+30*86400,source.userId,source.sourceSession,time).run();
 if(!result.meta.changes)throw new HttpError(401,'Your account access changed. Sign in again.');
 return json({ok:true},200,{'Set-Cookie':setCookie('stati_session',session,30*86400,env.APP_ORIGIN)});
}
