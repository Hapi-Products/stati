const {test}=require('node:test'),assert=require('node:assert/strict');
const {createSharedServiceStore}=require('../desktop/shared-services.cjs');
test('shared plans use the station key and cache only the authoritative response',async()=>{
 const context={credential:'isolated',deviceId:'station',userId:'person',generation:1},calls=[],snapshot={plans:[{id:'service',revision:3}],activeServiceId:'service'};
 const store=createSharedServiceStore({current:()=>context,local:{replaceSharedSnapshot:async(...args)=>calls.push(args),flush:async()=>{}},send:async()=>snapshot});
 assert.equal(await store.active('station'),'service');assert.deepEqual(calls,[['station',snapshot]]);await assert.rejects(store.list('person'),/Choose your profile/);
});
test('a late cloud response cannot commit after a profile or computer changes',async()=>{
 let context={credential:'isolated',deviceId:'station',userId:'one',generation:1},finish;const cached=[],store=createSharedServiceStore({current:()=>context,local:{replaceSharedSnapshot:async value=>cached.push(value),flush:async()=>{}},send:()=>new Promise(resolve=>finish=resolve)});
 const pending=store.list('station');await new Promise(resolve=>setImmediate(resolve));context={...context,userId:'two',generation:2};finish({plans:[],activeServiceId:null});await assert.rejects(pending,/selected user/);assert.equal(cached.length,0);
});
test('new songs publish their catalog before attachment and a failed cloud save keeps the local snapshot',async()=>{
 const order=[],context={credential:'fixture',deviceId:'station',userId:'admin',generation:1};const store=createSharedServiceStore({current:()=>context,local:{replaceSharedSnapshot:async()=>order.push('cache'),flush:async()=>{}},beforeAttach:async()=>order.push('catalog'),send:async()=>{order.push('cloud');throw Error('Conflict');}});
 await assert.rejects(store.change('station',{type:'attach-songs'}),/Conflict/);assert.deepEqual(order,['catalog','cloud']);
});
