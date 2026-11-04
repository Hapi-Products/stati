const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('src/web/upload-batch.ts','utf8').replace(/^import .*\n/gm,''),{mode:'transform'}).replace(/\bexport /g,'');
function fixture(){let ids=0;const scope={DOMException,createUploadIntent:(originalFile,deviceId)=>({originalFile,deviceId,intentId:'isolated-intent-'+(++ids),createdAt:0}),uploadWithRetry:()=>{throw Error('A local injected delivery is required.');}};vm.createContext(scope);vm.runInContext(source+'\nthis.createUploadBatch=createUploadBatch;',scope);return scope.createUploadBatch;}
const file=name=>new File(['lyrics'],name),receipt=(intent,status='queued')=>({id:'isolated-transfer-'+intent.intentId,intentId:intent.intentId,deviceId:intent.deviceId,status});
const stopped=()=>new DOMException('Stopped.','AbortError');
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}

test('selection keeps one intent for each original File and destination across rerenders and reordering',()=>{
 const batch=fixture()(),a=file('A.txt'),b=file('B.txt'),first=batch.select([a,b],['pc1','pc2']);
 assert.equal(first.length,4);assert.equal(batch.select([b,a],['pc2','pc1'])[3],first[0]);
 assert.equal(batch.select([a,a],['pc1','pc1']).length,1);
 assert.notEqual(batch.select([file('A.txt')],['pc1'])[0].intent.intentId,first[0].intent.intentId);
 assert.equal(first[0].intent.originalFile,a);
});
test('retry after a partly successful multi-file multi-computer batch sends only the unresolved original intent',async()=>{
 const batch=fixture()(),tasks=batch.select([file('A.txt'),file('B.txt')],['pc1','pc2']),calls=[];let failed=false;
 const deliver=async(_target,intent)=>{calls.push(intent.intentId);if(intent===tasks[1].intent&&!failed){failed=true;throw Error('Connection interrupted.');}return receipt(intent);};
 await batch.run(tasks,{signal:new AbortController().signal,deliver});
 assert.equal(tasks.filter(entry=>entry.receipt).length,3);assert.equal(tasks[1].state,'failed');
 await batch.run(batch.select(tasks.map(x=>x.file),['pc1','pc2']),{signal:new AbortController().signal,deliver});
 assert.equal(calls.length,5);assert.equal(calls.at(-1),tasks[1].intent.intentId);
 assert.equal(new Set(calls).size,4);assert.ok(tasks.every(entry=>entry.receipt));
});
test('rejected and expired receipts are retained outcomes and require an explicit new send',async()=>{
 const batch=fixture()(),tasks=batch.select([file('A.txt')],['pc1','pc2']);let calls=0;
 const deliver=async(_target,intent)=>receipt(intent,++calls===1?'rejected':'expired');
 await batch.run(tasks,{signal:new AbortController().signal,deliver});await batch.run(tasks,{signal:new AbortController().signal,deliver});
 assert.equal(calls,2);const previous=tasks.map(entry=>entry.intent.intentId);batch.again(tasks);
 const next=batch.select([tasks[0].file],['pc1','pc2']);assert.ok(next.every(entry=>!entry.receipt&&!previous.includes(entry.intent.intentId)));
});
test('an uncertain operation cannot be reset into a duplicate fresh intent',async()=>{
 const batch=fixture()(),tasks=batch.select([file('A.txt')],['pc1']);
 await batch.run(tasks,{signal:new AbortController().signal,deliver:async()=>{throw Error('Unknown outcome.');}});
 assert.throws(()=>batch.again(tasks),/Retry the remaining/);assert.equal(batch.select([tasks[0].file],['pc1'])[0],tasks[0]);
});
test('cancellation ignores late acceptance and progress, then retries the same original intent',async()=>{
 const batch=fixture()(),tasks=batch.select([file('A.txt'),file('B.txt')],['pc1']),controller=new AbortController(),gate=deferred(),updates=[];let activeOptions,calls=0;
 const pending=batch.run(tasks,{signal:controller.signal,onProgress:p=>updates.push(p.loaded),deliver:async(_target,intent,options)=>{calls++;activeOptions=options;await gate.promise;return receipt(intent);}});
 await Promise.resolve();controller.abort();activeOptions.progress(6);gate.resolve();await pending;
 assert.equal(calls,2);assert.ok(tasks.every(entry=>entry.state==='stopped'&&!entry.receipt));assert.deepEqual(updates,[]);
 const first=tasks[0].intent;await batch.run(tasks,{signal:new AbortController().signal,deliver:async(_target,intent)=>{if(!calls++)assert.fail();return receipt(intent);}});
 assert.equal(tasks[0].intent,first);assert.ok(tasks.every(entry=>entry.receipt));
});
test('an already stopped batch starts no sends and remains usable for explicit retry',async()=>{
 const batch=fixture()(),tasks=batch.select([file('A.txt')],['pc1']),controller=new AbortController();controller.abort();let calls=0;
 const deliver=async(_target,intent)=>{calls++;return receipt(intent);};await batch.run(tasks,{signal:controller.signal,deliver});assert.equal(calls,0);
 await batch.run(tasks,{signal:new AbortController().signal,deliver});assert.equal(calls,1);
});
test('batch reservation rejects concurrent starts or reset, then releases after completion',async()=>{
 const batch=fixture()(),tasks=batch.select([file('A.txt')],['pc1']),gate=deferred();
 const pending=batch.run(tasks,{signal:new AbortController().signal,deliver:async(_target,intent)=>{await gate.promise;return receipt(intent);}});
 await assert.rejects(batch.run(tasks,{signal:new AbortController().signal}),/already being sent/);assert.throws(()=>batch.again(tasks),/Finish or stop/);
 gate.resolve();await pending;batch.again(tasks);
});
test('retry progress counts previously accepted bytes once and never exceeds the selected total',async()=>{
 const batch=fixture()(),tasks=batch.select([file('A.txt'),file('B.txt')],['pc1']),progress=[];let fail=true;
 const deliver=async(_target,intent,options)=>{options.progress(999);if(intent===tasks[1].intent&&fail){fail=false;throw Error('Interrupted.');}return receipt(intent);};
 await batch.run(tasks,{signal:new AbortController().signal,deliver});
 await batch.run(tasks,{signal:new AbortController().signal,deliver,onProgress:value=>progress.push(value)});
 assert.ok(progress.length);assert.ok(progress.every(value=>value.loaded<=12&&value.total===12));assert.equal(progress.at(-1).loaded,12);
});
test('separate account workspaces never share operation identities for the same selected file',()=>{
 const create=fixture(),a=create(),b=create(),selected=file('A.txt');assert.notEqual(a.select([selected],['pc1'])[0].intent.intentId,b.select([selected],['pc1'])[0].intent.intentId);
});

