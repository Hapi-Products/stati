const {test}=require('node:test'),assert=require('node:assert/strict');
const {visibleState,visibleFiles}=require('../desktop/station-visibility.cjs');
const files=[{id:'mine',sender_id:'member',status:'delivered',saved:true},{id:'other',sender_id:'other',status:'queued'},{id:'legacy',status:'delivered'}];
function state(id='member',adminUnlocked=false){return{operatorGeneration:3,device:{operator_id:id},members:[{id:'member',role:'member'},{id:'other',role:'member'},{id:'admin',role:'admin'}],adminUnlocked,transfers:files,requests:[{id:'request'}],accessRequests:[{id:'access'}]};}
test('identified members share all station files, including saved files, without admin settings',()=>{
 assert.deepEqual(visibleFiles(state(),{id:'member'},3),files);assert.equal(visibleState(state(),{id:'member'},3).adminUnlocked,false);
 assert.deepEqual(visibleFiles(state('other'),{id:'other'},3),files);
});
test('choosing an admin name permits shared files but does not grant admin settings',()=>{
 assert.deepEqual(visibleFiles(state('admin'),{id:'admin'},3),files);assert.equal(visibleState(state('admin'),{id:'admin'},3).adminUnlocked,false);
 assert.deepEqual(visibleFiles(state('admin',true),{id:'admin'},3),files);
});
test('identity popup, stale polls and operator changes cannot expose cached files or requests',()=>{
 for(const [identity,generation,s] of [[null,3,state()],[{id:'member'},4,state()],[{id:'other'},3,state()],[{id:'removed'},3,state('removed')]]){
  const view=visibleState(s,identity,generation);
  assert.deepEqual(view.transfers,[]);assert.deepEqual(view.requests,[]);assert.deepEqual(view.accessRequests,[]);assert.equal(view.adminUnlocked,false);
 }
});
test('admin demotion removes privileged settings while preserving shared station files',()=>{
 const s=state('admin',true);s.members.find(m=>m.id==='admin').role='member';
 assert.deepEqual(visibleFiles(s,{id:'admin',role:'admin'},3),files);
 assert.equal(visibleState(s,{id:'admin'},3).adminUnlocked,false);
});
