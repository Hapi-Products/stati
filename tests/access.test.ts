import {issueOperator,pinDigest} from '../src/server/operator-auth';
const operatorProofs=new Map<string,string>();
import {env,SELF} from 'cloudflare:test';
import {it,expect,vi,beforeEach} from 'vitest';
import {hash,now,token} from '../src/server/core';
import {computerCode,timeCode} from '../src/server/enrollment';
beforeEach(async()=>{await env.DB.batch(['rate_limits','operator_sessions','operator_unlocks','account_pins','transfers','requests','receivers','devices','audit','sessions','passkeys','users'].map(table=>env.DB.prepare('DELETE FROM '+table)));await env.DB.prepare("DELETE FROM settings WHERE key IN ('bootstrap_invite','bootstrap_grant')").run();});
const call=(path:string,method='GET',data?:unknown,cookie?:string,bearer?:string)=>SELF.fetch('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',...(cookie?{Cookie:cookie}:{}),...(bearer?{Authorization:'Bearer '+bearer,...(operatorProofs.has(bearer)?{'X-Stati-Operator':operatorProofs.get(bearer)!}:{})}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
async function paired(){const owner=crypto.randomUUID(),id=crypto.randomUUID(),raw=token(),session=token();await env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,'Test','T','active','admin',?)").bind(owner,now()).run();await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),owner,now()+86400).run();await env.DB.prepare('INSERT INTO devices(id,name,token_hash,owner_id,operator_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?,?)').bind(id,'Isolated test PC',await hash(raw),owner,owner,now(),now()+600,now()).run();const salt=token(),pin={salt,digest:await pinDigest('7392',salt)};await env.DB.prepare('INSERT INTO account_pins VALUES(?,?,?)').bind(owner,pin.salt,pin.digest).run();operatorProofs.set(raw,await issueOperator(env,{deviceId:id,deviceTokenHash:await hash(raw)},owner,pin));return{id,raw,cookie:'stati_session='+session};}
it('matches RFC 6238 published SHA-1 test vectors',()=>{const key=new TextEncoder().encode('12345678901234567890');expect(timeCode(key,59,8)).toBe('94287082');expect(timeCode(key,1111111109,8)).toBe('07081804');expect(timeCode(key,20000000000,8)).toBe('65353130');});
it('hides the workspace before a code and never reveals the authenticator anonymously',async()=>{for(const path of ['/workspace','/members','/devices','/receive/anything']){const response=await call(path);expect(response.status).toBe(403);expect(await response.text()).not.toContain('Maranatha');}expect((await call('/station/enrollment-code')).status).toBe(401);});
it('accepts a current computer code, expires it, and keeps existing access grants',async()=>{const pc=await paired();const response=await call('/station/enrollment-code','GET',undefined,undefined,pc.raw);expect(response.status).toBe(200);const current=await response.json() as {code:string;expiresAt:number};expect(current.code).toBe(computerCode(env.ENROLLMENT_SECRET,pc.id).code);const unlocked=await call('/access','POST',{code:current.code});expect(unlocked.status).toBe(200);const grant=unlocked.headers.get('set-cookie')!.split(';')[0];vi.setSystemTime(new Date((current.expiresAt+1)*1000));await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now(),pc.id).run();expect((await call('/access','POST',{code:current.code})).status).toBe(401);expect((await call('/workspace','GET',undefined,grant)).status).toBe(200);expect((await call('/access','POST',{code:'285610'})).status).toBe(401);});
it('opens outside the schedule only with a live PC, while passkey members can queue offline requests',async()=>{const pc=await paired();vi.setSystemTime(new Date('2026-10-12T12:00:00-07:00'));await env.DB.prepare('UPDATE sessions SET expires_at=?').bind(now()+86400).run();await env.DB.prepare('UPDATE access_grants SET expires_at=?').bind(now()+86400).run();expect(await (await call('/access/status')).json()).toEqual({allowed:false,open:false});expect((await call('/workspace','GET',undefined,'stati_access=isolated-test-access')).status).toBe(403);expect((await call('/workspace','GET',undefined,pc.cookie)).status).toBe(200);expect((await call('/requests','POST',{deviceId:pc.id,message:'Please open the receiver'},pc.cookie)).status).toBe(201);expect((await call('/auth/register/options','POST',{firstName:'Test',lastInitial:'T'},pc.cookie)).status).toBe(409);expect((await call('/station/state','GET',undefined,undefined,pc.raw)).status).toBe(200);expect((await (await call('/access/status')).json() as {open:boolean}).open).toBe(true);const code=computerCode(env.ENROLLMENT_SECRET,pc.id).code;expect((await call('/auth/register/options','POST',{firstName:'Test',lastInitial:'T',code},'stati_access=isolated-test-access')).status).toBe(200);});
it('requires a fresh computer code for new registrations even with a remembered privacy grant',async()=>{const pc=await paired(),grant='stati_access=isolated-test-access';expect((await call('/auth/register/options','POST',{firstName:'Test',lastInitial:'T'},grant)).status).toBe(401);expect((await call('/auth/register/options','POST',{firstName:'Test',lastInitial:'T',code:computerCode(env.ENROLLMENT_SECRET,pc.id).code},grant)).status).toBe(200);});
it('allows a single-use first-owner invitation outside service hours without creating any account',async()=>{vi.setSystemTime(new Date('2026-10-12T12:00:00-07:00'));const invitation=token();await env.DB.prepare("INSERT INTO settings VALUES('bootstrap_invite',?)").bind(await hash(invitation)+':'+(now()+900)).run();const response=await call('/access/setup','POST',{token:invitation});expect(response.status).toBe(200);const grant=response.headers.get('set-cookie')!.split(';')[0];expect((await call('/access/setup','POST',{token:invitation})).status).toBe(410);expect((await call('/workspace','GET',undefined,grant)).status).toBe(200);expect((await call('/auth/register/options','POST',{firstName:'Owner',lastInitial:'T'},grant)).status).toBe(200);expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first())?.n).toBe(0);});

