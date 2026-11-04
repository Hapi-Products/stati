const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('esbuild'),{parseHTML}=require('linkedom');
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',pc='33333333-3333-4333-8333-333333333333';
const uuid=n=>`${String(n).padStart(8,'0')}-4444-4444-8444-444444444444`,now=()=>Math.floor(Date.now()/1000);
const row=(n,status='queued',extra={})=>({id:uuid(n),filename:'Local song '+n+'.txt',computer_name:'Local test computer',status,rejection_reason:null,created_at:now()-1800,updated_at:now()-1500,dismissed_at:null,...extra});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const connection=()=>({deviceId:pc,name:'Local test computer',expiresAt:now()+3600,maxBytes:50*1024*1024,connection:{status:'approved'},approver:'operator',sendingAllowed:true,uploadProtocol:'stati-upload-v1'});
async function ui(kind,handler,check,{storage=new Map(),userId=uid}={}){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),previous={window:global.window,document:global.document,navigator:global.navigator,act:global.IS_REACT_ACT_ENVIRONMENT,fetch:global.fetch,localStorage:global.localStorage};
 global.window=window;global.document=window.document;Object.defineProperty(global,'navigator',{configurable:true,value:window.navigator});global.IS_REACT_ACT_ENVIRONMENT=true;
 const local={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};global.localStorage=window.localStorage=local;window.sessionStorage={getItem:()=>null,setItem:()=>{}};
 window.location=new URL('http://127.0.0.1/');Object.defineProperty(window.document,'visibilityState',{configurable:true,value:'visible'});window.document.oninput=null;
 const calls=[],uploads=[];let nextIntent=8000;
 global.fetch=async(url,init={})=>{const call={path:String(url).replace(/^\/api/,''),method:init.method||'GET',body:init.body?JSON.parse(init.body):undefined,signal:init.signal};calls.push(call);const value=await handler(call);return value&&typeof value.json==='function'?value:Response.json(value);};
 const cache=new Map();function load(filename){filename=path.resolve(filename);if(cache.has(filename))return cache.get(filename).exports;const loaded=new Module(filename,module);cache.set(filename,loaded);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));const original=loaded.require.bind(loaded);
  loaded.require=name=>{if(name==='./upload-retry'&&filename.endsWith('upload-batch.ts'))return{createUploadIntent:(originalFile,deviceId)=>Object.freeze({originalFile,deviceId,intentId:uuid(++nextIntent),createdAt:Date.now()}),uploadWithRetry:async(target,intent)=>{const receipt=Object.freeze({protocol:'stati-upload-v1',intentId:intent.intentId,id:uuid(nextIntent+10000),deviceId:intent.deviceId,accepted:true,status:'queued',filename:intent.originalFile.name,bytes:intent.originalFile.size,sha256:'a'.repeat(64),replayed:false});uploads.push({target,intent,receipt});return receipt;}};
   if(name.startsWith('.')){const base=path.resolve(path.dirname(filename),name),resolved=[base,base+'.ts',base+'.tsx',base+'.js'].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());if(resolved)return load(resolved);}return original(name);};
  loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{loader:filename.endsWith('.tsx')?'tsx':filename.endsWith('.ts')?'ts':'js',format:'cjs',jsx:'automatic'}).code,filename);return loaded.exports;
 }
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),DeliveryStatus=load('src/web/DeliveryStatus.tsx').DeliveryStatus,Sender=kind==='Receive'?load('src/web/Receive.tsx').Receive:kind==='ComputerSend'?load('src/web/ComputerSend.tsx').ComputerSend:null,root=createRoot(window.document.getElementById('root'));
 const render=async(id=userId)=>{await act(async()=>root.render(React.createElement(React.Fragment,null,Sender&&React.createElement(Sender,{key:'sender:'+id,userId:id,token:'local-token'}),React.createElement(DeliveryStatus,{key:'status:'+id,userId:id}))));};
 const unmount=async()=>act(async()=>root.render(null));
 const click=async name=>{const element=[...document.querySelectorAll('button')].find(button=>button.textContent===name);assert.ok(element,name);assert.equal(element.disabled,false,name);await act(async()=>element.dispatchEvent(new window.Event('click',{bubbles:true})));};
 const choose=async()=>{if(kind==='ComputerSend'){await click('Select all');await click('Use selected computers');}const input=document.querySelector('input[type="file"]');Object.defineProperty(input,'files',{configurable:true,value:[new File(['isolated local lyrics'],'Selected lyrics.txt')]});await act(async()=>input.dispatchEvent(new window.Event('change',{bubbles:true})));await click(kind==='Receive'?'Send file':'Send to 1 computer');assert.equal(uploads.length,1);return uploads[0];};
 const visibility=async value=>{Object.defineProperty(document,'visibilityState',{configurable:true,value});await act(async()=>document.dispatchEvent(new window.Event('visibilitychange')));};
 try{await render();await check({calls,uploads,storage,render,unmount,click,choose,visibility,act,window,document,text:()=>document.body.textContent,modal:()=>document.querySelector('[role="alertdialog"]')});}
 finally{await act(async()=>root.unmount());global.window=previous.window;global.document=previous.document;Object.defineProperty(global,'navigator',{configurable:true,value:previous.navigator});global.IS_REACT_ACT_ENVIRONMENT=previous.act;global.fetch=previous.fetch;global.localStorage=previous.localStorage;}
}
const tick=async(context,act,ms=15000)=>act(async()=>context.mock.timers.tick(ms));
function handlerFor(getRecords,extra=()=>undefined){return async call=>{const result=extra(call);if(result!==undefined)return result;if(call.path==='/transfers')return getRecords();if(call.path==='/receivers')return[{id:pc,name:'Local test computer',expiresAt:now()+3600,online:1}];if(call.path.startsWith('/receive/'))return connection();return{ok:true};};}

