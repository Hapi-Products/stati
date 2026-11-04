const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('esbuild'),{parseHTML}=require('linkedom');
const pcA='11111111-1111-4111-8111-111111111111',pcB='22222222-2222-4222-8222-222222222222';
const info=(deviceId,status='approved')=>({deviceId,name:'Isolated computer',expiresAt:Math.floor(Date.now()/1000)+3600,maxBytes:50*1024*1024,connection:{status},approver:'operator',sendingAllowed:true,uploadProtocol:'stati-upload-v1'});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function modules(){
 const cache=new Map();function load(filename){filename=path.resolve(filename);if(cache.has(filename))return cache.get(filename).exports;
  const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));cache.set(filename,loaded);
  const original=loaded.require.bind(loaded);loaded.require=name=>{if(name.startsWith('.')){const base=path.resolve(path.dirname(filename),name),resolved=[base,base+'.ts',base+'.tsx',base+'.js'].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());if(resolved)return load(resolved);}return original(name);};
  loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{loader:filename.endsWith('.tsx')?'tsx':filename.endsWith('.ts')?'ts':'js',format:'cjs',jsx:'automatic'}).code,filename);return loaded.exports;
 }return load;
}
async function ui(component,handler,check,props={}){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),previous={window:global.window,document:global.document,navigator:global.navigator,act:global.IS_REACT_ACT_ENVIRONMENT,fetch:global.fetch,localStorage:global.localStorage};
 global.window=window;global.document=window.document;Object.defineProperty(global,'navigator',{configurable:true,value:window.navigator});global.IS_REACT_ACT_ENVIRONMENT=true;
 const storage=new Map();global.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
 window.location=new URL('http://127.0.0.1/');Object.defineProperty(window.document,'visibilityState',{configurable:true,value:'visible'});window.document.oninput=null;
 const calls=[];global.fetch=async(url,init={})=>{const call={path:String(url).replace(/^\/api/,''),method:init.method||'GET',body:init.body?JSON.parse(init.body):undefined,signal:init.signal};calls.push(call);const answer=await handler(call);return answer instanceof Response?answer:new Response(JSON.stringify(answer),{headers:{'Content-Type':'application/json'}});};
 const load=modules(),React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),root=createRoot(window.document.getElementById('root'));
 const Component=component==='Hook'?({ids})=>{load('src/web/useConnectionPresence.ts').useConnectionPresence(ids);return null;}:load('src/web/'+component+'.tsx')[component];
 const render=async next=>{await act(async()=>root.render(React.createElement(Component,{...props,...next})));};
 const click=async label=>{const element=[...window.document.querySelectorAll('button')].find(button=>button.textContent===label);assert.ok(element,label);assert.equal(element.disabled,false,label);await act(async()=>element.dispatchEvent(new window.Event('click',{bubbles:true})));};
 const visibility=async value=>{Object.defineProperty(window.document,'visibilityState',{configurable:true,value});await act(async()=>window.document.dispatchEvent(new window.Event('visibilitychange')));};
 const presence=()=>calls.filter(call=>call.path==='/connections/presence');
 const unmount=async()=>act(async()=>root.render(null));
 try{await render();await check({calls,presence,render,click,visibility,unmount,act,window,document:window.document});}
 finally{await act(async()=>root.unmount());global.window=previous.window;global.document=previous.document;Object.defineProperty(global,'navigator',{configurable:true,value:previous.navigator});global.IS_REACT_ACT_ENVIRONMENT=previous.act;global.fetch=previous.fetch;global.localStorage=previous.localStorage;}
}

test('presence renews only its visible scope, batches at 100 IDs and never clears another tab',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});
 await ui('Hook',async()=>({ok:true,renewed:1}),async({presence,render,visibility,act,unmount})=>{
  assert.equal(presence().length,0);await render({ids:[pcB,pcA,pcA,'not-a-uuid']});assert.deepEqual(presence().at(-1).body,{deviceIds:[pcA,pcB]});
  const started=presence().length;await render({ids:[pcA,pcB]});assert.equal(presence().length,started,'Reordering identical scope must not create another heartbeat');
  await visibility('hidden');assert.ok(presence().at(-1).signal.aborted===false,'A completed request needs no cancellation');await act(async()=>context.mock.timers.tick(45000));assert.equal(presence().length,started);
  await visibility('visible');assert.equal(presence().length,started+1);await render({ids:[]});const stopped=presence().length;await act(async()=>context.mock.timers.tick(45000));assert.equal(presence().length,stopped);
  const many=Array.from({length:201},(_,n)=>`${String(n+1).padStart(8,'0')}-1111-4111-8111-111111111111`);await render({ids:many});const batches=presence().slice(stopped);assert.deepEqual(batches.map(call=>call.body.deviceIds.length),[100,100,1]);
  await unmount();await act(async()=>context.mock.timers.tick(45000));assert.equal(presence().length,stopped+3);
  assert.ok(presence().every(call=>call.method==='POST'&&call.body.deviceIds.length>0));
 },{ids:[]});
});

