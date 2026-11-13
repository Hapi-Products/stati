const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');
const mainPath=path.resolve(__dirname,'../desktop/main.cjs');
const source=fs.readFileSync(mainPath,'utf8'),localRequire=createRequire(mainPath);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const drain=async()=>{for(let i=0;i<3;i++)await settle();};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const transfer=(id,role='admin')=>({id,filename:'song.txt',bytes:14,content_type:'text/plain',status:'queued',created_at:1,sender_role:role,sender_id:'sender-fixture-00000000000001',first_name:'Fixture',last_initial:'T'});
const deliveryGets=f=>f.http().filter(call=>call[1]==='GET'&&/^\/station\/transfers\/[\w-]+$/.test(call[2]));
const deliveryAcks=f=>f.http().filter(call=>call[1]==='POST'&&call[2].endsWith('/delivered'));
const failures=f=>f.calls.filter(call=>call[0]==='notification'&&call[1].title==='Stați · Save failed');

// Evaluate the actual main process with Electron, disk and HTTP boundaries mocked.
// No real credentials, login entries, network requests or files are changed.
function fixture({platform='win32',startup=true,mode='off',paired=true,route,transfers=[],history=[],receipts={},notifications=false,dialogResponse=0,canonicalDownloads="/mock/downloads",at,leaseClock,modules={}}={}){
 const calls=[],windows=[],trays=[],handlers=new Map(),intervals=[],timeouts=[];
 const app=new EventEmitter(),power=new EventEmitter(),theme=new EventEmitter();
 const hooks={},savedFiles=new Set(Object.values(receipts)),checkpoints=new Map(),historyRows=new Map(history.map(row=>[row.id,{...row}]));
 const diskFiles=new Map(paired?[['/mock/userData/device.bin',Buffer.from('sealed-device')]]:[]);
 let savedReceipts={...receipts},serverTransfers=transfers,serverOperator=null,now=at?Date.parse(at):Date.now();
 let start,api,leaseNumber=0,busy=false,installError=false;
 const missing=()=>Object.assign(Error('missing fixture file'),{code:'ENOENT'});
 const event=()=>({prevented:false,preventDefault(){this.prevented=true;}});
 class Window extends EventEmitter{
  constructor(options={}){super();this.options=options;this.visible=options.show!==false;this.destroyed=false;this.hides=0;this.closes=0;this.webContents=new EventEmitter();this.webContents.mainFrame={url:pathToFileURL(path.join(path.dirname(mainPath),'index.html')).href};this.webContents.setWindowOpenHandler=()=>{};this.webContents.getURL=()=>this.webContents.mainFrame.url;this.webContents.isLoading=()=>false;this.webContents.send=(...args)=>calls.push(['send',...args]);windows.push(this);}
  loadFile(){} isDestroyed(){return this.destroyed;} isMinimized(){return false;}
  show(){this.visible=true;} focus(){} restore(){} hide(){this.visible=false;this.hides++;}
  setTitleBarOverlay(){} setBackgroundColor(){} getBounds(){return{x:0,y:0,width:500,height:640};}
  close(){const e=event();this.closes++;this.emit('close',e);if(!e.prevented){this.destroyed=true;this.emit('closed');}return e;}
 }
 class Tray extends EventEmitter{
  constructor(icon){super();this.icon=icon;this.destroyed=false;trays.push(this);}
  setToolTip(value){this.toolTip=value;} setContextMenu(menu){this.menu=menu;}
  destroy(){this.destroyed=true;}
 }
 class Notice extends EventEmitter{
  static isSupported(){return notifications;}
  constructor(options){super();this.options=options;}
  show(){calls.push(['notification',this.options]);}
  close(){}
 }
 Object.assign(app,{isPackaged:true,setAppUserModelId(){},requestSingleInstanceLock:()=>true,isReady:()=>true,
  getPath:name=>'/mock/'+name,getVersion:()=> '0.1.0',whenReady:()=>({then(fn){start=fn;}}),
  setLoginItemSettings:settings=>calls.push(['login',settings]),quitCalls:0,completedQuits:0,
  quit(){this.quitCalls++;const e=event();this.emit('before-quit',e);this.lastQuitPrevented=e.prevented;if(!e.prevented){for(const win of windows)if(!win.isDestroyed())win.close();this.emit('will-quit');this.completedQuits++;}}
 });
 power.getSystemIdleState=()=> 'active';theme.shouldUseDarkColors=false;
 const image={resize(){return this;},isEmpty:()=>false,getSize:()=>({width:1,height:1}),toDataURL:()=>'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfQoAAAAASUVORK5CYII='};
 const electron={app,BrowserWindow:Window,Tray,Menu:{buildFromTemplate:value=>value,setApplicationMenu(){}},ipcMain:Object.assign(new EventEmitter(),{handle:(name,fn)=>handlers.set(name,fn)}),
  safeStorage:{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'protected',encryptString:value=>Buffer.from('sealed:'+value),decryptString:value=>value.toString()==='sealed-device'?'device-fixture':value.toString().startsWith('sealed:')?value.toString().slice(7):'access-fixture'},
  shell:{},screen:new EventEmitter(),Notification:Notice,desktopCapturer:{},nativeTheme:theme,
  protocol:{registerSchemesAsPrivileged(){},handle(){}},net:{},nativeImage:{createFromPath:()=>image,createFromBuffer:bytes=>{calls.push(['photo-decode',bytes.length]);return image;}},systemPreferences:{},powerMonitor:power,
  dialog:{showMessageBox:async()=>{calls.push(['dialog']);return{response:dialogResponse};},showOpenDialog:async(...args)=>hooks.showOpenDialog?hooks.showOpenDialog(...args):{canceled:true,filePaths:[]}}
 };
 electron.screen.getDisplayMatching=()=>({workArea:{x:0,y:0,width:1920,height:1080}});
 const disk={
  async readFile(file,encoding){if(diskFiles.has(file)){const bytes=Buffer.from(diskFiles.get(file));return encoding==='utf8'?bytes.toString():bytes;}const name=path.basename(file);if(name==='identity-settings.json')return JSON.stringify({mode});if(name==='clocks.json')return '[]';if(name==='deliveries.json')return JSON.stringify(savedReceipts);if(name==='station-history.json')return JSON.stringify(Object.fromEntries(historyRows));if(name==='hidden-history.json')return '[]';throw missing();},
  async mkdir(){},async realpath(file){calls.push(["realpath",file]);return file==="/mock/downloads"?canonicalDownloads:file;},
  async writeFile(file,data,options){const bytes=Buffer.from(data);calls.push(['disk-write',file,Buffer.from(bytes),options]);await hooks.writeFile?.(file,bytes,options);diskFiles.set(file,bytes);},
  async rename(from,to){calls.push(['disk-rename',from,to]);await hooks.rename?.(from,to);if(!diskFiles.has(from))throw missing();diskFiles.set(to,diskFiles.get(from));diskFiles.delete(from);},
  async unlink(file){calls.push(['unlink',file]);await hooks.unlink?.(file);diskFiles.delete(file);},
  async access(file){if(!savedFiles.has(file))throw missing();},async stat(file){const custom=await hooks.stat?.(file);if(custom!==undefined)return custom;if(!savedFiles.has(file))throw missing();return{size:14,mtimeMs:now,isFile:()=>true,isSymbolicLink:()=>false};},async lstat(file){return this.stat(file);}
 };
 const identity={status:()=>({presentation:'window'}),show:()=>calls.push(['identity']),dismiss:()=>calls.push(['dismiss']),hide:win=>{calls.push(['identity-hide']);win.hide();},workspace(){},close:()=>calls.push(['identity-close']),themeChanged(){},recheck(){}};
 const updates={enabled:false,getState:()=>({}),check:async()=>({}),async install(){await this.options.beforeInstall();if(installError)throw Error('Fixture installer launch failed');return{};}};
 function load(name){
  if(Object.hasOwn(modules,name))return modules[name];
  if(name==='electron')return electron;if(name==='node:fs/promises')return disk;
  if(name==='node:child_process')return{execFile:()=>{}};
  if(name==='qrcode')return{toDataURL:async()=> 'fixture-qr'};
  if(name==='./notification-lifetime.cjs')return{notificationLifetime:()=>({track(){},closeAll(){}})};
  if(name==='./identity-window.cjs')return{createIdentityWindow:()=>identity};
  if(name==='./operator-selection.cjs'&&leaseClock){const helper=localRequire(name);return{...helper,createOperatorSelection:options=>helper.createOperatorSelection({...options,now:leaseClock.now,timers:leaseClock.timers})};}
  if(name==='./identity-policy.cjs')return{...localRequire(name),canSkipIdentity:()=>localRequire(name).canSkipIdentity(now)};
  if(name==='./advanced.cjs')return{};
  if(name==='./powerpoint-batch.cjs')return{isRunning:()=>busy,cancel:()=>{calls.push(['cancel-conversion']);busy=false;}};
  if(name==='./station-files.cjs')return{
   ...localRequire(name),
   async readReceipts(){await hooks.readReceipts?.();return {...savedReceipts};},
   async mergeHistory(_file,rows,options={}){await hooks.mergeHistory?.(rows);await options.beforeCommit?.();for(const row of rows){const old=historyRows.get(row.id),next={...old,...row};if(row.status==='queued'&&['delivered','rejected','expired','unavailable'].includes(old?.status)){next.status=old.status;next.rejection_reason=old.rejection_reason;next.remoteAvailable=false;}historyRows.set(row.id,next);}return [...historyRows.values()];},
   async saveReceipt(_file,id,location,options={}){calls.push(['receipt',id,location]);await hooks.saveReceipt?.(id,location);await options.beforeCommit?.();savedReceipts[id]=location;},
   async renameSavedFile(_file,id,stem,options={}){calls.push(['rename',id,stem]);await hooks.renameSavedFile?.({id,stem,...options});await options.beforeCommit?.();const previous=savedReceipts[id];if(!previous)throw Error('Save this file first.');const renamed=path.join(path.dirname(previous),stem+path.extname(previous));savedFiles.delete(previous);savedFiles.add(renamed);savedReceipts[id]=renamed;return{path:renamed,filename:path.basename(renamed)};},
  };
  if(name==='./transfer-retry.cjs')return{createTransferRetry:options=>localRequire(name).createTransferRetry({...options,now:()=>now})};
  if(name==='./transfer-download.cjs')return{async writeDownload(response,temporaryPath,options){calls.push(['download',temporaryPath]);await hooks.download?.(response,temporaryPath,options);return{bytes:14,sha256:'a'.repeat(64),verified:true};}};
  if(name==='./delivery-recovery.cjs')return{
   async recoverDelivery(options){calls.push(['recover',options.id]);await hooks.recoverDelivery?.(options);await options.checkActive?.();if(options.signal?.aborted)throw options.signal.reason;const result=checkpoints.get(options.id);if(result)savedFiles.add(result.path);return result||null;},
   async prepareDelivery(options){calls.push(['prepare',options.id]);await options.checkActive?.();const result={path:path.join(options.downloadsDirectory,options.filename),integrity:'sha256'};checkpoints.set(options.id,result);await hooks.prepareDelivery?.(options);await options.checkActive?.();if(options.signal?.aborted)throw options.signal.reason;savedFiles.add(result.path);return result;},
   async verifyDelivery(options){calls.push(['verify',options.id]);await hooks.verifyDelivery?.(options);await options.checkActive?.();if(options.signal?.aborted)throw options.signal.reason;return true;},
   async completeDelivery(options){calls.push(['complete',options.id]);await hooks.completeDelivery?.(options);checkpoints.delete(options.id);},
  };
  if(name==='./updates.cjs')return{createUpdates:options=>{updates.options=options;return updates;}};
  if(name==='./build-release-guard.cjs')return{requireBuildsAllowed:async()=>{}};
  return localRequire(name);
 }
 const context=vm.createContext({console,Buffer,URL,Headers,Response,AbortSignal,AbortController,
  process:{platform,execPath:'C:\\Stati\\Stati.exe',argv:startup?['Stati.exe','--stati-startup']:['Stati.exe'],env:{},on(){}},
  setInterval:(fn,ms)=>{intervals.push({fn,ms});return{unref(){}};},
  setTimeout:(fn,ms)=>{timeouts.push({fn,ms});return{unref(){}};},clearTimeout(){},
  async fetch(url,options={}){
   const endpoint=new URL(url).pathname.slice(4),method=options.method||'GET';calls.push(['http',method,endpoint,options]);
   const custom=await route?.({endpoint,method,options,calls});if(custom!==undefined)return custom;
   let data={};
   if(endpoint==='/devices/pair/status')data={id:'station-fixture',name:'Isolated fixture PC',paired:true};
   if(endpoint==='/station/state')data={device:{id:'station-fixture',operator_id:serverOperator?.id||null},members:serverOperator?[serverOperator]:[],adminUnlocked:serverOperator?.role==='admin',transfers:serverTransfers,requests:[],accessRequests:[],accessApprover:'operator'};
   if(method==='GET'&&/^\/station\/transfers\/[\w-]+$/.test(endpoint))return new Response('fixture lyrics',{headers:{'Content-Length':'14','Content-Disposition':"attachment; filename*=UTF-8''song.txt",'X-Checksum-SHA256':'a'.repeat(64)}});
   if(endpoint==='/station/receiver'&&method==='POST')data={id:'lease-'+(++leaseNumber),url:'https://stati.ciani01.org/send/fixture',expiresAt:Math.floor(Date.now()/1000)+300};
   if(endpoint==='/station/receiver'&&method==='PATCH')data={expiresAt:Math.floor(Date.now()/1000)+300};
   return Response.json(data);
  }
 });
 const wrapper=vm.runInContext('(function(require,__dirname){'+source+`\nreturn {
   getState:()=>({main,prepareOpened,credential,receiver,quitting,finalQuitAllowed,receivingEnabled,privacyUnlocked,sessionLocked,identitySkipped,activeOperator,operatorProof,operatorGeneration,downloadsInFlight}),
   setState:state=>{if('privacyUnlocked'in state)privacyUnlocked=state.privacyUnlocked;if('activeOperator'in state)activeOperator=state.activeOperator;if('operatorProof'in state)operatorProof=state.operatorProof;if('prepareOpened'in state)prepareOpened=state.prepareOpened;if('receivingEnabled'in state)receivingEnabled=state.receivingEnabled;if('credential'in state){credential=state.credential;resetTransferState();}},
   showMain,spawnClock,sharedStationPoll,pollInBackground,pollStation,deliverTransfer,resetSessionIdentity,
   selectionStatus:()=>localOperatorSelection.status(),renewOperatorSelection:()=>localOperatorSelection.renewNow()
  };})`,context,{filename:mainPath});
 api=wrapper(load,path.dirname(mainPath));
 return{app,power,calls,windows,trays,intervals,timeouts,api,updates,hooks,savedFiles,checkpoints,diskFiles,ipc:electron.ipcMain,shell:electron.shell,receipts:()=>({...savedReceipts}),history:()=>[...historyRows.values()],advance:ms=>{now+=ms;},setTransfers:value=>{serverTransfers=value;},selectOperator:operator=>{serverOperator=operator;api.setState({privacyUnlocked:true,activeOperator:operator});},newWindow:()=>new Window(),setBusy:value=>{busy=value;},failInstall:()=>{installError=true;},
  async start(){await start();await settle();},
  invoke(name,win=api.getState().main,...args){const frame=win.webContents.mainFrame;return handlers.get(name)({senderFrame:frame,sender:win.webContents},...args);},
  http:()=>calls.filter(call=>call[0]==='http')};
}

