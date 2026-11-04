import {pinDigest} from '../src/server/operator-auth';
import {OPERATOR_LEASE_PROTOCOL,selectPinOperator} from '../src/server/operator-selection';
import { env,SELF,createExecutionContext,createScheduledController } from 'cloudflare:test';
import worker from '../src/server/index';
import { describe,it,expect,vi } from 'vitest';
import { hash,now,token,safeFilename,fileType } from '../src/server/core';
import { splitLyrics } from '../src/shared/slides';
import { permittedUrl } from '../src/server/lyrics';
// Fixture identities exist only in Vitest's isolated in-memory database. No deployed data is seeded.
async function fixture(status='active',role='member'){
 const id=crypto.randomUUID(),raw=token();await env.DB.prepare('INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,?,?,?,?,?)').bind(id,'Test','T',status,role,now()).run();await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(raw),id,now()+1000).run();return {id,cookie:'stati_session='+raw};
}
async function call(path:string,method='GET',data?:unknown,cookie?:string,bearer?:string){return SELF.fetch('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787','CF-Connecting-IP':crypto.randomUUID(),...(data?{'Content-Type':'application/json'}:{}),Cookie:'stati_access=isolated-test-access'+(cookie?'; '+cookie:''),...(bearer?{Authorization:'Bearer '+bearer,...(operatorProofs.has(bearer)?{'X-Stati-Operator':operatorProofs.get(bearer)!}:{}),...(operatorLeases.has(bearer)?{'X-Stati-Operator-Protocol':OPERATOR_LEASE_PROTOCOL,'X-Stati-Operator-Lease':operatorLeases.get(bearer)!}:{})}:{})},body:data?JSON.stringify(data):undefined});}
const operatorProofs=new Map<string,string>();
const operatorLeases=new Map<string,string>();
async function unlockAdmin(deviceId:string,credential:string,userId:string){const salt=token(),pin={salt,digest:await pinDigest('7392',salt)};await env.DB.prepare('INSERT INTO account_pins VALUES(?,?,?)').bind(userId,pin.salt,pin.digest).run();const selected=await selectPinOperator(env,{deviceId,deviceTokenHash:await hash(credential)},userId,pin);operatorProofs.set(credential,selected.proof);operatorLeases.set(credential,selected.lease);return selected.proof;}
const uploadCookies=new Map<string,string>();
async function station(){const u=await fixture();const p=await call('/devices/pair','POST',{name:'Isolated test station'});expect(p.status).toBe(200);const d=await p.json() as {id:string;credential:string;code:string};expect((await call('/devices/claim','POST',{code:d.code},u.cookie)).status).toBe(200);const selection=await SELF.fetch('http://localhost:8787/api/station/operator',{method:'POST',headers:{Origin:'http://localhost:8787',Authorization:'Bearer '+d.credential,'Content-Type':'application/json','X-Stati-Operator-Protocol':OPERATOR_LEASE_PROTOCOL},body:JSON.stringify({userId:u.id})});expect(selection.status).toBe(200);operatorLeases.set(d.credential,(await selection.json() as {lease:string}).lease);const response=await call('/station/receiver','POST',{},undefined,d.credential);expect(response.status).toBe(200);const receiver=await response.json() as {id:string;token:string};const c=await(await call('/connections/'+receiver.token,'POST',{},u.cookie)).json() as {connection:{id:string}};expect((await call('/station/connections/'+c.connection.id+'/decision','POST',{status:'approved'},undefined,d.credential)).status).toBe(200);uploadCookies.set(receiver.token,u.cookie);return{u,d,receiver};}
async function upload(receiveToken:string,filename='lyrics.txt',content='Test lyric',checksum?:string){return SELF.fetch('http://localhost:8787/api/receive/'+receiveToken,{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access; '+uploadCookies.get(receiveToken),'X-Filename':encodeURIComponent(filename),'Content-Length':String(new TextEncoder().encode(content).length),...(checksum!==undefined?{'X-Checksum-SHA256':checksum}:{})},body:content});}
describe('Account and role boundaries',()=>{
 it('does not expose the directory or computers to anonymous visitors',async()=>{expect((await call('/members')).status).toBe(401);expect((await call('/devices')).status).toBe(401);});
 it('keeps pending profiles out of the directory and station privileges',async()=>{const u=await fixture('pending');expect((await call('/me','GET',undefined,u.cookie)).status).toBe(200);expect((await call('/members','GET',undefined,u.cookie)).status).toBe(403);expect((await call('/devices/claim','POST',{code:'not-a-pair-code'},u.cookie)).status).toBe(403);});
 it('blocks members from approving themselves or other members',async()=>{const u=await fixture(),pending=await fixture('pending');expect((await call('/members/'+pending.id,'PATCH',{action:'approve'},u.cookie)).status).toBe(403);});
 it('lets an administrator approve a pending real-registration record and records an audit',async()=>{const u=await fixture('active','admin'),pending=await fixture('pending');expect((await call('/members/'+pending.id,'PATCH',{action:'approve'},u.cookie)).status).toBe(200);expect((await env.DB.prepare('SELECT status FROM users WHERE id=?').bind(pending.id).first())?.status).toBe('active');expect((await env.DB.prepare('SELECT action FROM audit WHERE subject_id=?').bind(pending.id).first())?.action).toBe('approve');});
 it('rejects cross-site state changes',async()=>{const r=await SELF.fetch('http://localhost:8787/api/auth/login/options',{method:'POST',headers:{Origin:'https://other.example'}});expect(r.status).toBe(403);});
 it('does not serve member photos to unapproved accounts',async()=>{const u=await fixture('pending'),other=await fixture();expect((await call('/members/'+other.id+'/photo','GET',undefined,u.cookie)).status).toBe(403);});
});
describe('Receiver and transfer lifecycle',()=>{
 it('pairs only once and refuses arbitrary pairing codes',async()=>{const {u,d}=await station();expect((await call('/devices/claim','POST',{code:d.code},u.cookie)).status).toBe(410);});
 it('streams a file through real R2, permits only its receiver computer to download, then removes the cloud copy after delivery',async()=>{const {d,receiver}=await station();const response=await upload(receiver.token);expect(response.status).toBe(201);const transfer=await response.json() as {id:string};const f=await call('/station/transfers/'+transfer.id,'GET',undefined,undefined,d.credential);expect(f.status).toBe(200);expect(await f.text()).toBe('Test lyric');const other=await station();expect((await call('/station/transfers/'+transfer.id,'GET',undefined,undefined,other.d.credential)).status).toBe(404);expect((await call('/station/transfers/'+transfer.id+'/delivered','POST',{},undefined,d.credential)).status).toBe(200);const row=await env.DB.prepare('SELECT * FROM transfers WHERE id=?').bind(transfer.id).first<{status:string;object_key:string}>();expect(row?.status).toBe('delivered');expect(await env.FILES.get(row!.object_key)).toBeNull();});
 it('retains private rejection reasons after cloud cleanup and cannot reverse a rejected file',async()=>{const {u,d,receiver}=await station();const sent=await(await upload(receiver.token)).json() as {id:string};const other=await fixture();expect((await call('/station/transfers/'+sent.id+'/reject','POST',{reason:'Wrong song for this service'},undefined,d.credential)).status).toBe(200);expect(await env.FILES.head('transfers/'+sent.id)).toBeNull();expect((await call('/station/transfers/'+sent.id+'/delivered','POST',{},undefined,d.credential)).status).toBe(409);const own=await(await call('/transfers','GET',undefined,u.cookie)).json() as {id:string;status:string;rejection_reason:string}[];expect(own.find(f=>f.id===sent.id)).toMatchObject({status:'rejected',rejection_reason:'Wrong song for this service'});const hidden=await(await call('/transfers','GET',undefined,other.cookie)).json();expect(hidden).toEqual([]);await worker.scheduled(createScheduledController(),env);expect(await env.DB.prepare('SELECT id FROM transfers WHERE id=?').bind(sent.id).first()).toBeNull();expect((await(await call('/transfers','GET',undefined,u.cookie)).json() as {id:string}[]).some(f=>f.id===sent.id)).toBe(true);});
 it('remembers member approval across receiver restarts but blocks closed computers',async()=>{const {u,d,receiver}=await station();await call('/station/receiver','DELETE',undefined,undefined,d.credential);expect((await upload(receiver.token)).status).toBe(410);const next=await(await call('/station/receiver','POST',{},undefined,d.credential)).json() as {id:string;token:string};const state=await(await call('/receive/device:'+d.id,'GET',undefined,u.cookie)).json() as {connection:{status:string}};expect(state.connection.status).toBe('approved');uploadCookies.set(next.token,u.cookie);expect((await upload(next.token)).status).toBe(201);});
 it('lets active administrators queue files for a closed computer without opening it for members',async()=>{const {u,d,receiver}=await station(),a=await fixture('active','admin');await call('/station/receiver','DELETE',undefined,undefined,d.credential);await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now()-100,d.id).run();expect((await call('/receive/device:'+d.id,'GET',undefined,u.cookie)).status).toBe(410);expect((await call('/receive/device:'+d.id,'GET',undefined,a.cookie)).status).toBe(200);const send=await SELF.fetch('http://localhost:8787/api/receive/device:'+d.id,{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:a.cookie,'Content-Length':'10','X-Filename':'lyrics.txt'},body:'Test lyric'});expect(send.status).toBe(201);expect((await upload(receiver.token)).status).toBe(410);const records=await(await call('/transfers','GET',undefined,a.cookie)).json() as {status:string}[];expect(records[0].status).toBe('queued');expect((await call('/receivers','GET',undefined,u.cookie)).status).toBe(200);expect(await(await call('/receivers','GET',undefined,u.cookie)).json()).not.toContainEqual(expect.objectContaining({id:d.id}));const adminComputers=await(await call('/receivers','GET',undefined,a.cookie)).json() as {id:string;online:number}[];expect(adminComputers).toContainEqual(expect.objectContaining({id:d.id,online:0}));});
 it('renews the same receiver without losing approval and refuses renewal after closing',async()=>{const {d,receiver}=await station();expect((await call('/station/receiver','PATCH',{id:receiver.id},undefined,d.credential)).status).toBe(200);expect((await upload(receiver.token)).status).toBe(201);await call('/station/receiver','DELETE',undefined,undefined,d.credential);expect((await call('/station/receiver','PATCH',{id:receiver.id},undefined,d.credential)).status).toBe(410);});
 it('revokes uploads immediately when the receiver closes',async()=>{const {d,receiver}=await station();expect((await call('/station/receiver','DELETE',undefined,undefined,d.credential)).status).toBe(200);expect((await upload(receiver.token)).status).toBe(410);});
 it('stops accepting uploads when the computer heartbeat goes stale',async()=>{const {d,receiver}=await station();await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now()-46,d.id).run();expect((await upload(receiver.token)).status).toBe(410);});
 it('enforces five-minute expiry on the server',async()=>{const {receiver}=await station();await env.DB.prepare('UPDATE receivers SET expires_at=? WHERE id=?').bind(now()-1,receiver.id).run();expect((await upload(receiver.token)).status).toBe(410);});
 it('revokes a removed member’s computer and receiver',async()=>{const {u,d,receiver}=await station(),a=await fixture('active','admin');expect((await call('/members/'+u.id,'PATCH',{action:'remove'},a.cookie)).status).toBe(200);expect((await upload(receiver.token)).status).toBe(401);expect((await call('/station/state','GET',undefined,undefined,d.credential)).status).toBe(401);expect((await call('/me','GET',undefined,u.cookie)).status).toBe(401);});
 it('refuses executable or incorrectly named file payloads',async()=>{const {receiver}=await station();expect((await upload(receiver.token,'song.exe','MZbinary')).status).toBe(415);expect((await upload(receiver.token,'song.pdf','not-a-pdf')).status).toBe(415);});
 it('refuses over-limit declared uploads before storing data',async()=>{const {receiver}=await station();const r=await SELF.fetch('http://localhost:8787/api/receive/'+receiver.token,{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access; '+uploadCookies.get(receiver.token),'Content-Length':String(51*1024*1024),'X-Filename':'song.txt'},body:'x'});expect(r.status).toBe(413);});
 it('queues an offline request only for an approved member',async()=>{const {u,d}=await station();expect((await call('/requests','POST',{deviceId:d.id,message:'Please open the receiver'},u.cookie)).status).toBe(201);const state=await (await call('/station/state','GET',undefined,undefined,d.credential)).json() as {requests:unknown[]};expect(state.requests).toHaveLength(1);});
});
describe('Transfer checksum route boundaries',()=>{
 it('queues a checksum-verified upload and sends the stored checksum only to its receiver',async()=>{
  const pc=await station(),content='Test lyric',sha256=await hash(content);
  const response=await upload(pc.receiver.token,'checked.txt',content,sha256.toUpperCase());
  expect(response.status).toBe(201);
  const sent=await response.json() as {id:string;status:string;sha256:string};
  expect(sent).toMatchObject({status:'queued',sha256});
  expect(await env.DB.prepare('SELECT device_id,sender_id,status,bytes FROM delivery_records WHERE id=?').bind(sent.id).first()).toMatchObject({device_id:pc.d.id,sender_id:pc.u.id,status:'queued',bytes:10});
  const download=await call('/station/transfers/'+sent.id,'GET',undefined,undefined,pc.d.credential);
  expect(download.status).toBe(200);expect(download.headers.get('X-Checksum-SHA256')).toBe(sha256);expect(await download.text()).toBe(content);
  const other=await station();expect((await call('/station/transfers/'+sent.id,'GET',undefined,undefined,other.d.credential)).status).toBe(404);
 });

 it('rejects a checksum for different same-sized bytes without queue rows, receipts, or orphan objects',async()=>{
  const pc=await station(),content='Test lyric',other='Best lyric';expect(content.length).toBe(other.length);
  const before=await env.FILES.list({prefix:'transfers/'});expect(before.truncated).toBe(false);
  const response=await upload(pc.receiver.token,'changed.txt',content,await hash(other));
  expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:expect.stringContaining('Nothing was queued')});
  for(const table of ['transfers','delivery_records'])expect(await env.DB.prepare(`SELECT id FROM ${table} WHERE device_id=?`).bind(pc.d.id).first()).toBeNull();
  const after=await env.FILES.list({prefix:'transfers/'});expect(after.truncated).toBe(false);expect(after.objects.map(object=>object.key)).toEqual(before.objects.map(object=>object.key));
 });

 it('rejects malformed checksum headers before calling object storage',async()=>{
  const pc=await station();let puts=0;
  const files=new Proxy(env.FILES,{get(target,property){if(property==='put')return(...args:Parameters<R2Bucket['put']>)=>{puts++;return target.put(...args);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const request=new Request('http://localhost:8787/api/receive/'+pc.receiver.token,{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access; '+pc.u.cookie,'X-Filename':'lyrics.txt','Content-Length':'10','X-Checksum-SHA256':'invalid-sha256'},body:'Test lyric'});
  const response=await worker.fetch(request,{...env,FILES:files},createExecutionContext());
  expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:expect.stringContaining('Invalid file checksum')});expect(puts).toBe(0);
  for(const table of ['transfers','delivery_records'])expect(await env.DB.prepare(`SELECT id FROM ${table} WHERE device_id=?`).bind(pc.d.id).first()).toBeNull();
 });
});
describe('Input preparation',()=>{
 it('keeps Romanian section headings out of rendered lyric text',()=>{expect(splitLyrics('Strofă 1\nÎmpreună cântăm\n\nRefren\nSlavă Domnului',4)).toEqual([{section:'Strofă 1',text:'Împreună cântăm'},{section:'Refren',text:'Slavă Domnului'}]);});
 it('keeps lyrics verbatim and honors sections and slide limits',()=>{expect(splitLyrics('[Verse 1]\nA\nB\nC\n\nChorus\nD',2)).toEqual([{section:'Verse 1',text:'A\nB'},{section:'Verse 1',text:'C'},{section:'Chorus',text:'D'}]);});
 it('uses safe Windows filenames without traversal or reserved devices',()=>{expect(safeFilename('../song.txt')).toBe('song.txt');expect(safeFilename('CON.txt')).toBe('presentation-CON.txt');});
 it('refuses private URLs, credentials, unsupported domains and unsafe ports',()=>{for(const u of ['http://127.0.0.1','https://localhost','https://169.254.169.254','https://hymnary.org.evil.test','https://name:secret@hymnary.org','https://hymnary.org:8443'])expect(()=>permittedUrl(u)).toThrow();expect(permittedUrl('https://hymnary.org/text/a').hostname).toBe('hymnary.org');});
});
describe('Administrator test build distribution',()=>{
 it('rejects anonymous and ordinary-member test downloads',async()=>{const u=await fixture();expect((await call('/downloads')).status).toBe(401);expect((await call('/downloads/windows-test','GET',undefined,u.cookie)).status).toBe(403);});
 it('streams admin-only artifacts and supports bounded resume ranges',async()=>{const u=await fixture('active','admin');const release={id:'windows-test',version:'0.1.0',filename:'Stati-Windows-0.1.0-test.exe',objectKey:'releases/test/artifact.exe',bytes:10,sha256:'a'.repeat(64),test:true};await env.FILES.put(release.objectKey,'0123456789');await env.DB.prepare("INSERT INTO settings(key,value) VALUES('release_windows-test',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(release)).run();const list=await(await call('/downloads','GET',undefined,u.cookie)).json() as {url:string;objectKey?:string}[];expect(list[0].url).toBe('/api/downloads/windows-test');expect(list[0].objectKey).toBeUndefined();const full=await call('/downloads/windows-test','GET',undefined,u.cookie);expect(full.status).toBe(200);expect(await full.text()).toBe('0123456789');const range=await SELF.fetch('http://localhost:8787/api/downloads/windows-test',{headers:{Cookie:u.cookie,Range:'bytes=3-6'}});expect(range.status).toBe(206);expect(range.headers.get('content-range')).toBe('bytes 3-6/10');expect(await range.text()).toBe('3456');const changed=await SELF.fetch('http://localhost:8787/api/downloads/windows-test',{headers:{Cookie:u.cookie,Range:'bytes=3-6','If-Range':'\"old-build\"'}});expect(changed.status).toBe(200);expect(await changed.text()).toBe('0123456789');const invalid=await SELF.fetch('http://localhost:8787/api/downloads/windows-test',{headers:{Cookie:u.cookie,Range:'bytes=100-'}});expect(invalid.status).toBe(416);});
});

describe('Multiple computer delivery',()=>{
 it('lists open receivers only for members and keeps deliveries independent',async()=>{await env.DB.prepare("DELETE FROM rate_limits WHERE key LIKE 'pair:%'").run();const a=await station(),b=await station();expect((await call('/receivers')).status).toBe(401);const list=await(await call('/receivers','GET',undefined,a.u.cookie)).json() as {id:string}[];expect(list.map(x=>x.id)).toContain(a.d.id);expect(list.map(x=>x.id)).not.toContain(b.d.id);expect((await call('/receive/device:'+a.d.id)).status).toBe(401);for(const target of [a,b]){const c=await(await call('/connections/device:'+target.d.id,'POST',{},a.u.cookie)).json() as {connection:{id:string;status:string}};if(c.connection.status==='pending')expect((await call('/station/connections/'+c.connection.id+'/decision','POST',{status:'approved'},undefined,target.d.credential)).status).toBe(200);const response=await SELF.fetch('http://localhost:8787/api/receive/device:'+target.d.id,{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:a.u.cookie,'X-Filename':'song.txt','Content-Length':'5'},body:'hello'});expect(response.status).toBe(201);}const rows=await env.DB.prepare('SELECT device_id,object_key FROM transfers WHERE device_id IN (?,?)').bind(a.d.id,b.d.id).all<{device_id:string;object_key:string}>();expect(rows.results).toHaveLength(2);expect(new Set(rows.results.map(x=>x.object_key)).size).toBe(2);await call('/station/receiver','DELETE',{},undefined,b.d.credential);expect((await call('/receive/device:'+b.d.id,'GET',undefined,a.u.cookie)).status).toBe(410);expect((await call('/receive/device:'+a.d.id,'GET',undefined,a.u.cookie)).status).toBe(200);});
 it('allows same-origin camera access without microphone access',async()=>{const response=await call('/health');expect(response.headers.get('Permissions-Policy')).toBe('camera=(self), microphone=(), geolocation=()');});
});

describe('Computer-specific approval',()=>{
 it('routes approval to an admin on the same computer, with operator fallback when none is present',async()=>{await env.DB.prepare("DELETE FROM rate_limits WHERE key LIKE 'pair:%'").run();const pc=await station(),other=await station(),member=await fixture('pending'),a=await fixture('active','admin');const pending=await(await call('/connections/device:'+pc.d.id,'POST',{},member.cookie)).json() as {connection:{id:string;status:string}};expect(pending.connection.status).toBe('pending');expect((await call('/receive/device:'+pc.d.id,'POST',{},member.cookie)).status).toBe(403);expect((await call('/connections/'+pending.connection.id+'/decision','POST',{status:'approved'},a.cookie)).status).toBe(403);expect((await call('/connections/device:'+pc.d.id,'POST',{},a.cookie)).status).toBe(200);expect((await call('/station/connections/'+pending.connection.id+'/decision','POST',{status:'approved'},undefined,pc.d.credential)).status).toBe(403);expect((await call('/station/connections/'+pending.connection.id+'/decision','POST',{status:'approved'},undefined,other.d.credential)).status).toBe(403);expect((await call('/connections/pending','GET',undefined,a.cookie)).status).toBe(200);expect((await call('/connections/'+pending.connection.id+'/decision','POST',{status:'approved'},a.cookie)).status).toBe(200);const info=await(await call('/receive/device:'+pc.d.id,'GET',undefined,member.cookie)).json() as {connection:{status:string}};expect(info.connection.status).toBe('approved');
 const again=await fixture('pending');const waiting=await(await call('/connections/device:'+pc.d.id,'POST',{},again.cookie)).json() as {connection:{id:string}};await env.DB.prepare('UPDATE computer_connections SET last_seen=? WHERE user_id=?').bind(now()-46,a.id).run();expect((await call('/station/connections/'+waiting.connection.id+'/decision','POST',{status:'approved'},undefined,pc.d.credential)).status).toBe(200);
 const next=await(await call('/station/receiver','POST',{},undefined,pc.d.credential)).json() as {token:string};const fresh=await(await call('/connections/'+next.token,'POST',{},member.cookie)).json() as {connection:{id:string;status:string}};expect(fresh.connection.status).toBe('approved');expect((await call('/station/connections/'+fresh.connection.id+'/decision','POST',{status:'denied'},undefined,pc.d.credential)).status).toBe(410);
 });
});
describe('Atomic connection decisions',()=>{
 it('applies competing decisions once and records exactly one audit',async()=>{await env.DB.prepare("DELETE FROM rate_limits WHERE key LIKE 'pair:%'").run();const pc=await station(),member=await fixture();const requested=await(await call('/connections/device:'+pc.d.id,'POST',{},member.cookie)).json() as {connection:{id:string}};const id=requested.connection.id;const results=await Promise.all(['approved','denied'].map(status=>call('/station/connections/'+id+'/decision','POST',{status},undefined,pc.d.credential)));expect(results.filter(r=>r.status===200)).toHaveLength(1);expect(results.filter(r=>[409,410].includes(r.status))).toHaveLength(1);const logs=await env.DB.prepare('SELECT action FROM audit WHERE subject_id=?').bind(id).all();expect(logs.results).toHaveLength(1);});
});
describe('Sending before team membership approval',()=>{
 it('lets a newly registered member send only after the correct computer approver allows access',async()=>{await env.DB.prepare("DELETE FROM rate_limits WHERE key LIKE 'pair:%'").run();const pc=await station(),pending=await fixture('pending'),a=await fixture('active','admin');expect((await call('/devices','GET',undefined,pending.cookie)).status).toBe(200);expect((await call('/receivers','GET',undefined,pending.cookie)).status).toBe(200);expect((await call('/members','GET',undefined,pending.cookie)).status).toBe(403);const request=await(await call('/connections/device:'+pc.d.id,'POST',{},pending.cookie)).json() as {connection:{id:string;status:string}};expect(request.connection.status).toBe('pending');const send=()=>SELF.fetch('http://localhost:8787/api/receive/device:'+pc.d.id,{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:pending.cookie,'X-Filename':'song.txt','Content-Length':'5'},body:'hello'});expect((await send()).status).toBe(403);expect((await call('/station/connections/'+request.connection.id+'/decision','POST',{status:'approved'},undefined,pc.d.credential)).status).toBe(200);expect((await send()).status).toBe(201);expect((await env.DB.prepare('SELECT status FROM users WHERE id=?').bind(pending.id).first())?.status).toBe('pending');
 const next=await(await call('/station/receiver','POST',{},undefined,pc.d.credential)).json() as {token:string};await call('/connections/'+next.token,'POST',{},a.cookie);const second=await(await call('/connections/'+next.token,'POST',{},pending.cookie)).json() as {connection:{id:string}};expect((await call('/station/connections/'+second.connection.id+'/decision','POST',{status:'approved'},undefined,pc.d.credential)).status).toBe(410);expect((await call('/receive/device:'+pc.d.id,'GET',undefined,pending.cookie)).status).toBe(200);expect((await send()).status).toBe(201);expect((await call('/members','GET',undefined,pending.cookie)).status).toBe(403);
 });
});

describe('Uploads invalidated after cloud storage',()=>{
 it('removes stored bytes when permission or receiver state changes before queueing',async()=>{
 for(const change of ['removed','denied','closed','commenter']){
  await env.DB.prepare("DELETE FROM rate_limits WHERE key LIKE 'pair:%'").run();const pc=await station(),sender=await fixture('pending');const requested=await(await call('/connections/'+pc.receiver.token,'POST',{},sender.cookie)).json() as {connection:{id:string}};await call('/station/connections/'+requested.connection.id+'/decision','POST',{status:'approved'},undefined,pc.d.credential);
  let key='';const files=new Proxy(env.FILES,{get(target,property){if(property==='put')return async(...args:Parameters<R2Bucket['put']>)=>{key=String(args[0]);const result=await target.put(...args);if(change==='removed')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(sender.id).run();else if(change==='commenter')await env.DB.prepare("INSERT INTO user_ministry_roles VALUES(?,'commenter',NULL,?)").bind(sender.id,now()).run();else if(change==='denied')await env.DB.prepare("UPDATE computer_connections SET status='denied' WHERE id=?").bind(requested.connection.id).run();else await env.DB.prepare('UPDATE receivers SET closed_at=? WHERE id=?').bind(now(),pc.receiver.id).run();return result;};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const response=await worker.fetch(new Request('http://localhost:8787/api/receive/'+pc.receiver.token,{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:sender.cookie,'Content-Length':'5','X-Filename':'song.txt'},body:'hello'}),{...env,FILES:files},createExecutionContext());expect([401,403,410]).toContain(response.status);expect(key).toMatch(/^transfers\//);expect(await env.FILES.get(key)).toBeNull();expect(await env.DB.prepare('SELECT id FROM transfers WHERE object_key=?').bind(key).first()).toBeNull();
 }
 });
});

describe('Scheduled cleanup recovery',()=>{
 it('continues after a storage deletion fails and retains the failed transfer for retry',async()=>{
  const pc=await station();const first=await(await upload(pc.receiver.token,'first.txt')).json() as {id:string};const second=await(await upload(pc.receiver.token,'second.txt')).json() as {id:string};
  await env.DB.prepare('UPDATE transfers SET expires_at=? WHERE id IN (?,?)').bind(now()-1,first.id,second.id).run();
  await env.DB.prepare('INSERT INTO rate_limits VALUES(?,?,?)').bind('expired-cleanup-test',1,now()-1).run();
  let failedKey='';const files=new Proxy(env.FILES,{get(target,property){if(property==='delete')return async(key:string|string[])=>{if((Array.isArray(key)?key:[key]).includes('transfers/'+first.id)){failedKey='transfers/'+first.id;throw new Error('Simulated storage outage');}return target.delete(key);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  await expect(worker.scheduled(createScheduledController(),{...env,FILES:files})).rejects.toThrow('cleanup needs retry: 1');
  const remaining=await env.DB.prepare('SELECT id,object_key FROM transfers WHERE id IN (?,?)').bind(first.id,second.id).all<{id:string;object_key:string}>();expect(remaining.results).toHaveLength(1);expect(remaining.results[0].object_key).toBe(failedKey);expect(await env.FILES.head(failedKey)).not.toBeNull();
  const otherKey='transfers/'+(remaining.results[0].id===first.id?second.id:first.id);expect(await env.FILES.head(otherKey)).toBeNull();expect(await env.DB.prepare('SELECT key FROM rate_limits WHERE key=?').bind('expired-cleanup-test').first()).toBeNull();
  await worker.scheduled(createScheduledController(),env);expect(await env.FILES.head(failedKey)).toBeNull();expect(await env.DB.prepare('SELECT id FROM transfers WHERE id IN (?,?)').bind(first.id,second.id).first()).toBeNull();
 });
});

describe('Computer management',()=>{
 it('requires a local administrator to rename and retains legacy administrator revocation until scoped rollout',async()=>{
  const pc=await station(),outsider=await fixture(),administrator=await fixture('active','admin');
  expect((await call('/devices/'+pc.d.id,'PATCH',{name:'Other'},outsider.cookie)).status).toBe(403);
  expect((await call('/devices/'+pc.d.id,'DELETE',undefined,outsider.cookie)).status).toBe(403);
  expect((await call('/devices/'+pc.d.id,'PATCH',{name:'  Choir PC  '},pc.u.cookie)).status).toBe(200);
  expect((await call('/devices/'+pc.d.id,'PATCH',{name:'Other PC'},administrator.cookie)).status).toBe(403);
  await env.DB.prepare("INSERT INTO station_memberships(device_id,user_id,status,updated_at,role) VALUES(?,?,'approved',?,'admin')").bind(pc.d.id,administrator.id,now()).run();
  expect((await call('/devices/'+pc.d.id,'PATCH',{name:'  Choir PC  '},administrator.cookie)).status).toBe(200);
  expect((await env.DB.prepare('SELECT name FROM devices WHERE id=?').bind(pc.d.id).first())?.name).toBe('Choir PC');
  expect((await call('/devices/'+pc.d.id,'PATCH',{name:' '},administrator.cookie)).status).toBe(400);
  expect((await call('/devices/'+pc.d.id,'PATCH',{name:'Sanctuary'},administrator.cookie)).status).toBe(200);
  expect((await call('/devices/'+pc.d.id,'DELETE',undefined,administrator.cookie)).status).toBe(200);
  const list=await(await call('/devices','GET',undefined,administrator.cookie)).json() as {id:string}[];
  expect(list.some(d=>d.id===pc.d.id)).toBe(false);
  expect((await call('/station/state','GET',undefined,undefined,pc.d.credential)).status).toBe(401);
  expect((await env.DB.prepare('SELECT closed_at FROM receivers WHERE id=?').bind(pc.receiver.id).first())?.closed_at).toBeTruthy();
 });
 it('lets a paired station rename and remove itself but cannot target another device',async()=>{
  const pc=await station(),other=await station();
  expect((await call('/station/device','PATCH',{name:'Blocked'},undefined,pc.d.credential)).status).toBe(403);
  const administrator=await fixture('active','admin');operatorProofs.set(pc.d.credential,await unlockAdmin(pc.d.id,pc.d.credential,administrator.id));
  expect((await call('/station/device','PATCH',{name:'Stage PC'},undefined,pc.d.credential)).status).toBe(200);
  expect((await env.DB.prepare('SELECT name FROM devices WHERE id=?').bind(pc.d.id).first())?.name).toBe('Stage PC');
  expect((await call('/station/device','PATCH',{name:'x'.repeat(61)},undefined,pc.d.credential)).status).toBe(400);
  expect((await call('/station/device','DELETE',undefined,undefined,pc.d.credential)).status).toBe(200);
  expect((await call('/station/device','PATCH',{name:'No'},undefined,pc.d.credential)).status).toBe(401);
  expect((await call('/station/state','GET',undefined,undefined,other.d.credential)).status).toBe(200);
 });
});
it('removes website verse numbers and section labels anywhere without dropping lyric words',()=>{
 expect(splitLyrics('1. Joy to the world\nThe Lord is come\nR:\nLet earth receive her King\nBridge\n2) He rules the world\nR: And makes the nations prove\n10000 reasons to sing',4).map(s=>s.text).join('\n')).toBe('Joy to the world\nThe Lord is come\nLet earth receive her King\nHe rules the world\nAnd makes the nations prove\n10000 reasons to sing');
});

it('allows active members without approval inside the service window, blocks outside it, and lets admins send anytime',async()=>{
 const pc=await station(),member=await fixture();
 const send=(cookie:string)=>SELF.fetch('http://localhost:8787/api/receive/device:'+pc.d.id,{method:'POST',headers:{Origin:'http://localhost:8787',Cookie:cookie,'X-Filename':'song.txt','Content-Length':'5'},body:'hello'});
 expect((await send(member.cookie)).status).toBe(201);
 for(const time of ['2026-10-11T09:00:00-07:00','2026-10-11T13:59:59-07:00']){vi.setSystemTime(new Date(time));await env.DB.prepare('UPDATE sessions SET expires_at=?').bind(now()+86400).run();await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now(),pc.d.id).run();await env.DB.prepare('UPDATE receivers SET expires_at=? WHERE device_id=?').bind(now()+300,pc.d.id).run();expect((await send(member.cookie)).status).toBe(201);}
 vi.setSystemTime(new Date('2026-10-12T12:00:00-07:00'));await env.DB.prepare('UPDATE sessions SET expires_at=?').bind(now()+86400).run();await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now(),pc.d.id).run();await env.DB.prepare('UPDATE receivers SET expires_at=? WHERE device_id=?').bind(now()+300,pc.d.id).run();
 expect((await send(member.cookie)).status).toBe(403);const a=await fixture('active','admin');expect((await send(a.cookie)).status).toBe(201);
});
it('rejects wrong PINs without locking out a correct PIN or granting admin from profile selection alone',async()=>{
 const pc=await station(),a=await fixture('active','admin');
 const {pinDigest}=await import('../src/server/operator-auth');const salt=token();await env.DB.prepare('INSERT INTO account_pins VALUES(?,?,?)').bind(a.id,salt,await pinDigest('7392',salt)).run();
 await env.DB.batch(['operator-pin-v2:'+a.id,'operator-pin-device-v2:'+pc.d.id].map(key=>env.DB.prepare('INSERT INTO rate_limits VALUES(?,?,?)').bind(key,999,now()+900)));
 for(let i=0;i<12;i++)expect((await call('/station/operator','POST',{userId:a.id,pin:'1111'},undefined,pc.d.credential)).status).toBe(401);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM operator_sessions WHERE device_id=?').bind(pc.d.id).first())?.n).toBe(0);
 expect((await call('/station/operator','POST',{userId:a.id,pin:'7392'},undefined,pc.d.credential)).status).toBe(200);
 expect((await call('/me/station-pin/options','POST',{},pc.u.cookie)).status).toBe(403);
});
it('revokes an operator proof after demotion and prevents its use on another computer',async()=>{
 const pc=await station(),other=await station(),a=await fixture('active','admin');const proof=await unlockAdmin(pc.d.id,pc.d.credential,a.id);operatorProofs.set(other.d.credential,proof);
 expect((await call('/station/device','PATCH',{name:'Not allowed'},undefined,other.d.credential)).status).toBe(403);
 operatorProofs.set(pc.d.credential,proof);await env.DB.prepare("UPDATE users SET role='member' WHERE id=?").bind(a.id).run();
 expect((await call('/station/enrollment-code','GET',undefined,undefined,pc.d.credential)).status).toBe(403);
});
it('dismisses a rejection durably for its sender without hiding the record or allowing another account to dismiss it',async()=>{
 const pc=await station(),other=await fixture('active','admin');const uploaded=await(await upload(pc.receiver.token)).json() as {id:string};
 expect((await call('/transfers/'+uploaded.id+'/dismiss','POST',{},pc.u.cookie)).status).toBe(409);
 expect((await call('/station/transfers/'+uploaded.id+'/reject','POST',{reason:'Wrong song'},undefined,pc.d.credential)).status).toBe(200);
 expect((await call('/transfers/'+uploaded.id+'/dismiss','POST',{},other.cookie)).status).toBe(404);
 expect((await call('/transfers/'+uploaded.id+'/dismiss','POST',{},pc.u.cookie)).status).toBe(200);
 expect((await call('/transfers/'+uploaded.id+'/dismiss','POST',{},pc.u.cookie)).status).toBe(200);
 const fresh=token();await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(fresh),pc.u.id,now()+1000).run();
 const records=await(await call('/transfers','GET',undefined,'stati_session='+fresh)).json() as {id:string;dismissed_at:number;status:string;rejection_reason:string}[];const record=records.find(r=>r.id===uploaded.id)!;
 expect(record.dismissed_at).toBe(now());expect(record.status).toBe('rejected');expect(record.rejection_reason).toBe('Wrong song');
 await env.DB.prepare('DELETE FROM delivery_records WHERE id=?').bind(uploaded.id).run();expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM delivery_dismissals WHERE transfer_id=?').bind(uploaded.id).first())?.n).toBe(0);
});

 it('hides unconnected, pending and denied computers from member device and receiver lists',async()=>{
  const pc=await station(),member=await fixture(),pending=await fixture('pending'),adminUser=await fixture('active','admin');
  async function listed(cookie:string,path:string){return await(await call(path,'GET',undefined,cookie)).json() as {id:string}[];}
  for(const path of ['/devices','/receivers']){
   expect((await listed(member.cookie,path)).some(d=>d.id===pc.d.id)).toBe(false);
   expect((await listed(pending.cookie,path)).some(d=>d.id===pc.d.id)).toBe(false);
   expect((await listed(adminUser.cookie,path)).some(d=>d.id===pc.d.id)).toBe(true);
  }
  const connection=await(await call('/connections/device:'+pc.d.id,'POST',{},pending.cookie)).json() as {connection:{id:string}};
  expect((await listed(pending.cookie,'/devices')).some(d=>d.id===pc.d.id)).toBe(false);
  await call('/station/connections/'+connection.connection.id+'/decision','POST',{status:'approved'},undefined,pc.d.credential);
  for(const path of ['/devices','/receivers'])expect((await listed(pending.cookie,path)).some(d=>d.id===pc.d.id)).toBe(true);
  await env.DB.prepare("UPDATE station_memberships SET status='denied' WHERE user_id=? AND device_id=?").bind(pending.id,pc.d.id).run();
  for(const path of ['/devices','/receivers'])expect((await listed(pending.cookie,path)).some(d=>d.id===pc.d.id)).toBe(false);
 });

it('allows repeated successful administrator PIN unlocks without consuming the guessing limit',async()=>{
 const pc=await station(),a=await fixture('active','admin');const {pinDigest}=await import('../src/server/operator-auth');const salt=token();await env.DB.prepare('INSERT INTO account_pins VALUES(?,?,?)').bind(a.id,salt,await pinDigest('7392',salt)).run();
 for(let i=0;i<7;i++)expect((await call('/station/operator','POST',{userId:a.id,pin:'7392'},undefined,pc.d.credential)).status).toBe(200);
 expect((await call('/station/operator','POST',{userId:a.id,pin:'1111'},undefined,pc.d.credential)).status).toBe(401);
 expect((await call('/station/operator','POST',{userId:a.id,pin:'7392'},undefined,pc.d.credential)).status).toBe(200);
});
it('acknowledges saved-file alerts only for the sender and keeps delivery history',async()=>{
 const pc=await station(),other=await fixture('active','admin');const uploaded=await(await upload(pc.receiver.token)).json() as {id:string};
 await env.DB.prepare("UPDATE delivery_records SET status='delivered',updated_at=? WHERE id=?").bind(now(),uploaded.id).run();
 expect((await call('/transfers/'+uploaded.id+'/dismiss','POST',{},other.cookie)).status).toBe(404);
 expect((await call('/transfers/'+uploaded.id+'/dismiss','POST',{},pc.u.cookie)).status).toBe(200);
 expect((await call('/transfers/'+uploaded.id+'/dismiss','POST',{},pc.u.cookie)).status).toBe(200);
 const records=await(await call('/transfers','GET',undefined,pc.u.cookie)).json() as {id:string;status:string;dismissed_at:number}[];
 expect(records.find(f=>f.id===uploaded.id)).toMatchObject({status:'delivered',dismissed_at:now()});
});