it('keeps a verified joining code available across rotation and canceled passkey option attempts',async()=>{const pc=await paired();const current=computerCode(env.ENROLLMENT_SECRET,pc.id);const unlocked=await call('/access','POST',{code:current.code});const grant=unlocked.headers.get('set-cookie')!.split(';')[0];vi.setSystemTime(new Date((now()+90)*1000));await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now(),pc.id).run();expect((await call('/auth/register/options','POST',{firstName:'Test',lastInitial:'T',code:current.code},grant)).status).toBe(200);expect((await call('/auth/register/options','POST',{firstName:'Test',lastInitial:'T',code:current.code},grant)).status).toBe(200);});

it('shows the joining code only when an active administrator is selected on the station',async()=>{const pc=await paired();await env.DB.prepare('UPDATE devices SET operator_id=NULL WHERE id=?').bind(pc.id).run();expect((await call('/station/enrollment-code','GET',undefined,undefined,pc.raw)).status).toBe(403);await env.DB.prepare('UPDATE devices SET operator_id=owner_id WHERE id=?').bind(pc.id).run();await env.DB.prepare("UPDATE users SET role='member' WHERE id=(SELECT owner_id FROM devices WHERE id=?)").bind(pc.id).run();expect((await call('/station/enrollment-code','GET',undefined,undefined,pc.raw)).status).toBe(403);});
it('an invite code permits retrying passkey setup without asking for that code twice',async()=>{const pc=await paired();const entered=await call('/access','POST',{code:computerCode(env.ENROLLMENT_SECRET,pc.id).code});expect(entered.status).toBe(200);const grant=entered.headers.get('set-cookie')!.split(';')[0];expect((await call('/auth/register/options','POST',{firstName:'Invited',lastInitial:'T'},grant)).status).toBe(200);expect((await call('/auth/register/options','POST',{firstName:'Invited',lastInitial:'T'},grant)).status).toBe(200);});

