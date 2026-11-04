const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {EventEmitter}=require('node:events'),{createRequire}=require('node:module');
const {createIdentityWindow}=require('../desktop/identity-window.cjs');
const source=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8'),localRequire=createRequire(path.join(__dirname,'../desktop/main.cjs'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({at='2026-10-18T16:59:00Z',captureBackdrop}={}){
 const handlers=new Map(),messages=[],exits=[];let full=false,visible=true,destroyed=false;
 const win=new EventEmitter();
 Object.assign(win,{isDestroyed:()=>destroyed,isMinimized:()=>false,isFullScreen:()=>full,isMaximized:()=>false,
  hide:()=>{visible=false;},show:()=>{visible=true;},focus(){},restore(){},getBounds:()=>({x:0,y:0,width:500,height:640}),
  setFullScreen:value=>{if(full&&!value)exits.push(()=>{visible=true;win.emit('leave-full-screen');});full=value;},
  setMinimumSize(){},setSize(){},center(){},setBounds(){},setAlwaysOnTop(){},setBackgroundMaterial(){},setBackgroundColor(){},
  webContents:{send:(name,data)=>{messages.push([name,data]);callbacks[name]?.(data);}}
 });
 const callbacks={};const screen={getDisplayMatching:()=>({workArea:{x:0,y:0,width:1920,height:1080}}),getPrimaryDisplay:()=>({bounds:{x:0,y:0,width:1920,height:1080}})};
 const identityScreen=createIdentityWindow({platform:'win32',screen,theme:{shouldUseDarkColors:false},mode:()=> 'before-service',now:()=>new Date(at),captureBackdrop,setTimer:()=>({unref(){}}),clearTimer(){}});
 const context={main:win,credential:'unit-device',identityPairedCredential:'unit-device',privacyUnlocked:true,sessionLocked:false,quitting:false,activeOperator:null,operatorAwaitingWorkspace:false,identitySkipped:false,identityScreen,identityReason:'startup',stationPoll:null,
  createMainWindow:()=>win,process:{platform:'win32'},identityPolicy:{canSkipIdentity:()=>true},operatorGeneration:0,
  clearOperator:()=>{context.activeOperator=null;context.operatorGeneration++;},handle:(name,fn)=>handlers.set(name,fn),require:localRequire};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function identityStatus('),source.indexOf('function sendIdentityPresentation('))+
  source.slice(source.indexOf('function identityWindow('),source.indexOf('function workspaceWindow('))+
  source.slice(source.indexOf('function showMain('),source.indexOf('function createBackgroundTray('))+
  source.slice(source.indexOf("handle('identity-skip'"),source.indexOf("handle('identity-settings'")),context);
 return{win,identityScreen,context,callbacks,messages,exits,visible:()=>visible,skip:()=>handlers.get('identity-skip')(),close:()=>{destroyed=true;identityScreen.close();}};
}

test('actual Skip handler with the real identity controller stays hidden after Windows exits fullscreen',async()=>{
 const f=fixture();f.context.identityWindow(f.win);assert.equal(f.identityScreen.status().presentation,'fullscreen');
 const result=await f.skip();assert.equal(result.skipped,true);assert.equal(f.context.activeOperator,null);assert.equal(f.context.identitySkipped,true);assert.equal(f.visible(),false);
 assert.equal(f.exits.length,1);f.exits.shift()();assert.equal(f.visible(),false,'native fullscreen exit must not restore the skipped identity screen');
 assert.equal(f.messages.at(-1)[0],'identity-required');assert.equal(f.messages.at(-1)[1].reason,'skip');f.close();
});

test('an explicit reopen during fullscreen exit is not hidden by the preceding Skip transition',async()=>{
 const f=fixture();f.context.identityWindow(f.win);await f.skip();assert.equal(f.visible(),false);
 f.context.showMain();assert.equal(f.context.identitySkipped,false);assert.equal(f.visible(),true);assert.equal(f.identityScreen.status().presentation,'fullscreen');
 f.exits.shift()();assert.equal(f.visible(),true,'an old hidden transition cannot hide a newly opened identity prompt');f.close();
});

