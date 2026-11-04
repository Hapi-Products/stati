const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=fs.existsSync(path.join(__dirname,'background-receiver.test.cjs'))?path.resolve(__dirname,'..'):path.resolve(__dirname,'../../../../stati'),fixturePath=path.join(root,'tests/background-receiver.test.cjs'),draftMain=path.join(__dirname,'../desktop/main.cjs');
const fixtureSource=fs.readFileSync(fixturePath,'utf8').replace("source=fs.readFileSync(mainPath,'utf8')","source=fs.readFileSync("+JSON.stringify(draftMain)+",'utf8')").replace("show(){calls.push(['notification',this.options]);}","show(){calls.push(['notification',this.options,this]);}").replace("  close(){}\n }","  close(){calls.push(['notification-close',this.options]);}\n }");
assert.ok(fixtureSource.includes(JSON.stringify(draftMain)),'Use the selected candidate main process');
const load=vm.runInThisContext('(function(require,__dirname){'+fixtureSource.slice(0,fixtureSource.indexOf('\ntest('))+'\nreturn{fixture,drain};})',{filename:fixturePath});
const {fixture,drain}=load(createRequire(fixturePath),path.dirname(fixturePath));
const deviceId='11111111-1111-4111-8111-111111111111',adminId='22222222-2222-4222-8222-222222222222',protocol='stati-operator-v1',serverNow=1900000000;
const file=index=>({id:'notification-file-fixture-'+String(index).padStart(6,'0'),filename:'SECRET song '+index+'.png',bytes:14,content_type:'image/png',status:'queued',created_at:1,sender_role:'member',sender_id:'sender-fixture-00000000000001',first_name:'AlicePrivate',last_initial:'P'});
const request=index=>({id:'notification-request-fixture-'+String(index).padStart(6,'0'),message:'SECRET request reason '+index,first_name:'AlicePrivate',last_initial:'P',created_at:1});
const notices=f=>f.calls.filter(call=>call[0]==='notification'&&['Stați · File received','Stați · Request'].includes(call[1].title));
function notificationFixture({startup=false,history=[],transfers=[],savedLedger}={}){
 let rows=transfers,requests=[],accessRequests=[],remoteOperator=null,now=0;
 const expiryTimers=[];
 const clock={now:()=>now,timers:{setTimeout:()=>({unref(){}}),clearTimeout(){}},advance:ms=>{now+=ms;}};
 const f=fixture({startup,mode:'off',notifications:true,history,at:'2026-10-21T02:21:00Z',leaseClock:clock,modules:{'./notification-lifetime.cjs':{notificationLifetime:()=>require(path.join(root,'desktop/notification-lifetime.cjs')).notificationLifetime({schedule:(fn,delay)=>{expiryTimers.push({fn,delay});return expiryTimers.length;},cancel(){}})}},route:({endpoint,method,options})=>{
  const body=options.body?JSON.parse(options.body):{};
  if(endpoint==='/devices/pair/status')return Response.json({id:deviceId,name:'Private notification fixture',paired:true});
  if(endpoint==='/station/state')return Response.json({operatorLeaseProtocol:protocol,device:{id:deviceId,name:'Private notification fixture',operator_id:remoteOperator},members:[{id:adminId,role:'admin',first_name:'Fixture',last_initial:'A'}],adminUnlocked:remoteOperator===adminId&&options.headers['X-Stati-Operator']==='p'.repeat(43),transfers:rows,requests,accessRequests,accessApprover:'operator'});
  if(endpoint==='/station/operator'&&method==='POST'){
   remoteOperator=body.userId;if(!remoteOperator)return Response.json({ok:true});
   return Response.json({protocol,lease:'l'.repeat(43),userId:adminId,expiresAt:serverNow+45,ttlSeconds:45,active:true,proof:'p'.repeat(43),proofExpiresAt:serverNow+8*3600});
  }
 }});
 if(savedLedger)f.diskFiles.set('/mock/userData/notification-seen.json',Buffer.from(savedLedger));
 return{...f,clock,expiryTimers,setRows:value=>{rows=value;},setRequests:value=>{requests=value;},setAccessRequests:value=>{accessRequests=value;},async ready(){await f.start();await drain();if(!startup)await f.invoke('access-status');},async chooseAdmin(){await f.invoke('operator',undefined,{id:adminId,pin:'1234'});await f.invoke('workspace-open');},async poll(){await f.api.pollStation();await drain();}};
}

