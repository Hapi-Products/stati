import {env,SELF} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {hash,now,token} from '../src/server/core';

const root='http://localhost:8787';
async function actor(firstName:string,status='active'){
 const id=crypto.randomUUID(),session=token();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,?,'R','member',?,?)").bind(id,firstName,status,now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+3600),
 ]);
 return {id,session};
}
async function station(owner:string,marked=true){
 const id=crypto.randomUUID(),credential=token();
 await env.DB.prepare("INSERT INTO devices(id,name,token_hash,owner_id,created_at,pair_expires) VALUES(?,'Preview computer',?,?,?,?)").bind(id,await hash(credential),owner,now(),now()+600).run();
 if(marked)await env.DB.prepare("INSERT INTO settings VALUES(?,'1')").bind('ilumin8-device:'+id).run();
 return {id,credential};
}
function call(path:string,auth:{session?:string;credential?:string},data?:unknown){
 return SELF.fetch(root+'/api'+path,{
  method:data?'POST':'GET',
  headers:{Origin:root,...(auth.session?{Cookie:'stati_session='+auth.session}:{}),...(auth.credential?{Authorization:'Bearer '+auth.credential}:{}),...(data?{'Content-Type':'application/json'}:{})},
  ...(data?{body:JSON.stringify(data)}:{}),
 });
}

it('exports the connected profile only for its paired Ilumin8 credential',async()=>{
 const owner=await actor('Owner'),pc=await station(owner.id);
 const ok=await call('/station/ilumin8/account',pc);
 expect(ok.status).toBe(200);
 expect(await ok.json()).toEqual({firstName:'Owner',lastInitial:'R',photoVersion:null});
 expect((await call('/station/ilumin8/account',owner)).status).toBe(401);
 expect((await call('/station/ilumin8/account',await station(owner.id,false))).status).toBe(403);
 await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),pc.id).run();
 expect((await call('/station/ilumin8/account',pc)).status).toBe(401);
});

it('redeems an active Stați member once, on its paired station and QR challenge',async()=>{
 const owner=await actor('Owner'),member=await actor('Worship singer'),pc=await station(owner.id),other=await station(owner.id);
 const binding='a'.repeat(64);
 const issue=await call('/ilumin8/participant-ticket',member,{stationId:pc.id,binding});
 expect(issue.status).toBe(201);
 const {ticket}=await issue.json<{ticket:string}>();
 const redeem=(target=pc,challenge=binding)=>call('/station/ilumin8/participant-ticket',target,{ticket,binding:challenge});
 expect((await redeem(other)).status).toBe(410);
 expect((await redeem(pc,'b'.repeat(64))).status).toBe(410);
 const ok=await redeem();
 expect(ok.status).toBe(200);
 expect(await ok.json()).toEqual({id:member.id,firstName:'Worship singer'});
 expect((await redeem()).status).toBe(410);
});

it('rejects pending senders and tickets whose account signed out after scanning',async()=>{
 const owner=await actor('Owner'),member=await actor('Singer'),pending=await actor('Visitor','pending'),pc=await station(owner.id);
 const binding='a'.repeat(64),data={stationId:pc.id,binding};
 expect((await call('/ilumin8/participant-ticket',pending,data)).status).toBe(403);
 const issued=await call('/ilumin8/participant-ticket',member,data);
 expect(issued.status).toBe(201);
 const {ticket}=await issued.json<{ticket:string}>();
 await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(member.session)).run();
 expect((await call('/station/ilumin8/participant-ticket',pc,{ticket,binding})).status).toBe(410);
});


it('serves the connected account photo without exposing its R2 key',async()=>{
 const owner=await actor('Photo owner'),pc=await station(owner.id);
 const photoKey='test/ilumin8-account/'+owner.id+'.png';
 const photo=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII='),char=>char.charCodeAt(0));
 await env.FILES.put(photoKey,photo,{httpMetadata:{contentType:'image/png'}});
 await env.DB.prepare('UPDATE users SET photo_key=? WHERE id=?').bind(photoKey,owner.id).run();
 const account=await call('/station/ilumin8/account',pc);
 expect(await account.json()).toEqual({firstName:'Photo owner',lastInitial:'R',photoVersion:await hash(photoKey)});
 const response=await call('/station/ilumin8/account/photo',pc);
 expect(response.status).toBe(200);
 expect(response.headers.get('content-type')).toBe('image/png');
 expect(new Uint8Array(await response.arrayBuffer())).toEqual(photo);
 expect((await call('/station/ilumin8/account/photo',await station(owner.id,false))).status).toBe(403);
});