test('Skip for now hides identity without granting a profile and preserves the paired receiver and clocks',async()=>{
 const f=fixture({startup:false,at:'2026-10-21T02:21:00Z'});await f.start();await drain();
 f.api.setState({privacyUnlocked:true,operatorProof:'partial-unlock-proof'});const main=f.api.getState().main,receiver=f.api.getState().receiver;
 f.api.spawnClock('11111111-1111-4111-8111-111111111111',{fontSize:52,autoSize:true,blur:false,showBackground:true});const clock=f.windows.at(-1);
 assert.equal((await f.invoke('identity-status')).canSkip,true);const generation=f.api.getState().operatorGeneration;
 const result=await f.invoke('identity-skip');assert.equal(result.skipped,true);assert.equal(result.canSkip,false);
 let state=f.api.getState();assert.equal(state.identitySkipped,true);assert.equal(state.activeOperator,null);assert.equal(state.operatorProof,null);assert.equal(state.operatorGeneration,generation+1);assert.equal(main.visible,false);assert.equal(state.receiver,receiver);assert.equal(state.receivingEnabled,true);assert.equal(clock.destroyed,false);assert.equal(clock.visible,true);
 await assert.rejects(f.invoke('workspace-open'),/Choose who/);await assert.rejects(f.invoke('prepare'),/Choose/);await assert.rejects(f.invoke('operator',main,{id:'untrusted-choice-0000000001'}),/Open Stați again/);
 await assert.rejects(f.invoke('operator-unlock-status',main,'old-phone-token'),/Open Stați again/);
 assert.ok(f.calls.some(call=>call[0]==='send'&&call[1]==='identity-required'&&call[2].reason==='skip'));
 const before=f.http().filter(call=>call[1]==='DELETE'&&call[2]==='/station/receiver').length;
 f.intervals.find(item=>item.ms===20000).fn();await drain();assert.equal(f.api.getState().receiver,receiver);assert.equal(f.http().filter(call=>call[1]==='DELETE'&&call[2]==='/station/receiver').length,before);
 f.api.showMain();state=f.api.getState();assert.equal(state.identitySkipped,false);assert.equal(main.visible,true);assert.equal(state.activeOperator,null);assert.ok(f.calls.some(call=>call[0]==='identity'));assert.equal((await f.invoke('identity-status')).canSkip,true);
});

test('Skip for now is rejected outside its time window, without pairing, while locked, or after choosing an operator',async()=>{
 for(const at of ['2026-10-21T01:54:59.999Z','2026-10-21T04:00:00Z']){
  const f=fixture({startup:false,at});await f.start();await drain();f.api.setState({privacyUnlocked:true});assert.equal((await f.invoke('identity-status')).canSkip,false);await assert.rejects(f.invoke('identity-skip'),/five minutes before/);assert.equal(f.api.getState().main.visible,true);
 }
 const unpaired=fixture({startup:false,paired:false,at:'2026-10-21T02:21:00Z'});await unpaired.start();unpaired.api.setState({privacyUnlocked:true});await assert.rejects(unpaired.invoke('identity-skip'),/five minutes before/);
 const chosen=fixture({startup:false,at:'2026-10-21T02:21:00Z'});await chosen.start();chosen.selectOperator({id:'chosen-admin',role:'admin'});await assert.rejects(chosen.invoke('identity-skip'),/five minutes before/);assert.equal(chosen.api.getState().activeOperator.id,'chosen-admin');
 const locked=fixture({startup:false,at:'2026-10-21T02:21:00Z'});await locked.start();locked.api.setState({privacyUnlocked:true});locked.power.emit('lock-screen');await assert.rejects(locked.invoke('identity-skip'),/Unlock this computer/);
});

