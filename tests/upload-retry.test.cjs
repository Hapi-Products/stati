const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const {stripTypeScriptTypes}=require('node:module');
const api=stripTypeScriptTypes(fs.readFileSync('src/web/api.ts','utf8'),{mode:'transform'}).replace(/\bexport /g,'');
const filename=fs.readFileSync('src/shared/file-name.js','utf8').replace(/\bexport /g,'');
const source=stripTypeScriptTypes(fs.readFileSync('src/web/upload-retry.ts','utf8').replace("import {ApiError} from './api';",'').replace("import {safeTransferFilename} from '../shared/file-name.js';",''),{mode:'transform'}).replace(/\bexport /g,'');
const device='22222222-2222-4222-8222-222222222222',otherDevice='33333333-3333-4333-8333-333333333333',transfer='44444444-4444-4444-8444-444444444444';
const expected=createHash('sha256').update('lyrics').digest('hex');
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
// Web Crypto completes on Node's worker pool. Event-loop turn counts can expire
// before that pool runs when the full suite is busy; wait for the real boundary.
async function until(predicate){const deadline=performance.now()+2000;while(performance.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}assert.fail('Fixture boundary was not reached within two seconds.');}

// Evaluate the real TypeScript with Web Crypto, real File bytes and inert XHR.
// No browser account, filesystem payload or network request is created.
function harness({file=new File(['lyrics'],'Cântare.txt'),crypto=webcrypto,manualTimers=false}={}){
 const timers=[],scope={DOMException,crypto,File,Response,Headers,AbortController,AbortSignal,XMLHttpRequest:undefined,
  setTimeout:manualTimers?(fn,ms)=>{const timer={fn,ms,cleared:false};timers.push(timer);return timer;}:setTimeout,
  clearTimeout:manualTimers?timer=>{if(timer)timer.cleared=true;}:clearTimeout};
 vm.createContext(scope);vm.runInContext(api+'\n'+filename+'\n'+source+'\nthis.createUploadIntent=createUploadIntent;this.uploadWithRetry=uploadWithRetry;',scope);
 const intent=scope.createUploadIntent(file,device),controller=new AbortController(),requests=[],probes=[],delays=[],retries=[],progress=[];
 const h={scope,file,intent,controller,requests,probes,delays,retries,progress,timers,clock:intent.createdAt,probe:null,wait:null};
 function createRequest(){
  const request={upload:{onprogress:null},onload:null,onerror:null,ontimeout:null,onabort:null,status:201,responseText:'',headers:{},sent:0,aborted:0,
   open(method,url){this.method=method;this.url=url;},setRequestHeader(key,value){this.headers[key]=value;},send(body){this.body=body;this.sent++;},abort(){this.aborted++;this.onabort?.();},
   load(value,status=201){this.status=status;this.responseText=typeof value==='string'?value:JSON.stringify(value);this.onload?.();}};
  requests.push(request);return request;
 }
 h.run=(selected=intent,overrides={})=>{
  h.clock=Math.max(h.clock,selected.createdAt);
  const result=scope.uploadWithRetry('device:'+selected.deviceId,selected,{signal:controller.signal,progress:value=>progress.push(value),now:()=>h.clock,createRequest,
   fetchReceipt:async(url,options)=>{probes.push({url,options});return h.probe?h.probe(url,options):Response.json({error:'Unknown upload'},{status:404});},
   wait:async(ms,signal)=>{delays.push(ms);if(h.wait)await h.wait(ms,signal);},onRetry:value=>retries.push(value),...overrides});
  void result.catch(()=>{});return result;
 };
 h.sent=async(index=0)=>{await until(()=>requests[index]?.sent);return requests[index];};
 h.receipt=(overrides={},selected=intent)=>({protocol:'stati-upload-v1',intentId:selected.intentId,id:transfer,deviceId:selected.deviceId,accepted:true,status:'queued',filename:'Cântare.txt',bytes:file.size,sha256:expected,replayed:false,...overrides});
 h.lookup=(overrides={},selected=intent)=>Response.json(h.receipt({replayed:true,...overrides},selected));
 return h;
}

test('intent exposes the original immutable File/computer identity and a deliberate new send receives a new UUID',()=>{
 const h=harness(),second=h.scope.createUploadIntent(h.file,device);
 assert.equal(h.intent.originalFile,h.file);assert.equal(h.intent.deviceId,device);assert.match(h.intent.intentId,/^[a-f0-9-]{36}$/);assert.equal(Number.isInteger(h.intent.createdAt),true);assert.equal(Object.isFrozen(h.intent),true);assert.notEqual(second.intentId,h.intent.intentId);
});