test('X-close keeps real background file and request alerts active without exposing private details or file actions',async()=>{
 const f=notificationFixture();await f.ready();const main=f.api.getState().main;assert.equal(main.close().prevented,true);assert.equal(main.visible,false);
 f.setRows([file(1)]);f.setRequests([request(1)]);f.setAccessRequests([request(2)]);await f.poll();
 assert.equal(notices(f).length,3);assert.ok(notices(f).some(call=>call[1].body==='A new file arrived. Open Stați to view it.'));
 assert.doesNotMatch(JSON.stringify(notices(f).map(call=>({title:call[1].title,body:call[1].body}))),/SECRET|AlicePrivate|reason|png|sender-fixture/);assert.equal(main.visible,false);assert.equal(f.api.getState().activeOperator,null);
 await f.poll();assert.equal(notices(f).length,3);
 await assert.rejects(f.invoke('file-open',main,file(1).id),/not available|selected user/);
});
test('startup-off with no main window still receives a generic toast, and its click opens Who are you without selecting a profile',async()=>{
 const f=notificationFixture({startup:true});await f.ready();assert.equal(f.api.getState().main,undefined);
 f.setRows([file(2)]);await f.poll();assert.equal(notices(f).length,1);assert.equal(f.api.getState().main,undefined);assert.doesNotMatch(notices(f)[0][1].body,/SECRET|AlicePrivate/);
 notices(f)[0][2].emit('click');const main=f.api.getState().main;assert.ok(main.visible);assert.equal(f.api.getState().activeOperator,null);
 await f.invoke('access-status');assert.ok(f.calls.some(call=>call[0]==='identity'));assert.equal(f.api.getState().operatorProof,null);
});
test('Windows lock, Skip and expired profile each keep generic alerts while excluding names, file names and request messages',async()=>{
 for(const condition of ['lock','skip','expired']){
  const f=notificationFixture();await f.ready();
  if(condition==='skip')await f.invoke('identity-skip');
  else{await f.chooseAdmin();if(condition==='lock')f.power.emit('lock-screen');else{f.clock.advance(45001);f.api.selectionStatus();}}
  f.setRows([file(3)]);f.setRequests([request(3)]);await f.poll();
  assert.equal(notices(f).length,2,condition);assert.doesNotMatch(JSON.stringify(notices(f).map(call=>({title:call[1].title,body:call[1].body}))),/SECRET|AlicePrivate|reason|png/,condition);assert.equal(f.api.getState().activeOperator,null,condition);
 }
});
test('a currently verified real administrator lease permits detailed notifications even while its window is hidden',async()=>{
 const f=notificationFixture();await f.ready();await f.chooseAdmin();const main=f.api.getState().main;main.close();
 f.setRows([file(4)]);f.setRequests([request(4)]);await f.poll();assert.equal(notices(f).length,2);
 assert.ok(notices(f).some(call=>call[1].body.includes('SECRET song 4.png')));assert.ok(notices(f).some(call=>call[1].body.includes('SECRET request reason 4')));assert.equal(main.visible,false);
});
test('identity invalidation clears detailed toasts immediately and ordinary notifications retain their twenty-minute expiry',async()=>{
 for(const action of ['lock','switch']){
  const f=notificationFixture();await f.ready();await f.chooseAdmin();f.setRows([file(8)]);f.setRequests([request(8)]);await f.poll();
  assert.equal(notices(f).length,2);assert.ok(f.expiryTimers.every(timer=>timer.delay===1200000));assert.equal(f.calls.filter(call=>call[0]==='notification-close').length,0);
  if(action==='lock')f.power.emit('lock-screen');else await f.invoke('operator',undefined,{id:null});
  assert.equal(f.calls.filter(call=>call[0]==='notification-close').length,2,action);await f.poll();assert.equal(notices(f).length,2,action+' must not re-display old details');
 }
 const f=notificationFixture();await f.ready();f.setRows([file(9)]);await f.poll();assert.equal(f.expiryTimers.length,1);f.expiryTimers[0].fn();assert.equal(f.calls.filter(call=>call[0]==='notification-close').length,1);
});
test('preexisting file history and persisted notification IDs prevent duplicate toasts across restarts',async()=>{
 const old=file(5),f=notificationFixture({history:[old],transfers:[old]});await f.ready();assert.equal(notices(f).length,0);
 f.setRows([old,file(6)]);f.setRequests([request(6)]);await f.poll();assert.equal(notices(f).length,2);
 const ledger=f.diskFiles.get('/mock/userData/notification-seen.json').toString();assert.doesNotMatch(ledger,/SECRET|AlicePrivate|reason|png/);assert.match(ledger,/notification-file-fixture-000006/);
 const restarted=notificationFixture({transfers:[old,file(6)],savedLedger:ledger});restarted.setRequests([request(6)]);await restarted.ready();await restarted.poll();assert.equal(notices(restarted).length,0);
});
test('explicit Exit stops polling and alerts; closing the window never needs an immortal or hidden process',async()=>{
 const f=notificationFixture();await f.ready();f.app.quit();await drain();assert.equal(f.api.getState().quitting,true);
 const before=f.http().filter(call=>call[2]==='/station/state').length;f.setRows([file(7)]);f.setRequests([request(7)]);f.api.pollInBackground();await drain();
 assert.equal(f.http().filter(call=>call[2]==='/station/state').length,before);assert.equal(notices(f).length,0);await assert.rejects(f.api.pollStation(),/closing/);
});