test('windowed identity receives lightweight Skip availability changes at the five-minute and service-end boundaries',async()=>{
 const f=fixture({startup:false,at:'2026-10-21T01:54:59Z'});await f.start();await drain();f.api.setState({privacyUnlocked:true});const tick=f.intervals.find(item=>item.ms===1000).fn;
 tick();const messages=()=>f.calls.filter(call=>call[0]==='send'&&call[1]==='identity-presentation');assert.equal(messages().at(-1)[2].canSkip,false);const count=messages().length;
 f.advance(1000);tick();assert.equal(messages().length,count+1);assert.equal(messages().at(-1)[2].canSkip,true);assert.equal(Object.hasOwn(messages().at(-1)[2],'backdrop'),false);
 tick();assert.equal(messages().length,count+1);f.advance(5*60000);tick();assert.equal((await f.invoke('identity-status')).canSkip,true);
 f.advance(2*3600000);tick();assert.equal(messages().at(-1)[2].canSkip,false);await assert.rejects(f.invoke('identity-skip'),/five minutes before/);
});

test('Skip invalidates a pending PIN or phone approval before its late proof can activate a profile',async()=>{
 for(const method of ['operator','operator-unlock-status']){
  const waiting=deferred(),started=deferred(),id='11111111-1111-4111-8111-111111111111',deviceId='22222222-2222-4222-8222-222222222222',lease='a'.repeat(43),token='b'.repeat(43),proof='c'.repeat(43),expiresAt=1900000045;
  const f=fixture({startup:false,at:'2026-10-21T02:21:00Z',route:async({endpoint,options})=>{
   if(endpoint==='/station/state')return Response.json({operatorLeaseProtocol:'stati-operator-v1',device:{id:deviceId,operator_id:null},members:[{id,role:'admin',first_name:'Fixture',last_initial:'T'}],adminUnlocked:false,transfers:[],requests:[],accessRequests:[],accessApprover:'operator'});
   if(endpoint==='/station/operator/unlock')return Response.json({protocol:'stati-operator-v1',lease,userId:id,active:false,ttlSeconds:300,expiresAt:1900000300,token,url:'https://stati.ciani01.org/unlock/'+token});
   const match=method==='operator'?endpoint==='/station/operator'&&JSON.parse(options.body||'{}').userId===id:endpoint==='/station/operator/unlock/status';
   if(match){started.resolve();await waiting.promise;return Response.json({protocol:'stati-operator-v1',lease,userId:id,active:true,ttlSeconds:45,expiresAt,proof,proofExpiresAt:1900000000+8*3600,...(method==='operator-unlock-status'?{approved:true}:{})});}
  }});await f.start();await drain();f.api.setState({privacyUnlocked:true});const main=f.api.getState().main;
  if(method==='operator-unlock-status')await f.invoke('operator-unlock',main,id);
  const choice=f.invoke(method,main,method==='operator'?{id,pin:'1234'}:token),rejected=assert.rejects(choice,/selected user changed|profile again|replaced/i);await started.promise;
  await f.invoke('identity-skip');waiting.resolve();await rejected;
  assert.equal(f.api.getState().activeOperator,null,method);assert.equal(f.api.getState().operatorProof,null,method);assert.equal(f.api.getState().main.visible,false,method);
 }
});

test('Windows off startup with zero clocks stays hidden, exposes a tray, and sends an authenticated device heartbeat without profile proof',async()=>{
 const f=fixture();await f.start();
 const state=f.api.getState();assert.equal(state.main,undefined);assert.equal(state.privacyUnlocked,false);assert.equal(state.activeOperator,null);assert.equal(state.operatorProof,null);
 assert.equal(f.app.quitCalls,0);assert.equal(f.windows.length,0);assert.equal(f.trays.length,1);
 assert.deepEqual(Array.from(f.trays[0].menu,item=>item.label).filter(Boolean),['Open Stați','Exit Stați']);
 const login=f.calls.filter(call=>call[0]==='login');assert.equal(login.length,1);assert.equal(login[0][1].openAtLogin,true);assert.deepEqual(Array.from(login[0][1].args),['--stati-startup']);
 const heartbeat=f.http().find(call=>call[2]==='/station/state');assert.ok(heartbeat);assert.equal(heartbeat[3].headers.Authorization,'Bearer device-fixture');assert.equal(heartbeat[3].headers['X-Stati-Operator'],undefined);
 assert.equal(state.receiver.id,'lease-1');
 f.trays[0].menu[0].click();assert.ok(f.api.getState().main.visible);
});

test('the startup window is shown without a broad unqualified remote operator reset',async()=>{
 const f=fixture({startup:false,mode:'in-app'});
 await f.start();await drain();
 assert.ok(f.api.getState().main);assert.equal(f.api.getState().main.visible,true);
 assert.equal(f.http().filter(call=>call[2]==='/station/operator').length,0);
});

test('the actual clock uses a transparent fixed native frame; manual dimensions remain controlled in Settings',async()=>{
 const f=fixture();await f.start();
 f.api.spawnClock('11111111-1111-4111-8111-111111111111',{fontSize:52,autoSize:true,blur:true,showBackground:true},{x:1600,y:0});
 const clock=f.windows.at(-1);assert.equal(clock.options.transparent,true);assert.equal(clock.options.resizable,false);assert.equal(clock.options.maximizable,false);assert.equal(clock.options.fullscreenable,false);assert.equal(clock.options.thickFrame,false);assert.equal(clock.options.hasShadow,false);assert.equal(clock.options.skipTaskbar,true);
});

test('the actual preview handler checks identity, coalesces media reads and never saves or acknowledges a preview',async()=>{
 const data=Buffer.from('fixture lyrics'),sha=require('node:crypto').createHash('sha256').update(data).digest('hex'),id='preview-transfer-fixture-000001',file={...transfer(id,'member'),filename:'clip.mp4',content_type:'video/mp4',sha256:sha};
 const f=fixture({startup:false,mode:'in-app',transfers:[file],route:async({endpoint,method})=>endpoint==='/station/transfers/'+id&&method==='GET'?new Response(data,{headers:{'Content-Length':String(data.length),'X-Checksum-SHA256':sha}}):undefined});await f.start();const main=f.api.getState().main;
 f.api.setState({privacyUnlocked:true});await assert.rejects(f.invoke('file-preview',main,id),/selected user/);assert.equal(deliveryGets(f).length,0);
 f.selectOperator({id:'preview-operator-fixture-00001',role:'member'});const [a,b]=await Promise.all([f.invoke('file-preview',main,id),f.invoke('file-preview',main,id)]);
 assert.equal(a.kind,'media');assert.equal(a.mediaType,'video');assert.equal(Buffer.from(a.bytes).toString(),'fixture lyrics');assert.equal(Buffer.from(b.bytes).toString(),'fixture lyrics');assert.equal(deliveryGets(f).length,1);assert.equal(deliveryAcks(f).length,0);assert.deepEqual(f.receipts(),{});assert.equal(f.calls.some(call=>call[0]==='receipt'||call[0]==='prepare'),false);
});

test('identity reset and Reject cancel a stalled preview body before any bytes reach the renderer',{timeout:5000},async()=>{
 for(const action of ['identity','reject']){
  const id='preview-stalled-fixture-000001',started=deferred();let canceled=false;
  const f=fixture({startup:false,mode:'in-app',transfers:[{...transfer(id,'member'),filename:'clip.mp4',content_type:'video/mp4'}],route:async({endpoint,method})=>{
   if(endpoint==='/station/transfers/'+id&&method==='GET'){started.resolve();return new Response(new ReadableStream({pull(){},cancel(){canceled=true;}}),{headers:{'Content-Length':'14','X-Checksum-SHA256':'a'.repeat(64)}});}
  }});await f.start();f.selectOperator({id:'preview-operator-fixture-00001',role:'member'});const main=f.api.getState().main,pending=f.invoke('file-preview',main,id),failure=assert.rejects(pending,/selected user changed|rejecting|no longer available/i);await started.promise;
  if(action==='identity')f.api.resetSessionIdentity('lock');else await f.invoke('reject',main,{id,reason:'Wrong version'});
  await failure;assert.equal(canceled,true,action);assert.equal(deliveryAcks(f).length,0);assert.deepEqual(f.receipts(),{});
 }
});

