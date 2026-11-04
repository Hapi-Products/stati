const {test}=require('node:test'),assert=require('node:assert/strict');
const {createIdentityWindow}=require('../desktop/identity-window.cjs');
function fixture({platform='win32',mode='before-service',at='2026-10-18T16:59:00Z',captureBackdrop}={}){
 const calls=[],events=[],timers=new Map();let full=false,maximized=false,clock=new Date(at),number=0;
 const win={isDestroyed:()=>false,getBounds:()=>({x:1400,y:0,width:1120,height:780}),isFullScreen:()=>full,isMaximized:()=>maximized,
  setFullScreen:value=>{full=value;calls.push(['fullscreen',value]);},unmaximize:()=>{maximized=false;calls.push(['unmaximize']);},
  setMinimumSize:(...args)=>calls.push(['minimum',...args]),setSize:(...args)=>calls.push(['size',...args]),center:()=>calls.push(['center']),setBounds:value=>calls.push(['bounds',value]),setAlwaysOnTop:(...args)=>calls.push(['top',...args]),setBackgroundMaterial:value=>calls.push(['material',value]),setBackgroundColor:value=>calls.push(['background',value])};
 const primary={bounds:{x:0,y:0,width:1366,height:768},workArea:{x:0,y:0,width:1366,height:728}},theme={shouldUseDarkColors:false};
 const controller=createIdentityWindow({platform,captureBackdrop,mode:()=>mode,now:()=>clock,theme,screen:{getPrimaryDisplay:()=>primary,getDisplayMatching:()=>primary},onPresentation:value=>events.push(value),setTimer:(fn,ms)=>{const id=++number;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)});
 return{win,controller,calls,events,timers,theme,setMode:value=>{mode=value;},setTime:value=>{clock=new Date(value);},maximize:()=>{maximized=true;}};
}
test('pre-service identity uses native Acrylic and the control display, then shrinks at exact service start without refocusing',()=>{
 const f=fixture();assert.equal(f.controller.show(f.win).presentation,'fullscreen');
 assert.deepEqual(f.calls.slice(0,2),[['material','acrylic'],['background','#00000000']]);
 assert.deepEqual(f.calls.find(c=>c[0]==='bounds')[1],{x:0,y:0,width:1366,height:768});
 const timer=[...f.timers.values()][0];assert.equal(timer.ms,60000);
 f.setTime('2026-10-18T17:00:00Z');timer.fn();
 assert.equal(f.controller.status().presentation,'window');assert.deepEqual(f.calls.at(-2),['size',500,640]);
 assert.ok(f.calls.some(c=>c[0]==='top'&&c[1]===false));assert.ok(!f.calls.some(c=>c[0]==='focus'||c[0]==='show'));
});
test('workspace selection survives all service phases; returning to Switch User during service remains a small window even if maximized',()=>{
 const f=fixture();f.controller.show(f.win);f.controller.workspace(f.win);const length=f.calls.length;
 f.setTime('2026-10-18T17:30:00Z');f.controller.recheck();f.setTime('2026-10-19T00:00:00Z');f.controller.recheck();assert.equal(f.calls.length,length);
 f.setTime('2026-10-18T18:00:00Z');f.maximize();f.controller.show(f.win);assert.equal(f.controller.status().presentation,'window');assert.ok(f.calls.some(c=>c[0]==='unmaximize'));assert.deepEqual(f.calls.at(-2),['size',500,640]);
});
test('window dismissal lasts for this prompt; only a new prompt can expand before service',()=>{
 const f=fixture();f.controller.show(f.win);f.controller.dismiss();f.controller.recheck();f.controller.show(f.win,{newPrompt:false});assert.equal(f.controller.status().presentation,'window');
 f.controller.show(f.win);assert.equal(f.controller.status().presentation,'fullscreen');
});
test('appearance changes keep the backdrop transparent and restore an opaque themed workspace',()=>{
 const f=fixture();f.controller.show(f.win);f.theme.shouldUseDarkColors=true;f.controller.themeChanged();assert.deepEqual(f.calls.at(-1),['background','#00000000']);
 f.controller.workspace(f.win);assert.ok(f.calls.some(c=>c[0]==='background'&&c[1]==='#17191f'));assert.equal(f.controller.status().presentation,'window');
});
test('unavailable Acrylic still opens fullscreen; a native fullscreen failure keeps a usable window; Mac avoids Windows-only calls',()=>{
 const f=fixture();f.win.setBackgroundMaterial=value=>{if(value==='acrylic')throw Error('Unavailable');};assert.equal(f.controller.show(f.win).presentation,'fullscreen');assert.ok(f.calls.some(call=>call[0]==='background'&&call[1]==='#f8f9fc'));
 f.theme.shouldUseDarkColors=true;f.controller.themeChanged();assert.deepEqual(f.calls.at(-1),['background','#17191f']);
 const broken=fixture();broken.win.setFullScreen=()=>{throw Error('Fullscreen unavailable');};assert.equal(broken.controller.show(broken.win).presentation,'window');
 const mac=fixture({platform:'darwin'});mac.controller.show(mac.win);assert.ok(!mac.calls.some(c=>c[0]==='material'));assert.equal(mac.controller.status().presentation,'window');
});

