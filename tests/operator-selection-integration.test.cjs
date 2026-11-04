const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
// Reuse the existing actual-main boundary fixture without registering its tests
// a second time. This evaluates current main.cjs, not a second implementation.
const fixturePath=path.resolve(__dirname,'background-receiver.test.cjs'),fixtureSource=fs.readFileSync(fixturePath,'utf8');
const load=vm.runInThisContext('(function(require,__dirname){'+fixtureSource.slice(0,fixtureSource.indexOf('\ntest('))+'\nreturn{fixture,drain,deferred};})',{filename:fixturePath});
const {fixture,drain,deferred}=load(createRequire(fixturePath),path.dirname(fixturePath));
const deviceId='11111111-1111-4111-8111-111111111111',memberId='22222222-2222-4222-8222-222222222222',adminId='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444';
const protocol='stati-operator-v1',proof='p'.repeat(43),publicToken='t'.repeat(43),serverNow=1900000000;
const members=[{id:memberId,role:'member',first_name:'Local',last_initial:'M'},{id:adminId,role:'admin',first_name:'Local',last_initial:'A'}];
function leaseClock(){
 let now=0,serial=0;const pending=new Map(),timers={setTimeout(fn,delay){const id=++serial;pending.set(id,{fn,at:now+delay});return id;},clearTimeout(id){pending.delete(id);}};
 return{now:()=>now,timers,async advance(ms){const target=now+ms;while(true){await drain();const next=[...pending.entries()].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next||next[1].at>target)break;now=next[1].at;pending.delete(next[0]);next[1].fn();}now=target;await drain();}};
}
function serverFixture({route:custom,leaseClock:clock=leaseClock(),capability=protocol,...options}={}){
 let current=null,serial=0;
 function issuance(userId,pending=false){
  const role=members.find(member=>member.id===userId)?.role,lease=String.fromCharCode(97+(serial++%20)).repeat(43),ttl=pending?300:45;
  current={userId,lease,proof:role==='admin'&&!pending?proof:null,pending};
  return{protocol,lease,userId,expiresAt:serverNow+Math.floor(clock.now()/1000)+ttl,ttlSeconds:ttl,active:!pending,...(pending?{token:publicToken,url:'https://stati.ciani01.org/unlock/'+publicToken}:role==='admin'?{proof,proofExpiresAt:serverNow+Math.floor(clock.now()/1000)+8*3600}:{})};
 }
 async function route(call){
  const {endpoint,method,options:request}=call,body=request.body?JSON.parse(request.body):{},headers=request.headers||{};
  const answer=await custom?.({...call,body,headers,current,issuance});if(answer!==undefined)return answer;
  if(endpoint==='/station/state')return Response.json({operatorLeaseProtocol:capability,device:{id:deviceId,operator_id:current&&!current.pending?current.userId:null},members,adminUnlocked:!!current?.proof&&headers['X-Stati-Operator']===current.proof,transfers:[],requests:[],accessRequests:[],accessApprover:'operator'});
  if(endpoint==='/station/operator'&&method==='POST'){
   if(body.userId===null){if(current?.lease===headers['X-Stati-Operator-Lease'])current=null;return Response.json({ok:true});}
   return Response.json(issuance(body.userId));
  }
  if(endpoint==='/station/operator/unlock')return Response.json(issuance(body.userId,true));
  if(endpoint==='/station/operator/unlock/status'){
   if(current?.pending&&headers['X-Stati-Operator-Lease']===current.lease&&body.token===publicToken&&body.userId===current.userId){current={...current,pending:false,proof};return Response.json({protocol,lease:current.lease,userId:current.userId,expiresAt:serverNow+Math.floor(clock.now()/1000)+45,ttlSeconds:45,active:true,approved:true,proof,proofExpiresAt:serverNow+Math.floor(clock.now()/1000)+8*3600});}
   return Response.json({approved:false});
  }
  if(endpoint==='/station/operator/presence')return Response.json({active:true,userId:body.userId,expiresAt:serverNow+Math.floor(clock.now()/1000)+45,ttlSeconds:45});
 }
 const f=fixture({startup:false,mode:'in-app',at:'2026-10-21T02:21:00Z',...options,leaseClock:clock,route});
 return{...f,clock,current:()=>current,async ready(){await f.start();await drain();f.api.setState({privacyUnlocked:true});}};
}
const select=(f,id=memberId)=>f.invoke('operator',undefined,{id,...(id===adminId?{pin:'1234'}:{})});
const decisions=f=>f.http().filter(call=>call[2].includes('/connections/')&&call[2].endsWith('/decision'));

