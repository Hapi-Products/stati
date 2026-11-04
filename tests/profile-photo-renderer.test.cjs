const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const source=fs.readFileSync('desktop/renderer.js','utf8');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfQoAAAAASUVORK5CYII=';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const {window,document}=parseHTML(fs.readFileSync('desktop/index.html','utf8')),callbacks={};let now=100000,calls=0;
 for(const dialog of document.querySelectorAll('dialog'))dialog.close=()=>dialog.removeAttribute('open');
 for(const input of document.querySelectorAll('input'))input.focus=()=>{};
 const member={id:'unit-photo-member',first_name:'Picture',last_initial:'T',role:'member',has_photo:1};
 const state={paired:true,adminUnlocked:false,device:{name:'Local photo fixture',operator_id:null},members:[member],transfers:[],requests:[],accessRequests:[],receiver:{}};
 const api={identityStatus:async()=>({presentation:'window'}),accessStatus:async()=>({allowed:true}),state:async()=>state,updateState:async()=>({phase:'disabled',message:'Unit fixture'}),senderPhoto:async()=>{calls++;return calls===1?null:png;},operator:async()=>({ok:true}),workspaceOpen:async()=>({ok:true})};
 window.stati=new Proxy(api,{get:(target,key)=>target[key]||(String(key).startsWith('on')?(callback=>{callbacks[key]=callback;return()=>{};}):async()=>({}))});
 class Clock extends Date{static now(){return now;}}
 const context={window,document,Date:Clock,Event:window.Event,console,setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},IntersectionObserver:class{observe(){}disconnect(){}}};vm.createContext(context);vm.runInContext(source,context);
 return {window,document,api,state,context,callbacks,calls:()=>calls,advance:ms=>now+=ms};
}
test('Who are you retries a temporarily missing photo without rebuilding the unchanged member list',async()=>{
 const f=fixture();await flush();await flush();const avatar=f.document.querySelector('.operator .avatar');assert.ok(avatar);assert.equal(f.calls(),1);assert.equal(avatar.querySelector('img'),null);
 await f.context.refresh();await flush();assert.equal(f.calls(),1);
 f.advance(5001);await f.context.refresh();await flush();assert.equal(f.calls(),2);assert.equal(f.document.querySelector('.operator .avatar'),avatar);assert.equal(avatar.querySelector('img').src,png);
 await f.context.refresh();await flush();assert.equal(f.calls(),2);
 f.advance(60001);await f.context.refresh();await flush();assert.equal(f.calls(),3);
});
test('file avatars use the retrying loader and identity reset cannot paint a late photo',async()=>{
 const f=fixture();await flush();await flush();f.state.transfers=[{id:'unit-photo-file',sender_id:f.state.members[0].id,has_photo:1,filename:'Photo notes.txt',bytes:14,status:'queued',created_at:1,first_name:'Picture',last_initial:'T'}];
 await f.context.refresh();await flush();const avatar=f.document.querySelector('.delivery-card .sender-avatar');assert.equal(avatar.querySelector('img').src,png);
 let finish;f.api.senderPhoto=()=>new Promise(resolve=>finish=resolve);const late=f.document.createElement('span');late.textContent='Late';f.document.body.append(late);f.context.setAvatarPhoto(late,'late-id');await flush();assert.equal(typeof finish,'function');
 f.context.clearAvatarPhotos();finish(png);await flush();assert.equal(late.querySelector('img'),null);assert.equal(late.textContent,'Late');
});
test('a broken decoded image keeps readable initials and retries at the next refresh',async()=>{
 const f=fixture();await flush();await flush();f.advance(5001);await f.context.refresh();await flush();const avatar=f.document.querySelector('.operator .avatar');avatar.querySelector('img').dispatchEvent(new f.window.Event('error'));assert.equal(avatar.textContent,'Picture'[0]+'T');assert.equal(avatar.querySelector('img'),null);
 f.advance(5001);await f.context.refresh();await flush();assert.equal(f.calls(),3);assert.equal(avatar.querySelector('img').src,png);
});


test('WebP uses the sandboxed thumbnail decoder before appearing in the avatar',async()=>{
 const f=fixture();await flush();await flush();const webp='data:image/webp;base64,fixture';let requested;f.window.statiThumbnail=async()=>({});f.window.statiPlayPreview=async()=>({});f.window.statiPhotoThumbnail=async input=>{requested=input;return png;};f.api.senderPhoto=async()=>webp;f.advance(5001);await f.context.refresh();await flush();assert.equal(requested,webp);assert.equal(f.document.querySelector('.operator .avatar img').src,png);
});

test('removing a computer clears visible files, profile photos, PIN and administrator controls',async()=>{
 const f=fixture();await flush();await flush();f.api.resetPairing=async()=>({ok:true});
 f.context.renderFiles([{id:'old-file',filename:'Previous station.txt',bytes:14,status:'delivered',saved:true,created_at:1,first_name:'Old profile',last_initial:'T'}]);
 f.document.getElementById('admin-pin').value='1234';vm.runInContext('adminUnlocked=true;operatorChosen=true',f.context);f.document.getElementById('connection').textContent='Previous administrator';
 f.document.getElementById('unpair').click();await flush();await flush();
 assert.equal(vm.runInContext('adminUnlocked',f.context),false);assert.equal(vm.runInContext('operatorChosen',f.context),false);assert.equal(vm.runInContext('paired',f.context),false);
 assert.equal(f.document.getElementById('files').children.length,0);assert.equal(f.document.getElementById('operators').children.length,0);assert.equal(f.document.getElementById('admin-pin').value,'');assert.equal(f.document.getElementById('connection').textContent,'Not paired');assert.equal(f.document.querySelector('[data-tab="settings"]').hidden,true);assert.equal(f.document.getElementById('operator-shade').hidden,true);
});