test('Windows X-close hides the actual main window and preserves selected operator, receiver pause and a running Prepare conversion',async()=>{
 const f=fixture();await f.start();const main=f.api.showMain();
 f.api.setState({privacyUnlocked:true,activeOperator:{id:'chosen-admin',role:'admin'},operatorProof:'verified-proof',prepareOpened:true,receivingEnabled:false});f.setBusy(true);
 const before=f.http().length,event=main.close(),state=f.api.getState();
 assert.equal(event.prevented,true);assert.equal(main.destroyed,false);assert.equal(main.visible,false);assert.equal(state.prepareOpened,true);
 assert.equal(state.activeOperator.id,'chosen-admin');assert.equal(state.operatorProof,'verified-proof');assert.equal(state.receiver.id,'lease-1');assert.equal(state.receivingEnabled,false);assert.equal(f.http().length,before);
 assert.equal(f.calls.some(call=>call[0]==='cancel-conversion'),false);
 assert.equal(f.api.showMain(),main);assert.equal(main.visible,true);assert.equal(f.api.getState().receivingEnabled,false);
});

test('Exit waits for an older identity-invalidated lease request before DELETE and never recreates the receiver',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;}),order=[];
 const f=fixture({route:async({endpoint,method})=>{if(endpoint==='/station/receiver'&&method==='POST'){order.push('lease-start');await pending;order.push('lease-finished');}if(endpoint==='/station/receiver'&&method==='DELETE')order.push('delete');}});
 await f.start();assert.deepEqual(order,['lease-start']);
 f.power.emit('lock-screen');assert.equal(f.api.getState().operatorProof,null);
 f.trays[0].menu[2].click();assert.equal(f.api.getState().quitting,true);assert.equal(f.app.lastQuitPrevented,true);assert.equal(f.app.completedQuits,0);assert.deepEqual(order,['lease-start']);
 f.trays[0].menu[2].click();assert.equal(f.app.lastQuitPrevented,true);assert.equal(f.api.getState().finalQuitAllowed,false);assert.equal(f.app.completedQuits,0);
 f.intervals.find(timer=>timer.ms===20000).fn();await settle();assert.deepEqual(order,['lease-start']);
 release();await settle();await settle();assert.deepEqual(order,['lease-start','lease-finished','delete']);assert.equal(f.app.completedQuits,1);assert.equal(f.app.lastQuitPrevented,false);assert.equal(f.api.getState().finalQuitAllowed,true);assert.equal(f.api.getState().receiver,null);assert.equal(f.trays[0].destroyed,true);
});

test('Exit during update preparation cannot bypass its pending receiver barrier; installer failure restores normal lifecycle',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const f=fixture({route:async({endpoint,method})=>{if(endpoint==='/station/receiver'&&method==='POST')await pending;}});
 await f.start();const main=f.api.showMain();f.api.setState({privacyUnlocked:true});f.failInstall();
 const installing=f.invoke('update-install',main);const rejected=assert.rejects(installing,/installer launch failed/);
 f.trays[0].menu[2].click();assert.equal(f.app.lastQuitPrevented,true);assert.equal(f.api.getState().finalQuitAllowed,false);assert.equal(f.app.completedQuits,0);
 release();await rejected;await settle();assert.equal(f.api.getState().quitting,false);assert.equal(f.api.getState().finalQuitAllowed,false);assert.equal(f.app.completedQuits,0);assert.ok(f.api.getState().receiver);
});

test('a service build hold leaves the current receiver running',async()=>{
 const f=fixture({modules:{'./build-release-guard.cjs':{requireBuildsAllowed:async()=>{throw Error('Builds are paused.');}}}});
 await f.start();const main=f.api.showMain();f.api.setState({privacyUnlocked:true});await settle();
 const receiver=f.api.getState().receiver;
 assert.ok(receiver);
 await assert.rejects(f.invoke('update-install',main),/Builds are paused/);await settle();
 assert.equal(f.api.getState().quitting,false);
 assert.equal(f.api.getState().receiver,receiver);
 assert.equal(f.http().some(call=>call[2]==='/station/receiver'&&call[1]==='DELETE'),false);
});

test('failed installer launch restores background polling and receiver after its shutdown preparation',async()=>{
 const f=fixture();await f.start();const main=f.api.showMain();f.api.setState({privacyUnlocked:true});f.failInstall();
 await assert.rejects(f.invoke('update-install',main),/installer launch failed/);await settle();
 const state=f.api.getState();assert.equal(state.quitting,false);assert.equal(state.receiver.id,'lease-2');assert.equal(f.app.quitCalls,0);
 const methods=f.http().filter(call=>call[2]==='/station/receiver').map(call=>call[1]);assert.deepEqual(methods,['POST','DELETE','POST']);
});

test('a lost receiver DELETE response causes update recovery to create a fresh lease immediately',async()=>{
 const f=fixture({route:({endpoint,method})=>{if(endpoint==='/station/receiver'&&method==='DELETE')throw Error('DELETE response lost after closure');}});
 await f.start();const main=f.api.showMain();f.api.setState({privacyUnlocked:true});
 await assert.rejects(f.invoke('update-install',main),/DELETE response lost/);await settle();
 assert.equal(f.api.getState().quitting,false);assert.equal(f.api.getState().receiver.id,'lease-2');
 assert.deepEqual(f.http().filter(call=>call[2]==='/station/receiver').map(call=>call[1]),['POST','DELETE','POST']);
});

test('background heartbeat does not bypass privacy or Windows-lock IPC checks or manufacture an operator proof',async()=>{
 const f=fixture();await f.start();const main=f.api.showMain();
 await assert.rejects(f.invoke('state',main),/computer passcode/);
 f.api.setState({privacyUnlocked:true,activeOperator:{id:'chosen-admin'},operatorProof:'verified-proof'});f.power.emit('lock-screen');
 await assert.rejects(f.invoke('state',main),/Unlock this computer/);await f.invoke('identity-status',main);
 f.intervals.find(timer=>timer.ms===20000).fn();await settle();const state=f.api.getState();
 assert.equal(state.sessionLocked,true);assert.equal(state.activeOperator,null);assert.equal(state.operatorProof,null);
 assert.equal(f.http().filter(call=>call[2]==='/station/state').at(-1)[3].headers['X-Stati-Operator'],undefined);
});

test('macOS lock and suspend revoke the selected operator and keep privileged IPC closed',async()=>{
 for(const event of ['lock-screen','suspend']){
  const f=fixture({platform:'darwin',startup:false});await f.start();const main=f.api.getState().main,receiver=f.api.getState().receiver;
  f.api.setState({privacyUnlocked:true,activeOperator:{id:'chosen-admin'},operatorProof:'verified-proof'});
  f.power.emit(event);await settle();
  const state=f.api.getState();assert.equal(state.sessionLocked,true);assert.equal(state.activeOperator,null);assert.equal(state.operatorProof,null);
  await assert.rejects(f.invoke('state',main),/Unlock this computer/);await f.invoke('identity-status',main);
  assert.equal(state.receiver,receiver);
 }
});

test('network failure retries on the timer and sleep/resume reconnects while identity off stays hidden',async()=>{
 let unavailable=true;const f=fixture({route:({endpoint})=>{if(endpoint==='/station/state'&&unavailable)throw Error('offline fixture');}});await f.start();
 assert.equal(f.api.getState().receiver,null);assert.equal(f.api.getState().operatorProof,null);unavailable=false;
 f.intervals.find(timer=>timer.ms===20000).fn();await settle();assert.equal(f.api.getState().receiver.id,'lease-1');
 f.api.setState({activeOperator:{id:'chosen-admin'},operatorProof:'verified-proof'});f.power.emit('suspend');const count=f.http().filter(call=>call[2]==='/station/state').length;
 f.power.emit('resume');await settle();const timer=f.timeouts.find(timer=>timer.ms===1000);timer.fn();await settle();
 assert.ok(f.http().filter(call=>call[2]==='/station/state').length>count);assert.equal(f.api.getState().main,undefined);assert.equal(f.api.getState().activeOperator,null);assert.equal(f.api.getState().operatorProof,null);assert.equal(f.api.getState().sessionLocked,false);
});

test('no-window Windows process keeps receiving and macOS reopens with its receiver closed until explicitly opened',async()=>{
 const windows=fixture();await windows.start();windows.app.emit('window-all-closed');assert.equal(windows.app.quitCalls,0);
 const mac=fixture({platform:'darwin',startup:false});await mac.start();const first=mac.api.getState().main;first.close();assert.equal(first.destroyed,true);assert.equal(mac.api.getState().receivingEnabled,false);
 const reopened=mac.api.showMain();assert.notEqual(reopened,first);assert.equal(mac.api.getState().receivingEnabled,false);const beforeOpen=mac.http().filter(call=>call[1]==='POST'&&call[2]==='/station/receiver').length;mac.api.setState({privacyUnlocked:true});await mac.invoke('receiver-open',reopened);assert.equal(mac.api.getState().receivingEnabled,true);assert.equal(mac.http().filter(call=>call[1]==='POST'&&call[2]==='/station/receiver').length,beforeOpen+1);
 mac.app.emit('window-all-closed');await settle();assert.ok(mac.app.quitCalls>0);assert.equal(mac.trays.length,0);
});

test('an unpaired startup cannot publish a device heartbeat and explicit Exit respects conversion work',async()=>{
 const unpaired=fixture({paired:false});await unpaired.start();assert.equal(unpaired.http().length,0);assert.equal(unpaired.api.getState().receiver,null);
 const f=fixture();await f.start();f.setBusy(true);f.trays[0].menu[2].click();await settle();assert.equal(f.api.getState().quitting,false);assert.equal(f.app.completedQuits,0);assert.equal(f.calls.some(call=>call[0]==='cancel-conversion'),true);assert.equal(f.http().some(call=>call[1]==='DELETE'),false);
 f.trays[0].menu[2].click();await settle();assert.equal(f.app.completedQuits,1);
});

