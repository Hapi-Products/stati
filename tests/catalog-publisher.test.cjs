const {test}=require('node:test'),assert=require('node:assert/strict');
const {createCatalogPublisher}=require('../desktop/catalog-publisher.cjs');
test('catalog snapshots are batched before one final commit and unchanged scans do not upload again',async()=>{
 const sent=[],songs=Array.from({length:95},(_,index)=>({id:String(index),text:'x'.repeat(9000)})),context={credential:'privatefixture',deviceId:'isolated'},publisher=createCatalogPublisher({current:()=>context,readCatalog:async()=>({songs,unreadable:2}),send:async(_,value)=>sent.push(value)});
 await publisher.run();assert.equal(sent[0].action,'begin');assert.equal(sent[0].count,95);assert.equal(sent.at(-1).action,'finish');assert.equal(sent.filter(value=>value.action==='chunk').flatMap(value=>value.songs).length,95);for(const value of sent.filter(value=>value.action==='chunk'))assert.ok(value.songs.length<=40&&Buffer.byteLength(JSON.stringify(value))<512*1024);
 const count=sent.length;await publisher.run();assert.equal(sent.length,count);publisher.cancel();
});
test('a changed pairing during an upload cannot publish the old computer snapshot',async()=>{
 let context={credential:'old',deviceId:'one'};const sent=[],errors=[],publisher=createCatalogPublisher({current:()=>context,readCatalog:async()=>({songs:[{id:'song',text:'words'}],unreadable:0}),send:async(_,value)=>{sent.push(value);context={credential:'new',deviceId:'two'};},onError:error=>errors.push(error)});
 await publisher.run();assert.deepEqual(sent.map(value=>value.action),['begin']);assert.equal(errors.length,0);publisher.cancel();
});
test('a failed chunk never finalizes a partial catalog and can retry a fresh generation',async()=>{
 let failed=true;const sent=[],errors=[],publisher=createCatalogPublisher({current:()=>({credential:'fixture',deviceId:'station'}),readCatalog:async()=>({songs:[{id:'song',text:'words'}],unreadable:0}),send:async(_,value)=>{sent.push(value);if(value.action==='chunk'&&failed)throw Error('Offline');},onError:error=>errors.push(error)});
 await publisher.run();assert.equal(sent.some(value=>value.action==='finish'),false);assert.equal(errors.length,1);failed=false;await publisher.run();assert.equal(sent.at(-1).action,'finish');assert.notEqual(sent[0].generation,sent[2].generation);publisher.cancel();
});
test('cancel invalidates a running scan even when the paired credential has not changed',async()=>{
 let finish;const sent=[],errors=[],context={credential:'fixture',deviceId:'station'},publisher=createCatalogPublisher({current:()=>context,readCatalog:()=>new Promise(resolve=>{finish=resolve;}),send:async(_,value)=>sent.push(value),onError:error=>errors.push(error)});
 const running=publisher.run();await new Promise(resolve=>setImmediate(resolve));publisher.cancel();finish({songs:[{id:'song',text:'words'}],unreadable:0});await running;assert.deepEqual(sent,[]);assert.deepEqual(errors,[]);
});
test('cancel during a chunk never sends finish or records an obsolete digest for an unchanged pairing',async()=>{
 let finish,held=true;const sent=[],errors=[],context={credential:'fixture',deviceId:'station'},publisher=createCatalogPublisher({current:()=>context,readCatalog:async()=>({songs:[{id:'song',text:'words'}],unreadable:0}),send:async(_,value)=>{sent.push(value);if(value.action==='chunk'&&held)await new Promise(resolve=>{finish=resolve;});},onError:error=>errors.push(error)});
 const running=publisher.run();await new Promise(resolve=>setImmediate(resolve));publisher.cancel();finish();await running;assert.deepEqual(sent.map(value=>value.action),['begin','chunk']);assert.deepEqual(errors,[]);
 held=false;await publisher.run();assert.deepEqual(sent.map(value=>value.action),['begin','chunk','begin','chunk','finish']);assert.notEqual(sent[0].generation,sent[2].generation);publisher.cancel();
});

