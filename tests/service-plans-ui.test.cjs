const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('esbuild'),{parseHTML}=require('linkedom');
function component(relative){const filename=path.resolve(__dirname,'..',relative),loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));const original=loaded.require.bind(loaded);loaded.require=name=>{if(name.endsWith('.css'))return{};if(name.startsWith('.')){const base=path.resolve(path.dirname(filename),name),file=[base+'.tsx',base+'.ts'].find(file=>fs.existsSync(file));if(file)return component(path.relative(path.resolve(__dirname,'..'),file));}return original(name);};loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{loader:filename.endsWith('.tsx')?'tsx':'ts',format:'cjs',jsx:'automatic'}).code,filename);return loaded.exports;}
const song=index=>({id:'song-appearance-identifier-'+index,songId:String(index).repeat(64),contentHash:'a'.repeat(64),title:'Song '+index,filename:index+'.pro',reviewed:false});
const fixture=()=>({id:'11111111-1111-4111-8111-111111111111',revision:1,title:'Tuesday worship',date:'2026-10-27',time:'21:00',notes:'Keep these notes',reviewed:false,archived:false,active:true,songs:[song(1),song(2)],tasks:[{id:'legacy-checklist-identifier',text:'Preserved old checklist',done:true}]});
async function ui(bridge,check,props={}){const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),old={window:global.window,document:global.document,navigator:global.navigator,act:global.IS_REACT_ACT_ENVIRONMENT};global.window=window;global.document=window.document;Object.defineProperty(global,'navigator',{configurable:true,value:window.navigator});global.IS_REACT_ACT_ENVIRONMENT=true;window.location=new URL('http://127.0.0.1/');window.document.oninput=null;window.stati={listServiceTemplates:async()=>[],searchSongLibrary:async()=>({items:[],total:0,unreadable:0}),...bridge};const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),root=createRoot(window.document.getElementById('root')),Component=component('src/desktop/ServicePlans.tsx').ServicePlans;
 const click=async element=>{assert.ok(element,'Expected control');assert.equal(element.disabled,false);await act(async()=>element.dispatchEvent(new window.Event('click',{bubbles:true})));};
 const button=name=>[...window.document.querySelectorAll('button')].find(element=>element.textContent===name);const submit=async()=>act(async()=>window.document.querySelector('.service-editor').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
 try{await act(async()=>root.render(React.createElement(Component,{embedded:true,disabled:false,...props})));await check({window,document:window.document,act,click,button,submit,text:()=>window.document.body.textContent});}finally{await act(async()=>root.unmount());global.window=old.window;global.document=old.document;Object.defineProperty(global,'navigator',{configurable:true,value:old.navigator});global.IS_REACT_ACT_ENVIRONMENT=old.act;}}
