const fs=require('node:fs'),path=require('node:path');
const {verifyExecutable}=require('./signature.cjs');
function createUpdates({app,resourcesPath=process.resourcesPath,platform=process.platform,onState=()=>{},beforeInstall=async()=>{},updater:provided,config:providedConfig,verifySignature=verifyExecutable,onInstallError=()=>{},previewBuild}){
 let updater=provided,state={version:app.getVersion(),phase:'disabled',message:platform==='darwin'?'This local Mac preview is updated by installing a newer build.':'Updates are enabled in the signed Windows release.'},busy=false;
 const emit=patch=>{state={...state,...patch};onState({...state});};
 let config=providedConfig;try{config??=require('js-yaml').load(fs.readFileSync(path.join(resourcesPath,'app-update.yml'),'utf8'));}catch{}
 const publishers=config?.publisherName;const trusted=Array.isArray(publishers)?publishers.some(p=>typeof p==='string'&&p.trim()):typeof publishers==='string'&&!!publishers.trim();
 const enabled=platform==='win32'&&app.isPackaged&&trusted&&config?.provider==='github'&&config.owner==='markusciani'&&config.repo==='stati-releases';
 if(previewBuild===undefined)try{previewBuild=require('./preview-build.json').number;}catch{}
 if(!enabled&&platform==='win32'&&app.isPackaged&&Number.isInteger(previewBuild)&&previewBuild>0)return require('./preview-updates.cjs').createPreviewUpdates({build:previewBuild,version:app.getVersion(),onState,beforeInstall,onInstallError,directory:path.join(app.getPath('userData'),'updates'),launchInstaller:async file=>{await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(file,['--updated','/S','--force-run'],{detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});app.quit();}});
 if(enabled){
  updater??=require('electron-updater').autoUpdater;updater.verifyUpdateCodeSignature=(names,file)=>verifySignature(Array.isArray(publishers)?publishers:[publishers],file);updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.allowDowngrade=false;updater.disableWebInstaller=true;updater.logger={info:()=>{},warn:()=>{},error:()=>{},debug:()=>{}};
  updater.on('checking-for-update',()=>emit({phase:'checking',message:'Checking for updates…'}));
  updater.on('update-available',info=>emit({phase:'available',nextVersion:info.version,message:'Version '+info.version+' is available.'}));
  updater.on('update-not-available',()=>emit({phase:'current',nextVersion:undefined,message:'Stați is up to date.'}));
  updater.on('download-progress',progress=>emit({phase:'downloading',percent:Math.max(0,Math.min(100,Math.round(progress.percent))),message:'Downloading update…'}));
  updater.on('update-downloaded',()=>emit({phase:'ready',percent:100,message:'Ready to restart and update.'}));
  updater.on('error',()=>emit({phase:'error',message:'Could not update. Check the connection and try again.'}));
  state={...state,phase:'idle',message:'Updates are checked automatically. You choose when to install.'};
 }
 async function check(){if(!enabled)return{...state};if(busy||['downloading','ready'].includes(state.phase))return{...state};busy=true;try{await updater.checkForUpdates();}catch{emit({phase:'error',message:'Could not check for updates. Try again later.'});}finally{busy=false;}return{...state};}
 async function install(){if(!enabled)throw new Error('A signed Windows release is required for automatic installation.');if(busy)throw new Error('An update is already in progress.');if(!['available','ready'].includes(state.phase))throw new Error('Check for an available update first.');busy=true;try{if(state.phase!=='ready'){emit({phase:'downloading',percent:0,message:'Downloading update…'});await updater.downloadUpdate();}await beforeInstall();emit({phase:'installing',message:'Restarting to install the update…'});updater.quitAndInstall(true,true);}catch(error){if(state.phase==='ready')emit({message:error.message});else emit({phase:'error',message:'Update could not be installed. Try again later.'});throw error;}finally{busy=false;}return{...state};}
 return{check,install,getState:()=>({...state}),enabled};
}
module.exports={createUpdates};