test('a transient administrator download retries from a fresh poll after backoff without duplicate saving or alerts',async()=>{
 const id='admin-transient-00000000000001';let first=true;
 const f=fixture({transfers:[transfer(id)],notifications:true,route:({endpoint,method})=>{
  if(method==='GET'&&endpoint==='/station/transfers/'+id&&first){first=false;throw Error('Fixture network disconnected');}
 }});
 await f.start();await drain();assert.equal(deliveryGets(f).length,1);assert.equal(failures(f).length,1);assert.deepEqual(f.receipts(),{});
 f.advance(7999);await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,1);
 f.advance(1);await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,2);
 assert.equal(f.calls.filter(call=>call[0]==='prepare').length,1);assert.equal(f.calls.filter(call=>call[0]==='receipt').length,1);
 assert.equal(deliveryAcks(f).length,1);assert.equal(Object.keys(f.receipts()).length,1);assert.equal(failures(f).length,1);
 f.advance(300000);await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,2);assert.equal(deliveryAcks(f).length,1);
});

test('a lost delivered response retries only the acknowledgement for the committed local file',async()=>{
 const id='admin-lost-ack-00000000000001';let first=true;
 const f=fixture({transfers:[transfer(id)],notifications:true,route:({endpoint,method})=>{
  if(method==='POST'&&endpoint==='/station/transfers/'+id+'/delivered'&&first){first=false;throw Error('Fixture ACK response lost');}
 }});
 await f.start();await drain();assert.equal(deliveryGets(f).length,1);assert.equal(deliveryAcks(f).length,1);assert.ok(f.receipts()[id]);
 f.advance(8000);await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,1);assert.equal(deliveryAcks(f).length,2);
 assert.equal(f.calls.filter(call=>call[0]==='prepare').length,1);assert.equal(f.calls.filter(call=>call[0]==='receipt').length,1);assert.equal(f.savedFiles.size,1);assert.equal(failures(f).length,1);
});

test('a failed receipt commit resumes its checkpoint without fetching or publishing a second file',async()=>{
 const id='admin-receipt-000000000000001',f=fixture({notifications:true});let first=true;
 f.hooks.saveReceipt=()=>{if(first){first=false;throw Error('Fixture receipt write interrupted');}};
 await f.start();f.setTransfers([transfer(id)]);await f.api.pollStation();await drain();
 assert.equal(deliveryGets(f).length,1);assert.equal(f.checkpoints.has(id),true);assert.equal(deliveryAcks(f).length,0);assert.deepEqual(f.receipts(),{});
 f.advance(8000);await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,1);assert.equal(f.calls.filter(call=>call[0]==='prepare').length,1);
 assert.equal(f.calls.filter(call=>call[0]==='receipt').length,2);assert.equal(f.checkpoints.has(id),false);assert.equal(deliveryAcks(f).length,1);assert.equal(f.savedFiles.size,1);
});

test('historical queued files absent from the current server response never trigger automatic delivery',async()=>{
 const id='admin-history-000000000000001',f=fixture({history:[transfer(id)]});await f.start();await drain();
 assert.equal(deliveryGets(f).length,0);assert.equal(deliveryAcks(f).length,0);
 const state=await f.api.pollStation();await drain();assert.equal(state.transfers.some(row=>row.id===id),true);assert.equal(deliveryGets(f).length,0);
});

test('pausing the receiver suppresses administrator auto-save until it is explicitly resumed',async()=>{
 const id='admin-paused-0000000000000001',f=fixture();await f.start();f.api.setState({receivingEnabled:false});f.setTransfers([transfer(id)]);
 await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,0);assert.equal(deliveryAcks(f).length,0);
 f.api.setState({receivingEnabled:true});await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,1);assert.equal(deliveryAcks(f).length,1);
});

test('a member transfer waits for an identified operator to press Save',async()=>{
 const id='member-manual-000000000000001',f=fixture({transfers:[transfer(id,'member')]});await f.start();await drain();
 assert.equal(deliveryGets(f).length,0);assert.equal(deliveryAcks(f).length,0);
 const main=f.api.showMain();f.api.setState({privacyUnlocked:true});await assert.rejects(f.invoke('deliver',main,id),/not available|Choose|selected user/i);
 assert.equal(deliveryGets(f).length,0);f.selectOperator({id:'member-operator-000000000001',role:'member'});
 await f.invoke('deliver',main,id);assert.equal(deliveryGets(f).length,1);assert.equal(deliveryAcks(f).length,1);assert.ok(f.receipts()[id]);
});

test('terminal download rejection does not keep retrying the same queued administrator file',async()=>{
 const id='admin-terminal-00000000000001',f=fixture({transfers:[transfer(id)],notifications:true,route:({endpoint,method})=>{
  if(method==='GET'&&endpoint==='/station/transfers/'+id)return Response.json({error:'Transfer is no longer queued.'},{status:410});
 }});
 await f.start();await drain();assert.equal(deliveryGets(f).length,1);
 f.advance(300000);await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,1);assert.equal(deliveryAcks(f).length,0);assert.equal(f.savedFiles.size,0);assert.ok(failures(f).length<=1);
});

test('an older queued response cannot revive work removed by a newer station response',async()=>{
 const id='admin-stale-poll-000000000001',older=deferred();let delay=false;
 const f=fixture({route:async({endpoint})=>{if(endpoint==='/station/state'&&delay){delay=false;await older.promise;return Response.json({device:{id:'station-fixture',operator_id:null},members:[],adminUnlocked:false,transfers:[transfer(id)],requests:[],accessRequests:[],accessApprover:'operator'});}}});await f.start();
 delay=true;const pending=f.api.pollStation();const cancelled=assert.rejects(pending,/stopped|closing/i);await settle();
 f.setTransfers([]);await f.api.pollStation();await drain();older.resolve();await cancelled;await drain();
 assert.equal(deliveryGets(f).length,0);assert.equal(deliveryAcks(f).length,0);assert.equal(f.savedFiles.size,0);
});

test('manual and automatic saving share one slot while identical callers reuse the pending result',async()=>{
 const one='member-one-000000000000000001',two='member-two-000000000000000001',admin='admin-busy-000000000000000001',download=deferred(),f=fixture({transfers:[transfer(one,'member'),transfer(two,'member')]});
 await f.start();f.selectOperator({id:'member-operator-000000000001',role:'member'});await f.api.pollStation();
 f.hooks.download=()=>download.promise;const generation=f.api.getState().operatorGeneration;
 const first=f.api.deliverTransfer(one,{generation}),same=f.api.deliverTransfer(one,{generation});
 await settle();await assert.rejects(async()=>f.api.deliverTransfer(two,{generation}),/already|saving|busy|another|progress/i);
 f.setTransfers([transfer(one,'member'),transfer(two,'member'),transfer(admin)]);await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,1);
 download.resolve();const [left,right]=await Promise.all([first,same]);assert.equal(left.path,right.path);assert.equal(deliveryGets(f).length,1);assert.equal(deliveryAcks(f).length,1);
 f.hooks.download=null;await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,2);assert.equal(deliveryAcks(f).length,2);assert.equal(f.receipts()[two],undefined);
});

test('Exit aborts an active save and waits for its checkpoint boundary before completing',async()=>{
 const id='admin-quit-000000000000000001',blocked=deferred(),f=fixture();await f.start();
 f.hooks.prepareDelivery=()=>blocked.promise;f.setTransfers([transfer(id)]);await f.api.pollStation();await drain();assert.equal(f.calls.filter(call=>call[0]==='prepare').length,1);
 f.trays[0].menu[2].click();await settle();assert.equal(f.api.getState().quitting,true);assert.equal(f.app.completedQuits,0);
 blocked.resolve();await drain();assert.equal(f.app.completedQuits,1);assert.equal(deliveryAcks(f).length,0);assert.deepEqual(f.receipts(),{});assert.equal(f.savedFiles.size,0);
 f.intervals.find(timer=>timer.ms===20000).fn();await drain();assert.equal(deliveryGets(f).length,1);
});

test('a revoked station response stops an already pending save and further automatic attempts',async()=>{
 const id='admin-revoked-000000000000001',blocked=deferred();let revoked=false;
 const f=fixture({route:({endpoint})=>{if(endpoint==='/station/state'&&revoked)return Response.json({error:'Computer access has been revoked.'},{status:401});}});await f.start();
 f.hooks.prepareDelivery=()=>blocked.promise;f.setTransfers([transfer(id)]);await f.api.pollStation();await drain();revoked=true;
 await assert.rejects(f.api.pollStation(),/revoked/);blocked.resolve();await drain();assert.equal(deliveryAcks(f).length,0);assert.deepEqual(f.receipts(),{});assert.equal(f.savedFiles.size,0);
 f.advance(300000);await assert.rejects(f.api.pollStation(),/revoked/);await drain();assert.equal(deliveryGets(f).length,1);
});

