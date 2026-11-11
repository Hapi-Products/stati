const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('esbuild'),{parseHTML}=require('linkedom');
function component(relative){
 const filename=path.resolve(__dirname,'..',relative),loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
 const original=loaded.require.bind(loaded);loaded.require=name=>{if(name.endsWith('.css'))return{};if(name.startsWith('.')){const base=path.resolve(path.dirname(filename),name),file=[base+'.tsx',base+'.ts'].find(file=>fs.existsSync(file));if(file)return component(path.relative(path.resolve(__dirname,'..'),file));}return original(name);};
 loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{loader:filename.endsWith('.tsx')?'tsx':'ts',format:'cjs',jsx:'automatic'}).code,filename);return loaded.exports;
}
const fixture=()=>({id:'11111111-1111-4111-8111-111111111111',revision:3,title:'Sunday morning',date:'2026-10-25',time:'10:00',notes:'Keep these notes',reviewed:true,archived:false,active:true,status:'Ready',songs:[],tasks:[{id:'checklist-item-identifier',text:'Check lyrics',done:true}],playlist:{phase:'waiting',message:'Waiting for ProPresenter.'}});
async function ui(name,bridge,check,props={}){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),previous={window:global.window,document:global.document,navigator:global.navigator,act:global.IS_REACT_ACT_ENVIRONMENT,confirm:global.confirm};
 global.window=window;global.document=window.document;Object.defineProperty(global,'navigator',{configurable:true,value:window.navigator});global.IS_REACT_ACT_ENVIRONMENT=true;global.confirm=()=>true;
 window.location=new URL('http://127.0.0.1/');window.document.oninput=null;
 Object.defineProperty(window.document,'visibilityState',{configurable:true,value:'visible'});window.stati=bridge;
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Component=component('src/desktop/'+name+'.tsx')[name],root=createRoot(window.document.getElementById('root'));
 const render=async next=>{await act(async()=>root.render(React.createElement(Component,{disabled:false,active:true,...props,...next})));};
 const click=async element=>{assert.ok(element);assert.equal(element.disabled,false);await act(async()=>element.dispatchEvent(new window.Event('click',{bubbles:true})));};
 const select=async value=>{const element=window.document.querySelector('select[aria-label="Add new songs to"]');Object.defineProperty(element,'value',{configurable:true,value});await act(async()=>element.dispatchEvent(new window.Event('change',{bubbles:true})));};
 const changed=async()=>{await act(async()=>window.dispatchEvent(new window.Event('stati-services-changed')));};
 const visibility=async value=>{Object.defineProperty(window.document,'visibilityState',{configurable:true,value});await act(async()=>window.document.dispatchEvent(new window.Event('visibilitychange')));};
 try{await render();await check({window,document:window.document,act,render,click,select,changed,visibility,text:()=>window.document.body.textContent});}
 finally{await act(async()=>root.unmount());global.window=previous.window;global.document=previous.document;Object.defineProperty(global,'navigator',{configurable:true,value:previous.navigator});global.IS_REACT_ACT_ENVIRONMENT=previous.act;global.confirm=previous.confirm;}
}
test('active service target selects Lyrics-only, announces native status and pauses hidden/inactive polling',async context=>{
 context.mock.timers.enable({apis:['setInterval','setTimeout']});let plans=[fixture()],lists=0,action,events=0;const busy=[];
 await ui('ServiceTarget',{listServicePlans:async()=>{lists++;return structuredClone(plans);},changeServicePlan:async value=>{action=value;plans=plans.map(plan=>({...plan,active:false}));return structuredClone(plans);}},async({window,document,act,render,select,visibility,text})=>{
  assert.equal(lists,1);assert.match(text(),/Waiting for ProPresenter/);assert.ok(document.querySelector('option[value="'+plans[0].id+'"]'));
  window.addEventListener('stati-services-changed',()=>events++);await select('');assert.deepEqual(action,{type:'select',id:null});assert.equal(events,1);assert.deepEqual(busy,[true,false]);assert.match(text(),/New songs stay in Lyrics/);
  await visibility('hidden');const before=lists;await act(async()=>context.mock.timers.tick(30000));assert.equal(lists,before);
  await visibility('visible');assert.equal(lists,before+1);await act(async()=>context.mock.timers.tick(29999));assert.equal(lists,before+1);await act(async()=>context.mock.timers.tick(1));assert.equal(lists,before+2);
  await render({active:false});const stopped=lists;await act(async()=>context.mock.timers.tick(30000));assert.equal(lists,stopped);
 },{onBusy:value=>busy.push(value)});
});
test('summary timeouts keep one IPC request and ignore its stale answer before retrying',async context=>{
 context.mock.timers.enable({apis:['setInterval','setTimeout']});let finish,lists=0;const pending=new Promise(resolve=>finish=resolve),latest={...fixture(),title:'Latest service',playlist:{phase:'synced',message:'Latest playlist is synced.'}};
 await ui('ServiceTarget',{listServicePlans:()=>{lists++;return lists===1?pending:Promise.resolve([latest]);}},async({act,text})=>{
  assert.equal(lists,1);await act(async()=>context.mock.timers.tick(8000));assert.match(text(),/taking too long/);
  await act(async()=>context.mock.timers.tick(30000));assert.equal(lists,1);
  await act(async()=>{finish([fixture()]);await Promise.resolve();});assert.equal(lists,2);assert.match(text(),/Latest playlist is synced/);assert.doesNotMatch(text(),/Waiting for ProPresenter/);
 });
});
test('a service change fences an older summary response and refreshes the selected target',async()=>{
 let finish,lists=0;const pending=new Promise(resolve=>finish=resolve),latest={...fixture(),title:'Chosen service',playlist:{phase:'review',message:'Review changed songs before service.'}};
 await ui('ServiceTarget',{listServicePlans:()=>{lists++;return lists===1?pending:Promise.resolve([latest]);}},async({act,changed,text})=>{
  await changed();assert.equal(lists,1);await act(async()=>finish([fixture()]));assert.equal(lists,2);assert.match(text(),/Review changed songs/);assert.doesNotMatch(text(),/Waiting for ProPresenter/);
 });
});
test('summary ignores an answer after its workspace closes and resumes safely on return',async()=>{
 let finish,lists=0;const pending=new Promise(resolve=>finish=resolve),latest={...fixture(),playlist:{phase:'disabled',message:'Automatic playlists are off.'}};
 await ui('ServiceTarget',{listServicePlans:()=>{lists++;return lists===1?pending:Promise.resolve([latest]);}},async({act,render,text})=>{
  await render({active:false});await act(async()=>finish([fixture()]));assert.doesNotMatch(text(),/Waiting for ProPresenter/);assert.equal(lists,1);
  await render({active:true});assert.equal(lists,2);assert.match(text(),/Automatic playlists are off/);
 });
});
const serviceSong={id:'song-appearance-identifier',songId:'a'.repeat(64),contentHash:'b'.repeat(64),title:'Attached song',filename:'song.pro',reviewed:false};
test('playlist status refresh and target selection preserve the open service draft and its revision',async()=>{
 let plan={...fixture(),songs:[serviceSong]},saved,action;let lists=0;
 await ui('ServicePlans',{listServicePlans:async()=>{lists++;return[structuredClone(plan)];},listServiceTemplates:async()=>[],searchSongLibrary:async()=>({items:[],total:0,unreadable:0}),changeServicePlan:async value=>{action=value;if(value.type==='select')plan={...plan,active:false};else{saved=value;plan={...value.plan,revision:plan.revision+1};}return[structuredClone(plan)];}},async({window,document,click,changed,select,text})=>{
  const button=name=>[...document.querySelectorAll('button')].find(element=>element.textContent===name);await click(button('Open'));
  await click(document.querySelector('[aria-label="Remove from service: Attached song"]'));assert.equal(document.querySelectorAll('.service-song-number').length,0);
  plan={...plan,playlist:{phase:'synced',message:'Playlist updated in ProPresenter.'}};await changed();assert.ok(lists>=2);assert.match(text(),/ProPresenter playlist ready/);assert.equal(document.querySelectorAll('.service-song-number').length,0);
  await select('');assert.deepEqual(action,{type:'select',id:null});assert.ok(document.querySelector('.service-editor'));assert.equal(saved.type,'save');assert.equal(saved.plan.revision,3);assert.deepEqual(saved.plan.songs,[]);assert.equal(saved.plan.tasks[0].done,true);assert.equal(saved.plan.notes,'Keep these notes');
 },{embedded:true});
});
test('computed playlist changes do not make an untouched draft dirty; stale-save errors retain user edits',async()=>{
 let plan={...fixture(),songs:[serviceSong]},saves=0;
 await ui('ServicePlans',{listServicePlans:async()=>[structuredClone(plan)],listServiceTemplates:async()=>[],searchSongLibrary:async()=>({items:[],total:0,unreadable:0}),changeServicePlan:async()=>{saves++;throw Error('This service changed. Reopen it before saving.');}},async({window,document,click,changed,act,text})=>{
  const button=name=>[...document.querySelectorAll('button')].find(element=>element.textContent===name);await click(button('Open'));
  plan={...plan,active:false,status:'Not started',playlist:{phase:'error',message:'ProPresenter is not responding.'}};await changed();assert.equal(button('Save'),undefined);assert.equal(button('Retry saving'),undefined);assert.equal(saves,0);
  await click(document.querySelector('[aria-label="Remove from service: Attached song"]'));
  await act(async()=>document.querySelector('.service-editor').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.match(text(),/This service changed/);assert.ok(document.querySelector('.service-editor'));assert.equal(document.querySelectorAll('.service-song-number').length,0);
  await changed();assert.match(text(),/This service changed/,'A status refresh must not clear the save error');
 },{embedded:true});
});

test('a slow service summary recovers as soon as the outstanding request succeeds', async context => {
 context.mock.timers.enable({apis: ['setInterval', 'setTimeout']});
 let finish;
 const pending = new Promise(resolve => { finish = resolve; });
 await ui('ServiceTarget', {listServicePlans: () => pending}, async ({act, text}) => {
  await act(async () => context.mock.timers.tick(8000));
  assert.match(text(), /taking too long/);
  await act(async () => finish([fixture()]));
  assert.doesNotMatch(text(), /taking too long/);
  assert.match(text(), /Waiting for ProPresenter/);
 });
});
