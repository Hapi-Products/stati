'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {openPresentationLedger}=require('../desktop/presentation-ledger.cjs');
const {fingerprint}=require('../desktop/presentation-scan.cjs');
const {createDiskReserve}=require('../desktop/disk-reserve.cjs');
async function fixture(check){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'stati-sync-space-'))),sourceRoot=path.join(root,'Documents'),targetRoot=path.join(root,'Lyrics'),directory=path.join(root,'Private');await fs.mkdir(sourceRoot);await fs.mkdir(targetRoot);
 let low=()=>false,leases=0;const reserve=createDiskReserve({reserveBytes:4096,metadataBytes:0,statfs:async folder=>({bsize:1n,bavail:low(folder)?0n:100000000n})});
 const diskReserve={async acquire(...args){const lease=await reserve.acquire(...args);leases++;return{...lease,async release(){await lease.release();leases--;}};}};
 const ledger=await openPresentationLedger({directory,sourceRoots:[sourceRoot],outputRoots:[targetRoot],checkActive(){},diskReserve}),source=path.join(sourceRoot,'Song.pptx');await fs.writeFile(source,'original PowerPoint bytes');const scanned=await fingerprint(source,{checkActive(){}});await ledger.observe({files:[scanned]});
 const created=await ledger.writeConversion({sourceId:scanned.id,expectedSourceHash:scanned.sha256,outputRoot:targetRoot,filename:'Song.pro',bytes:Buffer.from('original ProPresenter bytes'),direction:'to-pro'}),target=created.path;
 const f={root,sourceRoot,targetRoot,directory,source,target,ledger,id:created.id,setLow:rule=>{low=rule;},leases:()=>leases,enable:()=>ledger.enableTwoWay({id:created.id,consent:true}),sync:()=>ledger.synchronize({id:created.id,build:async()=>Buffer.from('updated saved lyric bytes')}),files:async()=>({source:await fs.readFile(source),target:await fs.readFile(target)}),temporaries:async()=>{const files=await fs.readdir(root,{recursive:true});return files.filter(file=>/\.tmp$/.test(file));}};
 try{await check(f);}finally{await fs.rm(root,{recursive:true,force:true});}
}
const lowSpace=error=>error?.code==='STATI_LOW_DISK_SPACE';
test('two-way opt-in refuses low-space backup allocation without changing either endpoint or consent',()=>fixture(async f=>{
 const before=await f.files();f.setLow(folder=>folder===path.join(f.directory,'backups'));await assert.rejects(f.enable(),lowSpace);assert.deepEqual(await f.files(),before);assert.equal((await f.ledger.listLinks()).items[0].twoWay,false);assert.equal(f.leases(),0);assert.deepEqual(await fs.readdir(path.join(f.directory,'backups')),[]);
 f.setLow(()=>false);await f.enable();assert.equal((await f.ledger.listLinks()).items[0].twoWay,true);assert.equal(f.leases(),0);
}));
test('a failed opt-in ledger snapshot leaves consent off and verified backups available for retry',()=>fixture(async f=>{
 const before=await f.files();f.setLow(folder=>folder===f.directory);await assert.rejects(f.enable(),lowSpace);assert.deepEqual(await f.files(),before);assert.equal((await f.ledger.listLinks()).items[0].twoWay,false);assert.equal((await fs.readdir(path.join(f.directory,'backups'))).length,2);assert.deepEqual(await f.temporaries(),[]);assert.equal(f.leases(),0);
 f.setLow(()=>false);await f.enable();assert.equal((await f.ledger.listLinks()).items[0].twoWay,true);assert.equal(f.leases(),0);
}));
for(const side of ['source','target'])test('low-space '+side+' endpoint staging preserves both files and releases reservations',()=>fixture(async f=>{
 await f.enable();await fs.writeFile(side==='target'?f.source:f.target,'deliberately edited saved lyrics');const before=await f.files();f.setLow(folder=>folder===(side==='source'?f.sourceRoot:f.targetRoot));await assert.rejects(f.sync(),lowSpace);assert.deepEqual(await f.files(),before);assert.deepEqual(await f.temporaries(),[]);assert.equal(f.leases(),0);
 f.setLow(()=>false);const result=await f.sync();assert.equal(result.status,'resynced');assert.equal(f.leases(),0);assert.equal((await fs.readFile(side==='source'?f.source:f.target,'utf8')),'updated saved lyric bytes');
}));
test('precommit ledger allocation failure removes only its owned stage and preserves the saved peer files',()=>fixture(async f=>{
 await f.enable();await fs.writeFile(f.source,'new saved PowerPoint words');const before=await f.files();f.setLow(folder=>folder===f.directory);await assert.rejects(f.sync(),lowSpace);assert.deepEqual(await f.files(),before);assert.deepEqual(await f.temporaries(),[]);assert.equal(f.leases(),0);f.setLow(()=>false);assert.equal((await f.sync()).status,'resynced');assert.equal(f.leases(),0);
}));
test('an ENOSPC during a new backup removes its owned partial bytes and keeps originals intact',()=>fixture(async f=>{
 const before=await f.files(),original=fs.open;let injected=false;
 fs.open=async function(file,...args){const handle=await original.call(this,file,...args);if(String(file).startsWith(path.join(f.directory,'backups')+path.sep)&&args[0]==='wx'&&!injected){injected=true;const write=handle.writeFile.bind(handle);handle.writeFile=async bytes=>{await write(bytes.subarray(0,2));throw Object.assign(Error('Injected full disk'),{code:'ENOSPC'});};}return handle;};
 try{await assert.rejects(f.enable(),lowSpace);}finally{fs.open=original;}
 assert.equal(injected,true);assert.deepEqual(await f.files(),before);assert.deepEqual(await fs.readdir(path.join(f.directory,'backups')),[]);assert.equal(f.leases(),0);await f.enable();assert.equal((await f.ledger.listLinks()).items[0].twoWay,true);assert.equal(f.leases(),0);
}));
