const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPairingSession}=require('../desktop/pairing-session.cjs');
const origin='https://stati.ciani01.org',url=origin+'/pair/fixture_pending_token';
const paired={id:'station-flat-id',name:'Church computer',paired:true};
const pending={id:'station-pending-id',name:'Church computer',paired:false,url,expiresAt:1900000600};
const created={...pending,credential:'new-private-device-credential'};
const failure=status=>Object.assign(Error('Fixture request failed.'),{status});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function fixture({credential='saved-private-device-credential',route,store,makeQr}={}){
 let currentCredential=credential;const requests=[],writes=[],qrCalls=[];
 const session=createPairingSession({
  current:()=>currentCredential,
  async request(endpoint,options){requests.push({endpoint,options});return route?route(endpoint,options):endpoint.endsWith('/status')?paired:created;},
  async storeSecret(next,expected){writes.push({next,expected});if(store)await store(next,expected);assert.equal(currentCredential,expected);currentCredential=next;},
  async qr(value){qrCalls.push(value);return makeQr?makeQr(value):'data:image/png;base64,fixture';},
 });
 return{...session,requests,writes,qrCalls,current:()=>currentCredential,set:value=>{currentCredential=value;}};
}

test('flat real pair-status response resumes an established connection without replacing its credential',async()=>{
 const f=fixture();assert.deepEqual(await f.status(),paired);assert.deepEqual(await f.pair('Church computer'),paired);
 assert.equal(f.current(),'saved-private-device-credential');assert.equal(f.writes.length,0);assert.equal(f.qrCalls.length,0);
 assert.ok(f.requests.every(call=>call.endpoint==='/devices/pair/status'&&call.options.deviceCredential==='saved-private-device-credential'));
});
test('pending pairing survives a new session by reusing its server URL and saved credential',async()=>{
 const f=fixture({route:async()=>pending});const result=await f.pair('A different name');
 assert.deepEqual(result,{paired:false,url,expiresAt:pending.expiresAt,qr:'data:image/png;base64,fixture'});
 assert.equal(f.requests.length,1);assert.equal(f.writes.length,0);assert.equal(f.current(),'saved-private-device-credential');
 assert.doesNotMatch(JSON.stringify(result),/private-device/);
});
test('concurrent new-pairing clicks share one request and one protected-storage write',async()=>{
 const wait=deferred(),f=fixture({credential:null,route:async()=>{await wait.promise;return created;}});
 const first=f.pair('Church computer'),second=f.pair('Church computer');assert.equal(first,second);assert.equal(f.requests.length,1);
 wait.resolve();const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,b);assert.equal(f.writes.length,1);
 assert.deepEqual(f.writes,[{next:created.credential,expected:null}]);assert.equal(f.current(),created.credential);
 assert.equal(f.requests[0].options.auth,false);assert.equal(f.requests[0].options.deviceCredential,null);
 assert.doesNotMatch(JSON.stringify(a),/new-private-device-credential/);
});
test('timeouts, server failures, auth failures and malformed status never cause replacement pairing',async()=>{
 for(const error of [Error('Offline'),failure(500),failure(401),failure(403)]){
  const f=fixture({route:async()=>{throw error;}});await assert.rejects(f.pair('Church computer'),e=>e===error);
  assert.equal(f.requests.length,1);assert.equal(f.writes.length,0);assert.equal(f.current(),'saved-private-device-credential');
 }
 for(const response of [{},{paired:true,device:{id:'wrong-shape'}},{...pending,url:undefined},{...pending,url:'https://elsewhere.example/pair/fixture_token'}]){
  const f=fixture({route:async()=>response});await assert.rejects(f.pair('Church computer'),/connection|pairing response/);assert.equal(f.writes.length,0);assert.equal(f.requests.length,1);
 }
});
test('only a confirmed expired or revoked connection permits replacement, with the old credential as commit guard',async()=>{
 const f=fixture({route:async endpoint=>{if(endpoint.endsWith('/status'))throw failure(410);return created;}});
 const result=await f.pair(' Church computer ');assert.equal(result.paired,false);assert.equal(f.current(),created.credential);
 assert.deepEqual(f.writes,[{next:created.credential,expected:'saved-private-device-credential'}]);
 assert.deepEqual(f.requests.map(call=>call.endpoint),['/devices/pair/status','/devices/pair']);assert.deepEqual(f.requests[1].options.data,{name:'Church computer'});
});
test('late status, creation and QR results cannot affect or expose a newer connection',async()=>{
 for(const stage of ['status','creation','qr']){
  const wait=deferred(),began=deferred();
  const f=fixture({credential:stage==='status'?'saved-private-device-credential':null,
   route:async endpoint=>{if((stage==='status'&&endpoint.endsWith('/status'))||(stage==='creation'&&endpoint==='/devices/pair')){began.resolve();await wait.promise;}return endpoint.endsWith('/status')?pending:created;},
   makeQr:async()=>{if(stage==='qr'){began.resolve();await wait.promise;}return'data:image/png;base64,fixture';},
  });
  const result=f.pair('Church computer'),rejected=assert.rejects(result,/connection changed/);await began.promise;f.set('a-newer-connection');wait.resolve();await rejected;
  assert.equal(f.current(),'a-newer-connection');assert.equal(f.writes.length,stage==='qr'?1:0,stage);
 }
});
test('cancel also fences a pending request when an external reset leaves the credential null',async()=>{
 const wait=deferred(),f=fixture({credential:null,route:async()=>{await wait.promise;return created;}});
 const first=f.pair('Church computer'),rejected=assert.rejects(first,/connection changed/);f.cancel();wait.resolve();await rejected;
 assert.equal(f.writes.length,0);assert.equal(f.current(),null);
 const next=await f.pair('Church computer');assert.equal(next.paired,false);assert.equal(f.writes.length,1);
});
test('QR rendering failure retains the stored pairing and the next click resumes it',async()=>{
 let qrAttempts=0;const f=fixture({credential:null,route:async endpoint=>endpoint.endsWith('/status')?pending:created,makeQr:async()=>{if(!qrAttempts++)throw Error('QR unavailable');return'fixture-qr';}});
 await assert.rejects(f.pair('Church computer'),/QR unavailable/);assert.equal(f.current(),created.credential);
 assert.equal((await f.pair('Church computer')).qr,'fixture-qr');assert.equal(f.requests.filter(call=>call.endpoint==='/devices/pair').length,1);assert.equal(f.writes.length,1);
});
test('protected-storage failure retries the same created pending connection without another POST',async()=>{
 let attempts=0;const f=fixture({credential:null,store:async()=>{if(!attempts++)throw Error('Protected storage unavailable');}});
 await assert.rejects(f.pair('Church computer'),/Protected storage/);assert.equal(f.current(),null);
 assert.equal((await f.pair('Church computer')).paired,false);assert.equal(f.current(),created.credential);
 assert.equal(f.requests.filter(call=>call.endpoint==='/devices/pair').length,1);assert.equal(f.writes.length,2);
});
test('invalid new responses cannot overwrite the old credential, and missing credentials need no status request',async()=>{
 const none=fixture({credential:null});assert.deepEqual(await none.status(),{paired:false});assert.equal(none.requests.length,0);
 for(const response of [{...created,credential:undefined},{...created,url:'https://elsewhere.example/pair/fixture_token'},{...created,expiresAt:0}]){
  const f=fixture({route:async endpoint=>{if(endpoint.endsWith('/status'))throw failure(410);return response;}});
  await assert.rejects(f.pair('Church computer'),/pairing response/);assert.equal(f.writes.length,0);assert.equal(f.current(),'saved-private-device-credential');
 }
});
