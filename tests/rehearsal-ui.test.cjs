const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('esbuild'),{parseHTML}=require('linkedom');
const serviceId='11111111-1111-4111-8111-111111111111',otherId='22222222-2222-4222-8222-222222222222';
const song=(id,title,slides,extra={})=>({id,songId:id.repeat(64),title,status:'ready',reviewed:true,message:'Lyrics loaded.',fontSize:96,slides,...extra});
const snapshot=(id=serviceId)=>({id,title:'Sunday rehearsal',date:'2026-10-25',time:'10:00',notes:'Local operator note',revision:2,ready:true,songs:[song('a','First song',[{section:'Verse',text:'Lord we sing Your glory'},{section:'Chorus',text:'Our hearts belong to You',ending:'Amen'}]),song('b','Laudă',[{section:'Verse',text:'Împreună cântăm',ending:'Amin'}])]});
const audioSelection=()=>({filename:'Local practice.mp3',contentType:'audio/mpeg',bytes:new Uint8Array([73,68,51,1,2,3])});
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};};
async function ui({bridge={},props={}}={},check){
 const {window}=parseHTML('<html><body><button id="outside">Outside</button><div id="root"></div></body></html>'),previous={};for(const key of ['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'])previous[key]=Object.getOwnPropertyDescriptor(global,key);
 Object.assign(global,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});window.location=new URL('https://isolated.invalid/');Object.defineProperty(global,'navigator',{configurable:true,value:window.navigator});Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.oninput=null;
 const calls={load:[],choose:0,close:0,created:[],revoked:[],subscribed:0,unsubscribed:0,pause:0,play:0,mediaLoad:0,live:0},listeners=new Set(),originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
 URL.createObjectURL=blob=>{const url='blob:local-rehearsal-'+(calls.created.length+1);calls.created.push({url,size:blob.size,type:blob.type});return url;};URL.revokeObjectURL=url=>calls.revoked.push(url);
 const api={loadServiceRehearsal:async id=>{calls.load.push(id);return snapshot(id);},chooseRehearsalAudio:async()=>{calls.choose++;return audioSelection();},onIdentityRequired:callback=>{calls.subscribed++;listeners.add(callback);return()=>{calls.unsubscribed++;listeners.delete(callback);};},focusPlayback:()=>{calls.live++;throw Error('Rehearsal cannot control ProPresenter.');},...bridge};window.stati=api;
 const cache=new Map();function load(filename){filename=path.resolve(filename);if(cache.has(filename))return cache.get(filename).exports;const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));cache.set(filename,loaded);const original=loaded.require.bind(loaded);loaded.require=name=>name.endsWith('.css')?{}:name.endsWith('.json')?original(name):name.startsWith('.')&&fs.existsSync(path.resolve(path.dirname(filename),name))?load(path.resolve(path.dirname(filename),name)):original(name);loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{loader:filename.endsWith('.tsx')?'tsx':filename.endsWith('.ts')?'ts':'js',format:'cjs',jsx:'automatic'}).code,filename);return loaded.exports;}
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),root=createRoot(document.getElementById('root')),Component=load('src/desktop/Rehearsal.tsx').Rehearsal,defaults={serviceId,title:'Sunday rehearsal',active:true,disabled:false,bridge:api,onClose:()=>calls.close++,...props};
 const render=async extra=>act(async()=>root.render(React.createElement(Component,{...defaults,...extra}))),button=name=>[...document.querySelectorAll('button')].find(element=>(element.getAttribute('aria-label')||element.textContent)===name),click=async target=>{assert.ok(target,'Expected control');assert.equal(target.disabled,false);await act(async()=>target.dispatchEvent(new window.Event('click',{bubbles:true})));},unmount=async()=>act(async()=>root.render(null)),key=async value=>{const event=new window.Event('keydown',{bubbles:true,cancelable:true});Object.defineProperty(event,'key',{value});await act(async()=>document.querySelector('[role="dialog"]').dispatchEvent(event));return event;};
 const media=()=>{const element=document.querySelector('audio');assert.ok(element);element.pause=()=>calls.pause++;element.play=()=>{calls.play++;return Promise.resolve();};element.load=()=>calls.mediaLoad++;return element;};
 const mediaEvent=async(element,type,properties={})=>{for(const [name,value]of Object.entries(properties))Object.defineProperty(element,name,{configurable:true,writable:true,value});await act(async()=>element.dispatchEvent(new window.Event(type,{bubbles:true})));};
 const edit=async(label,value)=>{const element=document.querySelector('input[aria-label="'+label+'"]');assert.ok(element);const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),'value');if(descriptor?.set)descriptor.set.call(element,value);else element.value=value;await act(async()=>element.dispatchEvent(new window.Event('input',{bubbles:true})));};
 try{await render();await check({window,document,act,api,calls,render,button,click,unmount,key,media,mediaEvent,edit,listeners,text:()=>document.body.textContent,identity:async()=>act(async()=>{for(const listener of listeners)listener({});}),hide:async()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});await act(async()=>document.dispatchEvent(new window.Event('visibilitychange')));}});assert.equal(calls.live,0);assert.equal(calls.play,0,'Rehearsal never starts audio programmatically');}
 finally{await act(async()=>root.unmount());URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;for(const [key,descriptor]of Object.entries(previous)){if(descriptor)Object.defineProperty(global,key,descriptor);else delete global[key];}}
}
test('rehearsal follows service order with button and keyboard slide navigation and localized endings',async()=>{
 await ui({},async({document,text,calls,button,click,key})=>{assert.deepEqual(calls.load,[serviceId]);assert.match(text(),/ProPresenter’s live output stays unchanged/);assert.equal(document.querySelector('.rehearsal-slide p').textContent,'Lord we sing Your glory');assert.equal(document.querySelector('.rehearsal-ending'),null);assert.equal(button('Previous rehearsal slide').disabled,true);await click(button('Next rehearsal slide'));assert.equal(document.querySelector('.rehearsal-ending').textContent,'Amen');await key('ArrowRight');assert.equal(document.querySelector('.rehearsal-slide p').textContent,'Împreună cântăm');assert.equal(document.querySelector('.rehearsal-ending').textContent,'Amin');assert.equal(button('Next rehearsal slide').disabled,true);await key('Home');assert.equal(document.querySelector('.rehearsal-slide p').textContent,'Lord we sing Your glory');await key('End');assert.match(text(),/Laudă · slide 1 of 1 · 3 of 3/);await key('PageUp');assert.equal(document.querySelector('.rehearsal-ending').textContent,'Amen');assert.match(document.querySelector('.rehearsal-slide p').getAttribute('style'),/font-size:/);});
});
test('missing and changed songs show their warnings and do not produce substitute rehearsal slides',async()=>{
 await ui({bridge:{loadServiceRehearsal:async()=>({...snapshot(),ready:false,songs:[song('x','Missing song',[],{status:'missing',message:'File is missing.'}),song('y','Changed song',[],{status:'changed',message:'Refresh its reference.'}),song('b','Available',[{section:'Verse',text:'Verified lyric'}],{reviewed:false})]})}},async({document,text,button})=>{const choices=[...document.querySelectorAll('.rehearsal-setlist button')];assert.equal(choices.length,3);assert.equal(choices[0].disabled,true);assert.equal(choices[1].disabled,true);assert.equal(choices[2].disabled,false);assert.equal(document.querySelector('.rehearsal-slide p').textContent,'Verified lyric');assert.doesNotMatch(text(),/review still needed/i);assert.match(text(),/Some songs are missing, changed or unreadable/);assert.equal(button('Next rehearsal slide').disabled,true);});
});
test('audio uses an owned bounded MP3 blob with manual controls and is stopped and revoked on close',async()=>{
 await ui({},async({document,calls,button,click,media})=>{assert.equal(document.querySelector('audio'),null);await click(button('Choose rehearsal MP3'));assert.equal(calls.choose,1);const element=media();assert.equal(element.hasAttribute('controls'),true);assert.equal(element.hasAttribute('autoplay'),false);assert.equal(element.getAttribute('preload'),'metadata');assert.equal(element.getAttribute('src'),'blob:local-rehearsal-1');assert.deepEqual(calls.created,[{url:'blob:local-rehearsal-1',size:6,type:'audio/mpeg'}]);await click(button('Close rehearsal'));assert.equal(calls.close,1);assert.equal(calls.pause,1);assert.equal(calls.mediaLoad,1);assert.deepEqual(calls.revoked,['blob:local-rehearsal-1']);assert.equal(document.querySelector('[role="dialog"]'),null);});
});
for(const reason of ['hide','identity','inactive','disabled','unmount'])test(reason+' immediately stops audio and removes rehearsal lyric data',async()=>{
 await ui({},async({document,calls,button,click,media,render,unmount,hide,identity})=>{await click(button('Choose rehearsal MP3'));media();if(reason==='hide')await hide();else if(reason==='identity')await identity();else if(reason==='unmount')await unmount();else await render({[reason==='inactive'?'active':'disabled']:reason!=='inactive'});assert.equal(calls.pause,1);assert.deepEqual(calls.revoked,['blob:local-rehearsal-1']);assert.equal(document.querySelector('[role="dialog"]'),null);assert.doesNotMatch(document.getElementById('root').textContent,/Lord we sing|Local practice/);if(reason==='hide'||reason==='identity')assert.equal(calls.close,1);});
});
test('late service and audio responses from an old scope never appear after a service switch',async()=>{
 const old=deferred(),held=deferred();let loads=0;
 await ui({bridge:{loadServiceRehearsal:async id=>++loads===1?old.promise:{...snapshot(id),title:'Current service'},chooseRehearsalAudio:()=>held.promise}},async({render,act,document,button,click,calls,text})=>{assert.match(text(),/Opening saved service/);await render({serviceId:otherId,title:'Current service'});assert.match(text(),/Current service/);await act(async()=>old.resolve({...snapshot(),title:'Old private service'}));assert.doesNotMatch(text(),/Old private service/);await click(button('Choose rehearsal MP3'));await render({disabled:true});await act(async()=>held.resolve(audioSelection()));assert.equal(calls.created.length,0);assert.equal(document.querySelector('audio'),null);assert.equal(document.querySelector('[role="dialog"]'),null);});
});
test('replacing or removing audio releases the previous blob and canceling the chooser keeps current audio',async()=>{
 let chooses=0;
 await ui({bridge:{chooseRehearsalAudio:async()=>++chooses===2?{canceled:true}:audioSelection()}},async({button,click,document,media,calls})=>{await click(button('Choose rehearsal MP3'));media();await click(button('Choose rehearsal MP3'));assert.equal(calls.created.length,1);assert.equal(calls.revoked.length,0);await click(button('Choose rehearsal MP3'));assert.deepEqual(calls.revoked,['blob:local-rehearsal-1']);assert.equal(document.querySelector('audio').getAttribute('src'),'blob:local-rehearsal-2');media();await click(button('Remove audio'));assert.deepEqual(calls.revoked,['blob:local-rehearsal-1','blob:local-rehearsal-2']);assert.equal(document.querySelector('audio'),null);});
});
test('invalid audio and failed loads give actionable errors without starting audio or live controls',async()=>{
 await ui({bridge:{chooseRehearsalAudio:async()=>({...audioSelection(),contentType:'video/mp4'})}},async({button,click,document,calls})=>{await click(button('Choose rehearsal MP3'));assert.match(document.querySelector('[role="alert"]').textContent,/audio could not be verified/);assert.equal(document.querySelector('audio'),null);assert.equal(calls.created.length,0);});
 await ui({bridge:{loadServiceRehearsal:async()=>{throw Error('The selected profile changed.');}}},async({document})=>{assert.match(document.querySelector('[role="alert"]').textContent,/profile changed/);assert.equal(document.querySelector('.rehearsal-slide'),null);});
});
test('Escape closes once and stale identity callbacks cannot close a replacement bridge scope',async()=>{
 let callback;
 await ui({bridge:{onIdentityRequired:listener=>{callback=listener;return()=>{};}}},async({key,calls,document})=>{await key('Escape');assert.equal(calls.close,1);assert.equal(document.querySelector('[role="dialog"]'),null);});
 await ui({bridge:{onIdentityRequired:listener=>{callback=listener;return()=>{};}}},async({render,api,act,calls,document})=>{const stale=callback;await render({bridge:{...api,onIdentityRequired:()=>()=>{}}});await act(async()=>stale({}));assert.equal(calls.close,0);assert.ok(document.querySelector('[role="dialog"]'));});
});