test('actual native main requires a chosen v1 profile before forwarding an approval, including Skip',async()=>{
 const f=serverFixture();await f.ready();await assert.rejects(f.invoke('connection-decision',undefined,{id:requestId,status:'approved'}),/Choose who/);assert.equal(decisions(f).length,0);
 await f.invoke('identity-skip');await assert.rejects(f.invoke('connection-decision',undefined,{id:requestId,status:'approved'}),/Choose who/);assert.equal(decisions(f).length,0);f.api.showMain();
 const result=await select(f);assert.equal(result.ok,true);assert.equal(f.api.getState().activeOperator.id,memberId);await f.invoke('connection-decision',undefined,{id:requestId,status:'approved'});
 const headers=decisions(f)[0][3].headers;assert.equal(headers.Authorization,'Bearer device-fixture');assert.equal(headers['X-Stati-Operator-Protocol'],protocol);assert.equal(headers['X-Stati-Operator-Lease'],f.current().lease);assert.equal(headers['X-Stati-Operator'],undefined);assert.doesNotMatch(JSON.stringify(result),/lease|proof|device-fixture/);
 await f.invoke('operator',undefined,{id:null});assert.equal(f.api.selectionStatus().phase,'none');await assert.rejects(f.invoke('connection-decision',undefined,{id:requestId,status:'denied'}),/Choose who/);
});
test('actual PIN unlock attaches both independent proof and lease and retains authority on normal Windows close',async()=>{
 const f=serverFixture();await f.ready();await select(f,adminId);const current=f.current(),main=f.api.getState().main;
 const event=main.close();assert.equal(event.prevented,true);assert.equal(main.visible,false);await f.clock.advance(10000);
 const pulse=f.http().find(call=>call[2]==='/station/operator/presence');assert.ok(pulse);assert.equal(pulse[3].headers.Authorization,'Bearer device-fixture');assert.equal(pulse[3].headers['X-Stati-Operator-Lease'],current.lease);assert.equal(pulse[3].headers['X-Stati-Operator'],proof);assert.equal(f.api.getState().operatorProof,proof);assert.equal(f.api.getState().activeOperator.id,adminId);
 f.api.showMain();await f.invoke('connection-decision',undefined,{id:requestId,status:'approved'});assert.equal(decisions(f)[0][3].headers['X-Stati-Operator'],proof);await f.invoke('operator',undefined,{id:null});
});
test('actual native main refuses missing protocol without preventing its identity-screen update IPC',async()=>{
 const f=serverFixture({capability:null});await f.ready();await assert.rejects(select(f),/update before choosing/i);assert.equal(f.api.getState().activeOperator,null);assert.equal(f.http().some(call=>call[2]==='/station/operator'&&JSON.parse(call[3].body||'{}').userId),false);
 let checked=0;f.updates.check=async()=>{checked++;return{phase:'available',version:'local-fixture'};};assert.equal((await f.invoke('update-check')).phase,'available');assert.equal(checked,1);assert.equal(f.api.getState().activeOperator,null);
});
test('late actual member and PIN responses are conditionally discarded after Switch User',async()=>{
 for(const id of [memberId,adminId]){
  const started=deferred(),held=deferred();let issued;
  const f=serverFixture({route:async({endpoint,method,body,issuance})=>{if(endpoint==='/station/operator'&&method==='POST'&&body.userId===id){issued=issuance(id);started.resolve();await held.promise;return Response.json(issued);}}});await f.ready();
  const choice=select(f,id),failure=assert.rejects(choice,/profile again|replaced|selected user changed/i);await started.promise;await f.invoke('operator',undefined,{id:null});held.resolve();await failure;await drain();
  assert.equal(f.api.getState().activeOperator,null);assert.equal(f.api.getState().operatorProof,null);assert.equal(f.api.selectionStatus().phase,'none');
  const reset=f.http().find(call=>call[2]==='/station/operator'&&JSON.parse(call[3].body||'{}').userId===null);assert.ok(reset);assert.equal(reset[3].headers['X-Stati-Operator-Lease'],issued.lease);assert.equal(reset[3].headers.Authorization,'Bearer device-fixture');
 }
});
test('actual pending phone cancel rejects a late begin result before any status poll can use it',async()=>{
 const started=deferred(),held=deferred();let issued;
 const f=serverFixture({route:async({endpoint,body,issuance})=>{if(endpoint==='/station/operator/unlock'){issued=issuance(body.userId,true);started.resolve();await held.promise;return Response.json(issued);}}});await f.ready();
 const choice=f.invoke('operator-unlock',undefined,adminId),failure=assert.rejects(choice,/expired|replaced|profile again/i);await started.promise;assert.equal(f.api.selectionStatus().phase,'choosing');await f.invoke('operator-unlock-cancel');held.resolve();await failure;await drain();
 assert.equal(f.api.getState().activeOperator,null);assert.equal(f.api.selectionStatus().phase,'none');const before=f.http().filter(call=>call[2]==='/station/operator/unlock/status').length;
 await assert.rejects(f.invoke('operator-unlock-status',undefined,publicToken),/expired|replaced/);assert.equal(f.http().filter(call=>call[2]==='/station/operator/unlock/status').length,before);
 const reset=f.http().find(call=>call[2]==='/station/operator'&&JSON.parse(call[3].body||'{}').userId===null);assert.equal(reset[3].headers['X-Stati-Operator-Lease'],issued.lease);
});
test('actual phone unlock sends only its public token to the renderer and the private lease stays on native requests',async()=>{
 const f=serverFixture();await f.ready();const begin=await f.invoke('operator-unlock',undefined,adminId),pending=f.current();assert.deepEqual(Object.keys(begin).sort(),['expiresAt','qr','token']);assert.equal(begin.token,publicToken);assert.equal(f.api.getState().activeOperator,null);
 await assert.rejects(f.invoke('operator-unlock-status',undefined,'q'.repeat(43)),/expired|replaced/);assert.equal(f.http().some(call=>call[2]==='/station/operator/unlock/status'),false);
 const result=await f.invoke('operator-unlock-status',undefined,begin.token);assert.equal(result.approved,true);assert.deepEqual(Object.keys(result),['approved']);assert.equal(f.api.getState().activeOperator.id,adminId);
 const status=f.http().find(call=>call[2]==='/station/operator/unlock/status');assert.equal(status[3].headers['X-Stati-Operator-Lease'],pending.lease);assert.equal(status[3].headers['X-Stati-Operator'],undefined);assert.equal(JSON.parse(status[3].body).userId,adminId);assert.equal(f.api.getState().operatorProof,proof);await f.invoke('operator',undefined,{id:null});
});
test('actual PIN and phone Cancel invalidate authority while final station confirmation is pending',async()=>{
 for(const method of ['pin','phone']){
  const started=deferred(),held=deferred();let hold=true;
  const f=serverFixture({route:async({endpoint,current})=>{
   if(endpoint==='/station/state'&&current&&!current.pending&&hold){hold=false;started.resolve();await held.promise;}
  }});await f.ready();
  let choice;
  if(method==='pin')choice=select(f,adminId);
  else{const begin=await f.invoke('operator-unlock',undefined,adminId);choice=f.invoke('operator-unlock-status',undefined,begin.token);}
  const cancelled=assert.rejects(choice,/profile|changed|expired|cancel|Choose/i);await started.promise;
  assert.equal(f.api.selectionStatus().phase,'active',method+' reached the final confirmation boundary');
  await f.invoke('operator-unlock-cancel');const afterCancel=f.api.selectionStatus().phase;
  held.resolve();await cancelled;await drain();assert.equal(afterCancel,'none',method+' Cancel clears an activated choice awaiting confirmation');
  assert.equal(f.api.getState().activeOperator,null,method);assert.equal(f.api.getState().operatorProof,null,method);
  await assert.rejects(f.invoke('connection-decision',undefined,{id:requestId,status:'approved'}),/Choose who/);assert.equal(decisions(f).length,0);
 }
});
test('actual PIN and phone Cancel after activation returns still discard a choice awaiting workspace commit',async()=>{
 for(const method of ['pin','phone']){
  const f=serverFixture();await f.ready();
  if(method==='pin')await select(f,adminId);
  else{const begin=await f.invoke('operator-unlock',undefined,adminId);assert.equal((await f.invoke('operator-unlock-status',undefined,begin.token)).approved,true);}
  assert.equal(f.api.getState().activeOperator.id,adminId);
  await f.invoke('operator-unlock-cancel');await drain();
  assert.equal(f.api.selectionStatus().phase,'none',method);assert.equal(f.api.getState().activeOperator,null,method);assert.equal(f.api.getState().operatorProof,null,method);
  await assert.rejects(f.invoke('workspace-open'),/Choose who/);
 }
});
test('committing the actual workspace keeps its chosen authority when an obsolete cancel arrives',async()=>{
 for(const method of ['pin','phone']){
  const f=serverFixture();await f.ready();
  if(method==='pin')await select(f,adminId);
  else{const begin=await f.invoke('operator-unlock',undefined,adminId);await f.invoke('operator-unlock-status',undefined,begin.token);}
  assert.equal((await f.invoke('workspace-open')).ok,true);const lease=f.current().lease;
  await f.invoke('operator-unlock-cancel');assert.equal(f.api.selectionStatus().phase,'active',method);assert.equal(f.api.getState().activeOperator.id,adminId,method);assert.equal(f.api.getState().operatorProof,proof,method);
  await f.invoke('connection-decision',undefined,{id:requestId,status:'approved'});assert.equal(decisions(f).at(-1)[3].headers['X-Stati-Operator-Lease'],lease);
  await f.invoke('operator',undefined,{id:null});
 }
});
test('actual renewal expiry clears selected privilege while receiver, clocks and administrator deliveries remain alive',async()=>{
 const f=serverFixture({route:({endpoint})=>{if(endpoint==='/station/operator/presence')return Response.json({error:'Offline fixture'},{status:503});}});await f.ready();await select(f,adminId);
 const receiver=f.api.getState().receiver;f.api.spawnClock('55555555-5555-4555-8555-555555555555',{fontSize:52,autoSize:true,blur:false,showBackground:true});const clock=f.windows.at(-1);
 await f.clock.advance(45000);assert.equal(f.api.getState().activeOperator,null);assert.equal(f.api.getState().operatorProof,null);assert.equal(f.api.getState().receiver,receiver);assert.equal(f.api.getState().receivingEnabled,true);assert.equal(clock.destroyed,false);assert.equal(clock.visible,true);assert.ok(f.calls.some(call=>call[0]==='send'&&call[1]==='identity-required'&&call[2].reason==='expired'));
 const before=f.http().filter(call=>call[2]==='/station/state').length;f.intervals.find(timer=>timer.ms===20000).fn();await drain();assert.ok(f.http().filter(call=>call[2]==='/station/state').length>before);assert.equal(f.api.getState().receiver,receiver);
 await assert.rejects(f.invoke('connection-decision',undefined,{id:requestId,status:'approved'}),/Choose who/);
});
test('actual lock/suspend immediately cancel native privilege and stale renewal cannot restore it',async()=>{
 for(const event of ['lock-screen','suspend']){
  const held=deferred(),started=deferred();const f=serverFixture({route:async({endpoint,body})=>{if(endpoint==='/station/operator/presence'){started.resolve();await held.promise;return Response.json({active:true,userId:body.userId,expiresAt:serverNow+45,ttlSeconds:45});}}});await f.ready();await select(f,adminId);const renewal=f.api.renewOperatorSelection();await started.promise;f.power.emit(event);assert.equal(f.api.getState().activeOperator,null);assert.equal(f.api.getState().operatorProof,null);assert.equal(f.api.selectionStatus().phase,'none');held.resolve();await renewal;await drain();assert.equal(f.api.getState().activeOperator,null);assert.equal(f.api.getState().sessionLocked,true);
  const pulse=f.http().find(call=>call[2]==='/station/operator/presence');assert.equal(pulse[3].signal.aborted,true);assert.ok(f.api.getState().receiver);
 }
});
test('retrying actual healthy pairing preserves the current administrator, proof and connection without a new station',async()=>{
 const f=serverFixture();await f.ready();await select(f,adminId);const old=f.current(),before=f.api.getState();
 const result=await f.invoke('pair',undefined,'Replacement fixture');await drain();
 assert.equal(result.paired,true);assert.equal(f.api.getState().credential,'device-fixture');
 assert.equal(f.api.getState().activeOperator.id,adminId);assert.equal(f.api.getState().operatorProof,before.operatorProof);assert.equal(f.current().lease,old.lease);
 assert.equal(f.http().filter(call=>call[2]==='/devices/pair'&&call[1]==='POST').length,0);
 assert.equal(f.http().filter(call=>call[2]==='/station/operator'&&JSON.parse(call[3].body||'{}').userId===null).length,0);
});
test('actual update install is reachable with no selected user and closes the receiver through the checked shutdown path',async()=>{
 const f=serverFixture();await f.ready();assert.equal(f.api.getState().activeOperator,null);await f.invoke('update-install');await drain();assert.equal(f.api.getState().quitting,true);assert.equal(f.api.getState().receiver,null);assert.ok(f.http().some(call=>call[2]==='/station/receiver'&&call[1]==='DELETE'));
});


