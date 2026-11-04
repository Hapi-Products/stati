const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('desktop/main.cjs','utf8'),start=source.indexOf("handle('service-plans-change'"),end=source.indexOf("handle('song-library-info'",start);
function fixture(){const calls=[],handlers={};let generation=1;const operator={id:'person',deviceId:'station',generation:1,capabilities:{readSongs:true,planServices:false}},context={
 handle:(name,handler)=>handlers[name]=handler,
 workspaceOperator:async capability=>{assert.equal(capability,'readSongs');return operator;},
 activeOperator:{capabilities:operator.capabilities},
 legacyServicePlans:()=>({list:async()=>{calls.push('local-list');return[];},change:async()=>calls.push('local-change')}),
 servicePlans:()=>({change:async(id,action)=>{calls.push({id,action});return[];},state:async()=>({plans:[]})}),
 assertIdentity:expected=>{if(expected!==generation)throw Error('Identity changed');},playlistJobs:()=>({schedule:()=>calls.push('schedule')}),notifyServiceChange:()=>calls.push('notify'),viewServicePlans:async()=>[{id:'service'}],
 };vm.runInNewContext(source.slice(start,end),context);return{calls,operator,handler:handlers['service-plans-change'],changeIdentity:()=>generation++};}
test('a pastor can forward explicit service leadership and scoped saves to the authoritative station service',async()=>{const f=fixture();for(const type of ['claim-leadership','finalize-order','acknowledge-order','release-leadership','save']){const action={type,id:'service'};await f.handler(action);assert.ok(f.calls.some(call=>call.id==='station'&&call.action===action));}assert.ok(!f.calls.includes('local-change'));});
test('read-only leadership access cannot mutate local templates without the separate planning capability',async()=>{for(const type of ['template-save','template-create','template-archive']){const f=fixture();await assert.rejects(f.handler({type,id:'template'}),/role|allow|planning/i);assert.deepEqual(f.calls,[]);}});
test('native service changes reject unknown actions before forwarding',async()=>{const f=fixture();await assert.rejects(f.handler({type:'delete-all-services'}),/valid service action/);assert.deepEqual(f.calls,[]);});
