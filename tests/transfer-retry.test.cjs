const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTransferRetry}=require('../desktop/transfer-retry.cjs');
const queued=id=>({id,status:'queued',sender_role:'admin'});
const failure=status=>Object.assign(Error('Isolated fixture failure'),status===undefined?{}:{status});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

test('retries start at eight seconds, double, and cap at five minutes without an attempt limit',async()=>{
 let clock=0,calls=0,alerts=0;const retry=createTransferRetry({now:()=>clock,deliver:async()=>{calls++;throw failure(503);},onFailure:()=>alerts++});
 const attempts=[[0,8000],[8000,24000],[24000,56000],[56000,120000],[120000,248000],[248000,504000],[504000,804000],[804000,1104000],[1104000,1404000]];
 for(const [at,next] of attempts){clock=at;assert.deepEqual(await retry.observe([queued('file')]),{id:'file',status:'retry',nextAttemptAt:next});clock=next-1;assert.equal(retry.observe([queued('file')]),null);}
 assert.equal(calls,attempts.length);assert.equal(alerts,1);
});

test('only authenticated admin queued entries are eligible; duplicate IDs do not duplicate work',async()=>{
 const calls=[];const retry=createTransferRetry({deliver:async id=>{calls.push(id);}});
 const queue=[null,{},queued(''),{...queued('member'),sender_role:'member'},...['delivered','rejected','expired'].map(status=>({...queued(status),status})),queued('admin'),queued('admin')];
 assert.equal((await retry.observe(queue)).status,'saved');assert.deepEqual(calls,['admin']);assert.equal(retry.observe(queue),null);
});

test('global active and per-file guards allow only one automatic delivery at a time',async()=>{
 const work=deferred(),calls=[];const retry=createTransferRetry({deliver:id=>{calls.push(id);return work.promise;}});
 const first=retry.observe([queued('a'),queued('b')]);assert.equal(retry.observe([queued('a'),queued('b')]),null);
 await Promise.resolve();assert.deepEqual(calls,['a']);assert.equal(retry.observe([queued('a'),queued('b')]),null);
 work.resolve({path:'/fixture/a'});assert.equal((await first).status,'saved');assert.equal((await retry.observe([queued('a'),queued('b')])).status,'saved');assert.deepEqual(calls,['a','b']);
});

test('a manual different-file task started after observe blocks the deferred automatic invocation',async()=>{
 let busy=false,calls=0,clock=0;const retry=createTransferRetry({now:()=>clock,isBusy:()=>busy,deliver:async()=>{calls++;throw failure(503);}});
 const pending=retry.observe([queued('automatic')]);busy=true;
 assert.deepEqual(await pending,{id:'automatic',status:'busy'});assert.equal(calls,0);
 busy=false;assert.deepEqual(await retry.observe([queued('automatic')]),{id:'automatic',status:'retry',nextAttemptAt:8000});assert.equal(calls,1);
});

test('deliver reserves the shared slot before any later manual invocation can run',async()=>{
 const work=deferred(),slots=new Set();let calls=0;
 const retry=createTransferRetry({isBusy:()=>slots.size>0,deliver:id=>{assert.equal(slots.size,0);slots.add(id);calls++;return work.promise.finally(()=>slots.delete(id));}});
 const pending=retry.observe([queued('automatic')]);await Promise.resolve();assert.equal(slots.has('automatic'),true);assert.equal(calls,1);
 assert.equal(retry.observe([queued('other')]),null);work.resolve();assert.equal((await pending).status,'stopped');assert.equal(slots.size,0);
});