test('a file cannot be rejected while its verified save is in progress',async()=>{
 const id='member-save-reject-0000000001',blocked=deferred(),f=fixture({transfers:[transfer(id,'member')]});await f.start();
 f.selectOperator({id:'member-operator-000000000001',role:'member'});const main=f.api.showMain();await f.api.pollStation();
 f.hooks.prepareDelivery=()=>blocked.promise;const pending=f.api.deliverTransfer(id,{generation:f.api.getState().operatorGeneration});await drain();
 await assert.rejects(f.invoke('reject',main,{id,reason:'Fixture rejection'}),/being saved|decided|finish/i);
 assert.equal(f.http().some(call=>call[2].endsWith('/reject')),false);blocked.resolve();await pending;
 assert.equal(deliveryAcks(f).length,1);assert.ok(f.receipts()[id]);
});

test('a file being rejected cannot start a concurrent save or later automatic retry',async()=>{
 const id='member-reject-save-0000000001',blocked=deferred(),f=fixture({transfers:[transfer(id,'member')],route:async({endpoint})=>{if(endpoint==='/station/transfers/'+id+'/reject')await blocked.promise;}});await f.start();
 f.selectOperator({id:'member-operator-000000000001',role:'member'});const main=f.api.showMain();await f.api.pollStation();
 const rejected=f.invoke('reject',main,{id,reason:'Fixture rejection'});await drain();
 await assert.rejects(async()=>f.api.deliverTransfer(id,{generation:f.api.getState().operatorGeneration}),/being saved|busy|another|finish/i);assert.equal(deliveryGets(f).length,0);
 blocked.resolve();await rejected;f.setTransfers([{...transfer(id),status:'rejected'}]);await f.api.pollStation();await drain();
 assert.equal(deliveryGets(f).length,0);assert.equal(deliveryAcks(f).length,0);assert.deepEqual(f.receipts(),{});
});

test('locking Windows cancels an explicit member save before its final file and receipt commit',async()=>{
 const id='member-lock-0000000000000001',blocked=deferred(),f=fixture({transfers:[transfer(id,'member')]});await f.start();
 f.selectOperator({id:'member-operator-000000000001',role:'member'});await f.api.pollStation();f.hooks.prepareDelivery=()=>blocked.promise;
 const pending=f.api.deliverTransfer(id,{generation:f.api.getState().operatorGeneration});const rejected=assert.rejects(pending,/stopped|selected user changed/i);await drain();
 f.power.emit('lock-screen');blocked.resolve();await rejected;assert.equal(deliveryAcks(f).length,0);assert.deepEqual(f.receipts(),{});assert.equal(f.savedFiles.size,0);
});

test('locking Windows preserves administrator background delivery without exposing file access',async()=>{
 const id='admin-lock-background-000001',blocked=deferred(),f=fixture();await f.start();const main=f.api.showMain();
 f.selectOperator({id:'admin-operator-0000000000001',role:'admin'});f.hooks.prepareDelivery=()=>blocked.promise;f.setTransfers([transfer(id)]);await f.api.pollStation();await drain();
 f.power.emit('lock-screen');await assert.rejects(f.invoke('state',main),/Unlock this computer/);blocked.resolve();await drain();
 assert.equal(deliveryGets(f).length,1);assert.equal(deliveryAcks(f).length,1);assert.ok(f.receipts()[id]);assert.equal(f.api.getState().operatorProof,null);assert.equal(f.api.getState().activeOperator,null);
});

test('delivery uses the canonical Downloads directory consistently for temporary data and checkpoints',async()=>{
 const id='admin-canonical-path-00000001',canonicalDownloads='/canonical/downloads',f=fixture({transfers:[transfer(id)],canonicalDownloads});
 f.hooks.recoverDelivery=options=>assert.equal(options.downloadsDirectory,canonicalDownloads);
 f.hooks.prepareDelivery=options=>{assert.equal(options.downloadsDirectory,canonicalDownloads);assert.equal(path.dirname(options.temporaryPath),canonicalDownloads);};
 await f.start();await drain();assert.equal(f.calls.filter(call=>call[0]==='realpath'&&call[1]==='/mock/downloads').length,1);
 assert.equal(path.dirname(f.calls.find(call=>call[0]==='download')[1]),canonicalDownloads);assert.equal(f.receipts()[id],path.join(canonicalDownloads,'song.txt'));assert.equal(deliveryAcks(f).length,1);
});

test('renaming a queued delivery is blocked before it can invalidate the saved checkpoint path',async()=>{
 const id='member-rename-queued-0000001',original='/mock/downloads/song.txt',f=fixture({transfers:[transfer(id,'member')],receipts:{[id]:original}});await f.start();
 f.selectOperator({id:'member-operator-000000000001',role:'member'});const main=f.api.showMain();
 await assert.rejects(f.invoke('file-rename',main,{id,stem:'Renamed song'}),/delivery confirmation|finish|queued/i);
 assert.equal(f.calls.filter(call=>call[0]==='rename').length,0);assert.equal(f.receipts()[id],original);assert.equal(deliveryAcks(f).length,0);
});

test('renaming is blocked by an active save even when the latest displayed transfer is delivered',async()=>{
 const id='member-rename-active-0000001',original='/mock/downloads/song.txt',f=fixture({transfers:[{...transfer(id,'member'),status:'delivered'}],receipts:{[id]:original}});await f.start();
 f.selectOperator({id:'member-operator-000000000001',role:'member'});const main=f.api.showMain(),inFlight=f.api.getState().downloadsInFlight;
 inFlight.add(id);try{await assert.rejects(f.invoke('file-rename',main,{id,stem:'Renamed song'}),/delivery confirmation|finish|saving/i);}finally{inFlight.delete(id);}
 assert.equal(f.calls.filter(call=>call[0]==='rename').length,0);assert.equal(f.receipts()[id],original);
});

test('an identified member can rename a delivered file after its delivery confirmation',async()=>{
 const id='member-rename-done-000000001',original='/mock/downloads/song.txt',f=fixture({transfers:[{...transfer(id,'member'),status:'delivered'}],receipts:{[id]:original}});await f.start();
 f.selectOperator({id:'member-operator-000000000001',role:'member'});const main=f.api.showMain(),result=await f.invoke('file-rename',main,{id,stem:'Renamed song'});
 assert.equal(result.path,'/mock/downloads/Renamed song.txt');assert.equal(f.receipts()[id],result.path);assert.equal(f.calls.filter(call=>call[0]==='rename').length,1);
});

test('a rename rechecks queue status at receipt commit and keeps the original path when delivery becomes queued',async()=>{
 const id='member-rename-recheck-000001',original='/mock/downloads/song.txt',f=fixture({transfers:[{...transfer(id,'member'),status:'delivered'}],receipts:{[id]:original}});await f.start();
 f.selectOperator({id:'member-operator-000000000001',role:'member'});const main=f.api.showMain();
 f.hooks.renameSavedFile=async()=>{f.setTransfers([transfer(id,'member')]);await f.api.pollStation();};
 await assert.rejects(f.invoke('file-rename',main,{id,stem:'Renamed song'}),/delivery confirmation|finish|queued/i);
 assert.equal(f.calls.filter(call=>call[0]==='rename').length,1);assert.equal(f.receipts()[id],original);assert.equal(f.savedFiles.has(original),true);assert.equal(f.savedFiles.has('/mock/downloads/Renamed song.txt'),false);
 // A failed rename releases its reservation so an explicit save can confirm the pending delivery.
 const result=await f.api.deliverTransfer(id,{generation:f.api.getState().operatorGeneration});assert.equal(result.path,original);assert.equal(deliveryAcks(f).length,1);
});

test('an in-progress rename reserves the file against concurrent manual delivery until its receipt commits',async()=>{
 const id='member-rename-reserve-000001',original='/mock/downloads/song.txt',blocked=deferred(),f=fixture({transfers:[{...transfer(id,'member'),status:'delivered'}],receipts:{[id]:original}});await f.start();
 f.selectOperator({id:'member-operator-000000000001',role:'member'});const main=f.api.showMain();f.hooks.renameSavedFile=()=>blocked.promise;
 const pending=f.invoke('file-rename',main,{id,stem:'Renamed song'});await drain();
 await assert.rejects(async()=>f.api.deliverTransfer(id,{generation:f.api.getState().operatorGeneration}),/being saved|busy|another|finish/i);
 assert.equal(deliveryGets(f).length,0);assert.equal(deliveryAcks(f).length,0);blocked.resolve();const result=await pending;assert.equal(f.receipts()[id],result.path);
});


test('native sender-photo uses bounded cached thumbnails and clears them when operator identity changes',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfQoAAAAASUVORK5CYII=','base64');
 const f=fixture({startup:false,route:async({endpoint})=>endpoint.endsWith('/photo')?new Response(png,{headers:{'Content-Length':String(png.length)}}):undefined});await f.start();f.api.setState({privacyUnlocked:true});
 const id='photo-fixture-person-00000001';const first=await f.invoke('sender-photo',undefined,id);assert.match(first,/^data:image\/png;base64,/);assert.equal(await f.invoke('sender-photo',undefined,id),first);assert.equal(f.calls.filter(call=>call[0]==='photo-decode').length,1);
 await f.invoke('operator',undefined,{id:null});assert.equal(await f.invoke('sender-photo',undefined,id),first);assert.equal(f.calls.filter(call=>call[0]==='photo-decode').length,2);
 assert.equal(f.http().filter(call=>call[2].endsWith('/photo')).length,2);await assert.rejects(f.invoke('sender-photo',undefined,'bad'),/identifier/);
 const headers=f.http().find(call=>call[2].endsWith('/photo'))[3].headers;assert.equal(headers.Authorization,'Bearer device-fixture');
});