test('uploads original bytes only to the new endpoint, sends SHA-256 and validates acceptance before final progress',async()=>{
 const h=harness(),result=h.run(),request=await h.sent();
 assert.equal(request.body,h.file);assert.equal(request.method,'POST');assert.equal(request.url,'/api/receive/device:'+device+'/uploads/'+h.intent.intentId);assert.equal(request.timeout,120000);
 assert.equal(request.headers['X-Filename'],encodeURIComponent('Cântare.txt'));assert.equal(request.headers['X-Checksum-SHA256'],expected);
 request.upload.onprogress({loaded:3});request.upload.onprogress({loaded:999});assert.deepEqual(h.progress,[0,3,6]);request.load(h.receipt());const receipt=await result;
 assert.equal(receipt.status,'queued');assert.equal(receipt.accepted,true);assert.equal(receipt.replayed,false);assert.equal(h.progress.at(-1),6);assert.equal(h.probes.length,0);
});

test('receipt filename validation uses the same sanitized wire filename as the server',async()=>{
 const file=new File(['lyrics'],'folder/ＣＯＮ.txt '),h=harness({file}),result=h.run(),request=await h.sent();
 request.load(h.receipt({filename:'presentation-CON.txt'}));assert.equal((await result).filename,'presentation-CON.txt');assert.equal(request.headers['X-Filename'],encodeURIComponent(file.name));
});

test('a lost success response is resolved by receipt lookup without a duplicate POST',async()=>{
 const h=harness();h.probe=()=>h.lookup();const result=h.run(),request=await h.sent();request.onerror();const receipt=await result;
 assert.equal(receipt.id,transfer);assert.equal(receipt.replayed,true);assert.equal(h.requests.length,1);assert.equal(h.delays.length,0);
 assert.equal(h.probes[0].url,'/api/uploads/'+h.intent.intentId+'?deviceId='+device);assert.equal(h.probes[0].options.credentials,'same-origin');assert.equal(h.probes[0].options.cache,'no-store');
});

test('unknown receipt retries use the same intent, fingerprint and File after an abortable delay',async()=>{
 const h=harness(),result=h.run(),first=await h.sent();first.onerror();const second=await h.sent(1);
 assert.deepEqual(h.delays,[1000]);assert.deepEqual(JSON.parse(JSON.stringify(h.retries)),[{attempt:2,delayMs:1000}]);assert.equal(h.probes.length,2);assert.equal(second.url,first.url);assert.equal(second.body,first.body);assert.deepEqual(second.headers,first.headers);
 second.load(h.receipt());await result;assert.equal(h.requests.length,2);assert.deepEqual(h.progress,[0,0,6]);
});

test('safe whole-file retries stop after four attempts with8/16/32second backoff',async()=>{
 const h=harness(),result=h.run();for(let index=0;index<4;index++){const request=await h.sent(index);request.ontimeout();}
 await assert.rejects(result,/several attempts|Retry this file/);assert.deepEqual(h.delays,[1000,2000,4000]);assert.equal(h.probes.length,7);assert.equal(h.requests.length,4);assert.equal(new Set(h.requests.map(request=>request.url)).size,1);assert.equal(h.progress.every(value=>value<=h.file.size),true);
});

for(const status of ['queued','delivered','rejected','expired'])test('acceptance during backoff is reconciled as '+status+' without resending bytes',async()=>{
 const h=harness();let accepted=false;
 h.probe=()=>accepted?h.lookup({status,...(status==='rejected'?{rejectionReason:'Use the corrected arrangement.'}:{})}):Response.json({error:'Unknown upload'},{status:404});
 h.wait=()=>{accepted=true;};
 const result=h.run(),first=await h.sent();first.onerror();const receipt=await result;
 assert.equal(receipt.status,status);assert.equal(receipt.replayed,true);assert.equal(h.requests.length,1);assert.equal(h.probes.length,2);assert.deepEqual(h.delays,[1000]);
 assert.equal(h.probes[0].url,h.probes[1].url);assert.equal(h.progress.at(-1),h.file.size);
});