test('manual A/B marks enable a bounded loop without starting playback, then seek only during user playback',async()=>{
 await ui({},async({document,button,click,media,mediaEvent,calls,text})=>{
  await click(button('Choose rehearsal MP3'));const element=media();await mediaEvent(element,'loadedmetadata',{duration:90,currentTime:12,paused:true});await click(button('Mark A at current time'));element.currentTime=24;await click(button('Mark B at current time'));await click(button('Enable A/B loop'));
  assert.equal(element.loop,true);assert.equal(button('Disable A/B loop').getAttribute('aria-pressed'),'true');assert.match(text(),/Looping 12s → 24s/);assert.equal(calls.play,0);
  await mediaEvent(element,'timeupdate',{currentTime:30,paused:true});assert.equal(element.currentTime,30,'Enabling a loop must not move paused playback');
  await mediaEvent(element,'timeupdate',{currentTime:30,paused:false});assert.equal(element.currentTime,30,'No user Play event means no loop seek');
  await mediaEvent(element,'play',{paused:false});assert.equal(element.currentTime,12);await mediaEvent(element,'timeupdate',{currentTime:23.9});assert.equal(element.currentTime,23.9);await mediaEvent(element,'timeupdate',{currentTime:24});assert.equal(element.currentTime,12);await mediaEvent(element,'timeupdate',{currentTime:5});assert.equal(element.currentTime,12);
  assert.equal(document.querySelector('audio').hasAttribute('autoplay'),false);
 });
});

