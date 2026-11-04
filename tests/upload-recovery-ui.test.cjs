const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('esbuild'),{parseHTML}=require('linkedom'),{createHash,randomUUID}=require('node:crypto');
const uid='11111111-1111-4111-8111-111111111111',pc='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444',token='local-recovery-token';
const now=()=>Math.floor(Date.now()/1000),file=(name='Local lyrics.txt')=>new File(['Inert local lyrics '+name],name,{type:'text/plain'});
const connection=deviceId=>({deviceId,name:deviceId===pc?'First computer':'Second computer',expiresAt:now()+3600,maxBytes:50*1024*1024,connection:{status:'approved'},approver:'operator',sendingAllowed:true,uploadProtocol:'stati-upload-v1'});

// Every application module, including upload-batch, upload-retry, hashing and
// receipt validation, is real. Only browser/transport/storage boundaries are local.
async function ui(kind,{computers=[pc],post,initialConnection='approved',requestedConnection='approved'}={},check){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),previous={};
 for(const key of ['window','document','navigator','fetch','localStorage','sessionStorage','XMLHttpRequest','IS_REACT_ACT_ENVIRONMENT'])previous[key]=Object.getOwnPropertyDescriptor(global,key);
 const saved=new Map(),storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
 Object.assign(global,{window,document:window.document,localStorage:storage,sessionStorage:storage,IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(global,'navigator',{configurable:true,value:window.navigator});window.localStorage=window.sessionStorage=storage;window.location=new URL('https://isolated.invalid/');document.oninput=null;Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 const calls=[],posts=[],accepted=new Map(),events=[];let connectionState=initialConnection;
 class LocalXHR{
  constructor(){this.upload={};this.headers={};this.aborted=false;this.status=0;this.responseText='';}
  open(method,url){this.method=method;this.url=url;const match=url.match(/^\/api\/receive\/([^/]+)\/uploads\/([^/]+)$/);assert.ok(match,'Only the resumable route may send bytes');this.target=match[1];this.intentId=match[2];this.deviceId=this.target.startsWith('device:')?this.target.slice(7):pc;}
  setRequestHeader(name,value){this.headers[name]=value;}
  send(selected){this.file=selected;posts.push(this);events.push({kind:'post',intentId:this.intentId,deviceId:this.deviceId});queueMicrotask(()=>{if(this.aborted)return;try{if(post)post(this,api);else api.reply(this,api.accept(this));}catch(error){api.failures.push(error);this.onerror?.();}});}
  abort(){this.aborted=true;this.onabort?.();}
 }
 const api={
  failures:[],
  accept(request){const key=request.deviceId+':'+request.intentId;let receipt=accepted.get(key);if(!receipt){receipt={protocol:'stati-upload-v1',intentId:request.intentId,id:randomUUID(),deviceId:request.deviceId,accepted:true,status:'queued',filename:decodeURIComponent(request.headers['X-Filename']),bytes:request.file.size,sha256:request.headers['X-Checksum-SHA256'],replayed:false};accepted.set(key,receipt);}return receipt;},
  reply(request,receipt,status=201){request.status=status;request.responseText=JSON.stringify(receipt);request.onload?.();},
  fail(request,status=409){this.reply(request,{error:'This local attempt needs another try.'},status);},
 };
 global.XMLHttpRequest=LocalXHR;
 global.fetch=async(url,init={})=>{
  const address=new URL(String(url),'https://isolated.invalid'),endpoint=address.pathname.replace(/^\/api/,''),call={endpoint,query:address.searchParams,method:init.method||'GET',signal:init.signal,credentials:init.credentials,cache:init.cache};calls.push(call);
  if(endpoint.startsWith('/uploads/')){const intentId=endpoint.slice('/uploads/'.length),deviceId=address.searchParams.get('deviceId');events.push({kind:'lookup',intentId,deviceId});assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');const receipt=accepted.get(deviceId+':'+intentId);return receipt?Response.json({...receipt,replayed:true}):Response.json({error:'Not accepted.'},{status:404});}
  if(endpoint==='/receivers')return Response.json(computers.map(deviceId=>({id:deviceId,name:connection(deviceId).name,expiresAt:now()+3600,online:1})));
  if(endpoint.startsWith('/receive/'))return Response.json({...connection(endpoint.includes('device:')?endpoint.split('device:')[1]:pc),connection:connectionState==='none'?null:{status:connectionState==='service-closed'?'approved':connectionState},sendingAllowed:connectionState!=='service-closed'});
  if(endpoint.startsWith('/connections/device:')&&call.method==='POST')connectionState=requestedConnection;
  if(endpoint.startsWith('/connections/'))return Response.json({ok:true});
  throw Error('Unexpected isolated API call '+endpoint);
 };
 const cache=new Map();function load(filename){filename=path.resolve(filename);if(cache.has(filename))return cache.get(filename).exports;const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));cache.set(filename,loaded);const original=loaded.require.bind(loaded);loaded.require=name=>{if(name.startsWith('.')){const base=path.resolve(path.dirname(filename),name),resolved=[base,base+'.ts',base+'.tsx',base+'.js'].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());if(resolved)return load(resolved);}return original(name);};loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{loader:filename.endsWith('.tsx')?'tsx':filename.endsWith('.ts')?'ts':'js',format:'cjs',jsx:'automatic'}).code,filename);return loaded.exports;}
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Component=load('src/web/'+kind+'.tsx')[kind],root=createRoot(document.getElementById('root'));
 const button=label=>[...document.querySelectorAll('button')].find(element=>element.textContent===label);
 const settle=async predicate=>{for(let count=0;count<80;count++){await act(async()=>{await new Promise(resolve=>setImmediate(resolve));});if(predicate())return;}assert.fail('Local UI did not settle: '+document.body.textContent);};
 const click=async label=>{const target=button(label);assert.ok(target,'Expected button '+label);assert.equal(target.disabled,false,'Enabled button '+label);await act(async()=>target.dispatchEvent(new window.Event('click',{bubbles:true})));};
 const choose=async(files,{connect=true}={})=>{if(kind==='ComputerSend'){await click('Select all');if(connect)await click('Use selected computers');}const input=document.querySelector('input[type="file"]');assert.ok(input);Object.defineProperty(input,'files',{configurable:true,value:files});await act(async()=>input.dispatchEvent(new window.Event('change',{bubbles:true})));};
 const send=()=>click(kind==='Receive'?'Send file':'Send to '+computers.length+' computer'+(computers.length===1?'':'s'));
 try{await act(async()=>root.render(React.createElement(Component,{userId:uid,token})));await check({act,document,window,calls,posts,accepted,events,button,settle,click,choose,send,failures:api.failures,text:()=>document.body.textContent});assert.deepEqual(api.failures,[]);}
 finally{await act(async()=>root.unmount());for(const [key,descriptor]of Object.entries(previous)){if(descriptor)Object.defineProperty(global,key,descriptor);else delete global[key];}}
}

