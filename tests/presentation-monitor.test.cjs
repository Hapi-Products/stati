const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPresentationMonitor}=require('../desktop/presentation-monitor.cjs');
const warning={id:'pair',name:'Song.pro',kind:'missing-pro',message:'Missing from the ProPresenter library.'};
test('monitor coalesces work, throttles checks, and alerts only on changed issues',async()=>{
 let time=0,calls=0,release;const notifications=[],monitor=createPresentationMonitor({current:()=>({key:'authorized-profile'}),now:()=>time,sync:async()=>{calls++;if(calls===1)await new Promise(resolve=>{release=resolve;});return{warnings:[warning]};},onAttention:value=>notifications.push(value)});
 const first=monitor.tick(),second=monitor.tick();assert.equal(first,second);assert.equal(calls,1);release();await first;assert.equal(notifications.length,1);
 await monitor.tick();assert.equal(calls,1);time=60000;await monitor.tick();assert.equal(calls,2);assert.equal(notifications.length,1);
});
test('a lock or identity change discards late private issues and clear permits the next profile',async()=>{
 let context={key:'first'},release,calls=0;const notifications=[];const monitor=createPresentationMonitor({current:()=>context,sync:async()=>{calls++;if(calls===1)await new Promise(resolve=>{release=resolve;});return{warnings:[warning]};},onAttention:(_value,scope)=>notifications.push(scope.key)});
 const pending=monitor.tick();context=null;monitor.clear();release();await pending;await monitor.tick();assert.deepEqual(notifications,[]);assert.equal(calls,1);
 context={key:'second'};await monitor.tick();assert.deepEqual(notifications,['second']);
});
test('resolved warnings can alert again if a linked file later goes missing',async()=>{
 let time=0,missing=true;const notifications=[];const monitor=createPresentationMonitor({current:()=>({key:'profile'}),now:()=>time,sync:async()=>({warnings:missing?[warning]:[]}),onAttention:value=>notifications.push(value)});
 await monitor.tick();time+=60000;missing=false;await monitor.tick();time+=60000;missing=true;await monitor.tick();assert.equal(notifications.length,2);
});
test('shutdown waits for current work, and skipped or failed checks never invent a successful sync',async()=>{
 let release,finished=false;const errors=[],notifications=[];const monitor=createPresentationMonitor({current:()=>({key:'profile'}),sync:async()=>{await new Promise(resolve=>{release=resolve;});throw Error('Connection unavailable');},onError:error=>errors.push(error.message),onAttention:value=>notifications.push(value)});
 void monitor.tick();const drained=monitor.drain().then(()=>{finished=true;});await Promise.resolve();assert.equal(finished,false);release();await drained;assert.deepEqual(errors,['Connection unavailable']);assert.deepEqual(notifications,[]);
});
