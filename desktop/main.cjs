const notificationExpiry=require('./notification-lifetime.cjs').notificationLifetime();
let operatorProof=null,activeOperator=null,operatorGeneration=0,backgroundOperatorId=null,operatorAwaitingWorkspace=false;
const workspaceFileJobs=new Set();
const powerPointExportJobs=new Map();let packageImportScope=null;let serviceDeskIntegration;let presentationIntegration;let presentationMonitor;
function abortWorkspaceFiles(){for(const controller of workspaceFileJobs)controller.abort();}
function clearPackageImport(){packageImportScope?.client.clear();packageImportScope=null;}
const {app,BrowserWindow,Menu,Tray,ipcMain,safeStorage,shell,screen,Notification,desktopCapturer,nativeTheme,protocol,net,nativeImage,systemPreferences,powerMonitor}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {fileURLToPath,pathToFileURL}=require('node:url');const {Readable}=require('node:stream');const QRCode=require('qrcode');
app.setAppUserModelId('org.hapiproducts.stati');
if(!app.requestSingleInstanceLock()){app.quit();return;}
app.on('second-instance',()=>{if(app.isReady())showMain();});
app.on('activate',()=>{if(app.isReady())showMain();});
protocol.registerSchemesAsPrivileged([{scheme:'stati',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
const ORIGIN=!app.isPackaged&&/^http:\/\/localhost:(8787|8790)$/.test(process.env.STATI_DEV_ORIGIN||'')?process.env.STATI_DEV_ORIGIN:'https://stati.ciani01.org';
let accessGrant=null,privacyUnlocked=false,clocksRestored=false;
let identityMode='before-service',identityReason='startup',sessionLocked=false,identitySkipped=false,identityPairedCredential=null,identityPresentationKey=null,operatorRequests=Promise.resolve();
const identityPolicy=require('./identity-policy.cjs');
const identityScreen=require('./identity-window.cjs').createIdentityWindow({platform:process.platform,screen,theme:nativeTheme,mode:()=>identityMode,...(process.platform==='win32'?{captureBackdrop:()=>require('./identity-backdrop.cjs').capturePrimaryBackdrop({screen,capturer:desktopCapturer})}:{}),onPresentation:()=>sendIdentityPresentation()});
function identityStatus(){return{...identityScreen.status(),windowControlsOverlay:process.platform==='win32',canSkip:!!credential&&identityPairedCredential===credential&&privacyUnlocked&&!sessionLocked&&!quitting&&(!activeOperator||operatorAwaitingWorkspace)&&!identitySkipped&&identityPolicy.canSkipIdentity()};}
function sendIdentityPresentation({lightweight=false}={}){
 if(!main||main.isDestroyed())return;
 const status=identityStatus(),key=JSON.stringify([status.presentation,status.windowControlsOverlay,status.canSkip]);
 if(lightweight&&key===identityPresentationKey)return;
 identityPresentationKey=key;
 // The one-second availability check never resends a captured desktop PNG.
 main.webContents.send('identity-presentation',lightweight?{presentation:status.presentation,windowControlsOverlay:status.windowControlsOverlay,canSkip:status.canSkip}:status);
}
function operatorRequest(endpoint,options={}){
 const selected=localOperatorSelection?.privateAuthority();
 const captured={deviceCredential:credential,proof:operatorProof,selectionLease:selected?.lease||null,...options};
 const task=operatorRequests.catch(()=>{}).then(()=>request(endpoint,captured));operatorRequests=task.then(()=>{},()=>{});return task;
}
let updateController;let notifiedUpdate;let updateStopping=false;
let prepareOpened=false;let prepareSection='prepare';let main,credential=null,receiver=null,pairing=null,quitting=false,finalQuitAllowed=false,backgroundTray=null;const clocks=new Map();const downloadsInFlight=new Set();const recentRequests=new Set();
const deliveryTasks=new Set(),deliveryControllers=new Map(),deliveryPromises=new Map(),decisionsInFlight=new Set(),blockedTransfers=new Set();
let transferEpoch=0,pollSequence=0,latestQueueSequence=0,latestServerTransfers=new Map(),historyStatusCursor=0;
let deliveryRetry=makeDeliveryRetry();
let pendingOperatorTicket=null;
const operatorLeaseProtocol=require('./operator-selection.cjs').PROTOCOL;
const localOperatorSelection=require('./operator-selection.cjs').createOperatorSelection({
 canUse:()=>!!credential&&privacyUnlocked&&!sessionLocked&&!identitySkipped&&!quitting,
 renew:scope=>request('/station/operator/presence',{method:'POST',data:{userId:scope.userId},deviceCredential:scope.credential,proof:scope.proof,selectionLease:scope.lease,signal:scope.signal,timeout:8000}),
 reset:scope=>request('/station/operator',{method:'POST',data:{userId:null},deviceCredential:scope.credential,proof:scope.proof,selectionLease:scope.lease,signal:scope.signal,timeout:8000}),
 onInvalidated:()=>{
  backgroundOperatorId=activeOperator?.id||backgroundOperatorId;clearOperator('expired');stationPoll=null;
  prepareOpened=false;
  if(main&&!main.isDestroyed()){main.webContents.send('identity-required',{reason:'expired'});if(main.isVisible())identityWindow(main);}
 }
});
const filePath=name=>path.join(app.getPath('userData'),name);
async function readJson(name,fallback){try{return JSON.parse(await fs.readFile(filePath(name),'utf8'));}catch{return fallback;}}
const jsonWrites=new Map();function writeJson(name,value){const serialized=JSON.stringify(value);const task=(jsonWrites.get(name)||Promise.resolve()).catch(()=>{}).then(async()=>{await fs.mkdir(app.getPath('userData'),{recursive:true});const temp=filePath(name+'.'+crypto.randomUUID()+'.tmp');await fs.writeFile(temp,serialized,{mode:0o600});await fs.rename(temp,filePath(name));});jsonWrites.set(name,task);return task.finally(()=>{if(jsonWrites.get(name)===task)jsonWrites.delete(name);});}
let credentialWrites=Promise.resolve();
function storeSecret(value,expected=credential){
 const task=credentialWrites.catch(()=>{}).then(async()=>{
  if(credential!==expected)throw new Error('The computer connection changed. Try again.');
  if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw new Error('Protected device storage is unavailable. Enable OS credential protection before pairing.');
  await fs.mkdir(app.getPath('userData'),{recursive:true});
  const temporary=filePath('device.'+crypto.randomUUID()+'.tmp');
  try{
   await fs.writeFile(temporary,safeStorage.encryptString(value),{mode:0o600});
   if(credential!==expected)throw new Error('The computer connection changed. Try again.');
   if(expected&&expected!==value){try{const previous=await fs.readFile(filePath('device.bin'));await fs.writeFile(filePath('device.previous.bin'),previous,{mode:0o600});}catch(error){if(error.code!=='ENOENT')throw error;}}
   await fs.rename(temporary,filePath('device.bin'));
   clearOperator();identityPairedCredential=null;credential=value;receiver=null;stationPoll=null;resetTransferState();
  }finally{await fs.unlink(temporary).catch(()=>{});}
 });credentialWrites=task.catch(()=>{});return task;
}
let devicePairing;
function pairingSession(){return devicePairing||=require('./pairing-session.cjs').createPairingSession({current:()=>credential,request,storeSecret,qr:url=>QRCode.toDataURL(url,{margin:2,width:230,color:{dark:'#414890',light:'#ffffff'}}),origin:ORIGIN});}
async function request(endpoint,{method='GET',data,auth=true,timeout=20000,signal,deviceCredential=credential,proof=operatorProof,selectionLease}={}){
 const selected=selectionLease===undefined?localOperatorSelection.privateAuthority():null;
 const lease=selectionLease===undefined?selected?.lease:selectionLease;
 const res=await fetch(ORIGIN+'/api'+endpoint,{method,headers:{...(auth&&deviceCredential?{Authorization:'Bearer '+deviceCredential,'X-Stati-Operator-Protocol':operatorLeaseProtocol,...(proof?{'X-Stati-Operator':proof}:{}),...(lease?{'X-Stati-Operator-Lease':lease}:{})}:{}),...(accessGrant?{Cookie:'stati_access='+accessGrant}:{}),Origin:ORIGIN,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
 if(!res.ok){let message='Request failed ('+res.status+').';try{message=(await res.json()).error||message;}catch{}const error=new Error(message);error.status=res.status;throw error;}return res.json();
}
function localWindow(file,options={}){const win=new BrowserWindow({width:1120,height:780,skipTaskbar:false,minWidth:800,minHeight:600,backgroundColor:nativeTheme.shouldUseDarkColors?'#17191f':'#f8f9fc',title:'Stați · Hapi Products',icon:path.join(__dirname,'../public/brand-icon.png'),...(process.platform==='darwin'&&options.frame!==false?{titleBarStyle:'hiddenInset',trafficLightPosition:{x:18,y:16},vibrancy:'sidebar',visualEffectState:'followWindow'}:{}),...options,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,...options.webPreferences}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(url!==win.webContents.getURL())event.preventDefault();});win.loadFile(path.join(__dirname,file));return win;}
function validSender(event){const url=event.senderFrame?.url;try{if(event.senderFrame!==event.sender.mainFrame)return false;return !!url&&path.dirname(fileURLToPath(url))===__dirname;}catch{return false;}}
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{if(!validSender(event))throw new Error('Untrusted app frame.');if(quitting)throw new Error('Stați is closing.');if(sessionLocked&&!['clock-delete','identity-status'].includes(name))throw new Error('Unlock this computer before using Stați.');if(!privacyUnlocked&&!['access-status','access-unlock','pair','pair-status','website','changelog','clock-delete','identity-status','identity-windowed','offline-desk-open'].includes(name))throw new Error('Enter the computer passcode first.');return fn(...args);});}
const idValid=id=>typeof id==='string'&&/^[\w-]{20,60}$/.test(id);
function validateId(id){if(!idValid(id))throw new Error('Invalid identifier.');}
function clockSettings(input={}){const font=['Segoe UI','Arial','Aptos','Calibri','Cambria','Candara','Consolas','Courier New','Georgia','Helvetica Neue','Impact','Palatino','Tahoma','Times New Roman','Trebuchet MS','Verdana','Avenir Next','Menlo'].includes(input.font)?input.font:'Segoe UI';const size=Number(input.fontSize);const color=/^#[\da-f]{6}$/i.test(input.color||'')?input.color:'#ffffff';const bg=/^#[\da-f]{6}$/i.test(input.background||'')?input.background:'#2c3047';return{font,bold:!!input.bold,italic:!!input.italic,fontSize:Number.isFinite(size)?Math.min(110,Math.max(24,size)):52,color,background:bg,blur:input.blur!==false,autoContrast:!!input.autoContrast,autoSize:input.autoSize!==false,width:Math.min(1600,Math.max(100,Number(input.width)||350)),height:Math.min(600,Math.max(50,Number(input.height)||140)),showBackground:input.showBackground!==false,showBorder:!!input.showBorder,showSeconds:!!input.showSeconds,twentyFourHour:!!input.twentyFourHour};}
function syncClockStartup(){const settings=require('./window-lifecycle.cjs').clockLoginSettings({platform:process.platform,packaged:app.isPackaged,count:clocks.size,executable:process.execPath,identityMode});if(settings)try{app.setLoginItemSettings(settings);}catch(error){console.warn('Stați startup could not be configured:',error.name);}}
async function persistClocks(){await writeJson('clocks.json',Array.from(clocks).filter(([,c])=>!c.window.isDestroyed()).map(([id,{window,settings}])=>({id,settings,bounds:window.getBounds()})));syncClockStartup();}
function clockDimensions(settings){return settings.autoSize===false?{width:Math.round(settings.width),height:Math.round(settings.height)}:{width:Math.round(350*settings.fontSize/52),height:Math.round(140*settings.fontSize/52)};}
function fitClock(window,settings){const current=window.getBounds(),area=screen.getDisplayMatching(current).workArea,size=clockDimensions(settings);size.width=Math.min(size.width,area.width);size.height=Math.min(size.height,area.height);window.setBounds({...size,x:Math.max(area.x,Math.min(current.x,area.x+area.width-size.width)),y:Math.max(area.y,Math.min(current.y,area.y+area.height-size.height))});}
function spawnClock(id,settings,bounds){const size=clockDimensions(settings);const display=screen.getDisplayMatching(bounds||{x:100,y:100,width:350,height:140}),area=display.workArea;const x=Math.max(area.x,Math.min(bounds?.x??area.x+60,area.x+area.width-size.width)),y=Math.max(area.y,Math.min(bounds?.y??area.y+60,area.y+area.height-size.height));const win=localWindow('clock.html',{x,y,...size,minWidth:100,minHeight:50,frame:false,resizable:false,maximizable:false,minimizable:false,fullscreenable:false,thickFrame:false,hasShadow:false,skipTaskbar:true,alwaysOnTop:true,transparent:true,backgroundColor:'#00000000',...(process.platform==='darwin'?{visualEffectState:'active'}:{}),...(process.platform==='win32'?{backgroundMaterial:settings.blur&&settings.showBackground?'acrylic':'none'}:{})});if(process.platform==='darwin')win.setVibrancy(settings.blur&&settings.showBackground?'under-window':null);win.setBackgroundColor('#00000000');clocks.set(id,{window:win,settings});win.webContents.on('did-finish-load',()=>win.webContents.send('clock-settings',{id,...settings}));let timer;win.on('move',()=>{clearTimeout(timer);timer=setTimeout(()=>void persistClocks(),300);});win.on('resize',()=>{const current=clocks.get(id);if(current&&current.settings.autoSize===false){const size=win.getBounds();current.settings.width=size.width;current.settings.height=size.height;}clearTimeout(timer);timer=setTimeout(()=>void persistClocks(),300);});win.on('closed',()=>{clearTimeout(timer);clocks.delete(id);notifyClockList();if(!quitting)void persistClocks().catch(e=>console.warn('Clock settings save failed:',e.name));});return id;}
function notifyClockList(){if(main&&!main.isDestroyed())main.webContents.send('clocks-changed');}
let contrastBusy=false,lastContrastStatus='';const contrastColors=new Map();
function contrastStatus(message){if(message===lastContrastStatus)return;lastContrastStatus=message;if(main&&!main.isDestroyed())main.webContents.send('clock-contrast-status',message);}
async function autoContrast(){if(contrastBusy||!Array.from(clocks.values()).some(c=>c.settings.autoContrast))return;contrastBusy=true;try{if(process.platform==='darwin'&&systemPreferences.getMediaAccessStatus('screen')==='denied')throw new Error('Allow Screen Recording for Stați in macOS Privacy & Security to use automatic text contrast.');const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:640,height:360}});if(process.platform==='darwin'&&systemPreferences.getMediaAccessStatus('screen')!=='granted')throw new Error('Allow Screen Recording for Stați in macOS Privacy & Security to use automatic text contrast.');for(const [id,{window,settings}] of clocks){if(!settings.autoContrast||window.isDestroyed())continue;const bounds=window.getBounds(),display=screen.getDisplayMatching(bounds),source=sources.find(s=>s.display_id===String(display.id));if(!source||source.thumbnail.isEmpty())throw new Error('Screen colors are unavailable. Check screen-recording permission.');const color=require('./clock-contrast.cjs').contrastColor(source.thumbnail.toBitmap(),source.thumbnail.getSize(),bounds,display.bounds,contrastColors.get(id));contrastColors.set(id,color);window.webContents.send('clock-settings',{color});}contrastStatus('');}catch(error){contrastStatus(error.message||'Automatic text contrast is unavailable.');}finally{contrastBusy=false;}}
async function restoreClocks(){if(clocksRestored)return;clocksRestored=true;const saved=await readJson('clocks.json',[]);for(const c of (Array.isArray(saved)?saved:[]).slice(0,5)){if(idValid(c.id)&&!clocks.has(c.id))spawnClock(c.id,clockSettings(c.settings),c.bounds);}syncClockStartup();}
async function unlockPrivacy(){privacyUnlocked=true;await restoreClocks();if(!activeOperator)identityWindow(main);return{allowed:true};}
// The desktop shell has its own paired-device and operator authentication.
// The six-digit website code is mobile onboarding, never a desktop startup gate.
handle('access-status',async()=>unlockPrivacy());
handle('access-unlock',async code=>{if(typeof code!=='string'||!/^\d{6}$/.test(code))throw new Error('Enter the six-digit computer passcode.');if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw new Error('Protected storage is unavailable.');const response=await fetch(ORIGIN+'/api/access',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({code}),signal:AbortSignal.timeout(20000)});if(!response.ok){const data=await response.json();throw new Error(data.error||'Unable to unlock.');}const raw=response.headers.get('set-cookie')?.match(/stati_access=([^;]+)/)?.[1];if(!raw)throw new Error('Access grant was not returned.');await fs.writeFile(filePath('access.bin'),safeStorage.encryptString(raw),{mode:0o600});accessGrant=raw;return unlockPrivacy();});
let remoteSongWork=null;let stationPoll=null;const stationPolls=new Set(),receiverMutations=new Set();let receivingEnabled=true,pendingPrepare=null;const previewCache=new Map(),previewControllers=new Set(),previewControllerIds=new Map(),previewTasks=new Set(),previewByteTasks=new Set(),previewQueue=require('./preview-queue.cjs').createPreviewQueue();
function stopFilePreviews(id){for(const [controller,fileId] of previewControllerIds)if(fileId===id)controller.abort(Error('This preview was closed after rejecting the file.'));}
function stopPreviewWork(){profilePhotos.clear();for(const controller of previewControllers)controller.abort(Error('The selected user changed or Stați is closing.'));previewQueue.clear();previewCache.clear();}
function clearOperator(reason='switch'){if(typeof presentationMonitor!=='undefined')presentationMonitor?.clear();if(typeof approvedOutputPlans!=='undefined')approvedOutputPlans?.clear();if(typeof serviceDeskIntegration!=='undefined')serviceDeskIntegration?.clear();if(typeof presentationIntegration!=='undefined')presentationIntegration?.clear();notificationExpiry.closeAll();abortWorkspaceFiles();clearPackageImport();main?.webContents?.send?.('workspace-reset',{reason});prepareOpened=false;clearAudioPlayback();localOperatorSelection.clear(reason);pendingOperatorTicket=null;operatorAwaitingWorkspace=false;localPlaylistJobs?.cancel();operatorGeneration++;activeOperator=null;operatorProof=null;stopPreviewWork();pendingPrepare=null;}
function identityWindow(win){if(sessionLocked||identitySkipped||!win||win.isDestroyed())return;if(privacyUnlocked&&credential&&identityPairedCredential===credential)identityScreen.show(win,{reason:identityReason});else identityScreen.dismiss(win);}
function workspaceWindow(){if(main&&!main.isDestroyed())identityScreen.workspace(main);}
function titleBarColors(){return{color:nativeTheme.shouldUseDarkColors?'#17191f':'#f8f9fc',symbolColor:nativeTheme.shouldUseDarkColors?'#ffffff':'#1a1a1a',height:32};}
function createMainWindow(){
 const win=localWindow('index.html',{width:500,height:640,minWidth:400,minHeight:500,show:false,...(process.platform==='win32'?{titleBarStyle:'hidden',titleBarOverlay:titleBarColors(),backgroundMaterial:'none'}:{})});
 // Reopening a closed window preserves the receiver's explicit paused state.
 win.webContents.on('did-finish-load',()=>{if(!win.isDestroyed())win.webContents.send('identity-presentation',identityStatus());});
 win.on('leave-full-screen',()=>{if(identityScreen.status().presentation==='fullscreen')identityScreen.dismiss(win);});
 win.on('close',event=>{if(!quitting&&process.platform==='win32'){event.preventDefault();identityScreen.dismiss(win);win.hide();return;}if(!quitting&&require('./powerpoint-batch.cjs').isRunning()){event.preventDefault();void require('electron').dialog.showMessageBox(win,{type:'info',message:'Finish or stop conversion before closing Stați.'});return;}clearOperator();prepareOpened=false;receivingEnabled=false;if(!quitting&&credential&&receiver){receiver=null;void request('/station/receiver',{method:'DELETE'}).catch(()=>{});}});
 win.on('closed',()=>{if(main===win){main=null;identityScreen.close();}});return win;
}
function showMain(){if(quitting||sessionLocked)return;const creating=!main||main.isDestroyed(),reopening=identitySkipped;identitySkipped=false;main=require('./window-lifecycle.cjs').showMainWindow(main,createMainWindow);if(creating||reopening||!activeOperator)identityWindow(main);return main;}
function createBackgroundTray(){
 if(process.platform!=='win32'||backgroundTray)return;
 const icon=nativeImage.createFromPath(path.join(__dirname,'../public/brand-icon.png')).resize({width:16,height:16});
 backgroundTray=new Tray(icon);
 backgroundTray.setToolTip('Stați · Open or exit');
 backgroundTray.setContextMenu(Menu.buildFromTemplate([{label:'Open Stați',click:showMain},{type:'separator'},{label:'Exit Stați',click:()=>app.quit()}]));
 backgroundTray.on('click',showMain);
}
function resetSessionIdentity(reason){
 if(sessionLocked||quitting)return;sessionLocked=true;
 backgroundOperatorId=activeOperator?.id||backgroundOperatorId;clearOperator();stationPoll=null;
 if(main&&!main.isDestroyed()){main.hide();identityScreen.dismiss(main);main.webContents.send('identity-required',{reason});}
 prepareOpened=false;
 
}
function resumeSessionIdentity(){
 if(!sessionLocked||quitting)return;sessionLocked=false;
 identityReason='unlock';
 if(main&&!main.isDestroyed())main.webContents.send('identity-required',{reason:'unlock'});
 if(identityMode==='off')return;
 const win=showMain();if(win&&!activeOperator)identityWindow(win);
}
function watchWindowsSession(){
 if(!['win32','darwin'].includes(process.platform))return;
 powerMonitor.on('lock-screen',()=>resetSessionIdentity('lock'));
 powerMonitor.on('suspend',()=>resetSessionIdentity('sleep'));
 powerMonitor.on('unlock-screen',resumeSessionIdentity);
 powerMonitor.on('resume',()=>{const timer=setTimeout(()=>{if(sessionLocked&&['active','idle'].includes(powerMonitor.getSystemIdleState(1)))resumeSessionIdentity();},1000);timer.unref();});
}
function identitySettings(){
 const schedule=require('../src/shared/service-schedule.json');
 const format=new Intl.DateTimeFormat('en-US',{weekday:'long',hour:'numeric',minute:'2-digit',timeZone:'UTC'});
 return{mode:identityMode,scheduleSummary:schedule.services.map(service=>format.format(new Date(Date.UTC(2026,0,4+service.day,service.hour,service.minute)))).join(' · ')+' (Phoenix time)',...identityStatus()};
}
handle('workspace-open',()=>{if(!activeOperator||!localOperatorSelection.privateAuthority({userId:activeOperator.id,generation:operatorGeneration}))throw Error('Choose who is using this computer first.');operatorAwaitingWorkspace=false;workspaceWindow();return {ok:true};});
handle('identity-open',()=>{if(!activeOperator)identityWindow(main);return identityStatus();});
handle('identity-status',identityStatus);
handle('identity-windowed',()=>{identityScreen.dismiss(main);return identityStatus();});
handle('identity-skip',()=>{
 if(!identityStatus().canSkip||!main||main.isDestroyed())throw Error('Skip for now is available from five minutes before service until the service ends.');
 identitySkipped=true;clearOperator();stationPoll=null;
 identityScreen.hide(main);
 // Clear partial PIN/passkey selection and invalidate any in-flight choice.
 // No workspace is opened, and device receiving/clocks remain untouched.
 main.webContents.send('identity-required',{reason:'skip'});
 
 return{skipped:true,...identityStatus()};
});
handle('identity-settings',identitySettings);
handle('identity-settings-save',async mode=>{
 if(!['before-service','in-app','off'].includes(mode))throw Error('Choose a sign-in screen option.');
 const generation=operatorGeneration,state=require('./station-visibility.cjs').visibleState(await sharedStationPoll(),activeOperator,operatorGeneration);assertIdentity(generation);
 if(!state.adminUnlocked)throw Error('Unlock an administrator before changing startup settings.');
 await writeJson('identity-settings.json',{mode});identityMode=mode;syncClockStartup();identityScreen.recheck(main);return identitySettings();
});
function notify(title,body,click){if(!Notification.isSupported())return{supported:false};const notification=new Notification({title,body,icon:path.join(__dirname,'../public/brand-icon.png')});if(click)notification.on('click',click);notification.on('failed',()=>{if(main&&!main.isDestroyed())main.webContents.send('notification-failed');});notificationExpiry.track(notification);notification.show();return{supported:true};}
let notificationJobs=Promise.resolve(),notificationDevice=null,notificationLedger=null;
function notificationDetailsAllowed(state){
 if(!privacyUnlocked||sessionLocked||identitySkipped||!activeOperator)return false;
 const selected=localOperatorSelection.privateAuthority({deviceId:state.device.id,userId:activeOperator.id,generation:operatorGeneration});
 return !!selected&&selected.credential===credential&&!!require('./station-visibility.cjs').operatorScope(state,activeOperator,operatorGeneration);
}
function notifyStationActivity(state,queued,historyIds,deviceCredential,epoch){
 const live=()=>!quitting&&credential===deviceCredential&&transferEpoch===epoch;
 const task=notificationJobs.catch(()=>{}).then(async()=>{
  if(!live())return;
  if(notificationDevice!==state.device.id){
   const saved=await readJson('notification-seen.json',{});if(!live())return;
   recentRequests.clear();if(saved.deviceId===state.device.id&&Array.isArray(saved.keys))for(const key of saved.keys.slice(-2000))if(typeof key==='string'&&/^(?:file|request|access):[\w-]{20,60}$/.test(key))recentRequests.add(key);
   notificationDevice=state.device.id;notificationLedger=JSON.stringify([...recentRequests]);
  }
  const remember=key=>{const seen=recentRequests.has(key);recentRequests.delete(key);recentRequests.add(key);return seen;};
  for(const file of queued.filter(file=>file.status==='queued'&&file.remoteAvailable!==false)){
   const key='file:'+file.id;if(historyIds.has(file.id)){remember(key);continue;}if(recentRequests.has(key)){remember(key);continue;}if(!live())return;
   const detailed=notificationDetailsAllowed(state),result=notify('Stați · File received',detailed?(file.first_name||'Member')+' sent '+file.filename:'A new file arrived. Open Stați to view it.',()=>{const win=showMain();if(win)win.webContents.send('navigate','station');});
   if(result.supported)remember(key);
  }
  const requests=[...(state.requests||[]).map(request=>({...request,kind:'request'})),...(state.accessApprover==='operator'?(state.accessRequests||[]).map(request=>({...request,kind:'access'})):[])];
  for(const request of requests){
   const key=request.kind+':'+request.id;if(recentRequests.has(key)){remember(key);continue;}if(!live())return;
   const detailed=notificationDetailsAllowed(state),body=detailed?request.first_name+' '+request.last_initial+'.: '+(request.kind==='access'?'Wants access to this computer.':request.message):request.kind==='access'?'Someone wants to connect. Open Stați to review the request.':'A request is waiting. Open Stați to review it.';
   if(notify('Stați · Request',body,showRequests).supported)remember(key);
  }
  while(recentRequests.size>2000)recentRequests.delete(recentRequests.values().next().value);
  const serialized=JSON.stringify([...recentRequests]);if(live()&&serialized!==notificationLedger){await writeJson('notification-seen.json',{deviceId:state.device.id,keys:[...recentRequests]});if(live())notificationLedger=serialized;}
 });notificationJobs=task.catch(error=>console.warn('Notification history:',error.name));return notificationJobs;
}
handle('notification-test',()=>notify('Stați','Notifications are working. Click to open Stați.',showRequests));
handle('notification-settings',()=>{if(process.platform==='win32')return shell.openExternal('ms-settings:notifications');if(process.platform==='darwin')return shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension');});
function showRequests(){const win=showMain();if(!win)return;if(win.webContents.isLoading())win.webContents.once('did-finish-load',()=>{if(!win.isDestroyed())win.webContents.send('show-requests');});else win.webContents.send('show-requests');}
function stoppedDelivery(){return Object.assign(new Error('File delivery was stopped. Refresh the file list before trying again.'),{cancelled:true,retryable:false});}
function makeDeliveryRetry(){
 return require('./transfer-retry.cjs').createTransferRetry({deliver:id=>deliverTransfer(id,{automatic:true}),isBusy:()=>downloadsInFlight.size>0||decisionsInFlight.size>0,onFailure:({terminal})=>{if(!quitting)notify('Stați · Save failed',terminal?'A file needs attention. Open Stați to check it.':'A file could not be saved. Stați will retry while it is queued.',showRequests);}});
}
function stopTransferWork(){deliveryRetry.stop();for(const item of deliveryControllers.values())item.controller.abort(stoppedDelivery());}
function resetTransferState(){stopTransferWork();stopPreviewWork();transferEpoch++;latestServerTransfers=new Map();historyStatusCursor=0;latestQueueSequence=++pollSequence;deliveryRetry=makeDeliveryRetry();}
function invalidateTransferState(){identityPairedCredential=null;stopTransferWork();stopPreviewWork();transferEpoch++;latestServerTransfers=new Map();historyStatusCursor=0;latestQueueSequence=++pollSequence;}
function observeServerTransfers(transfers,sequence){
 if(sequence<=latestQueueSequence||quitting)return;
 const previous=latestServerTransfers;
 latestQueueSequence=sequence;latestServerTransfers=new Map((Array.isArray(transfers)?transfers:[]).map(file=>[file.id,file]));
 // /station/state is bounded. Omission alone cannot stop a download that was
 // already authorized. Explicit per-ID results below can stop it; a failed
 // lookup retains only active work, never a new automatic retry candidate.
 for(const [id,item] of deliveryControllers){if(!latestServerTransfers.has(id)&&previous.has(id))latestServerTransfers.set(id,previous.get(id));const file=latestServerTransfers.get(id);if(file&&(file.status!=='queued'||file.remoteAvailable===false||item.automatic&&file.sender_role!=='admin')||blockedTransfers.has(id))item.controller.abort(stoppedDelivery());}
 void deliveryRetry.observe([...latestServerTransfers.values()].filter(file=>file.remoteAvailable!==false),{allowed:receivingEnabled&&!quitting&&!!credential,sequence});
}
async function pollStation(){
 if(quitting)throw new Error('Stați is closing.');
 if(!credential)return{paired:false,organization:'Stați'};
 if(identityPairedCredential!==credential){const captured=credential;let status;try{status=await pairingSession().status();}catch(error){if(captured!==credential)throw stoppedDelivery();if(error.status===410)return{paired:false,organization:'Stați'};throw error;}if(captured!==credential)throw stoppedDelivery();if(!status.paired)return{paired:false,organization:'Stați',pairing:status};identityPairedCredential=captured;if(privacyUnlocked&&!activeOperator)identityWindow(main);}
 const generation=operatorGeneration,epoch=transferEpoch,deviceCredential=credential,sequence=++pollSequence;
 const checkPoll=()=>{if(quitting||epoch!==transferEpoch||deviceCredential!==credential||generation!==operatorGeneration||sequence<latestQueueSequence)throw stoppedDelivery();};
 let state;try{state=await request('/station/state');}catch(error){if(epoch===transferEpoch&&deviceCredential===credential&&[401,403].includes(error.status))invalidateTransferState();throw error;}
 checkPoll();
 identityPairedCredential=deviceCredential;
 catalogConnection={credential:deviceCredential,deviceId:state.device.id};if(Date.now()-catalogScanAt>5*60000){catalogScanAt=Date.now();catalogPublisher().schedule();}
 state.operatorGeneration=generation;
 const stationFiles=require('./station-files.cjs'),historyFile=filePath('station-history.json');
 const history=await stationFiles.mergeHistory(historyFile,[],{beforeCommit:checkPoll});checkPoll();
 const current=(state.transfers||[]).map(file=>({...file,remoteAvailable:file.status==='queued'}));
 const batch=stationFiles.historyStatusBatch(history,current.map(file=>file.id),historyStatusCursor,[...downloadsInFlight]);
 let updates=[];
 if(batch.ids.length){
  try{const result=await request('/station/transfers/status',{method:'POST',data:{ids:batch.ids},timeout:8000});checkPoll();updates=stationFiles.historyStatusUpdates(batch.ids,result);historyStatusCursor=batch.cursor;}
  catch(error){checkPoll();if([401,403].includes(error.status)){invalidateTransferState();throw error;}/* Retain uncertain history when offline or while an older server is being updated. */}
 }
 checkPoll();
 const known=new Map(history.map(file=>[file.id,file]));
 // Only authenticated current/per-ID queue rows can schedule downloads. Local
 // history supplies display metadata, while the fresh role controls eligibility.
 observeServerTransfers([...current,...updates.map(row=>({...known.get(row.id),...row}))],sequence);
 if(receivingEnabled&&!quitting){if(!receiver){const opened=await receiverRequest({method:'POST'});checkPoll();receiver=opened;}else if(receiver.expiresAt<Math.floor(Date.now()/1000)+120){const renewing=receiver;try{const renewed=await receiverRequest({method:'PATCH',data:{id:renewing.id}});checkPoll();if(receiver===renewing)Object.assign(receiver,renewed);}catch(error){checkPoll();if(error.status!==410)throw error;const opened=await receiverRequest({method:'POST'});checkPoll();receiver=opened;}}}
 checkPoll();
 state.transfers=await stationFiles.mergeHistory(historyFile,[...current,...updates],{beforeCommit:checkPoll});
 const receipts=await readJson('deliveries.json',{});checkPoll();const recovered=[];
 for(const [id,location] of Object.entries(receipts)){if(state.transfers.some(f=>f.id===id))continue;try{const stat=await fs.stat(location);checkPoll();const ext=path.extname(location).toLowerCase();recovered.push({id,filename:path.basename(location),bytes:stat.size,content_type:['.png','.jpg','.jpeg','.webp','.gif'].includes(ext)?'image/'+(ext==='.jpg'?'jpeg':ext.slice(1)):'application/octet-stream',status:'delivered',remoteAvailable:false,created_at:Math.floor(stat.mtimeMs/1000)});}catch(error){checkPoll();}}
 if(recovered.length)state.transfers=await stationFiles.mergeHistory(historyFile,recovered,{beforeCommit:checkPoll});
 const hiddenHistory=new Set(await readJson('hidden-history.json',[]));checkPoll();state.transfers=state.transfers.filter(f=>f.status==='queued'||!hiddenHistory.has(f.id));state.transfers=state.transfers.map(f=>({...f,...(receipts[f.id]?{original_filename:f.filename,filename:path.basename(receipts[f.id])}:{}),saved:!!receipts[f.id]}));await notifyStationActivity(state,current,new Set(history.map(file=>file.id)),deviceCredential,epoch);if(state.adminUnlocked&&activeOperator?.role==='admin'&&!remoteSongWork){remoteSongWork=processRemoteSongActions(generation).catch(()=>{}).finally(()=>{remoteSongWork=null;});}return{paired:true,...state,receiver};}
async function sharedStationPoll(){if(quitting)throw new Error('Stați is closing.');if(!stationPoll){const pending=pollStation();stationPoll=pending;stationPolls.add(pending);void pending.finally(()=>{stationPolls.delete(pending);if(stationPoll===pending)stationPoll=null;}).catch(()=>{});}return stationPoll;}
function presentationMonitorScope(){
 if(process.platform!=='win32'||quitting||sessionLocked||!privacyUnlocked||identitySkipped||!credential||!activeOperator?.capabilities?.editLyrics)return null;
 return{key:credential+':'+activeOperator.id+':'+operatorGeneration,generation:operatorGeneration,userId:activeOperator.id};
}
function monitorPresentationFiles(){
 if(!presentationIntegration?.backgroundSync)return;
 if(!presentationMonitor)presentationMonitor=require('./presentation-monitor.cjs').createPresentationMonitor({now:()=>Date.now(),current:presentationMonitorScope,sync:()=>presentationIntegration.backgroundSync(),onAttention:(_result,scope)=>{notify('Stați · Linked song needs attention','A linked song is missing or has changes that need review. Open PowerPoint tools to see the file.',()=>{const current=presentationMonitorScope();showMain();if(current?.key===scope.key)openPrepare('powerpoint');});},onError:error=>console.warn('Linked song check:',error.name)});
 void presentationMonitor.tick().catch(()=>{});
}
function pollInBackground(){if(!quitting&&credential)void sharedStationPoll().then(()=>monitorPresentationFiles()).catch(()=>{});}
async function receiverRequest(options){
 if(quitting)throw new Error('Stați is closing.');
 const pending=request('/station/receiver',options);receiverMutations.add(pending);
 try{return await pending;}finally{receiverMutations.delete(pending);}
}
async function stopReceiver(){
 // Stop new polls first, including those independent of the visible profile.
 // Track older polls too: OS/user identity changes may have replaced stationPoll.
 quitting=true;finalQuitAllowed=false;clearOperator('quit');stopTransferWork();stopPreviewWork();await Promise.allSettled([...stationPolls,...receiverMutations,...deliveryTasks,...previewTasks,...previewByteTasks,...audioTasks,profilePhotos.drain()]);await presentationMonitor?.drain();await remoteSongWork;
 // A lost DELETE response may still have closed the server lease. Never reuse it.
 try{if(credential)await request('/station/receiver',{method:'DELETE'});}finally{receiver=null;}
}
function restoreAfterUpdateError(){if(!updateStopping)return;updateStopping=false;finalQuitAllowed=false;quitting=false;resetTransferState();pollInBackground();}
handle('state',async()=>require('./station-visibility.cjs').visibleState(await sharedStationPoll(),activeOperator,operatorGeneration));
async function assertFileAccess(id){validateId(id);const generation=operatorGeneration;const state=await sharedStationPoll();if(generation!==operatorGeneration||!require('./station-visibility.cjs').visibleFiles(state,activeOperator,operatorGeneration).some(file=>file.id===id))throw Error('This file is not available to the selected user.');return generation;}
function assertIdentity(generation){if(generation!==operatorGeneration)throw Error('The selected user changed. Try again.');}
function assertOperatorChangeAllowed(id){const converting=require('./powerpoint-batch.cjs').isRunning();if(converting&&(activeOperator||id!==backgroundOperatorId))throw Error('Conversion is still running. Unlock the previous operator or wait until it finishes.');if(downloadsInFlight.size&&(activeOperator||id===null))throw Error('Finish saving files before switching users.');}
async function beginOperatorChoice(id,generation){
 assertIdentity(generation);const deviceCredential=credential;
 const state=await operatorRequest('/station/state',{deviceCredential,proof:null,selectionLease:null});assertIdentity(generation);
 if(deviceCredential!==credential||state.operatorLeaseProtocol!==operatorLeaseProtocol)throw Error('The computer connection needs an update before choosing a profile. Check for updates and try again.');
 const member=state.members?.find(member=>member.id===id&&member.ministryRole!=='pastor');if(!member)throw Error('Choose a registered member.');
 return{ticket:localOperatorSelection.begin({credential:deviceCredential,deviceId:state.device.id,userId:id,role:member.role,requiresUnlock:member.requiresUnlock,generation}),deviceCredential};
}
async function activateOperator(ticket,result,startedAt=ticket.startedAt,token){
 try{
  if(!localOperatorSelection.activate(ticket,result,{startedAt,token}))throw Error('Choose your profile again. Its unlock request expired or was replaced.');
  assertIdentity(ticket.generation);assertOperatorChangeAllowed(ticket.userId);operatorAwaitingWorkspace=true;
  const scope=localOperatorSelection.privateAuthority({userId:ticket.userId,generation:ticket.generation});
  if(!scope)throw Error('Choose your profile again.');operatorProof=scope.proof;
  const state=await request('/station/state',{deviceCredential:scope.credential,proof:scope.proof,selectionLease:scope.lease});assertIdentity(ticket.generation);
  const member=state.members.find(member=>member.id===ticket.userId);
  if(state.operatorLeaseProtocol!==operatorLeaseProtocol||!member||member.ministryRole==='pastor'||state.device.operator_id!==ticket.userId||member.role==='admin'&&!state.adminUnlocked)throw Error('Choose your account again.');
  activeOperator={id:member.id,role:member.role,ministryRole:member.ministryRole,capabilities:member.capabilities};pendingOperatorTicket=null;stationPoll=null;playlistJobs().schedule();
 }catch(error){if(ticket.generation===operatorGeneration)clearOperator('activation-failed');throw error;}
}

handle('pair',name=>pairingSession().pair(name));
handle('pair-status',async()=>{const captured=credential,status=await pairingSession().status();if(captured!==credential)throw new Error('The computer connection changed. Try again.');if(status.paired){const newlyPaired=identityPairedCredential!==captured;identityPairedCredential=captured;stationPoll=null;if(newlyPaired&&privacyUnlocked&&!activeOperator)identityWindow(main);}return status;});
handle('enrollment-code',async()=>{const value=await request('/station/enrollment-code');if(!/^[0-9]{6}$/.test(value.code))throw Error('The invitation could not be verified. Try again.');return {...value,qr:await QRCode.toDataURL(ORIGIN+'/#join='+value.code,{margin:2,width:230})};});
handle('operator',async({id,pin})=>{
 if(identitySkipped)throw Error('Open Stați again before choosing your profile.');assertOperatorChangeAllowed(id);clearOperator();
 prepareOpened=false;stationPoll=null;
 const generation=operatorGeneration;
 if(id===null){identityReason='switch';identityWindow(main);if(main&&!main.isDestroyed())main.webContents.send('identity-required',{reason:'switch'});return{ok:true};}
 validateId(id);const {ticket,deviceCredential}=await beginOperatorChoice(id,generation);assertIdentity(generation);
 const result=await operatorRequest('/station/operator',{method:'POST',data:{userId:id,pin},deviceCredential,proof:null,selectionLease:null});
 await activateOperator(ticket,result);return{ok:true};
});
handle('operator-unlock',async id=>{
 if(identitySkipped)throw Error('Open Stați again before choosing your profile.');validateId(id);assertOperatorChangeAllowed(id);clearOperator();stationPoll=null;
 const generation=operatorGeneration,{ticket,deviceCredential}=await beginOperatorChoice(id,generation);assertIdentity(generation);
 const result=await operatorRequest('/station/operator/unlock',{method:'POST',data:{userId:id},deviceCredential,proof:null,selectionLease:null});
 if(!localOperatorSelection.bindPending(ticket,result))throw Error('This phone unlock expired or was replaced. Choose your profile again.');assertIdentity(generation);pendingOperatorTicket=ticket;
 return{token:result.token,expiresAt:result.expiresAt,qr:await QRCode.toDataURL(result.url+'?authenticate=1',{width:210,margin:2})};
});
handle('operator-unlock-status',async token=>{
 if(identitySkipped)throw Error('Open Stați again before choosing your profile.');if(typeof token!=='string'||token.length>100)throw Error('Invalid unlock request.');
 const ticket=pendingOperatorTicket,scope=localOperatorSelection.pendingRequest(ticket,token);if(!scope)throw Error('This phone unlock expired or was replaced. Choose your profile again.');
 const result=await operatorRequest('/station/operator/unlock/status',{method:'POST',data:{token,userId:scope.userId},deviceCredential:scope.credential,proof:null,selectionLease:scope.lease});
 if(result.approved)await activateOperator(ticket,result,scope.startedAt,token);return{approved:result.approved===true};
});
handle('operator-unlock-cancel',()=>{if(operatorAwaitingWorkspace||['choosing','pending'].includes(localOperatorSelection.status().phase)){clearOperator('cancel');stationPoll=null;}return{ok:true};});
handle('receiver-open',async()=>{receivingEnabled=true;receiver=await receiverRequest({method:'POST'});return{...receiver,qr:await QRCode.toDataURL(receiver.url,{margin:2,width:230,color:{dark:'#414890',light:'#ffffff'}})};});
handle('receiver-close',async()=>{receivingEnabled=false;latestServerTransfers=new Map();latestQueueSequence=++pollSequence;deliveryRetry.observe([],{allowed:false,sequence:latestQueueSequence});for(const item of deliveryControllers.values())if(item.automatic)item.controller.abort(stoppedDelivery());await request('/station/receiver',{method:'DELETE'});receiver=null;return{ok:true};});
function safeName(raw){const name=raw.normalize('NFKC').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/,'').slice(0,140);return !name||/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)?'presentation-'+name:name;}
async function removeOwnedTemporary(temporary,identity){
 if(!temporary||!identity)return;
 try{const current=await fs.lstat(temporary,{bigint:true});if(current.isFile()&&!current.isSymbolicLink()&&String(current.dev)===identity.dev&&String(current.ino)===identity.ino)await fs.unlink(temporary);}catch(error){if(error.code!=='ENOENT')console.warn('Temporary download cleanup failed:',error.name);}
}
async function deliverTransfer(id,{automatic=false,generation=operatorGeneration}={}){
 validateId(id);
 if(deliveryPromises.has(id))return deliveryPromises.get(id);
 if(downloadsInFlight.size||decisionsInFlight.has(id))throw Object.assign(new Error('Another file is being saved. Wait for it to finish, then try again.'),{code:'STATI_DELIVERY_BUSY'});
 const controller=new AbortController(),deviceCredential=credential,epoch=transferEpoch;
 const checkActive=()=>{
  if(quitting||controller.signal.aborted||epoch!==transferEpoch||credential!==deviceCredential||blockedTransfers.has(id))throw stoppedDelivery();
  if(automatic){const file=latestServerTransfers.get(id);if(!receivingEnabled||!file||file.status!=='queued'||file.remoteAvailable===false||file.sender_role!=='admin')throw stoppedDelivery();}
  else{assertIdentity(generation);if(sessionLocked||!activeOperator)throw stoppedDelivery();}
 };
 // Reserve the shared slot synchronously, before the first filesystem/network await.
 downloadsInFlight.add(id);deliveryControllers.set(id,{controller,automatic});
 const pending=(async()=>{
  let temporary,temporaryIdentity;
  try{
   checkActive();
   const stationFiles=require('./station-files.cjs'),recovery=require('./delivery-recovery.cjs');
   const receipts=await stationFiles.readReceipts(filePath('deliveries.json'));checkActive();
   await fs.mkdir(app.getPath('downloads'),{recursive:true});const downloadsDirectory=await fs.realpath(app.getPath('downloads'));checkActive();
   const options={downloadsDirectory,id,signal:controller.signal,checkActive};
   const acknowledge=async(saved,{existingReceipt=false}={})=>{
    checkActive();if(!existingReceipt)await stationFiles.saveReceipt(filePath('deliveries.json'),id,saved.path,{beforeCommit:checkActive});
    const verified=await recovery.verifyDelivery({...options,path:saved.path});
    if(!verified&&!existingReceipt)throw Object.assign(new Error('The saved-download checkpoint is missing. Existing files were retained; contact an administrator before retrying.'),{code:'STATI_RECOVERY_REQUIRED',retryable:false});
    checkActive();await request('/station/transfers/'+id+'/delivered',{method:'POST',data:{automatic},deviceCredential,signal:controller.signal});
    // Retain verification records across a lost ACK. Cleanup is housekeeping only after server success.
    await recovery.completeDelivery({...options,path:saved.path}).catch(error=>console.warn('Delivery checkpoint cleanup failed:',error.name));
    return saved;
   };
   if(receipts[id]){
    let exists=false;try{const stat=await fs.lstat(receipts[id]);if(!stat.isFile()||stat.isSymbolicLink())throw Object.assign(new Error('The saved file changed. Restore it before retrying.'),{retryable:false});exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(exists)return await acknowledge({path:receipts[id],alreadySaved:true},{existingReceipt:true});
   }
   const recovered=await recovery.recoverDelivery(options);checkActive();
   if(recovered)return acknowledge(recovered);
   const response=await fetch(ORIGIN+'/api/station/transfers/'+id,{headers:{Authorization:'Bearer '+deviceCredential,...(automatic?{'X-Stati-Delivery-Mode':'automatic'}:{})},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(300000)])});
   if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});const error=new Error('This file is no longer available.');if(!response.ok)error.status=response.status;throw error;}
   checkActive();let filename='presentation';try{filename=decodeURIComponent(response.headers.get('content-disposition')?.split("filename*=UTF-8''")[1]||filename);}catch{}
   temporary=path.join(downloadsDirectory,'.stati-'+id+'-'+crypto.randomUUID()+'.part');
   const checked=await require('./transfer-download.cjs').writeDownload(response,temporary);temporaryIdentity=checked.temporaryIdentity;checkActive();
   const saved=await recovery.prepareDelivery({...options,temporaryPath:temporary,filename:safeName(filename),checked});checkActive();
   await removeOwnedTemporary(temporary,temporaryIdentity);temporary=null;
   return await acknowledge(saved);
  }catch(error){if([401,403].includes(error.status)&&epoch===transferEpoch&&credential===deviceCredential)invalidateTransferState();if(controller.signal.aborted)throw controller.signal.reason||stoppedDelivery();throw error;}
  finally{await removeOwnedTemporary(temporary,temporaryIdentity);}
 })();
 deliveryPromises.set(id,pending);deliveryTasks.add(pending);
 try{return await pending;}finally{downloadsInFlight.delete(id);deliveryControllers.delete(id);deliveryPromises.delete(id);deliveryTasks.delete(pending);}
}
handle('deliver',async id=>{const generation=await assertFileAccess(id);assertIdentity(generation);blockedTransfers.delete(id);const result=await deliverTransfer(id,{generation});assertIdentity(generation);return result;});
handle('reject',async({id,reason})=>{
 const generation=await assertFileAccess(id);assertIdentity(generation);
 if(typeof reason!=='string'||reason.length>500)throw new Error('Use a reason up to 500 characters.');
 if(downloadsInFlight.has(id)||decisionsInFlight.has(id))throw new Error('This file is being saved or decided. Wait for it to finish.');
 decisionsInFlight.add(id);blockedTransfers.add(id);deliveryRetry.cancel(id);stopFilePreviews(id);
 try{assertIdentity(generation);await request('/station/transfers/'+id+'/reject',{method:'POST',data:{reason}});const records=await readJson('station-history.json',{});if(records[id]){records[id]={...records[id],status:'rejected',rejection_reason:reason};await require('./station-files.cjs').mergeHistory(filePath('station-history.json'),[records[id]]);}previewCache.delete(id);return{ok:true};}
 finally{decisionsInFlight.delete(id);}
});
handle('connection-decision',async({id,status})=>{
 validateId(id);if(!['approved','denied'].includes(status))throw new Error('Invalid decision.');
 if(!activeOperator)throw Error('Choose who is using this computer before approving requests.');
 const generation=operatorGeneration,scope=localOperatorSelection.privateAuthority({userId:activeOperator.id,generation});
 if(!scope)throw Error('Choose your profile again before approving requests.');
 const result=await request('/station/connections/'+id+'/decision',{method:'POST',data:{status},deviceCredential:scope.credential,proof:scope.proof,selectionLease:scope.lease});assertIdentity(generation);return result;
});
handle('ack',id=>{validateId(id);return request('/station/requests/'+id+'/ack',{method:'POST'});});
handle('downloads',async()=>{const state=require('./station-visibility.cjs').visibleState(await sharedStationPoll(),activeOperator,operatorGeneration);if(!state.adminUnlocked)throw Error('Unlock an administrator first.');return shell.openPath(app.getPath('downloads'));});
handle('changelog',()=>shell.openExternal(ORIGIN+'/changelog'));
handle('website',()=>shell.openExternal(ORIGIN));
handle('connection-diagnostics',async()=>{const operator=draftOperator();const report=await require('./diagnostics.cjs').connectionDiagnostics({probe:()=>request('/station/state',{timeout:10000}),version:app.getVersion(),platform:process.platform,protectedStorage:safeStorage.isEncryptionAvailable()&&safeStorage.getSelectedStorageBackend?.()!=='basic_text'});assertIdentity(operator.generation);return report;});
handle('diagnostics-export',async()=>{const operator=draftOperator();const report=await require('./diagnostics.cjs').connectionDiagnostics({probe:()=>request('/station/state',{timeout:10000}),version:app.getVersion(),platform:process.platform,protectedStorage:safeStorage.isEncryptionAvailable()&&safeStorage.getSelectedStorageBackend?.()!=='basic_text'});assertIdentity(operator.generation);const result=await require('electron').dialog.showSaveDialog(main,{title:'Save connection report',defaultPath:path.join(app.getPath('downloads'),'Stati-connection-report.json'),filters:[{name:'JSON report',extensions:['json']}]});if(result.canceled)return {canceled:true};assertIdentity(operator.generation);await fs.writeFile(result.filePath,JSON.stringify(report,null,2),{mode:0o600});return {ok:true};});
handle('computer-rename',async name=>{if(typeof name!=='string'||!name.trim()||name.trim().length>60)throw new Error('Enter a computer name up to 60 characters.');const result=await request('/station/device',{method:'PATCH',data:{name:name.trim()}});stationPoll=null;return result;});
handle('reset-pairing',async()=>{const answer=await require('electron').dialog.showMessageBox(main,{type:'warning',message:'Remove this computer?',detail:'It will need to be paired again. Your saved files and songs stay on this computer.',buttons:['Cancel','Remove computer'],defaultId:0,cancelId:0});if(answer.response!==1)return{canceled:true};if(downloadsInFlight.size||require('./powerpoint-batch.cjs').isRunning())throw new Error('Finish saving or converting files before removing this computer.');pairingSession().cancel();await credentialWrites;invalidateTransferState();if(credential)try{await request('/station/device',{method:'DELETE'});}catch(e){if(e.status!==401)throw e;}clearOperator();credential=null;receiver=null;stationPoll=null;await fs.unlink(filePath('device.bin')).catch(()=>{});return{ok:true};});
handle('clock-contrast-status',()=>lastContrastStatus);
handle('clocks',()=>Array.from(clocks,([id,{settings}])=>({id,...settings})));
handle('clock-add',async settings=>{if(clocks.size>=5)throw new Error('You can have up to five clocks.');const id=crypto.randomUUID();spawnClock(id,clockSettings(settings));await persistClocks();return id;});
handle('clock-update',async(id,input)=>{validateId(id);const c=clocks.get(id);if(!c)throw new Error('Clock not found.');c.settings=clockSettings(input);fitClock(c.window,c.settings);if(process.platform==='win32')c.window.setBackgroundMaterial(c.settings.blur&&c.settings.showBackground?'acrylic':'none');if(process.platform==='darwin')c.window.setVibrancy(c.settings.blur&&c.settings.showBackground?'under-window':null);c.window.setBackgroundColor('#00000000');c.window.webContents.send('clock-settings',{id,...c.settings});await persistClocks();return{ok:true};});
handle('clock-delete',async id=>{validateId(id);const c=clocks.get(id);if(c){clocks.delete(id);contrastColors.delete(id);c.window.close();}notifyClockList();await persistClocks();return{ok:true};});
handle('update-state',()=>updateController.getState());
handle('update-check',()=>updateController.check());
handle('update-install',async()=>{try{return await updateController.install();}catch(error){restoreAfterUpdateError();throw error;}});
const advanced=require('./advanced.cjs');
function openPrepare(section='prepare'){
 prepareSection=section;prepareOpened=true;
 const win=showMain();if(!win)return;
 const navigate=()=>{if(!win.isDestroyed())win.webContents.send('navigate',section);};
 if(win.webContents.isLoading())win.webContents.once('did-finish-load',navigate);else navigate();
}