for(const status of [401,403,410])test('authorization loss during backoff stops at receipt lookup '+status+' before resending',async()=>{
 const h=harness();let denied=false;
 h.probe=()=>Response.json({error:denied?'Access changed':'Unknown upload'},{status:denied?status:404});h.wait=()=>{denied=true;};
 const result=h.run(),first=await h.sent();first.onerror();await assert.rejects(result,{status,message:'Access changed'});
 assert.equal(h.requests.length,1);assert.equal(h.probes.length,2);assert.deepEqual(h.delays,[1000]);
});

test('Stop during the pre-resend check cancels lookup and ignores its late acceptance',async()=>{
 const h=harness(),blocked=deferred(),entered=deferred();
 h.probe=()=>{if(h.probes.length===1)return Response.json({error:'Unknown upload'},{status:404});entered.resolve();return blocked.promise;};
 const result=h.run(),first=await h.sent(),rejected=assert.rejects(result,{name:'AbortError'});first.onerror();await entered.promise;
 h.controller.abort();await rejected;blocked.resolve(h.lookup());await nextTurn();
 assert.equal(h.requests.length,1);assert.equal(h.probes.length,2);assert.equal(h.probes[1].options.signal.aborted,true);assert.deepEqual(h.progress,[0]);
});

for(const status of [500,502,503,504])test('transient HTTP'+status+' looks up acceptance before a safe retry',async()=>{
 const h=harness();h.probe=()=>h.lookup({status:'delivered'});const result=h.run(),request=await h.sent();request.load({error:'Temporary failure'},status);
 const receipt=await result;assert.equal(receipt.status,'delivered');assert.equal(h.requests.length,1);assert.equal(h.probes.length,1);
});