test('unseen saved outcomes older than 20 minutes alert once and dismissal preserves the file card',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let records=[row(1,'delivered')];
 await ui(null,handlerFor(()=>records),async({modal,click,document,act,calls,storage})=>{
  assert.match(modal().textContent,/File saved/);await click('OK');assert.equal(modal(),null);assert.equal(document.querySelectorAll('.delivery-status-row').length,1);
  assert.equal(calls.filter(call=>call.path.endsWith('/dismiss')).length,1,'OK acknowledges immediately, without waiting for the next poll');await tick(context,act);assert.equal(calls.filter(call=>call.path.endsWith('/dismiss')).length,1);assert.match(storage.get('stati-rejections-'+uid),new RegExp(uuid(1)));
  records=[row(1,'queued',{updated_at:now()+100})];await tick(context,act);assert.equal(modal(),null);assert.match(document.querySelector('.delivery-status-row').textContent,/Saved on computer/);
 });
});
for(const kind of ['Receive','ComputerSend'])for(const status of ['delivered','rejected'])test(kind+' reconciles '+status+' in its result, history and modal without mutating or resending the upload',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let records=[];
 await ui(kind,handlerFor(()=>records),async({choose,act,document,modal,uploads,click})=>{
  const upload=await choose(),original=upload.receipt;assert.equal(original.status,'queued');assert.equal(Object.isFrozen(original),true);
  records=[{...row(1,status,{updated_at:now(),rejection_reason:status==='rejected'?'Use the corrected verse.':null}),id:original.id,filename:original.filename}];await tick(context,act);
  const result=document.querySelector(kind==='Receive'?'.receiver':'.upload-results');assert.match(result.textContent,status==='delivered'?/Saved on the computer/:/corrected verse/);assert.match(modal().textContent,status==='delivered'?/File saved/:/corrected verse/);assert.match(document.querySelector('.delivery-status-row').textContent,status==='delivered'?/Saved on computer/:/corrected verse/);
  assert.equal(original.status,'queued');assert.equal(uploads.length,1);await click('OK');assert.ok(document.querySelector('.delivery-status-row'));
  records=[{...records[0],status:'queued',updated_at:now()+100,rejection_reason:null}];await tick(context,act);assert.match(result.textContent,status==='delivered'?/Saved on the computer/:/corrected verse/);assert.equal(uploads.length,1);
 });
});
for(const phase of ['headers','body'])test('a stalled status '+phase+' times out, retries and cannot overwrite a newer outcome',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});const gate=deferred();let gets=0;
 await ui(null,async call=>{if(call.path!=='/transfers')return{ok:true};if(++gets===1)return phase==='headers'?gate.promise:{ok:true,status:200,json:()=>gate.promise};return[row(2,'delivered')];},async({calls,act,modal})=>{
  const first=calls[0];await tick(context,act,8000);assert.equal(first.signal.aborted,true);await tick(context,act);assert.equal(gets,2);assert.match(modal().textContent,/Local song 2/);
  await act(async()=>gate.resolve(phase==='headers'?Response.json([row(1,'rejected')]):[row(1,'rejected')]));assert.match(modal().textContent,/Local song 2/);assert.doesNotMatch(modal().textContent,/Local song 1/);
 });
});
test('a stalled dismissal body never blocks GET polling or the next saved alert',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});const body=deferred(),storage=new Map([['stati-rejections-'+uid,JSON.stringify([uuid(1)])]]);let records=[row(1,'delivered')];
 await ui(null,handlerFor(()=>records,call=>call.path.endsWith('/dismiss')?{ok:true,status:200,json:()=>body.promise}:undefined),async({calls,act,modal})=>{
  assert.equal(modal(),null);await tick(context,act);const ack=calls.find(call=>call.path.endsWith('/dismiss'));assert.ok(ack);
  records=[row(2,'delivered'),...records];await tick(context,act);assert.match(modal().textContent,/Local song 2/);assert.ok(calls.filter(call=>call.path==='/transfers').length>=3);
  await tick(context,act,8000);assert.equal(ack.signal.aborted,true);await act(async()=>body.resolve({ok:true}));assert.match(modal().textContent,/Local song 2/);
 },{storage});
});
test('rapid dismissals acknowledge immediately and coalesce behind one in-flight ACK job',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});const first=deferred();let acks=0;
 await ui(null,handlerFor(()=>[row(1,'delivered'),row(2,'rejected')],call=>call.path.endsWith('/dismiss')?(++acks===1?first.promise:{ok:true}):undefined),async({calls,act,click,document,modal})=>{
  const firstButton=modal().querySelector('button');await act(async()=>{firstButton.dispatchEvent(new document.defaultView.Event('click',{bubbles:true}));firstButton.dispatchEvent(new document.defaultView.Event('click',{bubbles:true}));});assert.equal(acks,1,'Rapid repeated presses start one immediate request before any timer advances');
  await click('OK');assert.equal(modal(),null);assert.equal(acks,1,'The next dismissal waits behind the current job');
  assert.equal(calls.filter(call=>call.path==='/transfers').length,1,'Dismissals must not restart GET polling');
  await act(async()=>first.resolve({ok:true}));assert.equal(acks,2,'One coalesced follow-up acknowledges the next dismissed file');
  assert.equal(new Set(calls.filter(call=>call.path.endsWith('/dismiss')).map(call=>call.path)).size,2);
  await tick(context,act);assert.equal(acks,2);assert.equal(document.querySelectorAll('.delivery-status-row').length,2);
 });
});
test('a stalled ACK header request times out independently and a pending dismissal is retried',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let acks=0;
 await ui(null,handlerFor(()=>[row(1,'delivered')],call=>call.path.endsWith('/dismiss')?(++acks===1?new Promise(()=>{}):{ok:true}):undefined),async({calls,act,click,modal})=>{
  await click('OK');assert.equal(acks,1);const request=calls.find(call=>call.path.endsWith('/dismiss'));
  await tick(context,act,8000);assert.equal(request.signal.aborted,true);assert.equal(calls.filter(call=>call.path==='/transfers').length,1);await tick(context,act,7000);assert.equal(calls.filter(call=>call.path==='/transfers').length,2);
  await tick(context,act);assert.equal(acks,2);assert.equal(modal(),null);
 });
});
test('hidden/account-switched work aborts GET and ACK; a late answer cannot leak into the next account',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});const gate=deferred();let first=true,account=uid;
 await ui(null,async call=>{if(call.path.endsWith('/dismiss'))return new Promise(()=>{});if(first){first=false;return[row(1,'delivered')];}if(account===uid)return{ok:true,status:200,json:()=>gate.promise};return[row(2,'rejected',{rejection_reason:'Other local account reason.'})];},async({calls,act,click,visibility,render,modal})=>{
  await click('OK');await tick(context,act);const pending=[calls.find(call=>call.path.endsWith('/dismiss')),calls.filter(call=>call.path==='/transfers').at(-1)];assert.equal(pending.length,2);await visibility('hidden');assert.ok(pending.every(call=>call.signal.aborted));
  const count=calls.length;await tick(context,act,30000);assert.equal(calls.length,count);account=other;await render(other);assert.equal(modal(),null);await visibility('visible');assert.match(modal().textContent,/Other local account reason/);
  await act(async()=>gate.resolve([row(1,'rejected',{rejection_reason:'Old private reason.'})]));assert.doesNotMatch(modal().textContent,/Old private reason/);
 });
});
test('local dismissal survives a reload and failed acknowledgement; server dismissals also suppress alerts',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});const storage=new Map();let records=[row(1,'rejected',{rejection_reason:'Correct the song.'})];
 const handler=handlerFor(()=>records,call=>call.path.endsWith('/dismiss')?Response.json({error:'Temporary error'},{status:503}):undefined);
 await ui(null,handler,async({click,modal})=>{assert.ok(modal());await click('OK');assert.equal(modal(),null);},{storage});
 await ui(null,handler,async({modal,act,calls})=>{assert.equal(modal(),null);await tick(context,act);assert.ok(calls.some(call=>call.path.endsWith('/dismiss')));},{storage});
 records=[row(2,'delivered',{dismissed_at:now()})];await ui(null,handlerFor(()=>records),async({modal,document})=>{assert.equal(modal(),null);assert.equal(document.querySelectorAll('.delivery-status-row').length,1);});
});
test('known file cards merge across server pages, stay bounded, and an active sender keeps its terminal outcome after eviction',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let records=[];
 await ui('Receive',handlerFor(()=>records),async({choose,act,document,click})=>{
  const upload=await choose();records=[{...row(1,'delivered'),id:upload.receipt.id}];await tick(context,act);await click('OK');
  for(let page=0;page<11;page++){records=Array.from({length:100},(_,index)=>row(100+page*100+index,'delivered',{updated_at:now()+page+1}));await tick(context,act);}
  assert.equal(document.querySelectorAll('.delivery-status-row').length,1000);assert.match(document.querySelector('.receiver').textContent,/Saved on the computer/);assert.equal(upload.receipt.status,'queued');
 });
});
test('older unseen saved and rejected outcomes remain actionable behind 1,000 newer dismissed history cards',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let records=[];const base=now();
 await ui(null,handlerFor(()=>records),async({act,document,modal,click,calls})=>{
  for(let page=0;page<10;page++){
   records=Array.from({length:100},(_,index)=>row(100+page*100+index,'delivered',{updated_at:base-page,dismissed_at:base}));await tick(context,act);
  }
  assert.equal(document.querySelectorAll('.delivery-status-row').length,1000);assert.equal(modal(),null);
  records=[row(1,'delivered',{updated_at:base-2000}),row(2,'rejected',{updated_at:base-1000,rejection_reason:'An older outcome still needs review.'})];await tick(context,act);
  assert.match(modal().textContent,/An older outcome still needs review/);assert.equal(document.querySelectorAll('.delivery-status-row').length,1000);
  assert.equal(document.querySelector('.delivery-status-row strong').textContent,'Local song 199.txt','History still displays by update time and descending ID after bounded admission');
  await click('OK');assert.match(modal().textContent,/File saved/);await click('OK');assert.equal(modal(),null);
  assert.deepEqual(new Set(calls.filter(call=>call.path.endsWith('/dismiss')).map(call=>call.path)),new Set(['/transfers/'+uuid(1)+'/dismiss','/transfers/'+uuid(2)+'/dismiss']));
 });
});
test('an older locally dismissed outcome awaiting ACK survives a full newer acknowledged history cache',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let records=[];const base=now();
 const storage=new Map([['stati-rejections-'+uid,JSON.stringify([uuid(1)])]]);
 await ui(null,handlerFor(()=>records),async({act,document,modal,calls})=>{
  for(let page=0;page<10;page++){
   records=Array.from({length:100},(_,index)=>row(100+page*100+index,'delivered',{updated_at:base-page,dismissed_at:base}));await tick(context,act);
  }
  records=[row(1,'delivered',{updated_at:base-1000})];await tick(context,act);assert.equal(modal(),null);await tick(context,act);
  assert.equal(calls.filter(call=>call.path==='/transfers/'+uuid(1)+'/dismiss').length,1,'Older locally dismissed outcomes must still reach the server ACK job');
  assert.equal(document.querySelectorAll('.delivery-status-row').length,1000);
 },{storage});
});