test('actual native main refuses pastor selection before phone or PIN requests and keeps workspace closed',async()=>{
 const capabilities={readSongs:true,planServices:false,editLyrics:false,manageWorship:false,manageTeam:false,sendFiles:true};
 const f=serverFixture({route:async({endpoint,current,headers})=>{
  if(endpoint==='/station/state')return Response.json({operatorLeaseProtocol:protocol,device:{id:deviceId,operator_id:current&&!current.pending?current.userId:null},members:members.map(member=>member.id===memberId?{...member,ministryRole:'pastor',requiresUnlock:true,capabilities}:member),adminUnlocked:false,transfers:[],requests:[],accessRequests:[]});
  if(endpoint==='/station/workspace')return Response.json({deviceId,userId:memberId,capabilities});
 }});await f.ready();
 await assert.rejects(f.invoke('operator-unlock',undefined,memberId),/Choose a registered member/);
 await assert.rejects(f.invoke('operator',undefined,{id:memberId,pin:'1234'}),/Choose a registered member/);
 assert.equal(f.api.getState().activeOperator,null);assert.equal(f.api.getState().operatorProof,null);
 assert.equal(f.http().some(call=>call[2]==='/station/operator/unlock'||call[2]==='/station/operator'&&JSON.parse(call[3].body||'{}').userId===memberId),false);
 await assert.rejects(f.invoke('workspace-context'),/Choose who|Choose your/);
 for(const [channel,value] of [['service-plans-change',{type:'create'}],['song-library-save',{}],['prepare-draft-save',{}],['lyrics-export',{}],['presentation-export',{}],['presentation-insert',{}],['powerpoint-batch',{}],['powerpoint-render',{}]])await assert.rejects(f.invoke(channel,undefined,value),/Choose who|Choose your/,channel);
});


test('Prepare, Library and Services navigate the existing main window without opening a second window',async()=>{
 const f=serverFixture({route:({endpoint,current})=>endpoint==='/station/workspace'?Response.json({userId:current?.userId,deviceId,capabilities:{readSongs:true,createSlides:true,editLyrics:true,planServices:true}}):undefined});await f.ready();await select(f,adminId);await f.invoke('workspace-open');
 const main=f.api.getState().main,count=f.windows.length;
 for(const section of ['prepare','library','services','powerpoint','audio']){
  await f.invoke('prepare',main,section);
  assert.equal(f.windows.length,count);assert.equal(f.api.getState().main,main);
  assert.ok(f.calls.some(call=>call.includes('navigate')&&call.includes(section))||main.webContents.sent?.some?.(call=>call[0]==='navigate'&&call[1]===section));
 }
});