for(const status of [400,401,403,404,408,409,410,413,415,422,429,501])test('HTTP'+status+' is terminal and never falls back to the legacy route',async()=>{
 const h=harness(),result=h.run(),request=await h.sent();request.load({error:'Fixture denial'},status);await assert.rejects(result,{status,message:'Fixture denial'});
 assert.equal(h.requests.length,1);assert.equal(h.probes.length,0);assert.deepEqual(h.delays,[]);assert.match(request.url,/\/uploads\//);
});

for(const status of ['delivered','rejected','expired'])test('lookup exposes existing '+status+' outcome rather than claiming a newly queued send',async()=>{
 const h=harness();h.probe=()=>h.lookup({status,...(status==='rejected'?{rejectionReason:'Please send the corrected song.'}:{})});const result=h.run(),request=await h.sent();request.onerror();const receipt=await result;
 assert.equal(receipt.status,status);assert.equal(receipt.replayed,true);assert.equal(h.requests.length,1);if(status==='rejected')assert.equal(receipt.rejectionReason,'Please send the corrected song.');
});

for(const mismatch of [
 {protocol:'old-upload'}, {accepted:false}, {intentId:'55555555-5555-4555-8555-555555555555'}, {deviceId:otherDevice}, {id:'invalid'},
 {filename:'different.txt'}, {bytes:99}, {sha256:'0'.repeat(64)}, {sha256:expected.toUpperCase()}, {status:'unknown'}, {replayed:true},
 {rejectionReason:'unexpected reason'}, {status:'rejected',rejectionReason:7},
])test('invalid POST receipt remains terminal: '+JSON.stringify(mismatch),async()=>{
 const h=harness(),result=h.run(),request=await h.sent();request.load(h.receipt(mismatch));await assert.rejects(result,/invalid upload confirmation/);assert.equal(h.probes.length,0);assert.equal(h.requests.length,1);assert.deepEqual(h.delays,[]);
});

test('malformed success JSON or unsupported success status cannot confirm an upload',async()=>{
 for(const [value,status] of [['<html>offline</html>',201],['{}',201],[null,202]]){
  const h=harness(),result=h.run(),request=await h.sent();request.load(value===null?h.receipt():value,status);await assert.rejects(result,/invalid upload confirmation/);assert.equal(h.requests.length,1);assert.equal(h.probes.length,0);
 }
});

test('mismatched receipt lookup stops without retrying another POST',async()=>{
 const h=harness();h.probe=()=>h.lookup({deviceId:otherDevice});const result=h.run(),request=await h.sent();request.onerror();await assert.rejects(result,/invalid upload confirmation/);assert.equal(h.requests.length,1);assert.deepEqual(h.delays,[]);
});

test('lookup401 stops automatic work rather than treating denied access as an unknown intent',async()=>{
 const h=harness();h.probe=()=>Response.json({error:'Sign in again'},{status:401});const result=h.run(),request=await h.sent();request.onerror();await assert.rejects(result,{status:401});assert.equal(h.requests.length,1);assert.deepEqual(h.delays,[]);
});

test('lookup transport and body interruptions remain ambiguous and allow the same safe intent retry',async()=>{
 for(const bodyFailure of [false,true]){
  const h=harness();h.probe=()=>{if(!bodyFailure)throw Error('Receipt connection lost');return new Response(new ReadableStream({start(controller){controller.error(Error('Receipt body interrupted'));}}));};
  const result=h.run(),first=await h.sent();first.onerror();const second=await h.sent(1);second.load(h.receipt());await result;assert.equal(second.url,first.url);assert.deepEqual(h.delays,[1000]);
 }
});

test('manual Retry first reconciles its unresolved intent and retains current accepted state',async()=>{
 const h=harness(),initial=h.run(),first=await h.sent();first.load({error:'Quota is temporarily full'},429);await assert.rejects(initial,{status:429});
 h.probe=()=>h.lookup({status:'rejected',rejectionReason:'Wrong arrangement'});const receipt=await h.run();assert.equal(receipt.status,'rejected');assert.equal(h.requests.length,1);assert.equal(h.probes.length,1);
});

test('an already accepted intent missing from lookup is never silently sent again',async()=>{
 const h=harness(),initial=h.run(),first=await h.sent();first.load(h.receipt());await initial;
 await assert.rejects(h.run(),/previously accepted file/);assert.equal(h.requests.length,1);assert.equal(h.probes.length,1);
});

test('one original File digest is cached across retries and different receiving computers',async()=>{
 let reads=0;const file=new File(['lyrics'],'Cântare.txt'),read=file.arrayBuffer.bind(file);file.arrayBuffer=()=>{reads++;return read();};
 const h=harness({file}),first=h.run(),request=await h.sent();request.load(h.receipt());await first;
 const another=h.scope.createUploadIntent(file,otherDevice),second=h.run(another),next=await h.sent(1);next.load(h.receipt({},another));await second;assert.equal(reads,1);assert.notEqual(another.intentId,h.intent.intentId);
});

test('one-hour lifetime cannot be extended by changing or cloning the intent',async()=>{
 const h=harness();h.clock=h.intent.createdAt+3600000;await assert.rejects(h.run(),/hour old/);assert.equal(h.requests.length,0);
 await assert.rejects(h.scope.uploadWithRetry('device:'+device,{...h.intent,createdAt:Date.now()},{signal:h.controller.signal,progress(){}}),/original send operation/);assert.equal(h.requests.length,0);
});

test('intent lifetime is rechecked after backoff before another POST can start',async()=>{
 const h=harness();h.wait=()=>{h.clock=h.intent.createdAt+3600000;};const result=h.run(),request=await h.sent();request.onerror();await assert.rejects(result,/hour old/);assert.equal(h.requests.length,1);
});

test('a different computer target is rejected before reading or creating a request',async()=>{
 let reads=0;const file=new File(['lyrics'],'Cântare.txt');file.arrayBuffer=()=>{reads++;throw Error('must not read');};const h=harness({file});
 await assert.rejects(h.scope.uploadWithRetry('device:'+otherDevice,h.intent,{signal:h.controller.signal,progress(){}}),/original receiving computer/);assert.equal(reads,0);assert.equal(h.requests.length,0);
});

test('an already stopped operation never reads or sends file bytes',async()=>{
 let reads=0;const file=new File(['lyrics'],'Cântare.txt');file.arrayBuffer=()=>{reads++;throw Error('must not read');};const h=harness({file});h.controller.abort();await assert.rejects(h.run(),{name:'AbortError'});assert.equal(reads,0);assert.equal(h.requests.length,0);
});

test('Stop during file reading settles promptly and ignores its late completion',async()=>{
 const read=deferred(),file=new File(['lyrics'],'Cântare.txt');file.arrayBuffer=()=>read.promise;const h=harness({file}),result=h.run(),rejected=assert.rejects(result,{name:'AbortError'});
 h.controller.abort();await rejected;read.resolve(new TextEncoder().encode('lyrics').buffer);await nextTurn();assert.equal(h.requests.length,0);assert.deepEqual(h.progress,[]);
});

test('Stop during Web Crypto digest settles promptly and cannot create a late XHR',async()=>{
 const gate=deferred(),entered=deferred();const crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{entered.resolve();await gate.promise;return webcrypto.subtle.digest(...args);}}};
 const h=harness({crypto}),result=h.run(),rejected=assert.rejects(result,{name:'AbortError'});await entered.promise;h.controller.abort();await rejected;gate.resolve();await nextTurn();assert.equal(h.requests.length,0);assert.deepEqual(h.progress,[]);
});

