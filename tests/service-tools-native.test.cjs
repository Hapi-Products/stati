const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const source=fs.readFileSync('desktop/main.cjs','utf8');
const user='11111111-1111-4111-8111-111111111111',device='22222222-2222-4222-8222-222222222222',service='33333333-3333-4333-8333-333333333333',operation='44444444-4444-4444-8444-444444444444';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const handlers={},calls=[],held={},plans=[],plan={id:service,title:'Imported service',songs:[]};let clears=0;
 const client={
  prepare:async(file,options)=>{options.checkActive();calls.push(['prepare',file]);return{sessionId:'native-handle',canImport:true};},
  stage:async(id,options)=>{options.checkActive();calls.push(['stage',id]);if(held.stage)await held.stage(options);options.checkActive();return{plan,songCount:2,audioCount:1,warnings:[]};},
  confirm:async(id,options)=>{options.checkActive();calls.push(['confirm',id]);},clear:()=>{clears++;},
 };
 const context={AbortController,AbortSignal,Map,Set,path,crypto,credential:'verified-device',quitting:false,sessionLocked:false,privacyUnlocked:true,operatorGeneration:1,activeOperator:{id:user,capabilities:{planServices:true,createSlides:true,editLyrics:true}},workspaceFileJobs:new Set(),powerPointExportJobs:new Map(),packageImportScope:null,prepareWindow:null,main:null,catalogConnection:null,
  fs:{realpath:async directory=>directory},libraryDirectory:async()=>held.directory||'/isolated/Lyrics',app:{getPath:name=>'/isolated/'+name},
  draftOperator:()=>{if(!context.activeOperator)throw Error('No profile');return{id:context.activeOperator.id,generation:context.operatorGeneration};},
  assertIdentity:generation=>{if(generation!==context.operatorGeneration)throw Error('Changed identity');},
  workspaceOperator:async capability=>{calls.push(['authorize',capability]);const generation=context.operatorGeneration;if(held.authorize)await held.authorize(capability);context.assertIdentity(generation);if(!context.activeOperator?.capabilities[capability])throw Error('Not allowed');return{id:user,deviceId:device,generation,capabilities:context.activeOperator.capabilities};},
  handle:(name,fn)=>{handlers[name]=fn;},
  catalogChanged:()=>calls.push(['catalog']),catalogPublisher:()=>({flush:async()=>{calls.push(['flush']);if(held.flush)await held.flush();}}),
  servicePlans:()=>({list:async id=>{calls.push(['list',id]);return plans;},change:async(id,action)=>{calls.push(['change',id,action]);if(!plans.some(p=>p.id===action.plan.id))plans.push(action.plan);if(held.change)await held.change();return plans;}}),
  playlistJobs:()=>({schedule:()=>calls.push(['schedule'])}),notifyServiceChange:()=>calls.push(['changed']),
  require:name=>{
   if(name==='electron')return{dialog:{showOpenDialog:async()=>{calls.push(['picker']);return held.picker?held.picker():{filePaths:['/native/chosen'],canceled:false};}}};
   if(name==='./service-package-import.cjs')return{createServicePackageImport:options=>{calls.push(['client',options]);return client;}};
   if(name==='./powerpoint-export-batch.cjs')return{exportPowerPointBatch:async options=>{options.checkActive();calls.push(['batch',options]);if(held.batch)return held.batch(options);return{results:[],total:options.items.length};}};
   throw Error('Unexpected native boundary '+name);
  },
 };
 vm.createContext(context);vm.runInContext(source.match(/^function clearPackageImport.*$/m)[0]+'\n'+source.slice(source.indexOf('async function withWorkspaceFiles('),source.indexOf('function draftOperator(')),context);
 return{context,handlers,calls,held,plans,plan,get clears(){return clears;}};
}
const batch={operationId:operation,items:[{id:service,name:'song.txt',data:{title:'Song',slides:[{text:'Song'}]}}]};
test('batch reserves its stop handle before authorization and stops even when cancellation arrives during authorization',async()=>{
 const f=fixture();let release;f.held.authorize=()=>new Promise(resolve=>{release=resolve;});const pending=f.handlers['powerpoint-batch-export'](batch);assert.equal(f.context.powerPointExportJobs.size,1);assert.equal((await f.handlers['powerpoint-batch-export-cancel'](operation)).stopping,true);release();const result=await pending;assert.equal(result.stopped,true);assert.ok(!f.calls.some(c=>c[0]==='picker'||c[0]==='batch'));assert.equal(f.context.workspaceFileJobs.size,0);assert.equal(f.context.powerPointExportJobs.size,0);
});
test('batch picker cancellation and explicit stop cannot publish; native folder owns the output path',async()=>{
 for(const stop of [false,true]){const f=fixture();f.held.picker=async()=>{if(stop)await f.handlers['powerpoint-batch-export-cancel'](operation);return{canceled:!stop,filePaths:['/native/chosen']};};const result=await f.handlers['powerpoint-batch-export']({...batch,directory:'/renderer/forged'});assert.equal(stop?result.stopped:result.canceled,true);assert.ok(!f.calls.some(c=>c[0]==='batch'));}
 const f=fixture();await f.handlers['powerpoint-batch-export']({...batch,directory:'/renderer/forged'});assert.equal(f.calls.find(c=>c[0]==='batch')[1].directory,'/native/chosen');
});
test('batch refuses overlapping jobs and another identity cannot stop or inherit a job',async()=>{
 const f=fixture();let release;f.held.picker=()=>new Promise(resolve=>{release=resolve;});const pending=f.handlers['powerpoint-batch-export'](batch);await turn();await assert.rejects(f.handlers['powerpoint-batch-export'](batch),/Finish or stop/);f.context.operatorGeneration++;await assert.rejects(f.handlers['powerpoint-batch-export-cancel'](operation),/profile changed/);release({filePaths:['/native/chosen']});await assert.rejects(pending,/Changed identity/);assert.equal(f.context.powerPointExportJobs.size,0);assert.ok(!f.calls.some(c=>c[0]==='batch'));
});
test('batch access loss at publication is rejected and cleanup releases all jobs',async()=>{
 const f=fixture();f.held.batch=async()=>{f.context.activeOperator.capabilities.createSlides=false;f.context.activeOperator.capabilities.editLyrics=false;return{results:[{status:'saved'}]};};await assert.rejects(f.handlers['powerpoint-batch-export'](batch),/access changed/);assert.equal(f.context.workspaceFileJobs.size,0);assert.equal(f.context.powerPointExportJobs.size,0);
});
test('package import requires both fresh capabilities before a picker or any stage, and cancels picker without writes',async()=>{
 for(const capability of ['planServices','editLyrics']){const f=fixture();f.context.activeOperator.capabilities[capability]=false;await assert.rejects(f.handlers['service-package-choose-import'](),/Not allowed/);await assert.rejects(f.handlers['service-package-import']('native-handle'),/Not allowed/);assert.ok(!f.calls.some(c=>['picker','prepare','stage','change'].includes(c[0])));}
 const f=fixture();f.held.picker=()=>({canceled:true});assert.equal((await f.handlers['service-package-choose-import']()).canceled,true);assert.ok(!f.calls.some(c=>c[0]==='prepare'||c[0]==='stage'));
});
test('package native path and recovery journal are scoped to verified device, operator and canonical Lyrics folder',async()=>{
 const f=fixture();await f.handlers['service-package-choose-import']({path:'/renderer/forged'});assert.equal(f.calls.find(c=>c[0]==='prepare')[1],'/native/chosen');const first=f.calls.find(c=>c[0]==='client')[1];assert.equal(first.lyricsDirectory,'/isolated/Lyrics');assert.ok(first.journalDirectory.includes(device+'/'+user+'/'));assert.equal(first.audioDirectory,'/isolated/documents/Stați/Imported Audio');f.held.directory='/other/Lyrics';await f.handlers['service-package-choose-import']();assert.equal(f.clears,1);const next=f.calls.filter(c=>c[0]==='client')[1][1];assert.notEqual(next.journalDirectory,first.journalDirectory);
});
test('package stages exact files and flushes catalog before authoritative service creation',async()=>{
 const f=fixture();const result=await f.handlers['service-package-import']('native-handle');assert.equal(result.serviceId,service);assert.equal(result.alreadyImported,false);assert.deepEqual(f.calls.filter(c=>['stage','list','catalog','flush','change','confirm'].includes(c[0])).map(c=>c[0]),['stage','list','catalog','flush','change','confirm']);const change=f.calls.find(c=>c[0]==='change');assert.equal(change[1],device);assert.equal(change[2].plan,f.plan);assert.equal(f.context.workspaceFileJobs.size,0);
});
test('a lost accepted service response retries its stable id without creating a second service or overwriting later edits',async()=>{
 const f=fixture();f.held.change=()=>{throw Error('Lost reply after acceptance');};await assert.rejects(f.handlers['service-package-import']('native-handle'),/Lost reply/);assert.equal(f.plans.length,1);assert.ok(!f.calls.some(c=>c[0]==='confirm'));f.plans[0]={...f.plan,title:'Later edited title'};const result=await f.handlers['service-package-import']('native-handle');assert.equal(result.alreadyImported,true);assert.equal(result.title,'Later edited title');assert.equal(f.plans.length,1);assert.equal(f.calls.filter(c=>c[0]==='change').length,1);assert.equal(f.calls.filter(c=>c[0]==='confirm').length,1);
});
test('package rejects edit-right loss during staging or catalog flush before service publication',async()=>{
 for(const boundary of ['stage','flush']){const f=fixture();f.held[boundary]=()=>{f.context.activeOperator.capabilities.editLyrics=false;};await assert.rejects(f.handlers['service-package-import']('native-handle'),/access changed/);assert.ok(!f.calls.some(c=>c[0]==='change'||c[0]==='confirm'));assert.equal(f.context.workspaceFileJobs.size,0);}
});
test('identity changes while package picker is open invalidate its native handle before preview',async()=>{
 const f=fixture();f.held.picker=()=>{f.context.operatorGeneration++;return{filePaths:['/native/chosen']};};await assert.rejects(f.handlers['service-package-choose-import'](),/Changed identity/);assert.ok(!f.calls.some(c=>c[0]==='prepare'));
});


test('closing the main workspace while native work or authorization is pending aborts publication and removes its listener',async()=>{
 for(const boundary of ['authorize','picker']){const f=fixture(),window=new(require('node:events').EventEmitter)();window.isDestroyed=()=>false;f.context.main=window;let release;f.held[boundary]=()=>new Promise(resolve=>{release=resolve;});const pending=f.handlers['powerpoint-batch-export'](batch);await turn();window.emit('closed');release({filePaths:['/native/chosen']});await assert.rejects(pending,{name:'AbortError'});assert.ok(!f.calls.some(c=>c[0]==='batch'));assert.equal(window.listenerCount('closed'),0);assert.equal(f.context.workspaceFileJobs.size,0);assert.equal(f.context.powerPointExportJobs.size,0);}
});