for(const kind of ['Receive','ComputerSend'])test(kind+' recovers an accepted upload whose POST response was lost without sending its bytes again',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});
 await ui(kind,{post:(request,server)=>{server.accept(request);request.onerror();}},async({choose,send,settle,posts,accepted,calls,text})=>{
  const selected=file();await choose([selected]);await send();await settle(()=>/Queued for the computer|Sent · waiting for the computer/.test(text()));assert.equal(posts.length,1);assert.equal(accepted.size,1);assert.equal(posts[0].target,kind==='Receive'?token:'device:'+pc);
  const lookups=calls.filter(call=>call.endpoint.startsWith('/uploads/'));assert.equal(lookups.length,1);assert.equal(lookups[0].endpoint,'/uploads/'+posts[0].intentId);assert.equal(lookups[0].query.get('deviceId'),pc);assert.equal(posts[0].headers['X-Checksum-SHA256'],createHash('sha256').update(await selected.arrayBuffer().then(value=>Buffer.from(value))).digest('hex'));
 });
});

test('ComputerSend Retry remaining preserves the failed intent and skips accepted files across two computers',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let attempt=0;
 await ui('ComputerSend',{computers:[pc,other],post:(request,server)=>{if(++attempt===4)server.fail(request);else server.reply(request,server.accept(request));}},async({choose,send,settle,posts,accepted,click,button,text,document,events})=>{
  await choose([file('First.txt'),file('Second.txt')]);await send();await settle(()=>button('Retry remaining')?.disabled===false);assert.equal(posts.length,4);assert.equal(accepted.size,3);assert.equal(document.querySelectorAll('.upload-results li').length,4);assert.equal([...document.querySelectorAll('.upload-results li')].filter(row=>row.textContent.includes('Sent · waiting')).length,3);
  const failed=posts[3],previous=posts.slice(0,3).map(request=>request.intentId);await click('Retry remaining');await settle(()=>button('Send again')?.disabled===false);
  assert.equal(posts.length,5);assert.equal(accepted.size,4);assert.equal(posts[4].intentId,failed.intentId);assert.equal(posts[4].deviceId,failed.deviceId);assert.ok(posts.slice(4).every(request=>!previous.includes(request.intentId)));assert.equal([...document.querySelectorAll('.upload-results li')].filter(row=>row.textContent.includes('Sent · waiting')).length,4);
  const retryEvents=events.filter(event=>event.intentId===failed.intentId);assert.deepEqual(retryEvents.map(event=>event.kind),['post','lookup','post']);assert.match(text(),/Second.txt → Second computer/);
 });
});