test('an empty authoritative queue ends the failed episode while detached work settles',async()=>{
 let clock=0,calls=0,alerts=0;const running=deferred();
 const retry=createTransferRetry({now:()=>clock,deliver:id=>{calls++;if(id==='a'&&calls===2)return running.promise;throw failure(503);},onFailure:()=>alerts++});
 assert.equal((await retry.observe([queued('a')])).status,'retry');assert.equal(alerts,1);
 clock=8000;const detached=retry.observe([queued('a')]);await Promise.resolve();
 assert.equal(retry.observe([]),null);assert.equal(retry.observe([queued('b')]),null);
 running.reject(failure(503));assert.equal((await detached).status,'stopped');assert.equal(alerts,1);
 assert.equal((await retry.observe([queued('b')])).status,'retry');assert.equal(alerts,2);
});

test('multiple files share one failed episode until a save or empty queue ends it',async()=>{
 let alerts=0;const retry=createTransferRetry({deliver:async id=>{if(id!=='success')throw failure(410);return{};},onFailure:()=>alerts++});
 assert.equal((await retry.observe([queued('a')])).status,'terminal');
 assert.equal((await retry.observe([queued('b')])).status,'terminal');assert.equal(alerts,1);
 assert.equal((await retry.observe([queued('success')])).status,'saved');
 assert.equal((await retry.observe([queued('c')])).status,'terminal');assert.equal(alerts,2);
 assert.equal(retry.observe([]),null);assert.equal((await retry.observe([queued('d')])).status,'terminal');assert.equal(alerts,3);
});

test('authoritative queue order is respected and a backed-off file does not block other due files',async()=>{
 let clock=0;const calls=[];const retry=createTransferRetry({now:()=>clock,deliver:async id=>{calls.push(id);if(id==='a')throw failure(503);}});
 assert.equal((await retry.observe([queued('a'),queued('b')])).status,'retry');
 assert.equal((await retry.observe([queued('b'),queued('a')])).status,'saved');
 assert.equal(retry.observe([queued('a'),queued('b')]),null);clock=8000;assert.equal((await retry.observe([queued('a')])).status,'retry');assert.deepEqual(calls,['a','b','a']);
});

test('poll-start sequence ignores stale, duplicate, invalid and negative snapshots',async()=>{
 const calls=[];const retry=createTransferRetry({deliver:async id=>calls.push(id)});
 assert.equal(retry.observe([],{sequence:12}),null);
 for(const sequence of [11,12,-1,NaN,1.5,Infinity])assert.equal(retry.observe([queued('stale')],{sequence}),null);
 assert.equal((await retry.observe([queued('fresh')],{sequence:13})).status,'saved');assert.deepEqual(calls,['fresh']);
});

test('rejected, absent, or member-changed entries detach pending work and suppress failure alerts',async()=>{
 for(const next of [[],[{...queued('file'),status:'rejected'}],[{...queued('file'),sender_role:'member'}]]){
  const work=deferred();let alerts=0;const retry=createTransferRetry({deliver:()=>work.promise,onFailure:()=>alerts++});
  const pending=retry.observe([queued('file')],{sequence:10});await Promise.resolve();retry.observe(next,{sequence:12});
  assert.equal(retry.observe([queued('file')],{sequence:11}),null);work.reject(failure(503));assert.equal((await pending).status,'stopped');assert.equal(alerts,0);
 }
});

test('explicit cancellation persists through fresh snapshots and does not alert on detached failure',async()=>{
 const work=deferred();let calls=0,alerts=0;const retry=createTransferRetry({deliver:()=>{calls++;return work.promise;},onFailure:()=>alerts++});
 const pending=retry.observe([queued('file')]);await Promise.resolve();retry.cancel('file');work.reject(failure(503));
 assert.equal((await pending).status,'stopped');retry.observe([]);assert.equal(retry.observe([queued('file')]),null);assert.equal(calls,1);assert.equal(alerts,0);
});

test('cancel and stop prevent same-turn delivery and stop cannot be undone by fresh queues',async()=>{
 for(const operation of ['cancel','stop']){
  let calls=0;const retry=createTransferRetry({deliver:async()=>calls++});const pending=retry.observe([queued('file')]);retry[operation]('file');
  assert.equal((await pending).status,'stopped');assert.equal(calls,0);assert.equal(retry.observe([queued('file')]),null);
  if(operation==='stop')assert.equal(retry.observe([queued('other')]),null);
 }
});