test('Skip cancels an unfinished desktop snapshot so a late image never expands the hidden prompt',async()=>{
 let finish;const f=fixture({captureBackdrop:()=>new Promise(resolve=>{finish=resolve;})});f.context.identityWindow(f.win);await flush();
 assert.equal(typeof finish,'function');await f.skip();assert.equal(f.visible(),false);finish('data:image/png;base64,YQ==');await flush();
 assert.equal(f.visible(),false);assert.equal(f.identityScreen.status().presentation,'window');assert.equal(f.identityScreen.status().backdrop,null);f.close();
});

test('actual renderer Skip click reaches native hide, clears partial PIN state and cannot reveal a workspace',async()=>{
 const {parseHTML}=require('linkedom'),{window,document}=parseHTML(fs.readFileSync(path.join(__dirname,'../desktop/index.html'),'utf8'));
 const f=fixture(),callbacks={};f.context.identityWindow(f.win);let workspaceOpens=0;
 for(const dialog of document.querySelectorAll('dialog'))dialog.close=()=>dialog.removeAttribute('open');
 for(const input of document.querySelectorAll('input'))input.focus=()=>{};
 const member={id:'unit-admin',role:'admin',first_name:'Local',last_initial:'A'},state={paired:true,adminUnlocked:false,device:{name:'Local fixture',operator_id:null},members:[member],transfers:[],requests:[],accessRequests:[],receiver:{}};
 const api={identityStatus:async()=>f.context.identityStatus(),accessStatus:async()=>({allowed:true}),state:async()=>state,updateState:async()=>({phase:'disabled'}),senderPhoto:async()=>null,skipIdentity:async()=>f.skip(),workspaceOpen:async()=>{workspaceOpens++;}};
 window.stati=new Proxy(api,{get:(target,key)=>target[key]||(String(key).startsWith('on')?(callback=>{callbacks[key]=callback;return()=>{};}):async()=>({}))});
 f.callbacks['identity-required']=value=>callbacks.onIdentityRequired?.(value);
 const context={window,document,Event:window.Event,console,setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},IntersectionObserver:class{observe(){}disconnect(){}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop/renderer.js'),'utf8'),context);await flush();await flush();
 const button=document.getElementById('identity-skip');assert.equal(button.hidden,false);assert.equal(document.body.classList.contains('identity-fullscreen'),true);
 document.querySelector('.operator').click();await flush();document.getElementById('admin-pin').value='1234';assert.equal(document.getElementById('admin-unlock').hidden,false);
 button.click();await flush();await flush();assert.equal(f.context.identitySkipped,true);assert.equal(f.visible(),false);assert.equal(workspaceOpens,0);assert.equal(document.getElementById('admin-pin').value,'');assert.equal(document.getElementById('admin-unlock').hidden,true);
 f.exits.shift()();assert.equal(f.visible(),false);assert.equal(document.getElementById('identity-error').hidden,true);assert.equal(vm.runInContext('operatorChosen',context),false);f.close();
});


test('actual PIN and phone choices can still be skipped until the workspace commits, then Skip is blocked',async()=>{
 const fixturePath=path.join(__dirname,'operator-selection-integration.test.cjs'),fixtureSource=fs.readFileSync(fixturePath,'utf8');
 const load=vm.runInThisContext('(function(require,__dirname){'+fixtureSource.slice(0,fixtureSource.indexOf('\ntest('))+'\nreturn{serverFixture,select,adminId};})',{filename:fixturePath});
 const {serverFixture,select,adminId}=load(createRequire(fixturePath),__dirname);
 for(const method of ['pin','phone']){
  const f=serverFixture();await f.ready();
  const choose=async()=>{if(method==='pin')await select(f,adminId);else{const begin=await f.invoke('operator-unlock',undefined,adminId);await f.invoke('operator-unlock-status',undefined,begin.token);}};
  await choose();assert.equal(f.api.getState().activeOperator.id,adminId);
  assert.equal((await f.invoke('identity-status')).canSkip,true,method+' remains on the uncommitted identity prompt');
  await f.invoke('identity-skip');assert.equal(f.api.getState().identitySkipped,true);assert.equal(f.api.getState().main.visible,false);assert.equal(f.api.getState().activeOperator,null);assert.equal(f.api.getState().operatorProof,null);assert.equal(f.api.selectionStatus().phase,'none');
  f.api.showMain();await choose();await f.invoke('workspace-open');assert.equal((await f.invoke('identity-status')).canSkip,false);await assert.rejects(f.invoke('identity-skip'),/five minutes before/);assert.equal(f.api.getState().activeOperator.id,adminId);
  await f.invoke('operator',undefined,{id:null});
 }
});