test('uploads overlap up to three requests and keep aggregate progress bounded across retry resets',async()=>{
 const batch=fixture()(),tasks=batch.select(Array.from({length:7},(_,i)=>file(i+'.txt')),['pc1']),gate=deferred(),started=[],updates=[];let active=0,peak=0;
 const pending=batch.run(tasks,{signal:new AbortController().signal,onProgress:p=>updates.push(p.loaded),deliver:async(_target,intent,options)=>{started.push(intent);peak=Math.max(peak,++active);options.progress(3);options.progress(0);await gate.promise;active--;return receipt(intent);}});
 await Promise.resolve();assert.equal(started.length,3);assert.equal(peak,3);gate.resolve();await pending;assert.equal(started.length,7);assert.equal(peak,3);assert.ok(tasks.every(entry=>entry.receipt));assert.ok(updates.every((n,i)=>n<=42&&(!i||n>=updates[i-1])));assert.equal(updates.at(-1),42);
});
test('large files respect the 64 MB in-flight limit and cancellation starts no queued uploads',async()=>{
 const batch=fixture()(),large=size=>({name:size+'.pptx',size}),tasks=batch.select([large(40*1024*1024),large(40*1024*1024),large(10*1024*1024),large(20*1024*1024)],['pc1']),gate=deferred(),controller=new AbortController(),started=[];
 const pending=batch.run(tasks,{signal:controller.signal,deliver:async(_target,intent)=>{started.push(intent);await gate.promise;return receipt(intent);}});await Promise.resolve();assert.equal(started.length,2);assert.equal(started.reduce((n,intent)=>n+intent.originalFile.size,0),50*1024*1024);controller.abort();gate.resolve();await pending;assert.equal(started.length,2);assert.equal(tasks.filter(entry=>entry.state==='ready').length,2);assert.ok(tasks.every(entry=>!entry.receipt));
});
