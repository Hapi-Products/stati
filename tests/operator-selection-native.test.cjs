const {test}=require('node:test'),assert=require('node:assert/strict');
const {PROTOCOL,createOperatorSelection}=require('../desktop/operator-selection.cjs');
const device='11111111-1111-4111-8111-111111111111',one='22222222-2222-4222-8222-222222222222',two='33333333-3333-4333-8333-333333333333';
const lease='a'.repeat(43),otherLease='b'.repeat(43),proof='c'.repeat(43),phone='d'.repeat(43),serverNow=1900000000;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){
 let value=0,id=0;const tasks=new Map();
 const timers={setTimeout(callback,delay){const key=++id;tasks.set(key,{callback,at:value+delay});return key;},clearTimeout(key){tasks.delete(key);}};
 async function advance(milliseconds){
  const target=value+milliseconds;
  while(true){await flush();const next=[...tasks.entries()].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next||next[1].at>target)break;value=next[1].at;tasks.delete(next[0]);next[1].callback();}
  value=target;await flush();
 }
 return{now:()=>value,timers,advance,jump:milliseconds=>{value+=milliseconds;},pending:()=>tasks.size};
}
const active=(userId=one,overrides={})=>({protocol:PROTOCOL,lease,userId,expiresAt:serverNow+45,ttlSeconds:45,active:true,...overrides});
const pending=(userId=one,overrides={})=>({protocol:PROTOCOL,lease,userId,expiresAt:serverNow+300,ttlSeconds:300,active:false,token:phone,...overrides});
function fixture(overrides={}){
 const time=clock(),calls=[],resets=[],events=[];let permitted=true;
 const selection=createOperatorSelection({now:time.now,timers:time.timers,renew:async value=>{calls.push(value);return{active:true,userId:value.userId,expiresAt:serverNow+Math.floor(time.now()/1000)+45,ttlSeconds:45};},reset:async value=>resets.push(value),canUse:()=>permitted,onInvalidated:value=>events.push(value),...overrides});
 const begin=(userId=one,role='member',generation=1,credential='paired-device-one')=>selection.begin({deviceId:device,credential,userId,role,generation});
 return{time,selection,calls,resets,events,begin,deny:()=>{permitted=false;},allow:()=>{permitted=true;}};
}

