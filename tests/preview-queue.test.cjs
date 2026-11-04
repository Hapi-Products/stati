const {test}=require('node:test'),assert=require('node:assert/strict'),{createPreviewQueue}=require('../desktop/preview-queue.cjs');
const deferred=()=>{let resolve;return{promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)};},settle=()=>new Promise(resolve=>setImmediate(resolve));
test('preview work is bounded, coalesces duplicate requests and resumes after a failure',async()=>{
 const queue=createPreviewQueue(),a=deferred(),b=deferred(),calls=[];
 const first=queue.run('a',()=>{calls.push('a');return a.promise;}),second=queue.run('b',()=>{calls.push('b');return b.promise;}),third=queue.run('c',()=>{calls.push('c');return 3;});assert.equal(queue.run('a',()=>{throw Error('Duplicate must not run');}),first);
 await settle();assert.deepEqual(calls,['a','b']);a.resolve(1);assert.equal(await first,1);await settle();assert.deepEqual(calls,['a','b','c']);b.resolve(2);assert.deepEqual(await Promise.all([second,third]),[2,3]);await assert.rejects(queue.run('bad',()=>{throw Error('Parser failed');}),/Parser failed/);assert.equal(await queue.run('next',()=>4),4);
});
test('clearing a profile rejects queued jobs and an overload cannot start another parser',async()=>{
 const queue=createPreviewQueue({concurrency:1,maxWaiting:1}),a=deferred(),started=[];
 const first=queue.run('old:1',()=>{started.push(1);return a.promise;}),second=queue.run('old:2',()=>{started.push(2);});const rejected=assert.rejects(second,/selected user changed/);
 await assert.rejects(queue.run('old:3',()=>{started.push(3);}),/still loading/);queue.clear();await rejected;a.resolve();await first;await settle();assert.deepEqual(started,[1]);assert.equal(await queue.run('new:1',()=>7),7);
});