test('removing or replacing a paired computer clears the selected profile and its photo cache',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfQoAAAAASUVORK5CYII=','base64');
 const f=fixture({startup:false,dialogResponse:1,route:async({endpoint})=>endpoint.endsWith('/photo')?new Response(png):endpoint==='/devices/pair'?Response.json({credential:'replacement-fixture',url:'https://stati.ciani01.org/pair/isolated',expiresAt:1}):undefined});await f.start();f.api.setState({privacyUnlocked:true,activeOperator:{id:'unit-prior-admin',role:'admin'},operatorProof:'prior-proof'});await f.invoke('sender-photo',undefined,'photo-fixture-person-00000001');
 const before=f.api.getState().operatorGeneration;assert.equal((await f.invoke('reset-pairing')).ok,true);const state=f.api.getState();assert.equal(state.activeOperator,null);assert.equal(state.operatorProof,null);assert.equal(state.credential,null);assert.ok(state.operatorGeneration>before);assert.equal(await f.invoke('sender-photo',undefined,'photo-fixture-person-00000001'),null);
 f.api.setState({activeOperator:{id:'unit-prior-admin',role:'admin'},operatorProof:'prior-proof'});await f.invoke('pair',undefined,'Replacement fixture');assert.equal(f.api.getState().credential,'replacement-fixture');assert.equal(f.api.getState().activeOperator,null);assert.equal(f.api.getState().operatorProof,null);
});

const statusRow=(id,extra={})=>({id,status:'queued',remoteAvailable:false,sender_role:null,rejection_reason:null,...extra});
const statusResponse=(options,extra)=>Response.json({statuses:JSON.parse(options.body).ids.map(id=>statusRow(id,typeof extra==='function'?extra(id):extra))});
const statusCalls=f=>f.http().filter(call=>call[2]==='/station/transfers/status');
test('retained queued cards reconcile after cloud expiry and preserve a saved copy and sender metadata',async()=>{
 const id='c2a032fc-4f54-4dda-8d75-b1553cbac1d5',location='/mock/downloads/saved.txt';
 const f=fixture({history:[transfer(id)],receipts:{[id]:location},route:({endpoint,options})=>{if(endpoint==='/station/transfers/status')return statusResponse(options,{status:'expired'});}});await f.start();await drain();
 const state=await f.api.pollStation(),file=state.transfers.find(file=>file.id===id);assert.equal(file.status,'expired');assert.equal(file.remoteAvailable,false);assert.equal(file.saved,true);assert.equal(file.first_name,'Fixture');assert.equal(f.receipts()[id],location);assert.equal(f.savedFiles.has(location),true);assert.equal(deliveryGets(f).length,0);assert.equal(deliveryAcks(f).length,0);assert.equal(f.api.getState().activeOperator,null);
});
test('lost native ACK/rejection responses reconcile durable outcomes without fetching a second copy',async()=>{
 for(const status of ['delivered','rejected']){
  const id='c2a032fc-4f54-4dda-8d75-b1553cbac1d5',f=fixture({history:[transfer(id)],route:({endpoint,options})=>{if(endpoint==='/station/transfers/status')return statusResponse(options,{status,rejection_reason:status==='rejected'?'Wrong service':null});}});await f.start();await drain();assert.equal(f.history()[0].status,status);assert.equal(f.history()[0].rejection_reason,status==='rejected'?'Wrong service':null);assert.equal(deliveryGets(f).length,0);assert.equal(deliveryAcks(f).length,0);
 }
});
test('queued receipt without a temporary row stays pending but never starts an automatic download',async()=>{
 const id='c2a032fc-4f54-4dda-8d75-b1553cbac1d5',f=fixture({history:[transfer(id)],route:({endpoint,options})=>{if(endpoint==='/station/transfers/status')return statusResponse(options);}});await f.start();await drain();assert.equal(f.history()[0].status,'queued');assert.equal(f.history()[0].remoteAvailable,false);assert.equal(f.history()[0].sender_role,null);assert.equal(deliveryGets(f).length,0);await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,0);
});
test('retained remote queued work uses the current sender role for automatic delivery',async()=>{
 const id='c2a032fc-4f54-4dda-8d75-b1553cbac1d5';let role='member';const f=fixture({history:[transfer(id)],route:({endpoint,options})=>{if(endpoint==='/station/transfers/status')return statusResponse(options,{remoteAvailable:true,sender_role:role});}});await f.start();await drain();assert.equal(deliveryGets(f).length,0);assert.equal(f.history()[0].sender_role,'member');role='admin';await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,1);assert.equal(deliveryAcks(f).length,1);
});
test('each poll checks at most100 retained IDs and rotates through a400-file backlog',async()=>{
 const history=Array.from({length:400},(_,index)=>transfer('c2a032fc-4f54-4dda-8d75-'+String(index).padStart(12,'0'))),seen=new Set(),f=fixture({history,route:({endpoint,options})=>{if(endpoint==='/station/transfers/status'){const ids=JSON.parse(options.body).ids;assert.ok(ids.length<=100);ids.forEach(id=>seen.add(id));return statusResponse(options);}}});await f.start();await drain();for(let pass=0;pass<4;pass++)await f.api.pollStation();assert.equal(seen.size,400);assert.equal(deliveryGets(f).length,0);
});
test('a bounded station-list omission does not cancel an explicitly checked active download',async()=>{
 const id='c2a032fc-4f54-4dda-8d75-b1553cbac1d5',blocked=deferred(),f=fixture({route:({endpoint,options})=>{if(endpoint==='/station/transfers/status')return statusResponse(options,{remoteAvailable:true,sender_role:'admin'});}});await f.start();await drain();f.hooks.prepareDelivery=()=>blocked.promise;f.setTransfers([transfer(id)]);await f.api.pollStation();await drain();assert.equal(deliveryGets(f).length,1);f.setTransfers([]);await f.api.pollStation();assert.equal(JSON.parse(statusCalls(f).at(-1)[3].body).ids[0],id);blocked.resolve();await drain();assert.equal(deliveryAcks(f).length,1);assert.ok(f.receipts()[id]);
});
test('an explicit expired status cancels omitted active work before its saved receipt is committed',async()=>{
 const id='c2a032fc-4f54-4dda-8d75-b1553cbac1d5',blocked=deferred(),f=fixture({route:({endpoint,options})=>{if(endpoint==='/station/transfers/status')return statusResponse(options,{status:'expired'});}});await f.start();await drain();f.hooks.prepareDelivery=()=>blocked.promise;f.setTransfers([transfer(id)]);await f.api.pollStation();await drain();f.setTransfers([]);await f.api.pollStation();blocked.resolve();await drain();assert.equal(f.history()[0].status,'expired');assert.equal(deliveryAcks(f).length,0);assert.deepEqual(f.receipts(),{});assert.equal(f.savedFiles.size,0);
});
test('failed status lookup retains uncertain cards and an already active download without inventing new retries',async()=>{
 const id='c2a032fc-4f54-4dda-8d75-b1553cbac1d5',blocked=deferred(),f=fixture({route:({endpoint})=>{if(endpoint==='/station/transfers/status')return Response.json({error:'Isolated network failure'},{status:503});}});await f.start();await drain();f.hooks.prepareDelivery=()=>blocked.promise;f.setTransfers([transfer(id)]);await f.api.pollStation();await drain();f.setTransfers([]);await f.api.pollStation();assert.equal(f.history()[0].status,'queued');blocked.resolve();await drain();assert.equal(deliveryGets(f).length,1);assert.equal(deliveryAcks(f).length,1);assert.ok(f.receipts()[id]);
});
test('a late status lookup from an older poll cannot overwrite a newer status snapshot',async()=>{
 const id='c2a032fc-4f54-4dda-8d75-b1553cbac1d5',held=deferred(),started=deferred();let delay=false;
 const f=fixture({history:[transfer(id)],route:async({endpoint,options})=>{if(endpoint==='/station/transfers/status'){if(delay){delay=false;started.resolve();await held.promise;return statusResponse(options,{status:'expired'});}return statusResponse(options);}}});await f.start();await drain();delay=true;const old=f.api.pollStation(),rejected=assert.rejects(old,/stopped/);await started.promise;await f.api.pollStation();held.resolve();await rejected;assert.equal(f.history()[0].status,'queued');assert.equal(deliveryGets(f).length,0);
});
test('late lookup responses after credential replacement, Windows lock or quit cannot commit station history',async()=>{
 for(const change of ['credential','lock','quit']){
  const id='c2a032fc-4f54-4dda-8d75-b1553cbac1d5',held=deferred(),started=deferred();let delay=false;
  const f=fixture({history:[transfer(id)],route:async({endpoint,options})=>{if(endpoint==='/station/transfers/status'){if(delay){started.resolve();await held.promise;return statusResponse(options,{status:'expired'});}return statusResponse(options);}}});await f.start();await drain();delay=true;const pending=f.api.pollStation(),rejected=assert.rejects(pending,/stopped|closing/);await started.promise;if(change==='credential')f.api.setState({credential:'replacement-fixture'});else if(change==='lock')f.power.emit('lock-screen');else f.app.emit('before-quit',{preventDefault(){}});held.resolve();await rejected;await drain();assert.equal(f.history()[0].status,'queued',change);assert.equal(deliveryGets(f).length,0,change);
 }
});
test('a credential change while history mutation waits prevents its final commit',async()=>{
 const id='c2a032fc-4f54-4dda-8d75-b1553cbac1d5',held=deferred(),started=deferred();let expire=false;
 const f=fixture({history:[transfer(id)],route:({endpoint,options})=>{if(endpoint==='/station/transfers/status')return statusResponse(options,expire?{status:'expired'}:{});}});await f.start();await drain();f.hooks.mergeHistory=async rows=>{if(rows.some(row=>row.status==='expired')){started.resolve();await held.promise;}};expire=true;const pending=f.api.pollStation(),rejected=assert.rejects(pending,/stopped/);await started.promise;f.api.setState({credential:'replacement-fixture'});held.resolve();await rejected;assert.equal(f.history()[0].status,'queued');assert.equal(deliveryGets(f).length,0);
});

