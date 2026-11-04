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

test('saving a running order publishes fresh local song references before the cloud validates them',async()=>{
 const context={credential:'fixture',deviceId:'station',userId:'admin',generation:1},order=[];let published=false;
 const store=createSharedServiceStore({current:()=>context,local:{replaceSharedSnapshot:async()=>order.push('cache'),flush:async()=>{}},beforeAttach:async()=>{published=true;order.push('catalog');},send:async()=>{order.push('cloud');if(!published)throw Error('A selected song changed or is no longer available');return{plans:[],activeServiceId:null};}});
 await store.change('station',{type:'save',id:'service',plan:{songs:[{songId:'local',contentHash:'fresh'}]}});
 assert.deepEqual(order,['catalog','cloud','cache']);
});
test('a failed catalog publication prevents a running-order write and preserves the cached draft',async()=>{
 const context={credential:'fixture',deviceId:'station',userId:'admin',generation:1};let writes=0,caches=0;
 const store=createSharedServiceStore({current:()=>context,local:{replaceSharedSnapshot:async()=>caches++,flush:async()=>{}},beforeAttach:async()=>{throw Error('Catalog offline');},send:async()=>{writes++;return{plans:[]};}});
 await assert.rejects(store.change('station',{type:'save',plan:{songs:[{}]}}),/Catalog offline/);assert.equal(writes,0);assert.equal(caches,0);
});

test('notes autosaves with unchanged song references do not rescan the whole library',async()=>{
 const context={credential:'fixture',deviceId:'station',userId:'admin',generation:1},songs=[{songId:'song',contentHash:'same'}];let scans=0;
 const store=createSharedServiceStore({current:()=>context,local:{state:async()=>({plans:[{songs}]}),replaceSharedSnapshot:async()=>{},flush:async()=>{}},beforeAttach:async()=>scans++,send:async()=>({plans:[]})});
 await store.change('station',{type:'save',plan:{songs,notes:'Edited notes'}});assert.equal(scans,0);
});