test('the native entry point supplies startup versus Switch User reasons and keeps the paired/privacy gate',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('desktop/main.cjs','utf8'),calls=[];
 const context={sessionLocked:false,identitySkipped:false,privacyUnlocked:true,credential:'local-device',identityPairedCredential:'local-device',identityReason:'startup',identityScreen:{show:(_win,options)=>calls.push(options.reason),dismiss:()=>calls.push('dismiss')}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function identityWindow('),source.indexOf('function workspaceWindow(')),context);
 const win={isDestroyed:()=>false};context.identityWindow(win);context.identityReason='switch';context.identityWindow(win);context.privacyUnlocked=false;context.identityWindow(win);context.privacyUnlocked=true;context.sessionLocked=true;context.identityWindow(win);
 assert.deepEqual(calls,['startup','switch','dismiss']);
});

test('a service-time identity window keeps native blur; the selected workspace restores its normal opaque background',()=>{
 const f=fixture({at:'2026-10-21T02:21:00Z'});f.controller.show(f.win,{reason:'startup'});
 assert.equal(f.controller.status().presentation,'window');assert.ok(f.calls.some(call=>call[0]==='material'&&call[1]==='acrylic'));assert.ok(f.calls.some(call=>call[0]==='background'&&call[1]==='#00000000'));
 f.controller.workspace(f.win);assert.ok(f.calls.some(call=>call[0]==='material'&&call[1]==='none'));assert.equal(f.controller.status().presentation,'window');
});

test('startup before Tuesday service captures blur, shrinks at service start, and stays windowed during service',async()=>{
 const image='data:image/png;base64,YQ==',f=fixture({at:'2026-10-21T01:59:00Z',captureBackdrop:async()=>image});
 f.controller.show(f.win,{reason:'startup'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.controller.status().presentation,'fullscreen');assert.equal(f.controller.status().backdrop,image);assert.equal(f.timers.size,1);
 f.setTime('2026-10-21T02:00:00Z');[...f.timers.values()][0].fn();assert.equal(f.controller.status().presentation,'window');assert.equal(f.controller.status().backdrop,null);
 f.setTime('2026-10-21T02:21:00Z');f.controller.show(f.win,{reason:'startup'});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.controller.status().presentation,'window');
 f.controller.show(f.win,{reason:'unlock'});assert.equal(f.controller.status().presentation,'window');
 f.controller.workspace(f.win);assert.equal(f.controller.status().presentation,'window');assert.equal(f.controller.status().backdrop,null);
 f.controller.show(f.win,{reason:'switch'});assert.equal(f.controller.status().presentation,'window');
});
test('a normal existing prompt never grows when the next service approaches, and turning fullscreen off shrinks it',()=>{
 const f=fixture({at:'2026-10-18T18:30:00Z'});f.controller.show(f.win);const length=f.calls.length;f.setTime('2026-10-19T00:00:00Z');f.controller.recheck();assert.equal(f.calls.length,length);
 f.controller.show(f.win);f.setMode('off');f.controller.recheck();assert.equal(f.controller.status().presentation,'window');
});

test('a local backdrop is captured before expanding and discarded on selection or a late service transition',async()=>{
 const image='data:image/png;base64,YQ==';const settle=()=>new Promise(resolve=>setImmediate(resolve));
 const f=fixture({captureBackdrop:async()=>image});f.controller.show(f.win);assert.equal(f.controller.status().presentation,'window');await settle();
 assert.equal(f.controller.status().presentation,'fullscreen');assert.equal(f.controller.status().backdrop,image);assert.ok(f.calls.some(call=>call[0]==='material'&&call[1]==='none'));
 f.controller.workspace(f.win);assert.equal(f.controller.status().backdrop,null);
 for(const action of ['workspace','dismiss','service','close']){
  let complete;const g=fixture({captureBackdrop:()=>new Promise(resolve=>{complete=resolve;})});g.controller.show(g.win);await settle();
  if(action==='service')g.setTime('2026-10-18T17:00:00Z');else g.controller[action](g.win);
  complete(image);await settle();assert.equal(g.controller.status().presentation,'window',action);assert.equal(g.controller.status().backdrop,null,action);
 }
});
