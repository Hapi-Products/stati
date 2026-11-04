const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const id='fixture-transfer-0000000001';
// Actual main-process delivery, real isolated disk/checkpoint bytes, local response; no accounts/cloud.
async function fixture(t,received,expected){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-delivery-integrity-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const downloads=path.join(root,'Downloads'),ack=[];let gets=0;
 const source=await fs.readFile('desktop/main.cjs','utf8');
 const context={fs,path,crypto,Buffer,console,downloadsInFlight:new Set(),deliveryTasks:new Set(),deliveryPromises:new Map(),deliveryControllers:new Map(),decisionsInFlight:new Set(),blockedTransfers:new Set(),operatorGeneration:0,transferEpoch:0,sessionLocked:false,quitting:false,activeOperator:{id:'isolated-operator'},credential:'isolated-untransmitted-fixture',
  app:{getPath:()=>downloads},filePath:name=>path.join(root,name),validateId:value=>assert.equal(value,id),assertIdentity:generation=>assert.equal(generation,0),
  request:async endpoint=>{ack.push(endpoint);return{ok:true};},ORIGIN:'http://isolated.invalid',AbortSignal,AbortController,
  fetch:async()=>{gets++;return new Response(received,{headers:{'Content-Length':String(received.length),'Content-Disposition':"attachment; filename*=UTF-8''song.txt",'X-Checksum-SHA256':expected}});},
  require:name=>name.startsWith('./')?require(path.resolve('desktop',name)):require(name)};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function safeName('),source.indexOf("handle('deliver',")),context);
 return{root,downloads,ack,context,gets:()=>gets};
}
test('delivery never commits a receipt or acknowledges equal-length corrupted bytes',async t=>{
 const intended=Buffer.from('original lyrics'),corrupted=Buffer.from('tampered lyrics');assert.equal(intended.length,corrupted.length);
 const f=await fixture(t,corrupted,crypto.createHash('sha256').update(intended).digest('hex'));
 await assert.rejects(f.context.deliverTransfer(id),/File check failed/);assert.deepEqual(f.ack,[]);assert.deepEqual(await fs.readdir(f.downloads),[]);await assert.rejects(fs.access(path.join(f.root,'deliveries.json')),{code:'ENOENT'});assert.equal(f.context.downloadsInFlight.size,0);
});
test('delivery saves exact verified bytes before receipt and acknowledgement',async t=>{
 const content=Buffer.from('Doamne, noi cântăm'),f=await fixture(t,content,crypto.createHash('sha256').update(content).digest('hex'));
 const result=await f.context.deliverTransfer(id);assert.equal(result.integrity,'sha256');assert.deepEqual(await fs.readFile(result.path),content);assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'deliveries.json'),'utf8'))[id],result.path);assert.deepEqual(f.ack,['/station/transfers/'+id+'/delivered']);assert.deepEqual((await fs.readdir(f.downloads)).filter(name=>!name.startsWith('.')),['song.txt']);assert.deepEqual(await fs.readdir(path.join(f.downloads,'.stati-deliveries')),[]);assert.equal(f.context.downloadsInFlight.size,0);
});
test('delivery preserves a pre-existing temporary path when exclusive creation refuses it',async t=>{
 const content=Buffer.from('valid bytes'),f=await fixture(t,content,crypto.createHash('sha256').update(content).digest('hex'));await fs.mkdir(f.downloads);
 const existing=path.join(f.downloads,'.stati-'+id+'-collision.part');await fs.writeFile(existing,'unrelated existing file');f.context.crypto={...crypto,randomUUID:()=> 'collision'};
 await assert.rejects(f.context.deliverTransfer(id),/File check failed/);assert.equal(await fs.readFile(existing,'utf8'),'unrelated existing file');assert.deepEqual(f.ack,[]);await assert.rejects(fs.access(path.join(f.root,'deliveries.json')),{code:'ENOENT'});
});
test('receipt write failure recovers one saved destination without another GET',async t=>{
 const content=Buffer.from('verified saved lyrics'),f=await fixture(t,content,crypto.createHash('sha256').update(content).digest('hex'));
 const station=require('../desktop/station-files.cjs'),save=station.saveReceipt;let fail=true;
 station.saveReceipt=(...args)=>fail?Promise.reject(Object.assign(Error('receipt disk unavailable'),{code:'EACCES'})):save(...args);
 try{await assert.rejects(f.context.deliverTransfer(id),/receipt disk/);assert.equal(f.gets(),1);assert.deepEqual(f.ack,[]);assert.deepEqual((await fs.readdir(f.downloads)).filter(name=>!name.startsWith('.')),['song.txt']);fail=false;
  const result=await f.context.deliverTransfer(id);assert.equal(f.gets(),1);assert.equal(path.basename(result.path),'song.txt');assert.deepEqual(f.ack,['/station/transfers/'+id+'/delivered']);assert.deepEqual(await fs.readdir(path.join(f.downloads,'.stati-deliveries')),[]);
 }finally{station.saveReceipt=save;}
});
test('corrupt receipt records fail closed before fetching and preserve existing files',async t=>{
 const content=Buffer.from('lyrics'),f=await fixture(t,content,crypto.createHash('sha256').update(content).digest('hex'));await fs.writeFile(path.join(f.root,'deliveries.json'),'{broken receipt');
 await assert.rejects(f.context.deliverTransfer(id),/Invalid saved-file receipts/);assert.equal(f.gets(),0);assert.deepEqual(f.ack,[]);assert.equal(await fs.readFile(path.join(f.root,'deliveries.json'),'utf8'),'{broken receipt');
});