test('Stop during XHR ignores late load/progress/error and starts no lookup or retry',async()=>{
 const h=harness(),result=h.run(),request=await h.sent(),rejected=assert.rejects(result,{name:'AbortError'});h.controller.abort();await rejected;
 const before=h.progress.length;request.load(h.receipt());request.upload.onprogress({loaded:6});request.onerror();await nextTurn();assert.equal(request.aborted,1);assert.equal(h.progress.length,before);assert.equal(h.probes.length,0);assert.equal(h.requests.length,1);
});

test('Stop during lookup suppresses retries and ignores a late accepted receipt',async()=>{
 const blocked=deferred(),h=harness();h.probe=()=>blocked.promise;const result=h.run(),request=await h.sent(),rejected=assert.rejects(result,{name:'AbortError'});request.onerror();await until(()=>h.probes.length===1);h.controller.abort();await rejected;
 blocked.resolve(h.lookup({status:'delivered'}));await nextTurn();assert.equal(h.requests.length,1);assert.deepEqual(h.delays,[]);assert.deepEqual(h.progress,[0]);assert.equal(h.probes[0].options.signal.aborted,true);
});

test('Stop while parsing a receipt body settles promptly and ignores its late bytes',async()=>{
 const blocked=deferred(),entered=deferred(),h=harness();h.probe=()=>({status:200,ok:true,text:()=>{entered.resolve();return blocked.promise;}});
 const result=h.run(),request=await h.sent(),rejected=assert.rejects(result,{name:'AbortError'});request.onerror();await entered.promise;h.controller.abort();await rejected;
 blocked.resolve(JSON.stringify(h.receipt({replayed:true})));await nextTurn();assert.equal(h.requests.length,1);assert.deepEqual(h.delays,[]);
});

test('Stop during backoff settles promptly even when an injected wait ignores cancellation',async()=>{
 const blocked=deferred(),h=harness();h.wait=()=>blocked.promise;const result=h.run(),request=await h.sent(),rejected=assert.rejects(result,{name:'AbortError'});request.onerror();await until(()=>h.delays.length===1);h.controller.abort();await rejected;
 blocked.resolve();await nextTurn();assert.equal(h.requests.length,1);assert.equal(h.probes.length,1);assert.deepEqual(h.progress,[0]);
});

for(const stalledBody of [false,true])test('receipt lookup timeout bounds a stalled '+(stalledBody?'body':'fetch')+' without a new intent',async()=>{
 const blocked=deferred(),entered=deferred(),h=harness({manualTimers:true});h.probe=()=>{if(h.probes.length>1)return Response.json({error:'Unknown upload'},{status:404});entered.resolve();return stalledBody?{status:200,ok:true,text:()=>blocked.promise}:blocked.promise;};
 const result=h.run(),first=await h.sent();first.onerror();await entered.promise;await nextTurn();const timer=h.timers.find(timer=>timer.ms===15000&&!timer.cleared);assert.ok(timer);timer.fn();const second=await h.sent(1);second.load(h.receipt());await result;
 assert.equal(second.url,first.url);assert.deepEqual(h.delays,[1000]);assert.equal(h.probes[0].options.signal.aborted,true);assert.equal(timer.cleared,true);blocked.resolve(stalledBody?'{}':h.lookup());await nextTurn();assert.equal(h.requests.length,2);
});

test('parallel calls cannot create two active browser uploads for one intent',async()=>{
 const h=harness(),result=h.run(),request=await h.sent();await assert.rejects(h.run(),/already being sent/);request.load(h.receipt());await result;assert.equal(h.requests.length,1);
});

test('an old server rejecting the new route never receives a legacy fallback POST',async()=>{
 const h=harness(),result=h.run(),request=await h.sent();request.load({error:'Not found'},404);await assert.rejects(result,{status:404});assert.equal(h.requests.length,1);assert.equal(request.url.endsWith('/uploads/'+h.intent.intentId),true);assert.equal(h.probes.length,0);
});
