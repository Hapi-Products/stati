const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const source=fs.readFileSync('desktop/main.cjs','utf8');
function fixture(mode='before-service'){
 const events=[],power=new EventEmitter(),timers=[];let busy=false,idle='locked';power.getSystemIdleState=()=>idle;
 const win={isDestroyed:()=>false,hide:()=>events.push('hide'),webContents:{send:(name,data)=>events.push([name,data.reason])}};
 const context={nativeHostConnection:{notify:event=>events.push(['native-event',event])},clearNativePreviews:async()=>events.push('native-previews-clear'),workspaceFileJobs:new Set(),packageImportScope:null,clearAudioPlayback:()=>events.push('audio-clear'),notificationExpiry:{closeAll:()=>events.push('notifications-clear')},localOperatorSelection:{clear:reason=>events.push(['lease-clear',reason]),activate:()=>true},pendingOperatorTicket:null,localPlaylistJobs:{cancel:()=>events.push('playlist-cancel')},playlistJobs:()=>({schedule(){}}),identityMode:mode,identitySkipped:false,sessionLocked:false,quitting:false,activeOperator:{id:'unit-admin',role:'admin'},backgroundOperatorId:null,operatorProof:'unit-proof',operatorGeneration:4,previewCache:new Map(),stopPreviewWork(){},pendingPrepare:{},stationPoll:Promise.resolve(),main:win,prepareWindow:null,credential:'unit-device',powerMonitor:power,process:{platform:'win32'},identityScreen:{dismiss:()=>events.push('window')},operatorRequest:async()=>events.push('remote-reset'),showMain:()=>{events.push('show');return win;},identityWindow:()=>events.push('identity'),setTimeout:fn=>{timers.push(fn);return{unref(){}};},require:()=>({isRunning:()=>busy})};
 vm.createContext(context);vm.runInContext(source.match(/^function abortWorkspaceFiles.*$/m)[0]+'\n'+source.match(/^function clearPackageImport.*$/m)[0],context);
 vm.runInContext(source.slice(source.indexOf('function clearOperator('),source.indexOf('function identityWindow('))+source.slice(source.indexOf('function resetSessionIdentity('),source.indexOf('function identitySettings(')),context);
 return{context,events,power,timers,setIdle:value=>{idle=value;},setBusy:value=>{busy=value;}};
}
test('Windows lock clears selected identity/proof immediately, hides the window, and repeated sleep/lock events do not reset a fresh choice twice',async()=>{
 const f=fixture();f.context.watchWindowsSession();f.power.emit('lock-screen');
 assert.equal(f.context.activeOperator,null);assert.equal(f.context.operatorProof,null);assert.equal(f.context.operatorGeneration,5);assert.equal(f.context.sessionLocked,true);
 assert.ok(f.events.some(event=>Array.isArray(event)&&event[0]==='native-event'&&event[1]==='workspace-reset'));assert.ok(f.events.includes('native-previews-clear'));assert.ok(f.events.includes('playlist-cancel'));assert.ok(f.events.includes('hide'));assert.ok(f.events.some(e=>Array.isArray(e)&&e[0]==='identity-required'));
 assert.equal(f.events.filter(event=>event==='notifications-clear').length,1,'Lock removes any already-shown private toast details');
 f.power.emit('suspend');assert.equal(f.context.operatorGeneration,5);
 f.power.emit('unlock-screen');assert.equal(f.context.sessionLocked,false);assert.ok(f.events.includes('show'));assert.ok(f.events.includes('identity'));
 const count=f.events.length;f.power.emit('unlock-screen');f.power.emit('resume');assert.equal(f.events.length,count);
});
test('a locked conversion can be reauthenticated by its original operator; another profile cannot inherit its hidden workspace',()=>{
 const f=fixture();f.setBusy(true);f.context.resetSessionIdentity('lock');assert.equal(f.context.backgroundOperatorId,'unit-admin');
 f.context.downloadsInFlight=new Set();
 vm.runInContext(source.slice(source.indexOf('function assertOperatorChangeAllowed('),source.indexOf('async function activateOperator(')),f.context);
 assert.doesNotThrow(()=>f.context.assertOperatorChangeAllowed('unit-admin'));assert.throws(()=>f.context.assertOperatorChangeAllowed('other-admin'),/previous operator/);assert.throws(()=>f.context.assertOperatorChangeAllowed(null),/previous operator/);
 f.context.activeOperator={id:'unit-admin'};assert.throws(()=>f.context.assertOperatorChangeAllowed('unit-admin'),/previous operator/);
 f.setBusy(false);f.context.activeOperator=null;f.context.downloadsInFlight.add('queued-admin-file');assert.doesNotThrow(()=>f.context.assertOperatorChangeAllowed('other-admin'));assert.throws(()=>f.context.assertOperatorChangeAllowed(null),/Finish saving/);
});
test('phone approval for a different administrator during a locked conversion cannot retain a privileged proof',async()=>{
 const f=fixture();f.setBusy(true);f.context.resetSessionIdentity('lock');f.context.downloadsInFlight=new Set();
 f.context.assertIdentity=generation=>{if(generation!==f.context.operatorGeneration)throw Error('Changed');};
 f.context.request=async()=>({device:{operator_id:'other-admin'},members:[{id:'other-admin',role:'admin'}],adminUnlocked:true});
 f.context.operatorRequest=async()=>({approved:true,proof:'unit-other-proof'});
 vm.runInContext(source.slice(source.indexOf('function assertOperatorChangeAllowed('),source.indexOf("\nhandle('pair'")),f.context);
 await assert.rejects(f.context.activateOperator({userId:'other-admin',generation:f.context.operatorGeneration,startedAt:0},{approved:true,proof:'unit-other-proof'}),/previous operator/);assert.equal(f.context.operatorProof,null);assert.equal(f.context.activeOperator,null);
});
test('resume never reveals a still-locked Windows desktop; unlocked sleep resumes exactly once',()=>{
 const f=fixture();f.context.watchWindowsSession();f.power.emit('suspend');f.power.emit('resume');f.timers.shift()();assert.equal(f.context.sessionLocked,true);assert.ok(!f.events.includes('show'));
 f.setIdle('active');f.power.emit('resume');f.timers.shift()();assert.equal(f.context.sessionLocked,false);assert.equal(f.events.filter(e=>e==='show').length,1);
});
test('automatic off prevents popup on unlock while still clearing the admin proof',()=>{
 const f=fixture('off');f.context.resetSessionIdentity('lock');f.context.resumeSessionIdentity();assert.equal(f.context.operatorProof,null);assert.equal(f.context.activeOperator,null);assert.ok(!f.events.includes('show'));assert.ok(!f.events.includes('identity'));
});
test('operator mutations serialize a delayed OS reset before a new selection even if the prior request failed',async()=>{
 const calls=[];let finish;
 const context={localOperatorSelection:{privateAuthority:()=>null},credential:'captured-device',operatorProof:null,operatorRequests:Promise.reject(Error('Prior failed')),request:async(endpoint)=>{calls.push(endpoint);if(endpoint==='reset')await new Promise(resolve=>{finish=resolve;});return endpoint;}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function operatorRequest('),source.indexOf('let updateController;')),context);
 const reset=context.operatorRequest('reset'),select=context.operatorRequest('new-selection');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['reset']);finish();await Promise.all([reset,select]);assert.deepEqual(calls,['reset','new-selection']);
});
test('startup preferences require the currently verified admin; selecting a name, stale state, or a member cannot change them',async()=>{
 let save;
 const writes=[],context={operatorGeneration:4,activeOperator:{id:'unit-admin',role:'admin'},identityMode:'before-service',main:null,
  handle:(name,fn)=>{if(name==='identity-settings-save')save=fn;},require:require('node:module').createRequire(require('node:path').resolve('desktop/main.cjs')),assertIdentity:generation=>{if(generation!==context.operatorGeneration)throw Error('Changed user');},
  writeJson:async(...args)=>writes.push(args),syncClockStartup:()=>writes.push('startup'),identityScreen:{recheck(){}},identitySettings:()=>({mode:context.identityMode})};
 let state={paired:true,operatorGeneration:4,device:{operator_id:'unit-admin'},members:[{id:'unit-admin',role:'admin'}],adminUnlocked:false,transfers:[],requests:[]};context.sharedStationPoll=async()=>state;
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf("handle('identity-settings-save'"),source.indexOf('\nfunction notify(',source.indexOf("handle('identity-settings-save'"))),context);
 await assert.rejects(save('off'),/administrator/);assert.deepEqual(writes,[]);
 state.adminUnlocked=true;state.operatorGeneration=3;await assert.rejects(save('off'),/administrator/);
 state.operatorGeneration=4;state.members[0].role='member';await assert.rejects(save('off'),/administrator/);
 state.members[0].role='admin';assert.equal((await save('off')).mode,'off');assert.equal(writes.length,2);assert.equal(writes[0][0],'identity-settings.json');
 await assert.rejects(save('always-fullscreen'),/Choose/);
});

test('Windows identity lock aborts pending rehearsal and export work before clearing its selected profile',()=>{const f=fixture(),controller=new AbortController();f.context.workspaceFileJobs.add(controller);f.context.resetSessionIdentity('lock');assert.equal(controller.signal.aborted,true);assert.equal(f.context.activeOperator,null);});

test('Windows lock discards package handles and aborts batch jobs before profile clearing',()=>{const f=fixture(),controller=new AbortController();let cleared=0;f.context.workspaceFileJobs.add(controller);f.context.packageImportScope={client:{clear:()=>cleared++}};f.context.resetSessionIdentity('lock');assert.equal(cleared,1);assert.equal(f.context.packageImportScope,null);assert.equal(controller.signal.aborted,true);});