test('stop during active work suppresses late error notifications and all future retries',async()=>{
 const work=deferred();let alerts=0;const retry=createTransferRetry({deliver:()=>work.promise,onFailure:()=>alerts++});
 const pending=retry.observe([queued('file')]);await Promise.resolve();retry.stop();work.reject(failure(503));
 assert.equal((await pending).status,'stopped');assert.equal(retry.observe([queued('other')]),null);assert.equal(alerts,0);
});

test('successful delivery is never repeated even after disappearance and later queued snapshots',async()=>{
 let calls=0;const retry=createTransferRetry({deliver:async()=>{calls++;return{alreadySaved:true};}});
 assert.equal((await retry.observe([queued('file')])).result.alreadySaved,true);retry.observe([]);assert.equal(retry.observe([queued('file')]),null);assert.equal(calls,1);
});

test('401 and 403 stop the whole controller; other terminal 4xx only close that transfer',async()=>{
 for(const status of [400,401,403,404,405,409,410,422,499]){
  let calls=0;const retry=createTransferRetry({deliver:async()=>{calls++;throw failure(status);}});
  assert.equal((await retry.observe([queued('file')])).status,[401,403].includes(status)?'stopped':'terminal');
  retry.observe([]);assert.equal(retry.observe([queued('file')]),null);assert.equal(calls,1);
  const next=retry.observe([queued('other')]);if([401,403].includes(status))assert.equal(next,null);else assert.equal((await next).status,'terminal');
 }
});

test('network errors, timeouts, 408, 429, and 5xx remain retryable',async()=>{
 for(const error of [failure(),Object.assign(failure(),{name:'TimeoutError'}),failure(408),failure(429),failure(500),failure(503)]){
  const retry=createTransferRetry({now:()=>0,deliver:async()=>{throw error;}});
  assert.deepEqual(await retry.observe([queued('file')]),{id:'file',status:'retry',nextAttemptAt:8000});
 }
});

test('explicit abort, cancelled, and nonretryable failures terminate only that transfer',async()=>{
 for(const extra of [{name:'AbortError'},{cancelled:true},{retryable:false}]){
  const retry=createTransferRetry({deliver:async()=>{throw Object.assign(failure(503),extra);}});
  assert.equal((await retry.observe([queued('file')])).status,'terminal');assert.equal(retry.observe([queued('file')]),null);
 }
});

test('allowed false invalidates pending work without choosing or authenticating an operator',async()=>{
 let calls=0;const profile={operator:null,proof:null};const retry=createTransferRetry({deliver:async()=>{calls++;}});
 const pending=retry.observe([queued('file')]);retry.observe([queued('file')],{allowed:false});
 assert.equal((await pending).status,'stopped');assert.equal(calls,0);assert.deepEqual(profile,{operator:null,proof:null});
 assert.equal((await retry.observe([queued('file')],{allowed:true})).status,'saved');assert.deepEqual(profile,{operator:null,proof:null});
});

test('failure observers cannot reject delivery policy or resurrect stopped work',async()=>{
 const retry=createTransferRetry({deliver:()=>{throw failure(503);},onFailure:()=>{retry.stop();throw Error('Isolated observer failure');}});
 assert.equal((await retry.observe([queued('file')])).status,'stopped');assert.equal(retry.observe([queued('file')]),null);
});

test('configuration rejects invalid callbacks and delays',()=>{
 for(const options of [{deliver:null},{deliver(){},isBusy:null},{deliver(){},onFailure:null},{deliver(){},now:null},{deliver(){},baseDelayMs:0},{deliver(){},baseDelayMs:1.5},{deliver(){},maxDelayMs:7999}])assert.throws(()=>createTransferRetry(options),/Invalid transfer retry configuration/);
});
