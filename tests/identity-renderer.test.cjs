const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Who are you exposes check/install updates before a profile opens the workspace',async()=>{
 const {window,document}=parseHTML(fs.readFileSync('desktop/index.html','utf8')),callbacks={};
 for(const dialog of document.querySelectorAll('dialog'))dialog.close=()=>dialog.removeAttribute('open');
 let checked=0,installed=0,selected=0;
 const state={paired:true,adminUnlocked:false,device:{id:'11111111-1111-4111-8111-111111111111',name:'Local fixture',operator_id:null},members:[],transfers:[],requests:[],accessRequests:[],receiver:{}};
 const api={identityStatus:async()=>({presentation:'window',canSkip:false}),accessStatus:async()=>({allowed:true}),state:async()=>state,updateState:async()=>({phase:'idle',version:'0.1.0',message:'Updates checked automatically.'}),checkUpdates:async()=>{checked++;return{phase:'available',version:'0.1.0',message:'Preview available.'};},installUpdate:async()=>{installed++;return{phase:'installing',version:'0.1.0',message:'Restarting to install.'};},operator:async()=>{selected++;},senderPhoto:async()=>null};
 window.stati=new Proxy(api,{get:(target,key)=>target[key]||(String(key).startsWith('on')?(callback=>{callbacks[key]=callback;return()=>{};}):async()=>({}))});
 const context={window,document,Event:window.Event,console,confirm:()=>true,setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},IntersectionObserver:class{observe(){}disconnect(){}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('desktop/renderer.js','utf8'),context);await flush();await flush();
 const button=document.getElementById('identity-update');assert.equal(document.getElementById('operator-shade').hidden,false);assert.equal(document.getElementById('settings-panel').hidden,true);assert.ok(button.closest('.operator-modal'));assert.equal(button.hidden,false);assert.equal(button.disabled,false);assert.equal(button.textContent,'Check for updates');
 button.click();await flush();await flush();assert.equal(checked,1);assert.equal(button.textContent,'Update Stați');assert.equal(document.getElementById('identity-update-status').textContent,'Preview available.');
 button.click();await flush();await flush();assert.equal(installed,1);assert.equal(button.disabled,true);assert.equal(selected,0);assert.equal(document.getElementById('operator-shade').hidden,false);
});
test('late member selection cannot reveal the workspace after a native identity reset; PIN and cached files are cleared',async()=>{
 const {window,document}=parseHTML(fs.readFileSync('desktop/index.html','utf8')),callbacks={};
 for(const dialog of document.querySelectorAll('dialog'))dialog.close=()=>dialog.removeAttribute('open');
 for(const input of document.querySelectorAll('input'))input.focus=()=>{};
 const member={id:'unit-member',first_name:'Unit',last_initial:'T',role:'member'},state={paired:true,adminUnlocked:false,device:{name:'Unit fixture',operator_id:null},members:[member],transfers:[],requests:[],accessRequests:[],receiver:{}};
 let finishSelection,opened=0;
 const api={identityStatus:async()=>({presentation:'fullscreen',windowControlsOverlay:true}),accessStatus:async()=>({allowed:true}),state:async()=>state,
  updateState:async()=>({phase:'disabled',message:'Unit fixture'}),senderPhoto:async()=>null,operator:()=>new Promise(resolve=>{finishSelection=resolve;}),workspaceOpen:async()=>{opened++;return{ok:true};}};
 window.stati=new Proxy(api,{get:(target,key)=>target[key]||(String(key).startsWith('on')?(callback=>{callbacks[key]=callback;return()=>{};}):async()=>({}))});
 const context={window,document,Event:window.Event,console,setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},IntersectionObserver:class{observe(){}disconnect(){}}};vm.createContext(context);vm.runInContext(fs.readFileSync('desktop/renderer.js','utf8'),context);
 await flush();await flush();assert.ok(document.body.classList.contains('identifying'));assert.ok(document.body.classList.contains('windows-overlay'));
 document.querySelector('.operator').click();await flush();assert.equal(typeof finishSelection,'function');
 document.getElementById('admin-pin').value='1234';document.getElementById('files').textContent='Cached unit file';
 callbacks.onIdentityRequired({reason:'lock'});await flush();await flush();
 assert.equal(document.getElementById('admin-pin').value,'');assert.doesNotMatch(document.getElementById('files').textContent,/Cached unit file/);
 finishSelection({ok:true});await flush();await flush();assert.equal(opened,0);assert.equal(vm.runInContext('operatorChosen',context),false);assert.ok(!document.getElementById('operator-shade').hidden);
 callbacks.onIdentityPresentation({presentation:'window',windowControlsOverlay:true,canSkip:false});assert.ok(!document.documentElement.classList.contains('identity-fullscreen'));assert.ok(document.getElementById('identity-skip').hidden);assert.equal(document.getElementById('identity-windowed'),null);
});