for(const kind of ['Receive','ComputerSend'])test(kind+' Stop aborts locally and manual retry checks the original accepted send before attempting another POST',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});
 await ui(kind,{post:(request,server)=>{server.accept(request);/* The server committed, but its response never arrives. */}},async({choose,send,settle,posts,accepted,click,button,text,events})=>{
  await choose([file()]);await send();await settle(()=>posts.length===1&&button('Stop sending'));const original=posts[0];assert.equal(accepted.size,1);await click('Stop sending');await settle(()=>button(kind==='Receive'?'Retry send':'Retry remaining')?.disabled===false);assert.equal(original.aborted,true);assert.match(text(),/Sending stopped/);
  await click(kind==='Receive'?'Retry send':'Retry remaining');await settle(()=>/Queued for the computer|Sent · waiting for the computer/.test(text()));assert.equal(posts.length,1);assert.equal(accepted.size,1);assert.deepEqual(events.map(event=>event.kind),['post','lookup']);assert.equal(events[1].intentId,original.intentId);assert.equal(events[1].deviceId,original.deviceId);
 });
});

for(const kind of ['Receive','ComputerSend'])test(kind+' checks again after backoff and avoids resending when the interrupted request committed during the wait',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let commit;
 await ui(kind,{post:(request,server)=>{commit=()=>server.accept(request);request.onerror();}},async({choose,send,settle,posts,accepted,act,text,events})=>{
  await choose([file()]);await send();await settle(()=>/Connection interrupted\. Retrying/.test(text()));assert.equal(posts.length,1);assert.equal(accepted.size,0);assert.deepEqual(events.map(event=>event.kind),['post','lookup']);commit();
  await act(async()=>context.mock.timers.tick(8000));await settle(()=>/Queued for the computer|Sent · waiting for the computer/.test(text()));assert.equal(posts.length,1);assert.equal(accepted.size,1);assert.deepEqual(events.map(event=>event.kind),['post','lookup','lookup']);assert.ok(events.every(event=>event.intentId===posts[0].intentId));
 });
});

test('typed song requests preserve exact lyrics and use the existing checksummed upload protocol',async()=>{
 await ui('ComputerSend',{},async({window,document,act,click,send,settle,posts,text})=>{
  await click('Select all');await click('Use selected computers');await click('Song text');
  const title=document.querySelector('.send-text-fields input'),lyrics=document.querySelector('.send-text-fields textarea'),words='Strofă 1\nÎmpreună cântăm\nSlavă pentru Tine\n';
  for(const [input,value] of [[title,'../Song request'],[lyrics,words]]){const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set;setter.call(input,value);await act(async()=>input.dispatchEvent(new window.Event('input',{bubbles:true})));}
  await settle(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Send to 1 computer'&&!button.disabled));await send();await settle(()=>/Sent · waiting/.test(text()));
  assert.equal(posts.length,1);assert.equal(await posts[0].file.text(),words);assert.equal(posts[0].file.type,'text/plain');assert.ok(!posts[0].file.name.includes('/'));assert.ok(posts[0].file.name.endsWith('.txt'));
  assert.equal(posts[0].headers['X-Checksum-SHA256'],createHash('sha256').update(words).digest('hex'));
 });
});


test('one-screen send rechecks computer access and can complete an approved send with one action',async()=>{
 await ui('ComputerSend',{initialConnection:'none',requestedConnection:'approved'},async({choose,send,settle,posts,calls,text})=>{
  await choose([file()],{connect:false});assert.equal(posts.length,0);await send();await settle(()=>/Sent · waiting/.test(text()));
  assert.equal(posts.length,1);const requested=calls.findIndex(call=>call.endpoint.startsWith('/connections/device:')&&call.method==='POST');assert.ok(requested>=0);assert.ok(calls.slice(requested+1).some(call=>call.endpoint.startsWith('/receive/device:')));
 });
});
for(const status of ['pending','denied','service-closed'])test('one-screen send retains selected material without uploading when access is '+status,async()=>{
 await ui('ComputerSend',{initialConnection:'none',requestedConnection:status},async({choose,send,settle,posts,calls,document,text})=>{
  await choose([file()],{connect:false});await send();await settle(()=>status==='pending'?/Waiting for computer operator approval/.test(text()):status==='denied'?/Access denied/.test(text()):/Sending opens two hours before service/.test(text()));
  assert.equal(posts.length,0);assert.ok(document.querySelector('.choose-file').textContent.includes('Local lyrics.txt'));assert.equal(calls.filter(call=>call.endpoint.startsWith('/connections/device:')&&call.method==='POST').length,1);
 });
});