test('editable loop seconds validate finite ordered bounds against the actual MP3 duration',async()=>{
 await ui({},async({document,button,click,media,mediaEvent,edit})=>{
  await click(button('Choose rehearsal MP3'));const element=media();await click(button('Enable A/B loop'));assert.match(document.querySelector('.rehearsal-loop [role="alert"]').textContent,/Wait for the MP3 duration/);await mediaEvent(element,'loadedmetadata',{duration:60,currentTime:0,paused:true});
  for(const [a,b]of [['-1','10'],['5','5'],['20','10'],['0','61'],['Infinity','20'],['','20'],['0','']]){await edit('Loop start (A), seconds',a);await edit('Loop end (B), seconds',b);await click(button('Enable A/B loop'));assert.ok(document.querySelector('.rehearsal-loop [role="alert"]'),a+' / '+b);assert.equal(element.loop,false);}
  await edit('Loop start (A), seconds','2.5');await edit('Loop end (B), seconds','15.75');await click(button('Enable A/B loop'));assert.equal(element.loop,true);assert.equal(document.querySelector('.rehearsal-loop [role="alert"]'),null);await edit('Loop end (B), seconds','16');assert.equal(element.loop,false,'Editing the active range disables its previous loop');
 });
});

test('pause, explicit disable and Clear release active looping without changing the chosen audio source',async()=>{
 await ui({},async({document,button,click,media,mediaEvent,edit,calls})=>{
  await click(button('Choose rehearsal MP3'));const element=media();await mediaEvent(element,'loadedmetadata',{duration:40,currentTime:0,paused:true});await edit('Loop start (A), seconds','5');await edit('Loop end (B), seconds','10');await click(button('Enable A/B loop'));await mediaEvent(element,'play',{paused:false,currentTime:5});await mediaEvent(element,'pause',{paused:true,currentTime:8});
  assert.equal(element.loop,false);assert.equal(document.querySelector('input[aria-label="Loop start (A), seconds"]').value,'0');assert.equal(document.querySelector('input[aria-label="Loop end (B), seconds"]').value,'40');assert.equal(element.getAttribute('src'),'blob:local-rehearsal-1');assert.equal(calls.revoked.length,0);await mediaEvent(element,'ended',{currentTime:40});assert.equal(element.currentTime,40,'A late ended event after Pause cannot seek');
  await click(button('Enable A/B loop'));await click(button('Disable A/B loop'));assert.equal(element.loop,false);await edit('Loop start (A), seconds','8');await edit('Loop end (B), seconds','12');await click(button('Enable A/B loop'));await click(button('Clear loop'));assert.equal(element.loop,false);assert.equal(button('Enable A/B loop').getAttribute('aria-pressed'),'false');
 });
});