test('only a protocol-bound explicit member selection receives authority and renews captured credentials',async()=>{
 const f=fixture(),ticket=f.begin();assert.equal(f.selection.privateAuthority(),null);assert.equal(f.selection.activate(ticket,active()),true);
 assert.equal(f.selection.privateAuthority({userId:one,generation:1,deviceId:device}).lease,lease);
 assert.equal(f.selection.privateAuthority({userId:two}),null);assert.equal(f.selection.privateAuthority({generation:2}),null);
 await f.time.advance(9999);assert.equal(f.calls.length,0);await f.time.advance(1);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].credential,'paired-device-one');assert.equal(f.calls[0].lease,lease);assert.equal(f.calls[0].proof,null);assert.equal(f.calls[0].userId,one);
 assert.equal(f.selection.status().expiresInMs,45000);f.selection.dispose();await flush();
});
test('missing server capability never falls back to old device-only authority',async()=>{
 const f=fixture(),ticket=f.begin();assert.equal(f.selection.activate(ticket,{ok:true}),false);assert.equal(f.selection.privateAuthority(),null);
 await f.time.advance(60000);assert.equal(f.calls.length,0);assert.equal(f.events[0].reason,'invalid-response');
});
test('active authority ends at the request-start deadline even after a delayed response and clock skew',async()=>{
 const f=fixture(),ticket=f.begin();await f.time.advance(30000);
 assert.equal(f.selection.activate(ticket,active()),true);assert.equal(f.selection.status().expiresInMs,15000);
 const offline=Error('Offline');const g=fixture({renew:async()=>{throw offline;}}),second=g.begin();await g.time.advance(30000);assert.equal(g.selection.activate(second,active()),true);
 await g.time.advance(15000);assert.equal(g.selection.privateAuthority(),null);assert.equal(g.events[0].reason,'expired');f.selection.dispose();
});
test('administrator proof is separate, required, and never granted to a member response',()=>{
 const f=fixture(),admin=f.begin(one,'admin');assert.equal(f.selection.activate(admin,active()),false);assert.equal(f.selection.privateAuthority(),null);
 const second=f.begin(one,'admin',2);assert.equal(f.selection.activate(second,active(one,{proof,proofExpiresAt:serverNow+8*3600})),true);assert.equal(f.selection.privateAuthority().proof,proof);
 const member=f.begin(two,'member',3);assert.equal(f.selection.activate(member,active(two,{proof,proofExpiresAt:serverNow+8*3600})),false);assert.equal(f.selection.privateAuthority(),null);f.selection.dispose();
});
test('renewal preserves the original administrator proof and cannot extend its authentication deadline',async()=>{
 const f=fixture(),ticket=f.begin(one,'admin');assert.equal(f.selection.activate(ticket,active(one,{proof,proofExpiresAt:serverNow+60})),true);
 await f.time.advance(50000);assert.equal(f.calls.length,5);assert.ok(f.calls.every(value=>value.proof===proof&&value.proofExpiresAt===serverNow+60));assert.equal(f.selection.status().expiresInMs,10000);
 await f.time.advance(10000);assert.equal(f.selection.privateAuthority(),null);assert.equal(f.events[0].reason,'expired');
});
test('late PIN issuance resets only the captured old selection and never replaces a newer profile',async()=>{
 const f=fixture(),old=f.begin(one,'admin',1,'old-credential'),next=f.begin(two,'member',2,'new-credential');
 assert.equal(f.selection.activate(next,active(two,{lease:otherLease})),true);
 assert.equal(f.selection.activate(old,active(one,{proof,proofExpiresAt:serverNow+8*3600})),false);await flush();
 assert.equal(f.selection.privateAuthority().userId,two);assert.equal(f.selection.privateAuthority().credential,'new-credential');
 assert.equal(f.resets.length,1);assert.equal(f.resets[0].lease,lease);assert.equal(f.resets[0].credential,'old-credential');assert.equal(f.resets[0].userId,one);f.selection.dispose();
});
test('phone polling binds the exact public token to its pending private selection',async()=>{
 const f=fixture(),ticket=f.begin(one,'admin');assert.equal(f.selection.bindPending(ticket,pending()),true);assert.equal(f.selection.privateAuthority(),null);
 assert.equal(f.selection.pendingRequest(ticket,'e'.repeat(43)),null);const request=f.selection.pendingRequest(ticket,phone);
 assert.equal(request.lease,lease);assert.equal(request.token,phone);assert.equal(request.userId,one);assert.equal(request.proof,null);
 await f.time.advance(20000);assert.equal(f.calls.length,0);const poll=f.selection.pendingRequest(ticket,phone);
 assert.equal(f.selection.activate(ticket,active(one,{proof,proofExpiresAt:serverNow+8*3600}),{token:phone,startedAt:poll.startedAt}),true);
 assert.equal(f.selection.privateAuthority().proof,proof);assert.equal(f.selection.pendingRequest(ticket,phone),null);f.selection.dispose();
});
test('a newer choice invalidates an old phone token and a late approval cannot overwrite it',async()=>{
 const f=fixture(),old=f.begin(one,'admin');f.selection.bindPending(old,pending());const next=f.begin(two,'member',2,'new-credential');f.selection.activate(next,active(two,{lease:otherLease}));
 assert.equal(f.selection.pendingRequest(old,phone),null);
 assert.equal(f.selection.activate(old,active(one,{proof,proofExpiresAt:serverNow+8*3600}),{token:phone,startedAt:0}),false);await flush();
 assert.equal(f.selection.privateAuthority().userId,two);assert.ok(f.resets.every(value=>value.lease===lease));f.selection.dispose();
});
test('pending phone authority expires after its bounded ceremony deadline and does not renew',async()=>{
 const f=fixture(),ticket=f.begin(one,'admin');f.selection.bindPending(ticket,pending());await f.time.advance(300000);
 assert.equal(f.selection.status().phase,'none');assert.equal(f.selection.pendingRequest(ticket,phone),null);assert.equal(f.calls.length,0);assert.equal(f.events[0].reason,'expired');
});
test('a phone result must retain its original private lease and exact public token',()=>{
 for(const overrides of [{lease:otherLease},{token:'e'.repeat(43)}]){
  const f=fixture(),ticket=f.begin(one,'admin');f.selection.bindPending(ticket,pending());
  assert.equal(f.selection.activate(ticket,active(one,{proof,proofExpiresAt:serverNow+8*3600,...(overrides.lease?{lease:overrides.lease}:{})}),{token:overrides.token||phone,startedAt:0}),false);assert.equal(f.selection.privateAuthority(),null);f.selection.dispose();
 }
});
test('lock, suspend, switch, skip, quit and pairing replacement clear active authority synchronously',async()=>{
 for(const reason of ['lock','suspend','switch','skip','quit','pair-replacement']){
  const f=fixture(),ticket=f.begin();f.selection.activate(ticket,active());f.selection.clear(reason);
  assert.equal(f.selection.privateAuthority(),null,reason);await f.time.advance(60000);assert.equal(f.calls.length,0,reason);assert.equal(f.resets.length,1,reason);assert.equal(f.events.length,0,'explicit lifecycle owner already handles identity UI');
 }
});
test('normal hiding needs no state change and does not stop a deliberately selected service operator',async()=>{
 const f=fixture(),ticket=f.begin();f.selection.activate(ticket,active());await f.time.advance(100000);
 assert.equal(f.calls.length,10);assert.equal(f.selection.status().phase,'active');assert.equal(f.events.length,0);f.selection.dispose();
});
test('privacy/OS usability rejection prevents renewal even if the lifecycle caller missed clear',async()=>{
 const f=fixture(),ticket=f.begin();f.selection.activate(ticket,active());f.deny();await f.time.advance(10000);
 assert.equal(f.calls.length,0);assert.equal(f.selection.privateAuthority(),null);assert.equal(f.events[0].reason,'unavailable');
});
test('slow renewal jobs coalesce, abort when bounded and do not apply late results',async()=>{
 const first=deferred(),calls=[];const f=fixture({renew:value=>{calls.push(value);return first.promise;}}),ticket=f.begin();f.selection.activate(ticket,active());
 const a=f.selection.renewNow(),b=f.selection.renewNow();assert.equal(a,b);await flush();assert.equal(calls.length,1);
 await f.time.advance(8000);assert.equal(await a,false);assert.equal(calls[0].signal.aborted,true);assert.equal(f.selection.status().expiresInMs,37000);
 first.resolve({active:true,userId:one,expiresAt:serverNow+45,ttlSeconds:45});await flush();assert.equal(f.selection.status().expiresInMs,37000,'a cancelled late result cannot extend authority');
 f.selection.dispose();
});
test('switch aborts a renewal and its delayed response cannot clear or extend a newer profile',async()=>{
 const slow=deferred(),calls=[];const f=fixture({renew:value=>{calls.push(value);return slow.promise;}}),old=f.begin();f.selection.activate(old,active());const job=f.selection.renewNow();await flush();
 const next=f.begin(two,'member',2,'new-credential');f.selection.activate(next,active(two,{lease:otherLease}));assert.equal(calls[0].signal.aborted,true);
 slow.resolve({active:false,userId:one});assert.equal(await job,false);assert.equal(f.selection.privateAuthority().userId,two);assert.equal(f.selection.privateAuthority().lease,otherLease);f.selection.dispose();
});
test('network loss never extends authority and expiry emits only one identity event',async()=>{
 const f=fixture({renew:async()=>{throw Error('Offline');}}),ticket=f.begin();f.selection.activate(ticket,active());
 await f.time.advance(48000);
 assert.equal(f.selection.privateAuthority(),null);assert.equal(f.events.length,1);assert.equal(f.events[0].reason,'expired');
 await f.time.advance(60000);assert.equal(f.events.length,1,'expiry is not an authority recovery loop');
});
test('terminal renewal rejection clears authority immediately and redacted events contain no secrets',async()=>{
 const failure=Error('Access changed');failure.status=403;const f=fixture({renew:async()=>{throw failure;}}),ticket=f.begin(one,'admin');f.selection.activate(ticket,active(one,{proof,proofExpiresAt:serverNow+8*3600}));
 assert.equal(await f.selection.renewNow(),false);assert.equal(f.selection.privateAuthority(),null);assert.equal(f.events[0].reason,'rejected');
 const publicJSON=JSON.stringify({events:f.events,state:f.selection.status(),ticket});for(const secret of [lease,proof,'paired-device-one'])assert.equal(publicJSON.includes(secret),false);
});
test('renewal cannot replace credentials, user or proof and a cleared selection cannot be revived',async()=>{
 for(const extra of [{userId:two},{lease:otherLease},{proof},{proofExpiresAt:serverNow+10*3600}]){
  const f=fixture({renew:async()=>({active:true,userId:one,expiresAt:serverNow+45,ttlSeconds:45,...extra})}),ticket=f.begin();f.selection.activate(ticket,active());assert.equal(await f.selection.renewNow(),false);assert.equal(f.selection.privateAuthority(),null);assert.equal(f.events[0].reason,'invalid-response');
  assert.equal(await f.selection.renewNow(),false);
 }
});
test('a delayed old reset uses captured credentials even when a replacement pairing is active',async()=>{
 const slow=deferred(),resets=[];const f=fixture({reset:value=>{resets.push(value);return slow.promise;}}),old=f.begin(one,'member',1,'old-device-credential');f.selection.activate(old,active());f.selection.clear('pair-replacement');
 const next=f.begin(two,'member',2,'replacement-device-credential');f.selection.activate(next,active(two,{lease:otherLease}));await flush();assert.equal(resets[0].credential,'old-device-credential');assert.equal(resets[0].lease,lease);
 slow.resolve({ok:true});await flush();assert.equal(f.selection.privateAuthority().credential,'replacement-device-credential');assert.equal(f.selection.privateAuthority().userId,two);f.selection.dispose();
});
test('synchronous access check enforces expiry after a delayed native timer or resumed event loop',()=>{
 const f=fixture(),ticket=f.begin();f.selection.activate(ticket,active());f.time.jump(45000);
 assert.equal(f.selection.privateAuthority(),null);assert.equal(f.events[0].reason,'expired');assert.equal(f.selection.status().phase,'none');
});


test('named ministry selection requires a phone proof without changing its base member role',async()=>{
 const f=fixture(),start=()=>f.selection.begin({deviceId:device,credential:'paired-device-one',userId:one,role:'member',requiresUnlock:true,generation:1});
 let ticket=start();assert.equal(f.selection.activate(ticket,active()),false);assert.equal(f.selection.privateAuthority(),null);
 ticket=start();assert.equal(f.selection.bindPending(ticket,pending()),true);
 assert.equal(f.selection.activate(ticket,active(one,{proof,proofExpiresAt:serverNow+8*3600}),{token:phone}),true);
 assert.equal(f.selection.privateAuthority().proof,proof);assert.equal(f.selection.privateAuthority().userId,one);assert.equal(f.selection.status().phase,'active');f.selection.dispose();await flush();
});