test('compact service editor automatically saves order and preserves hidden legacy fields',async context=>{context.mock.timers.enable({apis:['setTimeout','setInterval']});let plan=fixture(),saved;await ui({listServicePlans:async()=>[structuredClone(plan)],changeServicePlan:async action=>{saved=structuredClone(action);plan={...action.plan,revision:plan.revision+1};return[structuredClone(plan)];}},async({document,act,click,button,text})=>{await click(button('Open'));assert.doesNotMatch(text(),/Reviewed and ready|Add item|Check files|Checklist:/);assert.equal(document.querySelectorAll('.service-song-number').length,2);await click(document.querySelector('[aria-label="Move later: Song 1"]'));assert.equal(saved,undefined);await act(async()=>context.mock.timers.tick(450));assert.equal(saved.type,'save');assert.deepEqual(saved.plan.songs.map(song=>song.title),['Song 2','Song 1']);assert.equal(saved.plan.tasks[0].text,'Preserved old checklist');assert.equal(saved.plan.notes,'Keep these notes');assert.match(text(),/Saved automatically/);assert.equal(button('Save'),undefined);assert.equal(button('Retry saving'),undefined);});});
test('failed autosave retains changes and exposes a retry only after failure',async context=>{context.mock.timers.enable({apis:['setTimeout','setInterval']});let plan=fixture(),fail=true,saves=0;await ui({listServicePlans:async()=>[structuredClone(plan)],changeServicePlan:async action=>{saves++;if(fail)throw Error('The computer could not save this service.');plan={...action.plan,revision:2};return[structuredClone(plan)];}},async({document,act,click,button,submit,text})=>{await click(button('Open'));await click(document.querySelector('[aria-label="Remove from service: Song 1"]'));await act(async()=>context.mock.timers.tick(450));assert.equal(saves,1);assert.match(text(),/could not save/);assert.equal(button('Retry saving').disabled,false);await act(async()=>context.mock.timers.tick(3000));assert.equal(saves,1,'A failed draft must not retry endlessly');fail=false;await submit();assert.equal(saves,2);assert.deepEqual(plan.songs.map(song=>song.title),['Song 2']);assert.match(text(),/Saved automatically/);});});
test('changes made while an autosave is in flight use its new revision in the following save',async context=>{context.mock.timers.enable({apis:['setTimeout','setInterval']});let plan=fixture(),finish,calls=[];await ui({listServicePlans:async()=>[structuredClone(plan)],changeServicePlan:async action=>{calls.push(structuredClone(action));if(calls.length===1)await new Promise(resolve=>finish=resolve);assert.equal(action.plan.revision,plan.revision);plan={...action.plan,revision:plan.revision+1};return[structuredClone(plan)];}},async({document,act,click,button,text})=>{await click(button('Open'));await click(document.querySelector('[aria-label="Move later: Song 1"]'));await act(async()=>context.mock.timers.tick(450));assert.equal(calls.length,1);await click(document.querySelector('[aria-label="Remove from service: Song 1"]'));await act(async()=>finish());await act(async()=>context.mock.timers.tick(450));assert.equal(calls.length,2);assert.equal(calls[1].plan.revision,2);assert.deepEqual(plan.songs.map(song=>song.title),['Song 2']);assert.match(text(),/Saved automatically/);});});
test('view-only service browsing has no create, edit or reorder actions',async()=>{const plan=fixture();await ui({listServicePlans:async()=>[plan]},async({document,click,button,text})=>{assert.equal(button('Create service'),undefined);await click(button('Open'));assert.equal(document.querySelector('.service-song-actions'),null);assert.equal(button('Save'),undefined);assert.equal(document.querySelector('.service-song-search'),null);assert.match(text(),/View only/);assert.ok([...document.querySelectorAll('.service-date-fields input')].every(input=>input.disabled));},{readOnly:true});});
test('before-leave hook flushes a pending edit before changing computer and reports failed saves',async context=>{context.mock.timers.enable({apis:['setTimeout','setInterval']});let plan=fixture(),leave,fail=false,saves=0;await ui({listServicePlans:async()=>[structuredClone(plan)],changeServicePlan:async action=>{saves++;if(fail)throw Error('Do not leave: service could not be saved.');plan={...action.plan,revision:plan.revision+1};return[structuredClone(plan)];}},async({document,act,click,button,text})=>{await click(button('Open'));await click(document.querySelector('[aria-label="Move later: Song 1"]'));assert.equal(saves,0);assert.equal(typeof leave,'function');let allowed;await act(async()=>{allowed=await leave();});assert.equal(allowed,true);assert.equal(saves,1);assert.deepEqual(plan.songs.map(song=>song.title),['Song 2','Song 1']);fail=true;await click(document.querySelector('[aria-label="Remove from service: Song 1"]'));await act(async()=>{allowed=await leave();});assert.equal(allowed,false);assert.match(text(),/Do not leave/);assert.ok(document.querySelector('.service-editor'));},{registerBeforeLeave:callback=>leave=callback});});
test('approval flushes the visible draft and cannot approve after a conflicting service save',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});const plan=fixture();let approvals=0,saves=0;await ui({listServicePlans:async()=>[structuredClone(plan)],listServiceVersions:async()=>({versions:[],latestApproved:null,snapshot:null,current:{plan,lyrics:[]},canApprove:true}),saveServiceVersion:async()=>{approvals++;throw Error('Must not approve an unsaved draft');},changeServicePlan:async()=>{saves++;throw Error('This service changed on another computer. Your draft was kept.');}},async({document,click,button,text})=>{await click(button('Open'));await click(document.querySelector('[aria-label="Move later: Song 1"]'));await click(button('Save history copy'));assert.equal(saves,1);assert.equal(approvals,0);assert.deepEqual([...document.querySelectorAll('[data-service-song] .service-song-row > strong')].map(element=>element.textContent),['Song 2','Song 1']);assert.match(text(),/conflicting draft is still open/);assert.equal(button('Retry saving').disabled,false);assert.deepEqual(plan.songs.map(song=>song.title),['Song 1','Song 2']);});
});
const leadership=(overrides={})=>({leaderId:'another-user',leaderLabel:'Leader T.',revision:2,isLeader:false,canClaim:false,canTakeOver:true,canEdit:false,canAcknowledge:false,finalizedRevision:null,finalizedAt:null,acknowledgedRevision:null,acknowledgedAt:null,acknowledgedByLabel:null,...overrides});
test('an assigned order stays view-only until an authorized backup explicitly takes over',async()=>{
 let plan={...fixture(),leadership:leadership()},received;
 await ui({listServicePlans:async()=>[structuredClone(plan)],changeServicePlan:async action=>{received=action;plan={...plan,leadership:leadership({leaderId:'current-user',leaderLabel:'Backup T.',revision:3,isLeader:true,canTakeOver:false,canEdit:true})};return[structuredClone(plan)];}},async({document,click,button,text})=>{
  await click(button('Open'));assert.equal(document.querySelector('.service-song-actions'),null);assert.match(text(),/Service leader: Leader T\./);
  await click(button('Take over'));assert.deepEqual(received,{type:'claim-leadership',id:plan.id,expectedRevision:1,expectedLeadershipRevision:2,takeOver:true});
  assert.ok(document.querySelector('.service-song-actions'));assert.match(text(),/You are leading/);
 });
});
test('a pastor leading one service can edit that order while global service creation stays hidden',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let plan={...fixture(),leadership:leadership({leaderId:'pastor-user',isLeader:true,canTakeOver:false,canEdit:true})},received;
 await ui({listServicePlans:async()=>[structuredClone(plan)],changeServicePlan:async action=>{received=action;plan={...action.plan,revision:2};return[structuredClone(plan)];}},async({document,act,click,button})=>{
  assert.equal(button('Create service'),undefined);await click(button('Open'));assert.ok(document.querySelector('.service-song-actions'));
  await click(document.querySelector('[aria-label="Move later: Song 1"]'));await act(async()=>context.mock.timers.tick(450));assert.equal(received.type,'save');assert.deepEqual(received.plan.songs.map(song=>song.title),['Song 2','Song 1']);
 },{readOnly:true});
});
test('finalizing flushes pending song-order changes and uses the returned saved revision',async()=>{
 let plan={...fixture(),leadership:leadership({isLeader:true,canTakeOver:false,canEdit:true})},actions=[];
 await ui({listServicePlans:async()=>[structuredClone(plan)],changeServicePlan:async action=>{actions.push(structuredClone(action));plan=action.type==='save'?{...action.plan,revision:2}:{...plan,leadership:{...plan.leadership,revision:3,finalizedRevision:plan.revision}};return[structuredClone(plan)];}},async({document,click,button,text})=>{
  await click(button('Open'));await click(document.querySelector('[aria-label="Move later: Song 1"]'));await click(button('Finalize running order'));
  assert.equal(actions[0].type,'save');assert.equal(actions[1].type,'finalize-order');assert.equal(actions[1].expectedRevision,2);assert.equal(actions[1].expectedLeadershipRevision,2);assert.match(text(),/Running order finalized/);
 });
});
test('service schedule validation rejects partial or impossible dates and invalid times without timezone conversion',()=>{
 const {validServiceSchedule}=component('src/desktop/ServicePlans.tsx');for(const [date,time]of [['2026-10-27','09:25'],['2028-02-29','00:00'],['2026-11-01','23:59']])assert.equal(validServiceSchedule(date,time),true);for(const [date,time]of [['','10:00'],['2026-2-2','10:00'],['2026-02-30','10:00'],['2027-02-29','10:00'],['2026-10-27',''],['2026-10-27','24:00'],['2026-10-27','09:2'],['2026-10-27','9:25']])assert.equal(validServiceSchedule(date,time),false,date+' '+time);
});
test('native date and time inputs retain partial edits locally and autosave only a complete valid schedule',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let plan=fixture(),saves=[];await ui({listServicePlans:async()=>[structuredClone(plan)],changeServicePlan:async action=>{saves.push(structuredClone(action));plan={...action.plan,revision:plan.revision+1};return[structuredClone(plan)];}},async({window,document,act,click,button,submit,text})=>{
  await click(button('Open'));const edit=async(selector,value)=>{const input=document.querySelector(selector),setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(input,value);await act(async()=>input.dispatchEvent(new window.Event('input',{bubbles:true})));};
  const date=document.querySelector('.service-editor input[type=date]'),time=document.querySelector('.service-editor input[type=time]');assert.equal(date.getAttribute('min'),'0001-01-01');assert.equal(date.getAttribute('max'),'9999-12-31');assert.equal(time.getAttribute('step'),'60');
  await edit('.service-editor input[type=date]','2026-02-30');await act(async()=>context.mock.timers.tick(450));assert.equal(saves.length,0);assert.equal(date.value,'2026-02-30');assert.match(text(),/Complete the date and time to save/);await submit();assert.match(text(),/complete calendar date/);assert.equal(saves.length,0);
  await edit('.service-editor input[type=date]','2026-11-01');await edit('.service-editor input[type=time]','18:4');await act(async()=>context.mock.timers.tick(450));assert.equal(saves.length,0);
  await edit('.service-editor input[type=time]','18:45');await act(async()=>context.mock.timers.tick(450));assert.equal(saves.length,1);assert.equal(saves[0].plan.date,'2026-11-01');assert.equal(saves[0].plan.time,'18:45');assert.equal(button('Save'),undefined);assert.equal(button('Retry saving'),undefined);
 });
});
test('new service uses a complete local date and rejects invalid calendar values before calling the bridge',async()=>{
 let calls=0;await ui({listServicePlans:async()=>[],changeServicePlan:async()=>{calls++;return[];}},async({window,document,act,text})=>{const form=document.querySelector('.service-create'),date=form.querySelector('input[type=date]');assert.match(date.value,/^\d{4}-\d{2}-\d{2}$/);assert.equal(form.closest('details').hasAttribute('open'),false);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(date,'2026-02-30');await act(async()=>date.dispatchEvent(new window.Event('input',{bubbles:true})));await act(async()=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(calls,0);assert.match(text(),/complete calendar date/);});
});

test('an unavailable templates read does not block opening or creating shared services', async () => {
 const original = fixture();
 const created = {...fixture(), id: '22222222-2222-4222-8222-222222222222', title: 'New worship service', active: true};
 let templatesFailed;
 const unavailable = new Promise((_resolve, reject) => { templatesFailed = reject; });
 let request, plans = [original];
 await ui({
  listServicePlans: async () => plans,
  listServiceTemplates: () => unavailable,
  changeServicePlan: async action => {
   request = action;
   plans = [{...original, active: false}, created];
   return plans;
  },
 }, async ({window, document, act, click, button, text}) => {
  await click(button('Open'));
  assert.match(text(), /Tuesday worship/);
  await click(document.querySelector('[aria-label="Close service"]'));
  await act(async () => templatesFailed(Error('Templates offline')));

  const form = document.querySelector('.service-create');
  const title = form.querySelector('input[type=text], input:not([type])');
  const value = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
   value.call(title, created.title);
   title.dispatchEvent(new window.Event('input', {bubbles: true}));
  });
  await act(async () => form.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true})));
  assert.equal(request.type, 'create');
  assert.equal(request.title, created.title);
  assert.equal(document.querySelector('.service-editor h3')?.textContent, created.title);
 });
});