// Match the real flat pairing-status response; a nested device mock hid the startup regression.
test('an existing installation opens Who are you after startup without a website code, replacing credentials, or creating a station',async()=>{
 const f=fixture({startup:false});await f.start();await drain();
 assert.equal((await f.invoke('access-status')).allowed,true);await f.api.sharedStationPoll();
 assert.equal(f.api.getState().credential,'device-fixture');assert.equal(f.api.getState().privacyUnlocked,true);
 assert.ok(f.calls.some(call=>call[0]==='identity'));
 assert.equal(f.http().filter(call=>call[2]==='/access'||call[2]==='/workspace'||call[1]==='POST'&&call[2]==='/devices/pair').length,0);
 const pair=await f.invoke('pair',undefined,'Retry connection');assert.equal(pair.paired,true);assert.equal(f.api.getState().credential,'device-fixture');
 assert.equal(f.http().filter(call=>call[1]==='POST'&&call[2]==='/devices/pair').length,0);
});
test('a new installation opens computer onboarding locally without the mobile passcode gate or gated workspace request',async()=>{
 const f=fixture({startup:false,paired:false});await f.start();await drain();
 assert.equal((await f.invoke('access-status')).allowed,true);const state=await f.api.sharedStationPoll();
 assert.equal(state.paired,false);assert.equal(f.http().filter(call=>call[2]==='/workspace'||call[2]==='/access').length,0);
 await assert.rejects(f.invoke('prepare'),/Choose/);
});
test('a pending pairing resumes after restart without station-state access or credential replacement',async()=>{
 const pending={id:'station-fixture',name:'Isolated fixture PC',paired:false,url:'https://stati.ciani01.org/pair/pending-fixture-123',expiresAt:2000000000};
 const f=fixture({startup:false,route:({endpoint})=>endpoint==='/devices/pair/status'?Response.json(pending):undefined});
 await f.start();await drain();assert.equal((await f.invoke('access-status')).allowed,true);
 const state=await f.api.sharedStationPoll();assert.equal(state.paired,false);assert.equal(state.pairing.url,pending.url);
 const resumed=await f.invoke('pair',undefined,pending.name);assert.equal(resumed.url,pending.url);assert.equal(resumed.qr,'fixture-qr');
 assert.equal(f.api.getState().credential,'device-fixture');assert.equal(f.http().filter(call=>call[2]==='/station/state'||call[1]==='POST'&&call[2]==='/devices/pair').length,0);
});
test('a temporary connection error preserves the saved installation and does not trigger a new pairing',async()=>{
 const f=fixture({startup:false,route:({endpoint})=>{if(endpoint==='/devices/pair/status')throw Error('Local test network unavailable');}});
 await f.start();await drain();assert.equal((await f.invoke('access-status')).allowed,true);
 await assert.rejects(f.invoke('pair',undefined,'Retry'),/network unavailable/);
 assert.equal(f.api.getState().credential,'device-fixture');assert.equal(f.http().filter(call=>call[1]==='POST'&&call[2]==='/devices/pair').length,0);
});

const replacementPairing={id:'replacement-fixture-id',credential:'replacement-fixture-credential',url:'https://stati.ciani01.org/pair/replacement-fixture-token',expiresAt:2000000000};
function replacementRoute({endpoint,options}){
 if(endpoint==='/devices/pair/status')return options.headers.Authorization==='Bearer device-fixture'?Response.json({error:'Pairing expired.'},{status:410}):Response.json({id:replacementPairing.id,name:'Replacement fixture PC',paired:false,url:replacementPairing.url,expiresAt:replacementPairing.expiresAt});
 if(endpoint==='/devices/pair')return Response.json(replacementPairing);
}
test('actual replacement preserves the previous encrypted bytes and atomically commits a protected new credential',async()=>{
 const f=fixture({startup:false,route:replacementRoute});await f.start();await f.invoke('access-status');
 const original=Buffer.from(f.diskFiles.get('/mock/userData/device.bin'));
 const result=await f.invoke('pair',undefined,'Replacement fixture PC');
 assert.equal(result.paired,false);assert.equal(result.qr,'fixture-qr');assert.equal(f.api.getState().credential,replacementPairing.credential);
 assert.deepEqual(f.diskFiles.get('/mock/userData/device.previous.bin'),original);
 assert.equal(f.diskFiles.get('/mock/userData/device.bin').toString(),'sealed:'+replacementPairing.credential);
 assert.notEqual(f.diskFiles.get('/mock/userData/device.bin').toString(),replacementPairing.credential);
 const staged=f.calls.findIndex(call=>call[0]==='disk-write'&&/device\.[\w-]+\.tmp$/.test(call[1]));
 const backup=f.calls.findIndex(call=>call[0]==='disk-write'&&call[1].endsWith('/device.previous.bin'));
 const commit=f.calls.findIndex(call=>call[0]==='disk-rename'&&call[2].endsWith('/device.bin'));
 assert.ok(staged>=0&&backup>staged&&commit>backup);assert.equal(f.calls[staged][3].mode,0o600);assert.equal(f.calls[backup][3].mode,0o600);
 assert.equal([...f.diskFiles.keys()].some(file=>/device\.[\w-]+\.tmp$/.test(file)),false);
 assert.doesNotMatch(JSON.stringify(result),/replacement-fixture-credential|sealed-device/);
});
test('actual staged-write, backup-write and atomic-rename failures preserve the original installation and selected profile',async()=>{
 for(const stage of ['staged-write','backup-write','rename']){
  const f=fixture({startup:false,route:replacementRoute});await f.start();await f.invoke('access-status');
  const original=Buffer.from(f.diskFiles.get('/mock/userData/device.bin')),operator={id:'storage-fixture-admin',role:'admin'};
  f.api.setState({activeOperator:operator,operatorProof:'storage-fixture-proof'});
  f.hooks.writeFile=async file=>{if(stage==='staged-write'&&/device\.[\w-]+\.tmp$/.test(file)||stage==='backup-write'&&file.endsWith('/device.previous.bin'))throw Object.assign(Error('Fixture storage failure'),{code:'EIO'});};
  f.hooks.rename=async(_from,to)=>{if(stage==='rename'&&to.endsWith('/device.bin'))throw Object.assign(Error('Fixture storage failure'),{code:'EIO'});};
  await assert.rejects(f.invoke('pair',undefined,'Replacement fixture PC'),/Fixture storage failure/);
  assert.equal(f.api.getState().credential,'device-fixture',stage);assert.deepEqual(f.diskFiles.get('/mock/userData/device.bin'),original,stage);
  assert.equal(f.api.getState().activeOperator.id,operator.id,stage);assert.equal(f.api.getState().operatorProof,'storage-fixture-proof',stage);
  assert.equal([...f.diskFiles.keys()].some(file=>/device\.[\w-]+\.tmp$/.test(file)),false,stage);
  if(stage==='rename')assert.deepEqual(f.diskFiles.get('/mock/userData/device.previous.bin'),original);
 }
});
test('actual Remove computer waits for an in-flight protected write then removes it, so a late pairing cannot restore the connection',async()=>{
 const held=deferred(),started=deferred(),f=fixture({startup:false,paired:false,dialogResponse:1,route:replacementRoute});
 await f.start();await f.invoke('access-status');
 f.hooks.writeFile=async file=>{if(/device\.[\w-]+\.tmp$/.test(file)){started.resolve();await held.promise;}};
 const pair=f.invoke('pair',undefined,'Replacement fixture PC'),canceled=assert.rejects(pair,/connection changed/);await started.promise;
 let removed=false;const reset=f.invoke('reset-pairing').then(value=>{removed=true;return value;});await drain();
 assert.equal(removed,false);assert.equal(f.api.getState().credential,null);assert.equal(f.diskFiles.has('/mock/userData/device.bin'),false);
 held.resolve();await canceled;assert.equal((await reset).ok,true);await drain();
 assert.equal(f.api.getState().credential,null);assert.equal(f.api.getState().activeOperator,null);assert.equal(f.diskFiles.has('/mock/userData/device.bin'),false);
 assert.equal([...f.diskFiles.keys()].some(file=>/device\.[\w-]+\.tmp$/.test(file)),false);
 const commit=f.calls.findIndex(call=>call[0]==='disk-rename'&&call[2].endsWith('/device.bin'));
 const removal=f.calls.findIndex(call=>call[0]==='unlink'&&call[1].endsWith('/device.bin'));
 assert.ok(commit>=0&&removal>commit);
});
