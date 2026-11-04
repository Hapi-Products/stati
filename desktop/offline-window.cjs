'use strict';
// This window can only read a passphrase-protected local export. Its preload
// deliberately has no station bridge, identity, network or presentation API.
function createOfflineWindow({ipcMain,createWindow,store,dialog,isLocked,isClosing,preload}){
 let window=null,generation=0;
 function lock(){generation++;store().lock();if(window&&!window.isDestroyed())window.webContents.send('offline-locked');}
 function allowed(event){return !!window&&!window.isDestroyed()&&event?.sender===window.webContents&&!!event.senderFrame&&event.senderFrame===event.sender.mainFrame&&event.senderFrame.url==='stati://app/offline.html'&&!isLocked()&&!isClosing();}
 function handle(name,work){ipcMain.handle(name,async(event,...args)=>{
  if(!allowed(event))throw Error('Unlock the computer and open the offline desk first.');
  // Invalidate a previous copy without notifying this same UI; it is waiting
  // for the chooser result and fences any older result with its own epoch.
  if(name==='offline-copy-choose'){generation++;store().lock();}
  const scope=generation,checkActive=()=>{if(scope!==generation||!allowed(event))throw Error('The offline desk was locked.');};
  const result=await work(args,{checkActive});checkActive();return result;
 });}
 handle('offline-copy-choose',async(_args,options)=>{
  const choice=await dialog.showOpenDialog(window,{title:'Open protected service copy',properties:['openFile'],filters:[{name:'Stați protected service',extensions:['statiservice']}]});options.checkActive();if(choice.canceled||!choice.filePaths?.[0])return{canceled:true};return store().choose(choice.filePaths[0],options);
 });
 handle('offline-copy-unlock',([input],options)=>{if(!input||typeof input.id!=='string'||typeof input.passphrase!=='string')throw Error('Choose a protected copy and enter its passphrase.');return store().unlock(input.id,input.passphrase,options);});
 handle('offline-copy-audio',([input],options)=>store().audio(input,options));
 // Lock invalidates the request's generation by design.
 ipcMain.handle('offline-copy-lock',event=>{if(!allowed(event))throw Error('The offline desk is unavailable.');lock();return{ok:true};});
 return{lock,open(){
  if(isLocked()||isClosing())throw Error('Unlock the computer first.');if(window&&!window.isDestroyed()){window.show();window.focus();return{ok:true};}
  lock();const created=createWindow('build/offline.html',{title:'Stați · Offline service desk',webPreferences:{preload}});window=created;
  created.webContents.removeAllListeners('will-navigate');created.webContents.on('will-navigate',event=>event.preventDefault());
  created.on('closed',()=>{if(window!==created)return;lock();window=null;});created.loadURL('stati://app/offline.html');return{ok:true};
 }};
}
module.exports={createOfflineWindow};