test('checkpoint integrity failure after a new receipt commits must prevent the cloud acknowledgement',async t=>{
 const content=Buffer.from('verified lyrics retained locally'),f=await fixture(t,content,crypto.createHash('sha256').update(content).digest('hex'));
 const originalRequire=f.context.require;let checks=0;
 f.context.require=name=>name==='./delivery-recovery.cjs'?{...originalRequire(name),verifyDelivery:async options=>{
  checks++;assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'deliveries.json'),'utf8'))[id],options.path);
  throw Object.assign(Error('Saved checkpoint integrity no longer matches'),{code:'STATI_RECOVERY_REQUIRED',retryable:false});
 }}:originalRequire(name);
 await assert.rejects(f.context.deliverTransfer(id),{code:'STATI_RECOVERY_REQUIRED'});
 assert.equal(checks,1);assert.equal(f.gets(),1);assert.deepEqual(f.ack,[]);
 const receipts=JSON.parse(await fs.readFile(path.join(f.root,'deliveries.json'),'utf8'));assert.deepEqual(await fs.readFile(receipts[id]),content);assert.equal(f.context.downloadsInFlight.size,0);
});

test('checkpoint integrity failure for an existing receipt never acknowledges or fetches another copy',async t=>{
 const content=Buffer.from('previously saved verified lyrics'),f=await fixture(t,content,crypto.createHash('sha256').update(content).digest('hex'));
 await fs.mkdir(f.downloads);const canonical=await fs.realpath(f.downloads),saved=path.join(canonical,'song.txt');await fs.writeFile(saved,content);
 await require('../desktop/station-files.cjs').saveReceipt(path.join(f.root,'deliveries.json'),id,saved);
 const originalRequire=f.context.require;let checks=0;
 f.context.require=name=>name==='./delivery-recovery.cjs'?{...originalRequire(name),verifyDelivery:async()=>{
  checks++;throw Object.assign(Error('Existing checkpoint integrity no longer matches'),{code:'STATI_RECOVERY_REQUIRED',retryable:false});
 }}:originalRequire(name);
 await assert.rejects(f.context.deliverTransfer(id),{code:'STATI_RECOVERY_REQUIRED'});assert.equal(checks,1);assert.equal(f.gets(),0);assert.deepEqual(f.ack,[]);
 assert.deepEqual(await fs.readFile(saved),content);assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'deliveries.json'),'utf8'))[id],saved);assert.equal(f.context.downloadsInFlight.size,0);
});

test('same-size saved-file corruption after receipt commit cannot delete the valid cloud source',async t=>{
 const content=Buffer.from('correct song lyrics'),corrupt=Buffer.from('damaged song lyrics');assert.equal(content.length,corrupt.length);
 const f=await fixture(t,content,crypto.createHash('sha256').update(content).digest('hex')),originalRequire=f.context.require;
 f.context.require=name=>name==='./station-files.cjs'?{...originalRequire(name),saveReceipt:async(...args)=>{
  await originalRequire(name).saveReceipt(...args);await fs.writeFile(args[2],corrupt);
 }}:originalRequire(name);
 await assert.rejects(f.context.deliverTransfer(id),{code:'STATI_RECOVERY_REQUIRED'});assert.equal(f.gets(),1);assert.deepEqual(f.ack,[]);
 const receipts=JSON.parse(await fs.readFile(path.join(f.root,'deliveries.json'),'utf8'));assert.deepEqual(await fs.readFile(receipts[id]),corrupt);
 // The retained checkpoint must continue to block ACK on a later receipt-based retry.
 f.context.require=originalRequire;await assert.rejects(f.context.deliverTransfer(id),{code:'STATI_RECOVERY_REQUIRED'});assert.equal(f.gets(),1);assert.deepEqual(f.ack,[]);
});

test('a lost acknowledgement keeps the checkpoint and detects changed bytes before retrying ACK',async t=>{
 const content=Buffer.from('correct song lyrics'),corrupt=Buffer.from('damaged song lyrics');assert.equal(content.length,corrupt.length);
 const f=await fixture(t,content,crypto.createHash('sha256').update(content).digest('hex')),originalRequest=f.context.request;
 f.context.request=async endpoint=>{f.ack.push(endpoint);throw Error('Fixture ACK response lost');};
 await assert.rejects(f.context.deliverTransfer(id),/ACK response lost/);assert.equal(f.gets(),1);assert.equal(f.ack.length,1);
 const receipts=JSON.parse(await fs.readFile(path.join(f.root,'deliveries.json'),'utf8'));assert.equal((await fs.readdir(path.join(f.downloads,'.stati-deliveries'))).includes(id),true);
 await fs.writeFile(receipts[id],corrupt);f.context.request=originalRequest;
 await assert.rejects(f.context.deliverTransfer(id),{code:'STATI_RECOVERY_REQUIRED'});assert.equal(f.gets(),1);assert.equal(f.ack.length,1);assert.deepEqual(await fs.readFile(receipts[id]),corrupt);
});