test('Skip visibility updates in a window, clears partial PIN selection and never opens the workspace',async()=>{
 const {window,document}=parseHTML(fs.readFileSync('desktop/index.html','utf8')),callbacks={};
 for(const dialog of document.querySelectorAll('dialog'))dialog.close=()=>dialog.removeAttribute('open');
 for(const input of document.querySelectorAll('input'))input.focus=()=>{};
 const member={id:'unit-admin',first_name:'Unit',last_initial:'A',role:'admin'},state={paired:true,adminUnlocked:false,device:{name:'Unit fixture',operator_id:null},members:[member],transfers:[],requests:[],accessRequests:[],receiver:{}};
 let skipped=0,opened=0,canSkip=false;const api={identityStatus:async()=>({presentation:'window',windowControlsOverlay:true,canSkip}),accessStatus:async()=>({allowed:true}),state:async()=>state,updateState:async()=>({phase:'disabled',message:'Unit fixture'}),senderPhoto:async()=>null,workspaceOpen:async()=>{opened++;return{ok:true};},skipIdentity:async()=>{skipped++;canSkip=false;callbacks.onIdentityRequired({reason:'skip'});return{skipped:true,presentation:'window',canSkip:false};}};
 window.stati=new Proxy(api,{get:(target,key)=>target[key]||(String(key).startsWith('on')?(callback=>{callbacks[key]=callback;return()=>{};}):async()=>({}))});
 const context={window,document,Event:window.Event,console,setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},IntersectionObserver:class{observe(){}disconnect(){}}};vm.createContext(context);vm.runInContext(fs.readFileSync('desktop/renderer.js','utf8'),context);await flush();await flush();
 const skip=document.getElementById('identity-skip');assert.ok(skip.hidden);assert.equal(document.getElementById('identity-windowed'),null);assert.doesNotMatch(document.getElementById('operator-shade').textContent,/Use a window/);
 canSkip=true;callbacks.onIdentityPresentation({presentation:'window',canSkip:true});assert.equal(skip.hidden,false);assert.equal(skip.textContent,'Skip for now');
 document.querySelector('.operator').click();await flush();document.getElementById('admin-pin').value='1234';assert.equal(document.getElementById('admin-unlock').hidden,false);
 skip.click();await flush();await flush();assert.equal(skipped,1);assert.equal(opened,0);assert.equal(document.getElementById('admin-pin').value,'');assert.equal(document.getElementById('admin-unlock').hidden,true);assert.ok(skip.hidden);assert.equal(vm.runInContext('operatorChosen',context),false);assert.ok(document.body.classList.contains('identifying'));
 callbacks.onIdentityPresentation({presentation:'window',canSkip:true});assert.equal(skip.hidden,false);callbacks.onIdentityPresentation({presentation:'window',canSkip:false});assert.ok(skip.hidden);
});

test('lightweight Skip updates preserve the blurred backdrop, and Escape only uses the window fallback',async()=>{
 const {window,document}=parseHTML(fs.readFileSync('desktop/index.html','utf8')),callbacks={};for(const dialog of document.querySelectorAll('dialog'))dialog.close=()=>dialog.removeAttribute('open');
 const state={paired:true,adminUnlocked:false,device:{name:'Unit fixture'},members:[],transfers:[],requests:[],accessRequests:[],receiver:{}};let windowed=0,skipped=0,opened=0;
 const api={identityStatus:async()=>({presentation:'fullscreen',windowControlsOverlay:true,canSkip:false,backdrop:'data:image/png;base64,YQ=='}),accessStatus:async()=>({allowed:true}),state:async()=>state,updateState:async()=>({phase:'disabled'}),identityWindowed:async()=>{windowed++;return{presentation:'window',canSkip:false};},skipIdentity:async()=>{skipped++;return{skipped:true};},workspaceOpen:async()=>{opened++;}};
 window.stati=new Proxy(api,{get:(target,key)=>target[key]||(String(key).startsWith('on')?(callback=>{callbacks[key]=callback;return()=>{};}):async()=>({}))});
 const context={window,document,Event:window.Event,console,setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},IntersectionObserver:class{observe(){}disconnect(){}}};vm.createContext(context);vm.runInContext(fs.readFileSync('desktop/renderer.js','utf8'),context);await flush();await flush();
 const before=document.body.style.getPropertyValue('--identity-backdrop');assert.ok(before.includes('data:image/png;base64,YQ=='));callbacks.onIdentityPresentation({presentation:'fullscreen',canSkip:true});assert.equal(document.body.style.getPropertyValue('--identity-backdrop'),before);
 const event=new window.Event('keydown',{bubbles:true,cancelable:true});event.key='Escape';document.dispatchEvent(event);await flush();assert.equal(windowed,1);assert.equal(skipped,0);assert.equal(opened,0);assert.ok(document.body.classList.contains('identifying'));assert.ok(!document.body.classList.contains('identity-fullscreen'));
});

test('Library and Services are main sidebar actions and PowerPoint changes obey edit access',async()=>{
 const {window,document}=parseHTML(fs.readFileSync('desktop/index.html','utf8')),calls=[];for(const dialog of document.querySelectorAll('dialog'))dialog.close=()=>dialog.removeAttribute('open');
 const member={id:'unit-pastor',first_name:'Unit',last_initial:'T',role:'pastor',capabilities:{readSongs:true,editLyrics:false}},state={paired:true,adminUnlocked:false,device:{name:'Unit fixture',operator_id:member.id},members:[member],transfers:[],requests:[],accessRequests:[],receiver:{}};
 const api={identityStatus:async()=>({presentation:'window'}),accessStatus:async()=>({allowed:true}),state:async()=>state,updateState:async()=>({phase:'disabled'}),prepare:async section=>calls.push(section)};
 window.stati=new Proxy(api,{get:(target,key)=>target[key]||(String(key).startsWith('on')?()=>()=>{}:async()=>({}))});
 const context={window,document,Event:window.Event,console,setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},IntersectionObserver:class{observe(){}disconnect(){}}};vm.createContext(context);vm.runInContext(fs.readFileSync('desktop/renderer.js','utf8'),context);await flush();await flush();
 for(const id of ['library','services']){const button=document.getElementById(id);assert.ok(button.closest('nav[aria-label="Main navigation"]'));assert.equal(button.hidden,false);button.click();}await flush();assert.deepEqual(calls,['library','services']);assert.equal(document.getElementById('powerpoint-changes').hidden,true);
});