let prepareDraftStore;
function drafts(){return prepareDraftStore||(prepareDraftStore=require('./prepare-drafts.cjs').createDraftStore(app.getPath('userData'),safeStorage));}
let outputTranslationDrafts;
function outputTranslations(){return outputTranslationDrafts||(outputTranslationDrafts=require('./output-layout-drafts.cjs').createOutputTranslationStore(path.join(app.getPath('userData'),'output-translations'),safeStorage));}
handle('output-translations-load',async source=>{const operator=await workspaceOperator('editLyrics');const translations=await outputTranslations().load(operator.id,source,()=>assertIdentity(operator.generation));assertIdentity(operator.generation);return{ownerId:operator.id,translations};});
handle('output-translations-save',async input=>{const operator=await workspaceOperator('editLyrics');if(input?.ownerId!==operator.id)throw Error('The selected user changed. Your prior translation draft was kept.');const saved=await outputTranslations().save(operator.id,input.source,input.translations,()=>assertIdentity(operator.generation));assertIdentity(operator.generation);return saved;});
async function workspaceOperator(capability='readSongs'){const operator=draftOperator(),context=await request('/station/workspace');assertIdentity(operator.generation);if(context.userId!==operator.id||!(context.capabilities?.[capability]||capability==='createSlides'&&context.capabilities?.editLyrics))throw Error('Your role does not allow this action.');return {...operator,capabilities:context.capabilities,deviceId:context.deviceId};}
let localAudioPlayback=null;const audioTasks=new Set();
function trackAudioTask(task){audioTasks.add(task);void task.finally(()=>audioTasks.delete(task)).catch(()=>{});return task;}
function clearAudioPlayback(){localAudioPlayback?.controller.abort();localAudioPlayback?.client.clear();localAudioPlayback=null;}
function assertAudioScope(scope){
 if(!scope||scope!==localAudioPlayback||quitting||sessionLocked||identitySkipped||!privacyUnlocked||credential!==scope.credential||operatorGeneration!==scope.generation||activeOperator?.id!==scope.userId||activeOperator.role!=='admin'||!activeOperator.capabilities?.editLyrics||operatorProof!==scope.proof)throw Error('Unlock your administrator profile before preparing audio.');
 const authority=localOperatorSelection.privateAuthority({userId:scope.userId,deviceId:scope.deviceId,generation:scope.generation});
 if(!authority||authority.credential!==scope.credential||authority.lease!==scope.lease||!authority.proof||authority.proof!==scope.proof)throw Error('Unlock your administrator profile before preparing audio.');
}
async function audioPlayback(){
 const generation=operatorGeneration;let operator;try{operator=await workspaceOperator('editLyrics');}catch(error){if(generation===operatorGeneration)clearAudioPlayback();throw error;}const authority=localOperatorSelection.privateAuthority({userId:operator.id,deviceId:operator.deviceId,generation:operator.generation});
 if(!authority||!authority.proof||authority.credential!==credential||activeOperator?.role!=='admin')throw Error('Unlock your administrator profile before preparing audio.');
 const settings=await playlistManager().settings();assertIdentity(operator.generation);
 if(!Number.isInteger(settings.port)||settings.port<1||settings.port>65535)throw Error('Choose a valid local ProPresenter port in Settings.');
 if(localAudioPlayback&&(localAudioPlayback.credential!==authority.credential||localAudioPlayback.userId!==authority.userId||localAudioPlayback.deviceId!==authority.deviceId||localAudioPlayback.generation!==authority.generation||localAudioPlayback.lease!==authority.lease||localAudioPlayback.proof!==authority.proof||localAudioPlayback.port!==settings.port))clearAudioPlayback();
 if(!localAudioPlayback)localAudioPlayback={...authority,port:settings.port,controller:new AbortController(),client:require('./audio-playback.cjs').createAudioPlayback({directory:path.join(app.getPath('documents'),'Stați','Playback'),baseUrl:'http://127.0.0.1:'+settings.port+'/'})};
 assertAudioScope(localAudioPlayback);return localAudioPlayback;
}
handle('audio-choose',async()=>{
 const scope=await audioPlayback(),selection=await require('electron').dialog.showOpenDialog(main,{title:'Choose MP3 files for Playback',properties:['openFile','multiSelections'],filters:[{name:'MP3 audio',extensions:['mp3']}]});assertAudioScope(scope);
 if(selection.canceled)return{canceled:true,state:'not-ready',files:[],failures:[],imported:false};
 const selected=new Map();for(const file of selection.filePaths||[]){if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Choose MP3 files on this computer.');const resolved=path.resolve(file),key=process.platform==='win32'?resolved.normalize('NFC').toLowerCase():resolved;selected.set(key,resolved);}
 const result=await trackAudioTask(scope.client.prepareFiles([...selected.values()],{checkActive:()=>assertAudioScope(scope)}));assertAudioScope(scope);return result;
});
handle('audio-status',async()=>{const scope=await audioPlayback(),result=await trackAudioTask(scope.client.getPlaybackPlaylist({signal:scope.controller.signal}));assertAudioScope(scope);return result;});
handle('audio-focus',async()=>{const scope=await audioPlayback(),result=await trackAudioTask(scope.client.focusPlayback({signal:scope.controller.signal}));assertAudioScope(scope);return result;});
handle('audio-reveal',async id=>{const scope=await audioPlayback();assertAudioScope(scope);shell.showItemInFolder(scope.client.preparedPath(id));return{ok:true};});
ipcMain.on('audio-drag',(event,ids)=>{
 const trusted=!!main&&!main.isDestroyed()&&event.sender===main.webContents&&validSender(event);
 if(!trusted)return;
 try{const scope=localAudioPlayback;assertAudioScope(scope);scope.client.startDrag(ids,event.sender,nativeImage.createFromPath(path.join(__dirname,'../public/brand-icon.png')),{checkActive:()=>assertAudioScope(scope)});}
 catch(error){event.sender.send('audio-drag-error',error instanceof Error?error.message:'The audio could not be dragged. Prepare it again.');}
});
handle('workspace-context',async()=>{const operator=await workspaceOperator();return{capabilities:operator.capabilities,initialWorkspace:prepareSection};});
async function withWorkspaceFiles(capability,work){
 const window=main,controller=new AbortController(),closed=()=>controller.abort();workspaceFileJobs.add(controller);window?.once?.('closed',closed);
 try{const operator=await workspaceOperator(capability),deviceCredential=credential;
 const checkActive=()=>{controller.signal.throwIfAborted();assertIdentity(operator.generation);if(window?.isDestroyed?.()||quitting||sessionLocked||!privacyUnlocked||credential!==deviceCredential||activeOperator?.id!==operator.id||!(activeOperator.capabilities?.[capability]||capability==='createSlides'&&activeOperator.capabilities?.editLyrics))throw Error('The selected profile or its access changed. Try again.');};
 checkActive();return await work({operator,checkActive,signal:controller.signal});}finally{window?.removeListener?.('closed',closed);workspaceFileJobs.delete(controller);}
}
async function workspaceService(operator,id){
 if(typeof id!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw Error('Choose a saved service.');
 const plans=await servicePlans().list(operator.deviceId);assertIdentity(operator.generation);const plan=plans.find(plan=>plan.id===id);if(!plan)throw Error('This service is no longer available.');return plan;
}
handle('song-versions-list',id=>withWorkspaceFiles('editLyrics',async({operator,checkActive})=>{
 const directory=await libraryDirectory(operator);checkActive();return require('./song-save.cjs').listSongVersions(directory,id,checkActive);
}));
handle('song-version-preview',input=>withWorkspaceFiles('editLyrics',async({operator,checkActive})=>{
 if(!input||typeof input!=='object')throw Error('Choose a saved song version.');const directory=await libraryDirectory(operator);checkActive();return require('./song-save.cjs').previewSongVersion(directory,input.id,input.currentHash,input.versionHash,checkActive);
}));
handle('song-version-restore',input=>withWorkspaceFiles('editLyrics',async({operator,checkActive})=>{
 if(!input||typeof input!=='object')throw Error('Choose a saved song version.');const directory=await libraryDirectory(operator);checkActive();
 const result=await require('./song-save.cjs').restoreSongVersion(directory,input.id,input.currentHash,input.versionHash,checkActive);checkActive();catalogChanged();playlistJobs().schedule();notifyServiceChange();return result;
}));
handle('service-rehearsal',id=>withWorkspaceFiles('readSongs',async({operator,checkActive,signal})=>{
 const plan=await workspaceService(operator,id),directory=await libraryDirectory(operator);checkActive();const result=await require('./service-rehearsal.cjs').readServiceRehearsal(directory,plan,{checkActive,signal});checkActive();return result;
}));
handle('rehearsal-audio',()=>withWorkspaceFiles('readSongs',async({checkActive,signal})=>{
 const choice=await require('electron').dialog.showOpenDialog(main,{title:'Choose an MP3 for rehearsal',properties:['openFile'],filters:[{name:'MP3 audio',extensions:['mp3']}]});checkActive();
 if(choice.canceled||!choice.filePaths?.[0])return{canceled:true};const filename=choice.filePaths[0];if(path.extname(filename).toLowerCase()!=='.mp3')throw Error('Choose an MP3 for rehearsal.');
 const result=await require('./preview-bytes.cjs').readLocalPreview(filename,{signal,checkActive}),detected=await(await import('file-type')).fileTypeFromBuffer(result.bytes.subarray(0,4100));checkActive();
 if(!result.bytes.length||detected?.ext!=='mp3'||detected.mime!=='audio/mpeg')throw Error('This file is not a supported MP3. The original has been kept.');
 return{filename:path.basename(filename),contentType:'audio/mpeg',bytes:result.bytes.buffer.slice(result.bytes.byteOffset,result.bytes.byteOffset+result.bytes.byteLength)};
}));
handle('service-package-export',input=>withWorkspaceFiles('readSongs',async({operator,checkActive,signal})=>{
 if(!input||typeof input!=='object'||!input.options||typeof input.options.includeAudio!=='boolean')throw Error('Choose valid service package options.');
 const plan=await workspaceService(operator,input.id),directory=await libraryDirectory(operator);checkActive();let audioPaths=[];
 if(input.options.includeAudio){const selection=await require('electron').dialog.showOpenDialog(main,{title:'Choose MP3s for this service package',properties:['openFile','multiSelections'],filters:[{name:'MP3 audio',extensions:['mp3']}]});checkActive();if(selection.canceled)return{canceled:true};audioPaths=selection.filePaths;}
 const selection=await require('electron').dialog.showSaveDialog(main,{title:'Export portable service package',defaultPath:path.join(app.getPath('downloads'),'Stati-service-'+plan.date+'-'+plan.time.replace(':','')+'.zip'),filters:[{name:'Service ZIP',extensions:['zip']}]});checkActive();if(selection.canceled||!selection.filePath)return{canceled:true};
 if(path.extname(selection.filePath).toLowerCase()!=='.zip')throw Error('Choose a .zip filename for the service package.');
 const result=await require('./service-package.cjs').exportServicePackage({plan,directory,audioPaths,destination:selection.filePath,checkActive,signal});checkActive();return result;
}));
handle('powerpoint-export',data=>withWorkspaceFiles('createSlides',async({checkActive,signal})=>advanced.exportPowerPoint(data,main,app.getPath('downloads'),checkActive,signal)));
handle('powerpoint-batch-export',async input=>{
 if(!input||typeof input!=='object'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.operationId||'')||!Array.isArray(input.items)||!input.items.length||input.items.length>20)throw Error('Choose up to 20 reviewed songs for this PowerPoint batch.');
 const owner=draftOperator();if(powerPointExportJobs.size)throw Error('Finish or stop the current PowerPoint export first.');
 const job={...owner,credential,controller:new AbortController()};powerPointExportJobs.set(input.operationId,job);workspaceFileJobs.add(job.controller);
 try{return await withWorkspaceFiles('createSlides',async({checkActive,signal})=>{
  const combined=AbortSignal.any([signal,job.controller.signal]),check=()=>{combined.throwIfAborted();checkActive();};
  if(job.controller.signal.aborted)return{stopped:true,results:[],total:input.items.length};check();
  const selected=await require('electron').dialog.showOpenDialog(main,{title:'Choose a folder for PowerPoint lyrics',properties:['openDirectory','createDirectory']});
  checkActive();if(job.controller.signal.aborted)return{stopped:true,results:[],total:input.items.length};if(selected.canceled||!selected.filePaths?.[0])return{canceled:true,stopped:false,results:[],total:input.items.length};
  const result=await require('./powerpoint-export-batch.cjs').exportPowerPointBatch({items:input.items,directory:selected.filePaths[0],checkActive:check,signal:combined});checkActive();return result;
 });}finally{workspaceFileJobs.delete(job.controller);if(powerPointExportJobs.get(input.operationId)===job)powerPointExportJobs.delete(input.operationId);}
});
handle('powerpoint-batch-export-cancel',async id=>{
 const owner=draftOperator(),job=powerPointExportJobs.get(id);if(!(activeOperator?.capabilities?.createSlides||activeOperator?.capabilities?.editLyrics))throw Error('Your role does not allow this action.');
 if(!job)return{stopping:false};if(job.id!==owner.id||job.generation!==owner.generation||job.credential!==credential)throw Error('The selected profile changed.');job.controller.abort();return{stopping:true};
});
async function servicePackageImporter(context){
 const editor=await workspaceOperator('editLyrics');context.checkActive();if(editor.id!==context.operator.id||editor.deviceId!==context.operator.deviceId||editor.generation!==context.operator.generation)throw Error('The selected profile changed.');
 const directory=await fs.realpath(await libraryDirectory(editor));context.checkActive();
 const key=editor.deviceId+':'+editor.id+':'+editor.generation+':'+directory;
 if(packageImportScope&&(packageImportScope.key!==key||packageImportScope.credential!==credential))clearPackageImport();
 if(!packageImportScope){const rootHash=crypto.createHash('sha256').update(directory).digest('hex').slice(0,24);packageImportScope={key,credential,client:require('./service-package-import.cjs').createServicePackageImport({lyricsDirectory:directory,audioDirectory:path.join(app.getPath('documents'),'Stați','Imported Audio'),journalDirectory:path.join(app.getPath('userData'),'service-package-imports',editor.deviceId,editor.id,rootHash)})};}
 const scope=packageImportScope,checkActive=()=>{context.checkActive();if(scope!==packageImportScope||!activeOperator?.capabilities?.editLyrics||scope.credential!==credential)throw Error('Your import access changed. Choose the package again.');};checkActive();return{scope,checkActive,signal:context.signal};
}
handle('service-package-choose-import',()=>withWorkspaceFiles('planServices',async context=>{
 const importer=await servicePackageImporter(context),choice=await require('electron').dialog.showOpenDialog(main,{title:'Open a Stați service package',properties:['openFile'],filters:[{name:'Service ZIP',extensions:['zip']}]});importer.checkActive();if(choice.canceled||!choice.filePaths?.[0])return{canceled:true};return importer.scope.client.prepare(choice.filePaths[0],importer);
}));
handle('service-package-import',id=>withWorkspaceFiles('planServices',async context=>{
 const importer=await servicePackageImporter(context);if(typeof id!=='string')throw Error('Choose and review a service package first.');const staged=await importer.scope.client.stage(id,importer);importer.checkActive();
 const existing=(await servicePlans().list(context.operator.deviceId)).find(plan=>plan.id===staged.plan.id);importer.checkActive();let accepted=existing;
 if(!accepted){catalogConnection={credential,deviceId:context.operator.deviceId};catalogChanged();await catalogPublisher().flush();importer.checkActive();const plans=await servicePlans().change(context.operator.deviceId,{type:'import',plan:staged.plan});importer.checkActive();accepted=plans.find(plan=>plan.id===staged.plan.id);}
 if(!accepted)throw Error('The new service could not be confirmed. Retry this same package to check it without creating another service.');
 await importer.scope.client.confirm(id,importer);importer.checkActive();playlistJobs().schedule();notifyServiceChange();return{serviceId:accepted.id,title:accepted.title,songCount:staged.songCount,audioCount:staged.audioCount,alreadyImported:!!existing,warnings:staged.warnings};
}));
function draftOperator(){if(!activeOperator)throw Error('Choose your profile before preparing slides.');return {id:activeOperator.id,generation:operatorGeneration};}
let songFavorites;
function favoriteSongs(){return songFavorites||(songFavorites=require('./song-favorites.cjs').favoritesStore(app.getPath('userData')));}
async function libraryDirectory(operator){const saved=await savedLyricsDirectory();assertIdentity(operator.generation);if(!operator.capabilities?.editLyrics){if(!saved)throw Error('Ask an administrator to choose the Lyrics folder on this computer first.');return saved;}const directory=await advanced.songsFolder(main,app.getPath('documents'));assertIdentity(operator.generation);if(directory!==saved)catalogChanged();return directory;}
let catalogConnection=null,catalogScanAt=0,localCatalogPublisher;
function catalogPublisher(){return localCatalogPublisher||(localCatalogPublisher=require('./catalog-publisher.cjs').createCatalogPublisher({current:()=>!quitting&&catalogConnection?.credential===credential?catalogConnection:null,readCatalog:async()=>{const directory=await savedLyricsDirectory();return directory?require('./conversion-work.cjs')('catalog-snapshot',directory):null;},send:(context,data)=>request('/station/catalog',{method:'POST',data,deviceCredential:context.credential,proof:null,selectionLease:null}),onState:(state,context)=>{if(state.state==='ready'&&context?.credential===credential&&Number.isFinite(state.updatedAt))void writeJson('catalog-sync.json',{deviceId:context.deviceId,updatedAt:state.updatedAt,songCount:state.songCount}).catch(error=>console.warn('Library sync summary:',error.name));},onError:error=>console.warn('Shared song library:',error.name)}));}
function catalogChanged(){catalogScanAt=Date.now();catalogPublisher().cancel({forgetDigest:false});catalogPublisher().schedule();}
async function catalogSyncStatus(operator){const state=catalogPublisher().status(),saved=await readJson('catalog-sync.json',{});assertIdentity(operator.generation);if(state.updatedAt===null&&saved.deviceId===operator.deviceId&&Number.isFinite(saved.updatedAt)&&Number.isInteger(saved.songCount)&&saved.songCount>=0)return{...state,updatedAt:saved.updatedAt,songCount:saved.songCount};return state;}
handle('song-library-sync-status',async()=>{const operator=await workspaceOperator('readSongs');return catalogSyncStatus(operator);});
handle('song-library-choose-folder',async()=>{
 const operator=await workspaceOperator('editLyrics');
 const folder=await advanced.songsFolder(main,app.getPath('documents'),()=>assertIdentity(operator.generation),true);
 if(!folder)return null;
 assertIdentity(operator.generation);
 catalogConnection={credential,deviceId:operator.deviceId};
 catalogChanged();
 await catalogPublisher().flush();
 assertIdentity(operator.generation);
 return catalogSyncStatus(operator);
});
handle('song-library-rescan',async()=>{const operator=await workspaceOperator('readSongs');await libraryDirectory(operator);assertIdentity(operator.generation);catalogConnection={credential,deviceId:operator.deviceId};catalogChanged();await catalogPublisher().flush();assertIdentity(operator.generation);return catalogSyncStatus(operator);});
let localServicePlans;
function legacyServicePlans(){return localServicePlans||(localServicePlans=require('./service-plans.cjs').servicePlans(app.getPath('userData'),safeStorage));}
function sharedServiceOperator(){const scope=localOperatorSelection.privateAuthority();return !quitting&&!sessionLocked&&activeOperator?.capabilities?.readSongs&&scope&&scope.userId===activeOperator.id?scope:null;}
let remoteServicePlans;const serviceMigrations=new Map();
async function migrateServicePlans(context){
 if(!activeOperator?.capabilities?.planServices)return;
 const key=context.deviceId+':'+context.userId;if(serviceMigrations.has(key))return serviceMigrations.get(key);
 const pending=(async()=>{const source=await legacyServicePlans().state(context.userId),done=await readJson('service-imports.json',{});if(!source.plans.some(plan=>!done[key+':'+plan.id]))return;await catalogPublisher().flush();let changed=false;
  for(const plan of source.plans){const marker=key+':'+plan.id;if(done[marker])continue;const current=sharedServiceOperator();if(!current||current.generation!==context.generation||current.userId!==context.userId)throw Error('The selected user changed.');
   try{await request('/station/services',{method:'POST',data:{type:'import',plan},deviceCredential:context.credential,proof:context.proof,selectionLease:context.lease});done[marker]=true;changed=true;}catch(error){if([401,403].includes(error.status))throw error;console.warn('Preserved local service import:',error.name);}
  }if(changed)await writeJson('service-imports.json',done);
 })();serviceMigrations.set(key,pending);try{await pending;}finally{serviceMigrations.delete(key);}
}
function servicePlans(){return remoteServicePlans||(remoteServicePlans=require('./shared-services.cjs').createSharedServiceStore({current:sharedServiceOperator,local:legacyServicePlans(),migrate:migrateServicePlans,beforeAttach:async()=>{catalogChanged();await catalogPublisher().flush();},send:(context,method,data)=>request('/station/services',{method,data,deviceCredential:context.credential,proof:context.proof,selectionLease:context.lease})}));}
let localPlaylistManager,localPlaylistJobs,approvedOutputPlans;
function playlistPlans(){return approvedOutputPlans||(approvedOutputPlans=require('./approved-service-store.cjs').createApprovedServiceStore({base:servicePlans(),current:sharedServiceOperator,loadVersion:(scope,id,versionId)=>request('/station/services/'+id+'/versions?versionId='+encodeURIComponent(versionId),{deviceCredential:scope.credential,proof:scope.proof,selectionLease:scope.lease})}));}
async function savedLyricsDirectory(){const saved=await readJson('lyrics-folder.json',{});if(typeof saved.path!=='string'||path.basename(saved.path)!=='Lyrics')return null;try{if((await fs.stat(saved.path)).isDirectory())return saved.path;}catch{}return null;}
function playlistManager(){return localPlaylistManager||(localPlaylistManager=require('./service-playlist-sync.cjs').createServicePlaylistSync({userData:app.getPath('userData'),protection:safeStorage,plansStore:playlistPlans(),readLibrary:async(_user,plan,{signal}={})=>{const scope=sharedServiceOperator();if(!scope)throw Error('Choose your profile first.');const checkActive=()=>{signal?.throwIfAborted();const current=sharedServiceOperator();if(!current||current.generation!==scope.generation||current.credential!==scope.credential||current.deviceId!==scope.deviceId||current.userId!==scope.userId)throw Error('The selected user changed.');};checkActive();if(!plan.songs.length)return[];const directory=await savedLyricsDirectory();checkActive();if(!directory)throw Error('Choose the ProPresenter Lyrics folder in Prepare slides before syncing songs.');return require('./service-output.cjs').serviceOutputReferences(directory,plan,{allowUnavailable:true,checkActive,signal});}}));}
function notifyServiceChange(){for(const win of [main])if(win&&!win.isDestroyed())win.webContents.send('service-plans-changed');}
function playlistJobs(){return localPlaylistJobs||(localPlaylistJobs=require('./service-playlist-jobs.cjs').createServicePlaylistJobs({manager:playlistManager(),plansStore:servicePlans(),current:()=>{const context=sharedServiceOperator();return context?{id:context.deviceId,generation:context.generation}:null;},readDirectory:savedLyricsDirectory,work:require('./conversion-work.cjs'),beforeSync:async operator=>{const scope=sharedServiceOperator();if(!scope||scope.deviceId!==operator.id||scope.generation!==operator.generation)throw Error('The selected user changed.');const shared=await servicePlans().state(scope.deviceId),legacy=await legacyServicePlans().list(scope.userId);assertIdentity(scope.generation);await playlistManager().importBindings(scope.userId,scope.deviceId,legacy.filter(plan=>shared.plans.some(item=>item.id===plan.id)).map(plan=>plan.id));},onChanged:notifyServiceChange,onError:error=>console.warn('Service playlist sync:',error.name)}));}
async function viewServicePlans(operator){operator={...operator,id:operator.deviceId||operator.id};const {plans}=await servicePlans().state(operator.id);assertIdentity(operator.generation);const summaries=await playlistManager().list(operator.id,{plans});assertIdentity(operator.generation);const byId=new Map(summaries.map(summary=>[summary.serviceId,summary]));return plans.map(plan=>({...plan,status:require('./service-plans.cjs').serviceStatus(plan),playlist:byId.get(plan.id)}));}
async function playlistAdministrator(){const operator=draftOperator(),state=require('./station-visibility.cjs').visibleState(await sharedStationPoll(),activeOperator,operatorGeneration);assertIdentity(operator.generation);if(!state.adminUnlocked)throw Error('Unlock an administrator before changing service playlist settings.');return operator;}
handle('playlist-settings',async()=>{const operator=await playlistAdministrator(),settings=await playlistManager().settings();assertIdentity(operator.generation);return{...settings,sharedServices:true};});
handle('playlist-settings-save',async patch=>{const operator=await playlistAdministrator(),old=await playlistManager().settings();assertIdentity(operator.generation);if(patch&&((patch.serviceRetention!==undefined&&patch.serviceRetention!==old.serviceRetention)||(patch.clearPlaylistItems!==undefined&&patch.clearPlaylistItems!==old.clearPlaylistItems)))throw Error('Automatic cleanup for shared services is still being prepared. Current services and playlists are kept.');
 localPlaylistJobs?.cancel();const value=await playlistManager().saveSettings(patch);assertIdentity(operator.generation);if(localAudioPlayback&&value.port!==localAudioPlayback.port)clearAudioPlayback();playlistJobs().schedule();notifyServiceChange();return{...value,sharedServices:true};
});
handle('playlist-connection-check',async()=>{const operator=await playlistAdministrator(),settings=await playlistManager().settings();assertIdentity(operator.generation);const result=await require('./propresenter-playlists.cjs').createProPresenterPlaylists({baseUrl:'http://127.0.0.1:'+settings.port+'/'}).probe({playlists:true});assertIdentity(operator.generation);return{...result,message:'Connected to ProPresenter’s local v1 API and readable playlists. Verify playlist creation and songs on this PC before service.'};});
handle('service-templates-list',async()=>{const operator=await workspaceOperator();const templates=await legacyServicePlans().templates(operator.id);assertIdentity(operator.generation);return templates;});
handle('service-plans-list',async()=>{const operator=await workspaceOperator();return viewServicePlans(operator);});
handle('service-plans-change',async action=>{const operator=await workspaceOperator('readSongs');if(!action||!['create','save','duplicate','archive','select','template-save','template-create','template-archive','claim-leadership','release-leadership','finalize-order','acknowledge-order'].includes(action.type))throw Error('Choose a valid service action.');
 if(!operator.capabilities.planServices&&!['claim-leadership','release-leadership','finalize-order','acknowledge-order','save'].includes(action.type))throw Error('Your role does not allow this action.');
 if(action.type.startsWith('template-')){if(!operator.capabilities.planServices)throw Error('Your role does not allow changing service templates.');const before=await legacyServicePlans().list(operator.id);await legacyServicePlans().change(operator.id,action);if(action.type==='template-create'){const created=(await legacyServicePlans().list(operator.id)).find(plan=>!before.some(old=>old.id===plan.id));await servicePlans().state(operator.deviceId);if(created)await servicePlans().change(operator.deviceId,{type:'select',id:created.id});}}
 else await servicePlans().change(operator.deviceId,action);assertIdentity(operator.generation);playlistJobs().schedule();notifyServiceChange();return viewServicePlans(operator);});
handle('service-song-preview',async id=>{const operator=await workspaceOperator('readSongs'),directory=await libraryDirectory(operator);const result=await require('./conversion-work.cjs')('catalog-preview',directory,id);assertIdentity(operator.generation);return result;});
handle('song-library-info',async id=>{const operator=await workspaceOperator('readSongs'),directory=await libraryDirectory(operator);const result=await require('./conversion-work.cjs')('catalog-info',directory,id);assertIdentity(operator.generation);return result;});
handle('service-readiness',async id=>{const operator=await workspaceOperator('readSongs'),plans=await servicePlans().list(operator.deviceId);const plan=plans.find(item=>item.id===id);if(!plan)throw Error('Service plan unavailable.');const result=plan.songs.length?await require('./conversion-work.cjs')('service-readiness',await libraryDirectory(operator),plan.songs):{ready:true,items:[]};assertIdentity(operator.generation);const checklistStatus=require('./service-plans.cjs').serviceStatus(plan);return {...result,ready:result.ready,checklistStatus,checkedAt:Date.now()};});
handle('song-library-search',async input=>{const operator=await workspaceOperator('readSongs'),directory=await libraryDirectory(operator),favorites=await favoriteSongs().load(operator.id);const result=await require('./conversion-work.cjs')('catalog-search',directory,input,favorites);assertIdentity(operator.generation);return result;});
handle('song-library-open',async id=>{const operator=await workspaceOperator('readSongs'),directory=await libraryDirectory(operator);const song=await require('./conversion-work.cjs')('catalog-open',directory,id);assertIdentity(operator.generation);return song;});
handle('song-library-favorite',async({id,favorite})=>{const operator=await workspaceOperator('readSongs');const result=await favoriteSongs().set(operator.id,id,favorite);assertIdentity(operator.generation);return result;});
handle('song-library-save',async({id,contentHash,data})=>{const operator=await workspaceOperator('editLyrics'),target=await servicePlans().active(operator.deviceId),directory=await libraryDirectory(operator);assertIdentity(operator.generation);const result=await require('./song-save.cjs').saveLibrarySong(directory,id,contentHash,data,()=>assertIdentity(operator.generation));assertIdentity(operator.generation);catalogChanged();return playlistJobs().attach({...operator,id:operator.deviceId},result,[result.path],target);});
handle('song-library-clone',async({id,contentHash,groupName})=>{const operator=await workspaceOperator('editLyrics'),directory=await libraryDirectory(operator);assertIdentity(operator.generation);const result=await require('./song-save.cjs').cloneLibrarySong(directory,id,contentHash,groupName,()=>assertIdentity(operator.generation));assertIdentity(operator.generation);catalogChanged();return result;});
handle('prepare-draft-load',async()=>{const operator=await workspaceOperator('createSlides');const result=await drafts().load(operator.id);assertIdentity(operator.generation);return result;});
handle('prepare-draft-save',async data=>{const operator=await workspaceOperator('createSlides');const result=await drafts().save(operator.id,data);assertIdentity(operator.generation);return result;});
handle('prepare',async section=>{if(section!==undefined&&!['prepare','library','services','powerpoint','audio'].includes(section))throw Error('Choose a valid workspace.');await workspaceOperator(['powerpoint','audio'].includes(section)?'editLyrics':!section||section==='prepare'?'createSlides':'readSongs');return openPrepare(section);});
async function savedFile(id){const generation=await assertFileAccess(id);const receipts=await readJson('deliveries.json',{});if(!receipts[id])throw new Error('Save this file to the computer first.');await fs.access(receipts[id]);assertIdentity(generation);return receipts[id];}
function previewActive(generation,deviceCredential,id,signal){signal?.throwIfAborted();assertIdentity(generation);if(quitting||sessionLocked||credential!==deviceCredential||blockedTransfers.has(id))throw Error('This preview is no longer available.');}
async function loadFileBytes(id,{signal}={}){
 const job=(async()=>{
  const generation=await assertFileAccess(id),deviceCredential=credential,controller=new AbortController();previewControllers.add(controller);previewControllerIds.set(controller,id);
  const currentSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(60000),...(signal?[signal]:[])]),checkActive=()=>previewActive(generation,deviceCredential,id,currentSignal);
  try{
   checkActive();const receipts=await require('./station-files.cjs').readReceipts(filePath('deliveries.json')),history=await readJson('station-history.json',{}),metadata=history[id];checkActive();
   if(!metadata||metadata.status==='rejected')throw Error('Preview unavailable.');
   let result;
   if(receipts[id])result=await require('./preview-bytes.cjs').readLocalPreview(receipts[id],{expectedChecksum:metadata.sha256,signal:currentSignal,checkActive});
   else{const current=latestServerTransfers.get(id);if(!current||current.status!=='queued')throw Error('This preview is no longer available.');const response=await fetch(ORIGIN+'/api/station/transfers/'+id,{headers:{Authorization:'Bearer '+deviceCredential},signal:currentSignal});result=await require('./preview-bytes.cjs').readRemotePreview(response,{expectedBytes:current.bytes,expectedChecksum:current.sha256,signal:currentSignal,checkActive});}
   checkActive();return {...result,metadata,localPath:receipts[id]||null};
  }finally{previewControllers.delete(controller);previewControllerIds.delete(controller);}
 })();previewByteTasks.add(job);try{return await job;}finally{previewByteTasks.delete(job);}
}
async function fileBytes(id){return (await loadFileBytes(id)).bytes;}
handle('file-preview',async id=>{
 const generation=await assertFileAccess(id),deviceCredential=credential;previewActive(generation,deviceCredential,id);
 const job=previewQueue.run(generation+':'+id,async()=>{
  const controller=new AbortController();previewControllers.add(controller);previewControllerIds.set(controller,id);const check=()=>previewActive(generation,deviceCredential,id,controller.signal);
  try{
   check();const history=await readJson('station-history.json',{}),metadata=history[id],receipts=await require('./station-files.cjs').readReceipts(filePath('deliveries.json'));check();
   if(!metadata||metadata.status==='rejected')throw Error('Preview unavailable.');
   const name=receipts[id]?path.basename(receipts[id]):metadata.filename,contentType=metadata.content_type||'',format=require('./preview-formats.cjs').previewFormat(name,contentType);
   if(format.kind==='unsupported')return {kind:'unsupported',reason:'Open the saved file to view this format.'};
   if(!receipts[id]&&previewCache.has(id)){await assertFileAccess(id);check();if(latestServerTransfers.get(id)?.status!=='queued')throw Error('This preview is no longer available.');return previewCache.get(id);}
   const loaded=await loadFileBytes(id,{signal:controller.signal});check();let result;
   if(format.kind==='media'||format.kind==='pdf')result={...format,bytes:loaded.bytes};
   else{
    try{const sample=format.sampleBytes?loaded.bytes.subarray(0,format.sampleBytes):loaded.bytes;result=await require('./conversion-work.cjs').withSignal('document-preview',AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),{bytes:sample,name,contentType});check();if(result.original){delete result.original;result.bytes=loaded.bytes;}}
    catch(error){check();result={kind:'unsupported',reason:'This file could not be previewed. Open its saved copy to view it.'};}
   }
   result={...result,name,changedSinceDelivery:!!loaded.changedSinceDelivery};
   // Keep at most16 small remote payloads. Local files are reread on demand;
   // videos and PDFs never become a second in-memory file library.
   if(!loaded.localPath&&result.kind!=='media'&&result.kind!=='pdf'&&(!result.bytes||result.bytes.byteLength<=1024*1024)){previewCache.set(id,result);if(previewCache.size>16)previewCache.delete(previewCache.keys().next().value);}
   check();return result;
  }finally{previewControllers.delete(controller);previewControllerIds.delete(controller);}
 });previewTasks.add(job);try{return await job;}finally{previewTasks.delete(job);}
});
const profilePhotos=require('./profile-photos.cjs').createProfilePhotos({fetchPhoto:(id,signal)=>fetch(ORIGIN+'/api/station/senders/'+id+'/photo',{headers:{Authorization:'Bearer '+credential},signal}),thumbnail:(bytes,info)=>require('./profile-photos.cjs').nativeThumbnail(nativeImage,bytes,info)});
handle('sender-photo',async id=>{validateId(id);if(!credential)return null;try{return await profilePhotos.load(id);}catch{return null;}});
handle('file-rename',async({id,stem})=>{
 const generation=await assertFileAccess(id);
 const check=()=>{assertIdentity(generation);if(downloadsInFlight.has(id)||latestServerTransfers.get(id)?.status==='queued')throw new Error('Wait for delivery confirmation before renaming this file.');};
 check();if(decisionsInFlight.has(id))throw new Error('This file is being decided or renamed. Wait for it to finish.');
 decisionsInFlight.add(id);
 try{const result=await require('./station-files.cjs').renameSavedFile(filePath('deliveries.json'),id,stem,{beforeCommit:check});stationPoll=null;previewCache.delete(id);return result;}
 finally{decisionsInFlight.delete(id);}
});
handle('file-reveal',async id=>{shell.showItemInFolder(await savedFile(id));return {ok:true};});
handle('file-open',async id=>{const error=await shell.openPath(await savedFile(id));if(error)throw new Error(error);});
handle('file-copy',async id=>{const generation=await assertFileAccess(id);const original=await savedFile(id);const choice=await require('electron').dialog.showSaveDialog(main,{title:'Save another copy',defaultPath:path.join(app.getPath('downloads'),path.parse(original).name+' copy'+path.extname(original))});if(choice.canceled)return{canceled:true};assertIdentity(generation);await fs.copyFile(original,choice.filePath,require('node:fs').constants.COPYFILE_EXCL);return{path:choice.filePath};});
handle('file-email',async id=>{const generation=await assertFileAccess(id);const original=await savedFile(id),directory=filePath('mail-drafts');await fs.mkdir(directory,{recursive:true,mode:0o700});const draft=path.join(directory,crypto.randomUUID()+'.eml');await fs.writeFile(draft,require('./station-files.cjs').emailDraft(original,await fileBytes(id)),{mode:0o600});assertIdentity(generation);const error=await shell.openPath(draft);if(error)throw new Error('Unable to open the mail app. The draft is saved at '+draft);return{path:draft};});
handle('file-prepare',async id=>{const generation=await assertFileAccess(id);await workspaceOperator('createSlides');assertIdentity(generation);const records=await readJson('station-history.json',{});const file=records[id];if(!file)throw new Error('File unavailable.');const location=await savedFile(id);if(prepareOpened&&main&&!main.isDestroyed()){const answer=await require('electron').dialog.showMessageBox(main,{type:'question',message:'Replace the current lyrics with this file?',buttons:['Replace','Cancel'],defaultId:1,cancelId:1});if(answer.response!==0)return;}const bytes=await fileBytes(id);assertIdentity(generation);pendingPrepare={name:path.basename(location),data:bytes.toString('base64')};openPrepare();if(main&&!main.isDestroyed())main.webContents.send('prepare-file');});
handle('prepare-input',()=>{const result=pendingPrepare;pendingPrepare=null;return result;});
handle('lyrics',async url=>{await workspaceOperator('createSlides');return advanced.lyrics(url);});
handle('lyrics-export',data=>withWorkspaceFiles('createSlides',async({checkActive,signal})=>{const result=await advanced.exportLyrics(data,main,app.getPath('documents'),app.getPath('downloads'),checkActive,signal);checkActive();catalogChanged();return result;}));
handle('presentation-export',data=>withWorkspaceFiles('createSlides',async({operator,checkActive,signal})=>{const target=data?.layoutCopy||!operator.capabilities.planServices?null:await servicePlans().active(operator.deviceId);checkActive();const result=await advanced.exportPresentation(data,main,app.getPath('documents'),app.getPath('downloads'),checkActive,signal);checkActive();catalogChanged();return data?.layoutCopy||!operator.capabilities.planServices?result:playlistJobs().attach({...operator,id:operator.deviceId},result,[result.path],target);}));
handle('presentation-insert',data=>withWorkspaceFiles('createSlides',async({operator,checkActive,signal})=>{const target=operator.capabilities.planServices?await servicePlans().active(operator.deviceId):null;checkActive();const result=await advanced.insertPresentation(data,main,app.getPath('documents'),app.getPath('downloads'),checkActive,signal);checkActive();catalogChanged();return operator.capabilities.planServices?playlistJobs().attach({...operator,id:operator.deviceId},result,[result.path],target):result;}));
handle('powerpoint-cancel',()=>presentationIntegration.cancel());
handle('powerpoint-render',async()=>{await workspaceOperator('createSlides');return advanced.renderPowerPoint(main,app.getPath('downloads'));});