test('a pending presence request is not duplicated; hiding/scope changes abort it and ignore its late completion',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});const pending=deferred();let requests=0;
 await ui('Hook',async call=>{if(call.path==='/connections/presence'&&++requests===1)return pending.promise;return{ok:true,renewed:1};},async({presence,render,visibility,act})=>{
  assert.equal(presence().length,1);await render({ids:[pcA]});assert.equal(presence().length,1);
  await act(async()=>context.mock.timers.tick(7000));assert.equal(presence().length,1);
  await visibility('hidden');assert.equal(presence()[0].signal.aborted,true);await render({ids:[pcB]});assert.equal(presence().length,1);
  await visibility('visible');assert.equal(presence().length,2);assert.deepEqual(presence()[1].body.deviceIds,[pcB]);
  await act(async()=>pending.resolve({ok:true,renewed:1}));await act(async()=>context.mock.timers.tick(20000));assert.equal(presence().length,3);assert.deepEqual(presence()[2].body.deviceIds,[pcB]);
 },{ids:[pcA]});
});

test('presence has a bounded timeout and retries transient failure, while terminal authorization stops its job',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let attempts=0;
 await ui('Hook',async()=>{attempts++;if(attempts===1)return new Promise(()=>{});if(attempts===2)return new Response(JSON.stringify({error:'Removed'}),{status:403});return{ok:true,renewed:1};},async({presence,act,visibility})=>{
  await act(async()=>context.mock.timers.tick(8000));assert.equal(presence()[0].signal.aborted,true);
  await act(async()=>context.mock.timers.tick(20000));assert.equal(attempts,2);
  await act(async()=>context.mock.timers.tick(45000));await visibility('hidden');await visibility('visible');assert.equal(attempts,2);
 },{ids:[pcA]});
});

test('ComputerSend keeps choosing private, then renews only approved continued recipients and stops while changing destinations',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let statusB='pending';
 await ui('ComputerSend',async call=>{if(call.path==='/receivers')return[{id:pcA,name:'Computer A',expiresAt:info(pcA).expiresAt,online:1},{id:pcB,name:'Computer B',expiresAt:info(pcB).expiresAt,online:1}];if(call.path.startsWith('/receive/device:'))return info(call.path.slice(16),call.path.endsWith(pcB)?statusB:'approved');if(call.path.startsWith('/connections/device:')||call.path==='/connections/presence')return{ok:true,renewed:1};throw Error('Unexpected isolated request: '+call.path);},async({presence,click,act,document})=>{
  assert.equal(presence().length,0);await click('Select all');assert.equal(presence().length,0);await click('Use selected computers');assert.deepEqual(presence().at(-1).body.deviceIds,[pcA]);
  assert.match(document.body.textContent,/Waiting for computer operator approval/);statusB='approved';await act(async()=>context.mock.timers.tick(10000));assert.deepEqual(presence().at(-1).body.deviceIds,[pcA,pcB]);
  const destinations=document.querySelector('.send-destination');destinations.open=true;await act(async()=>destinations.dispatchEvent(new document.defaultView.Event('toggle')));const stopped=presence().length;await act(async()=>context.mock.timers.tick(30000));assert.equal(presence().length,stopped);
 },{userId:'isolated-user'});
});

test('ComputerSend drops revoked/closed/offline recipients and does not recreate uploads while status polls update',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let connection='approved',online=1;
 await ui('ComputerSend',async call=>{if(call.path==='/receivers')return[{id:pcA,name:'Computer A',expiresAt:info(pcA).expiresAt,online},{id:pcB,name:'Offline computer',expiresAt:info(pcB).expiresAt,online:0}];if(call.path.startsWith('/receive/device:'))return info(call.path.slice(16),connection);return{ok:true,renewed:1};},async({presence,click,act,calls})=>{
  await click('Select all');await click('Use selected computers');assert.deepEqual(presence().at(-1).body.deviceIds,[pcA]);
  connection='denied';await act(async()=>context.mock.timers.tick(10000));const stopped=presence().length;await act(async()=>context.mock.timers.tick(10000));assert.equal(presence().length,stopped);
  online=0;await act(async()=>context.mock.timers.tick(20000));assert.equal(presence().length,stopped);connection='approved';await act(async()=>context.mock.timers.tick(10000));assert.equal(presence().length,stopped);
  assert.equal(calls.filter(call=>call.path.startsWith('/upload')||call.method==='PUT').length,0);
 },{userId:'isolated-user'});
});