test('delivery history uses one visible request per 15 seconds, wakes on return, and ACK remains immediate',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let records=[];
 await ui(null,handlerFor(()=>records),async({calls,act,visibility,modal,click})=>{
  const gets=()=>calls.filter(call=>call.path==='/transfers');assert.equal(gets().length,1);
  records=[row(1,'delivered')];await tick(context,act,14999);assert.equal(gets().length,1);assert.equal(modal(),null);
  await tick(context,act,1);assert.equal(gets().length,2);assert.match(modal().textContent,/File saved/);
  await click('OK');assert.equal(calls.filter(call=>call.path.endsWith('/dismiss')).length,1);assert.equal(gets().length,2,'Immediate dismissal does not restart history reads');
  await visibility('hidden');const hidden=calls.length;await tick(context,act,60000);assert.equal(calls.length,hidden);
  records=[row(2,'rejected',{rejection_reason:'Correct these lyrics.'})];await visibility('visible');assert.equal(gets().length,3);assert.match(modal().textContent,/Correct these lyrics/);
 });
});

test('clearing completed upload history keeps pending sends and receipt records',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let records=[row(1,'delivered',{dismissed_at:now()}),row(2,'queued')];
 await ui(null,handlerFor(()=>records,call=>{if(call.path==='/transfers/clear-history'){records=records.map(record=>record.status==='queued'?record:{...record,history_hidden_at:now()});return{ok:true};}}),async({document,click,calls,act})=>{
  assert.equal(document.querySelectorAll('.delivery-status-row').length,2);await click('Clear completed');
  assert.equal(document.querySelectorAll('.delivery-status-row').length,1);assert.match(document.querySelector('.delivery-status-row').textContent,/Local song 2/);assert.equal(records.length,2);
  await tick(context,act);assert.equal(document.querySelectorAll('.delivery-status-row').length,1);assert.equal(calls.filter(call=>call.path==='/transfers/clear-history'&&call.method==='POST').length,1);assert.equal(calls.filter(call=>call.method==='DELETE').length,0);
 });
});