let protectedServiceStore;
function offlineServiceStore(){return protectedServiceStore||(protectedServiceStore=require('./offline-service.cjs').createOfflineServiceStore({directory:path.join(app.getPath('documents'),'Stați','Offline Services')}));}
const offlineServiceWindow=require('./offline-window.cjs').createOfflineWindow({ipcMain,createWindow:localWindow,store:offlineServiceStore,dialog:require('electron').dialog,isLocked:()=>sessionLocked,isClosing:()=>quitting,preload:path.join(__dirname,'offline-preload.cjs')});
serviceDeskIntegration=require('./service-desk-ipc.cjs').installServiceDesk({handle,withWorkspaceFiles,request,workspaceService,libraryDirectory,window:()=>main,dialog:require('electron').dialog,documents:()=>app.getPath('documents'),scopeKey:operator=>credential+':'+operator.deviceId+':'+operator.id+':'+operator.generation,onApproved:{before:async context=>{catalogConnection={credential,deviceId:context.operator.deviceId};catalogChanged();await catalogPublisher().flush();context.checkActive();},after:()=>{playlistJobs().schedule();notifyServiceChange();}},playlistStatus:async(operator,id)=>(await playlistManager().list(operator.deviceId)).find(item=>item.serviceId===id),offline:{lock:()=>offlineServiceWindow.lock(),open:()=>{identityScreen.dismiss(main);return offlineServiceWindow.open();},store:offlineServiceStore}});
presentationIntegration=require('./presentation-tools.cjs').installPresentationTools({handle,withWorkspaceFiles,backgroundDirectory:savedLyricsDirectory,window:()=>main,documents:()=>app.getPath('documents'),home:()=>app.getPath('home'),userData:()=>app.getPath('userData'),libraryDirectory,scopeKey:operator=>operator.deviceId+':'+operator.id,onChanged:()=>{catalogChanged();notifyServiceChange();playlistJobs().schedule();},beforeConvert:operator=>servicePlans().active(operator.deviceId),afterConvert:async(result,operator,target)=>{assertIdentity(operator.generation);return playlistJobs().attach({...operator,id:operator.deviceId},result,(result.results||[]).filter(item=>['converted','skipped'].includes(item.status)&&item.path).map(item=>item.path),target);}});
app.whenReady().then(async()=>{if(process.platform==='win32'&&app.isPackaged){void require('./desktop-shortcut.cjs').removeLegacyDesktopShortcuts({executablePath:process.execPath,userData:app.getPath('userData'),scriptDirectory:__dirname}).catch(()=>{});}nativeTheme.themeSource='system';nativeTheme.on('updated',()=>{identityScreen.themeChanged(main);if(main&&!main.isDestroyed()&&process.platform==='win32')main.setTitleBarOverlay(titleBarColors());});protocol.handle('stati',request=>{const u=new URL(request.url);const target=path.resolve(__dirname,'build','.'+decodeURIComponent(u.pathname));const root=path.resolve(__dirname,'build')+path.sep;if(u.hostname!=='app'||!target.startsWith(root))return new Response('Not found',{status:404});return net.fetch(pathToFileURL(target).href).then(response=>{const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin','*');return new Response(response.body,{headers,status:response.status});});});try{const encrypted=await fs.readFile(filePath('device.bin'));if(safeStorage.isEncryptionAvailable())credential=safeStorage.decryptString(encrypted);}catch{}try{const encrypted=await fs.readFile(filePath('access.bin'));if(safeStorage.isEncryptionAvailable())accessGrant=safeStorage.decryptString(encrypted);}catch{}identityMode=identityPolicy.normalizeIdentityMode((await readJson('identity-settings.json',{})).mode);watchWindowsSession();createBackgroundTray();powerMonitor.on('resume',pollInBackground);powerMonitor.on('unlock-screen',pollInBackground);if(!(process.argv.includes('--stati-startup')&&identityMode==='off'))showMain();await restoreClocks();const navigate=section=>{if(!main||main.isDestroyed())return;main.show();main.focus();if(privacyUnlocked)main.webContents.send('navigate',section);};Menu.setApplicationMenu(process.platform==='darwin'?Menu.buildFromTemplate([{label:'Stați',submenu:[{role:'about'},...['undo','redo','cut','copy','paste','selectAll'].map(role=>({role,visible:false,acceleratorWorksWhenHidden:true})),{type:'separator'},{label:'Settings…',accelerator:'Cmd+,',click:()=>navigate('settings')},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},{role:'editMenu'},{role:'windowMenu'}]):null);updateController=require('./updates.cjs').createUpdates({app,onInstallError:restoreAfterUpdateError,onState:state=>{if(state.phase==='error')restoreAfterUpdateError();if(main&&!main.isDestroyed())main.webContents.send('update-state',state);if(state.phase==='available'&&state.nextVersion!==notifiedUpdate){notifiedUpdate=state.nextVersion;notify('Stați · Update available',state.message,()=>{const win=showMain();if(win)win.webContents.send('navigate','settings');});}},beforeInstall:async()=>{if(require('./powerpoint-batch.cjs').isRunning())throw new Error('Finish or stop the PowerPoint batch before updating.');if(downloadsInFlight.size)throw new Error('Finish saving the received files, then press Update again.');updateStopping=true;try{await stopReceiver();if(clocksRestored)await persistClocks();finalQuitAllowed=true;}catch(error){restoreAfterUpdateError();throw error;}}});if(updateController.enabled){setTimeout(()=>void updateController.check(),20000).unref();setInterval(()=>void updateController.check(),5*60000).unref();}setInterval(()=>{void autoContrast();},2500).unref();setInterval(()=>identityScreen.recheck(main),15000).unref();setInterval(()=>sendIdentityPresentation({lightweight:true}),1000).unref();screen.on('display-metrics-changed',()=>identityScreen.recheck(main));pollInBackground();setInterval(pollInBackground,20000).unref();setInterval(()=>{if(activeOperator&&!sessionLocked&&!quitting)playlistJobs().schedule();},60000).unref();});
app.on('before-quit',event=>{if(quitting){if(!finalQuitAllowed)event.preventDefault();return;}if(require('./powerpoint-batch.cjs').isRunning()){event.preventDefault();require('./powerpoint-batch.cjs').cancel();void require('electron').dialog.showMessageBox({type:'info',message:'Stopping PowerPoint conversion. Quit again when it stops.'});return;}event.preventDefault();quitting=true;serviceDeskIntegration?.clear();abortWorkspaceFiles();localPlaylistJobs?.cancel();void(async()=>{if(localPlaylistJobs)await localPlaylistJobs.flush().catch(()=>{});await stopReceiver().catch(()=>{});if(prepareDraftStore)await prepareDraftStore.flush().catch(()=>{});if(outputTranslationDrafts)await outputTranslationDrafts.flush().catch(()=>{});if(localServicePlans)await localServicePlans.flush().catch(()=>{});if(clocksRestored)await persistClocks().catch(error=>console.warn('Clock settings save failed:',error.name));finalQuitAllowed=true;app.quit();})();});
app.on('window-all-closed',()=>{if(process.platform!=='win32')app.quit();});
process.on('uncaughtException',err=>{console.error('Stați desktop error:',err.name);});

handle('history-clear',async()=>{const state=require('./station-visibility.cjs').visibleState(await sharedStationPoll(),activeOperator,operatorGeneration);if(!state.adminUnlocked)throw Error('Unlock an administrator first.');const answer=await require('electron').dialog.showMessageBox(main,{type:'question',message:'Clear delivery history?',detail:'Saved files stay in Downloads. Waiting files stay visible. Server security records are retained.',buttons:['Cancel','Clear history'],defaultId:0,cancelId:0});if(answer.response!==1)return {canceled:true};const hidden=new Set(await readJson('hidden-history.json',[]));for(const file of state.transfers)if(file.status!=='queued')hidden.add(file.id);await writeJson('hidden-history.json',[...hidden]);await require('./station-files.cjs').clearHistory(filePath('station-history.json'),[...hidden]);return {ok:true};});

app.on('will-quit',()=>{backgroundTray?.destroy();backgroundTray=null;identityScreen.close();notificationExpiry.closeAll();});

async function processRemoteSongActions(generation){const operator=await workspaceOperator('editLyrics');if(operator.generation!==generation)return;const directory=await savedLyricsDirectory();if(!directory)return;const capturedCredential=credential,capturedProof=operatorProof,capturedLease=localOperatorSelection.privateAuthority()?.lease;const check=()=>{assertIdentity(generation);if(credential!==capturedCredential||operatorProof!==capturedProof)throw Error('The selected profile changed.');};check();const options={deviceCredential:capturedCredential,proof:capturedProof,selectionLease:capturedLease};const {commands}=await request('/station/song-commands',options);check();if(!commands.length)return;const processor=require('./remote-song-actions.cjs').createRemoteSongActions({directory,archiveDirectory:filePath('Archived songs'),receiptDirectory:filePath('song-action-receipts'),assertCurrent:check});await processor.run(commands,async(id,result)=>{check();await workspaceOperator('editLyrics');check();await request('/station/song-commands/'+id,{...options,method:'POST',data:result});catalogChanged();});}
handle('song-archive-open',async()=>{await workspaceOperator('editLyrics');const directory=filePath('Archived songs');await fs.mkdir(directory,{recursive:true,mode:0o700});await shell.openPath(directory);return{ok:true};});