test('B at the exact duration uses native looping and ended fallback only seeks for an active user play session',async()=>{
 await ui({},async({button,click,media,mediaEvent,edit})=>{
  await click(button('Choose rehearsal MP3'));const element=media();await mediaEvent(element,'loadedmetadata',{duration:30,currentTime:0,paused:true});await edit('Loop start (A), seconds','7');await click(button('Enable A/B loop'));assert.equal(element.loop,true);await mediaEvent(element,'ended',{currentTime:30,paused:true});assert.equal(element.currentTime,30);
  await mediaEvent(element,'play',{paused:false,currentTime:7});await mediaEvent(element,'ended',{currentTime:30,paused:true});assert.equal(element.currentTime,7);await click(button('Clear loop'));await mediaEvent(element,'ended',{currentTime:30});assert.equal(element.currentTime,30);
 });
});

test('old media events cannot change a new selected MP3 or resurrect its loop',async()=>{
 await ui({},async({document,button,click,media,mediaEvent,edit,calls})=>{
  await click(button('Choose rehearsal MP3'));const old=media();await mediaEvent(old,'loadedmetadata',{duration:20,currentTime:0,paused:true});await edit('Loop start (A), seconds','5');await edit('Loop end (B), seconds','10');await click(button('Enable A/B loop'));await mediaEvent(old,'play',{paused:false,currentTime:5});
  await click(button('Choose rehearsal MP3'));const current=media();assert.notEqual(current,old);assert.equal(old.loop,false);assert.deepEqual(calls.revoked,['blob:local-rehearsal-1']);await mediaEvent(current,'loadedmetadata',{duration:60,currentTime:3,paused:true});
  for(const event of ['loadedmetadata','play','timeupdate','ended','pause','error'])await mediaEvent(old,event,{duration:20,currentTime:19,paused:false});assert.equal(current.currentTime,3);assert.equal(current.loop||false,false);assert.equal(document.querySelector('input[aria-label="Loop end (B), seconds"]').value,'60');assert.equal(button('Enable A/B loop').getAttribute('aria-pressed'),'false');assert.equal(document.querySelector('.rehearsal-loop [role="alert"]'),null);
 });
});