test('Receive renews only its resolved approved computer, pauses hidden and rejects stale token/status responses',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let status='approved',gate=null;
 await ui('Receive',async call=>{if(call.path==='/connections/presence')return{ok:true,renewed:1};if(gate)return gate.promise;return info(call.path.endsWith('second')?pcB:pcA,status);},async({presence,render,visibility,act})=>{
  assert.deepEqual(presence().at(-1).body.deviceIds,[pcA]);await visibility('hidden');const stopped=presence().length;await act(async()=>context.mock.timers.tick(45000));assert.equal(presence().length,stopped);
  await visibility('visible');assert.equal(presence().length,stopped+1);status='denied';await act(async()=>context.mock.timers.tick(5000));const denied=presence().length;await act(async()=>context.mock.timers.tick(10000));assert.equal(presence().length,denied);
  gate=deferred();await render({token:'second'});assert.equal(presence().length,denied);const pending=gate;gate=null;status='approved';await visibility('hidden');await visibility('visible');assert.deepEqual(presence().at(-1).body.deviceIds,[pcB]);
  await act(async()=>pending.resolve(info(pcA)));assert.deepEqual(presence().at(-1).body.deviceIds,[pcB]);
 },{token:'first'});
});

test('a timed-out destination connection cannot duplicate connection jobs or open a stale sending workspace',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});const pending=deferred();let posts=0;
 await ui('ComputerSend',async call=>{
  if(call.path==='/receivers')return[{id:pcA,name:'Computer A',expiresAt:info(pcA).expiresAt,online:1}];
  if(call.path.startsWith('/receive/'))return info(pcA);
  if(call.path.startsWith('/connections/device:')){posts++;return posts===1?pending.promise:{ok:true};}
  return{ok:true,renewed:1};
 },async({click,presence,act,calls,document})=>{
  await click('Select all');await click('Use selected computers');assert.equal(posts,1);assert.equal(presence().length,0);
  const button=[...document.querySelectorAll('button')].find(element=>element.textContent==='Use selected computers');await act(async()=>button.dispatchEvent(new document.defaultView.Event('click',{bubbles:true})));assert.equal(posts,1);
  await act(async()=>context.mock.timers.tick(8000));assert.equal(button.disabled,false);const checks=calls.filter(call=>call.path.startsWith('/receive/')).length;
  await act(async()=>pending.resolve({ok:true}));assert.equal(calls.filter(call=>call.path.startsWith('/receive/')).length,checks);assert.equal(presence().length,0);assert.match(document.body.textContent,/Send a file/);
  await click('Use selected computers');assert.equal(posts,2);assert.deepEqual(presence().at(-1).body.deviceIds,[pcA]);
 },{userId:'isolated-user'});
});

test('Receive access requests are single, abort on hide and cannot revive a subsequently denied scope',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});const pending=deferred();let status='none';
 await ui('Receive',async call=>call.method==='POST'?pending.promise:info(pcA,status),async({click,calls,presence,visibility,act})=>{
  await click('Request access');await click('Request access');const request=calls.find(call=>call.method==='POST');assert.ok(request);assert.equal(calls.filter(call=>call.method==='POST').length,1);
  await visibility('hidden');assert.equal(request.signal.aborted,true);const before=calls.length;status='denied';await act(async()=>pending.resolve({ok:true}));assert.equal(calls.length,before);assert.equal(presence().length,0);
  await visibility('visible');await act(async()=>context.mock.timers.tick(10000));assert.equal(presence().length,0);
 },{token:'isolated-token'});
});

test('Account and Team cannot mount an account-wide presence heartbeat',()=>{
 const source=fs.readFileSync(path.resolve('src/web/main.tsx'),'utf8');assert.doesNotMatch(source,/connections\/presence/);
});

test('pending connection requests poll at 15 seconds, pause hidden and discard an old response after returning',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});const pending=deferred();let requests=0;
 await ui('ConnectionRequests',async call=>{
  assert.equal(call.path,'/connections/pending');requests++;return requests===2?pending.promise:[{id:pcA,first_name:requests===1?'Initial':'Current',last_initial:'T',computerName:'Isolated computer'}];
 },async({calls,act,visibility,document})=>{
  assert.equal(requests,1);assert.match(document.body.textContent,/Initial/);await act(async()=>context.mock.timers.tick(14999));assert.equal(requests,1);
  await act(async()=>context.mock.timers.tick(1));assert.equal(requests,2);await visibility('hidden');assert.equal(calls[1].signal.aborted,true);
  await act(async()=>context.mock.timers.tick(60000));assert.equal(requests,2);await visibility('visible');assert.equal(requests,3);assert.match(document.body.textContent,/Current/);
  await act(async()=>pending.resolve([{id:pcA,first_name:'Stale',last_initial:'T',computerName:'Earlier computer'}]));assert.match(document.body.textContent,/Current/);assert.doesNotMatch(document.body.textContent,/Stale/);
 });
});