it('repeated code mistakes do not lock out a valid code and shared-IP passkey sign-in has no attempt ceiling',async()=>{
 const pc=await paired(),code=computerCode(env.ENROLLMENT_SECRET,pc.id).code,wrong=code==='000000'?'111111':'000000';
 await env.DB.prepare('INSERT INTO rate_limits VALUES(?,?,?)').bind('access:'+await hash('local'),999,now()+300).run();
 for(let i=0;i<12;i++)expect((await call('/access','POST',{code:wrong})).status).toBe(401);
 expect((await call('/access','POST',{code})).status).toBe(200);
 for(let i=0;i<25;i++)expect((await call('/auth/login/options','POST',{})).status).toBe(200);
});
it('pending pairing is resumable with its bearer; a claimed computer exposes no old pairing link and repeated pairing requests have no IP attempt ceiling',async()=>{
 let pending:{id:string;credential:string;url:string;expiresAt:number;code:string}|undefined;
 for(let i=0;i<12;i++){const response=await call('/devices/pair','POST',{name:'Isolated pairing '+i});expect(response.status).toBe(200);pending=await response.json() as typeof pending;}
 const status=await call('/devices/pair/status','GET',undefined,undefined,pending!.credential);expect(status.status).toBe(200);
 expect(await status.json()).toEqual({id:pending!.id,name:'Isolated pairing 11',paired:false,url:pending!.url,expiresAt:pending!.expiresAt});
 expect((await call('/devices/pair/status')).status).toBe(401);
 const pc=await paired();expect((await call('/devices/claim','POST',{code:pending!.code},pc.cookie)).status).toBe(200);
 expect(await (await call('/devices/pair/status','GET',undefined,undefined,pending!.credential)).json()).toEqual({id:pending!.id,name:'Isolated pairing 11',paired:true});
});
it('admin phone invitation works with the PC closed and stops after issuer signout',async()=>{
 vi.setSystemTime(new Date('2026-10-12T12:00:00-07:00'));
 const pc=await paired();await env.DB.prepare('UPDATE devices SET last_seen=0 WHERE id=?').bind(pc.id).run();
 expect((await call('/devices/'+pc.id+'/enrollment-code')).status).toBe(403);
 const shown=await call('/devices/'+pc.id+'/enrollment-code','GET',undefined,pc.cookie);expect(shown.status).toBe(200);
 const invite=await shown.json() as {code:string;url:string};expect(invite.url).toContain('#join='+invite.code);
 const entered=await call('/access','POST',{code:invite.code});expect(entered.status).toBe(200);expect((await entered.clone().json() as {deviceId:string}).deviceId).toBe(pc.id);
 const grant=entered.headers.get('set-cookie')!.split(';')[0];expect((await call('/auth/register/options','POST',{firstName:'Invited',lastInitial:'I'},grant)).status).toBe(200);
 await env.DB.prepare('DELETE FROM sessions').run();expect((await call('/access','POST',{code:invite.code})).status).toBe(423);
});

it('phone invites reject members, disconnected issuers and revoked computers',async()=>{
 const pc=await paired();
 await env.DB.prepare("UPDATE users SET role='member'").run();
 expect((await call('/devices/'+pc.id+'/enrollment-code','GET',undefined,pc.cookie)).status).toBe(403);
 await env.DB.prepare("UPDATE users SET role='admin'").run();
 await env.DB.prepare('INSERT INTO station_disconnections(user_id,device_id,created_at,operation_id) SELECT owner_id,id,?,? FROM devices WHERE id=?').bind(now(),'invite-test',pc.id).run();
 expect((await call('/devices/'+pc.id+'/enrollment-code','GET',undefined,pc.cookie)).status).toBe(403);
 await env.DB.prepare('DELETE FROM station_disconnections').run();
 await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),pc.id).run();
 expect((await call('/devices/'+pc.id+'/enrollment-code','GET',undefined,pc.cookie)).status).toBe(403);
});
it('an expired phone invite cannot unlock registration while the PC is closed',async()=>{
 vi.setSystemTime(new Date('2026-10-12T12:00:00-07:00'));
 const pc=await paired();await env.DB.prepare('UPDATE devices SET last_seen=0').run();
 expect((await call('/devices/'+pc.id+'/enrollment-code','GET',undefined,pc.cookie)).status).toBe(200);
 vi.setSystemTime(new Date((now()+91)*1000));
 const code=computerCode(env.ENROLLMENT_SECRET,pc.id).code;
 expect((await call('/access','POST',{code})).status).toBe(423);
});