test('an all-unreadable local scan cannot replace the previous shared songs with an empty catalog',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{catalogSnapshot}=require('../desktop/catalog-publisher.cjs');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stati-unreadable-library-'));
 let snapshot={songs:[{id:'previous-readable-song',text:'Previous readable lyrics'}],unreadable:0};
 const sent=[],errors=[],context={credential:'isolated-fixture',deviceId:'isolated-station'},publisher=createCatalogPublisher({current:()=>context,readCatalog:async()=>snapshot,send:async(_,data)=>sent.push(data),onError:error=>errors.push(error)});
 try{
  await publisher.flush();const previous=publisher.status(),count=sent.length;assert.equal(previous.state,'ready');assert.equal(previous.songCount,1);assert.ok(previous.updatedAt>0);
  await fs.writeFile(path.join(directory,'unreadable.pro'),Buffer.from([255,255,255]));snapshot=await catalogSnapshot(directory);assert.equal(snapshot.songs.length,0);assert.equal(snapshot.unreadable,1);
  await assert.rejects(publisher.flush(),/1 song file could not be read.*previous shared library has been kept/);
  assert.equal(sent.length,count);assert.equal(errors.length,1);assert.equal(publisher.status().state,'error');assert.equal(publisher.status().songCount,1);assert.equal(publisher.status().updatedAt,previous.updatedAt);
 }finally{publisher.cancel();await fs.rm(directory,{recursive:true,force:true});}
});
test('a missing folder reports setup required without publishing an empty catalog; readable songs still share alongside a warning',async()=>{
 const sent=[],context={credential:'fixture',deviceId:'station'};let snapshot=null;
 const publisher=createCatalogPublisher({current:()=>context,readCatalog:async()=>snapshot,send:async(_,value)=>sent.push(value)});
 await publisher.flush();assert.equal(publisher.status().state,'waiting');assert.match(publisher.status().error,/Choose the Lyrics folder/);assert.equal(sent.length,0);
 snapshot={songs:[{id:'readable-song',text:'Readable lyrics'}],unreadable:1};await publisher.flush();assert.equal(publisher.status().state,'ready');assert.equal(publisher.status().songCount,1);
 assert.equal(sent[0].unreadable,1);assert.equal(sent.at(-1).action,'finish');publisher.cancel();
});
test('a deliberately empty readable folder can commit, and sync summaries never leak across computer credentials',async()=>{
 const sent=[];let context={credential:'old-fixture',deviceId:'old-station'};
 const publisher=createCatalogPublisher({current:()=>context,readCatalog:async()=>({songs:[],unreadable:0}),send:async(_,value)=>sent.push(value)});
 publisher.schedule();assert.equal(publisher.status().state,'scheduled');await publisher.flush();assert.equal(publisher.status().state,'ready');assert.equal(publisher.status().songCount,0);
 assert.deepEqual(sent.map(row=>row.action),['begin','finish']);context={credential:'new-fixture',deviceId:'new-station'};assert.deepEqual(publisher.status(),{state:'idle',updatedAt:null,songCount:null,error:''});publisher.cancel();
});

test('ordinary catalog invalidation keeps the scoped digest so unchanged songs are not reuploaded',async()=>{
 const sent=[];let context={credential:'pc-credential',deviceId:'pc'},songs=[{id:'one',text:'Saved words'}];const publisher=createCatalogPublisher({current:()=>context,readCatalog:async()=>({songs,unreadable:0}),send:async(_,value)=>sent.push(value)});
 await publisher.flush();assert.equal(sent.length,3);publisher.cancel({forgetDigest:false});await publisher.flush();assert.equal(sent.length,3);
 songs=[{id:'one',text:'Changed words'}];publisher.cancel({forgetDigest:false});await publisher.flush();assert.equal(sent.length,6);
 context={credential:'new-credential',deviceId:'pc'};publisher.cancel({forgetDigest:false});await publisher.flush();assert.equal(sent.length,9);publisher.cancel();
});