for(const reason of ['hide','identity','inactive','disabled','unmount'])test(reason+' tears down an active audio loop and its owned source',async()=>{
 await ui({},async({document,button,click,media,mediaEvent,edit,render,unmount,hide,identity,calls})=>{
  await click(button('Choose rehearsal MP3'));const element=media();await mediaEvent(element,'loadedmetadata',{duration:20,currentTime:3,paused:true});await edit('Loop start (A), seconds','3');await edit('Loop end (B), seconds','8');await click(button('Enable A/B loop'));await mediaEvent(element,'play',{paused:false});
  if(reason==='hide')await hide();else if(reason==='identity')await identity();else if(reason==='unmount')await unmount();else await render({[reason==='inactive'?'active':'disabled']:reason!=='inactive'});
  assert.equal(element.loop,false);assert.equal(element.getAttribute('src'),null);assert.equal(calls.pause,1);assert.deepEqual(calls.revoked,['blob:local-rehearsal-1']);assert.equal(document.querySelector('.rehearsal-loop'),null);await mediaEvent(element,'timeupdate',{currentTime:9,paused:false});assert.equal(element.currentTime,9);
 });
});

test('invalid duration changes and playback errors release loop state with useful feedback',async()=>{
 await ui({},async({document,button,click,media,mediaEvent,edit})=>{
  await click(button('Choose rehearsal MP3'));const element=media();await mediaEvent(element,'loadedmetadata',{duration:20,currentTime:2,paused:true});await edit('Loop start (A), seconds','2');await edit('Loop end (B), seconds','8');await click(button('Enable A/B loop'));await mediaEvent(element,'durationchange',{duration:Infinity});assert.equal(element.loop,false);assert.match(document.querySelector('.rehearsal-loop [role="alert"]').textContent,/duration is unavailable/);await mediaEvent(element,'loadedmetadata',{duration:10});await click(button('Enable A/B loop'));await mediaEvent(element,'error');assert.equal(element.loop,false);assert.match(document.querySelector('.rehearsal-loop [role="alert"]').textContent,/could not be played/);
 });
});
