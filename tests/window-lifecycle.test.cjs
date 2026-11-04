const {test}=require('node:test'),assert=require('node:assert/strict');
const {showMainWindow,clockLoginSettings}=require('../desktop/window-lifecycle.cjs');
function window(){const calls=[];return{calls,isDestroyed:()=>false,isMinimized:()=>false,restore:()=>calls.push('restore'),show:()=>calls.push('show'),focus:()=>calls.push('focus')};}
test('relaunch recreates a closed main window even when clock windows keep the process running',()=>{
 const clock=window(),fresh=window();let created=0;
 const main=showMainWindow({isDestroyed:()=>true},()=>{created++;return fresh;});
 assert.equal(main,fresh);assert.equal(created,1);assert.deepEqual(main.calls,['show','focus']);assert.deepEqual(clock.calls,[]);
 showMainWindow(main,()=>{throw Error('Do not duplicate the main window');});
 assert.equal(created,1);
});
test('relaunch restores and focuses a minimized main window',()=>{const main=window();main.isMinimized=()=>true;showMainWindow(main,()=>{});assert.deepEqual(main.calls,['restore','show','focus']);});
test('receiver login startup uses the installed Windows executable even after the last clock is removed',()=>{
 const base={platform:'win32',packaged:true,executable:'C:\\Program Files\\Stati\\Stați.exe'};
 assert.deepEqual(clockLoginSettings({...base,count:1}),{openAtLogin:true,path:base.executable,args:['--stati-startup']});
 assert.equal(clockLoginSettings({...base,count:0}).openAtLogin,true);
 assert.equal(clockLoginSettings({...base,packaged:false,count:1}),null);
 assert.equal(clockLoginSettings({...base,platform:'darwin',count:1}),null);
});
test('identity off only suppresses its popup; receiver and clocks always share one login entry',()=>{
 const base={platform:'win32',packaged:true,executable:'C:\\Stati\\Stati.exe'};
 for(const identityMode of ['before-service','in-app'])assert.equal(clockLoginSettings({...base,identityMode,count:0}).openAtLogin,true);
 assert.equal(clockLoginSettings({...base,identityMode:'off',count:1}).openAtLogin,true);
 assert.deepEqual(clockLoginSettings({...base,identityMode:'off',count:0}),{openAtLogin:true,path:base.executable,args:['--stati-startup']});
});
