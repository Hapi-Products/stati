'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {scanPresentations,computerRoots,fingerprint}=require('../desktop/presentation-scan.cjs');
const {openPresentationLedger}=require('../desktop/presentation-ledger.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'stati-presentation-sync-'))),sourceRoot=path.join(root,'Documents'),outputRoot=path.join(root,'Lyrics'),directory=path.join(root,'Private');await fs.mkdir(sourceRoot);await fs.mkdir(outputRoot);
 let authorized=true,guardHook=()=>{};const checkActive=()=>{if(!authorized)throw Error('Changed identity');guardHook();};
 const options={directory,sourceRoots:[sourceRoot],outputRoots:[outputRoot],checkActive};
 const ledger=await openPresentationLedger(options);
 async function source(name='Original.pro',bytes='original presentation'){const file=path.join(sourceRoot,name);await fs.writeFile(file,bytes);const snapshot=await fingerprint(file,{checkActive});await ledger.observe({files:[snapshot]});return snapshot;}
 return{root,sourceRoot,outputRoot,directory,ledger,options,checkActive,source,deny:()=>{authorized=false;},hook:fn=>{guardHook=fn;},async cleanup(){await fs.rm(root,{recursive:true,force:true});}};
}
async function convert(f,source,extra={}){return f.ledger.writeConversion({sourceId:source.id,expectedSourceHash:source.sha256,outputRoot:f.outputRoot,filename:'Song.pptx',bytes:Buffer.from('generated slides'),direction:'to-pptx',...extra});}
async function refresh(f,source,bytes){await fs.writeFile(source.path,bytes);const current=await fingerprint(source.path,{checkActive:f.checkActive});await f.ledger.observe({files:[current]});return current;}
test('native scan finds PPT/PPTX once, excludes links/system/cache/Office lockfiles, and leaves originals intact',async()=>{
 const f=await fixture();try{
  const chosen=path.join(f.sourceRoot,'One.PPTX'),other=path.join(f.sourceRoot,'Nested');await fs.mkdir(other);await fs.writeFile(chosen,'one');await fs.writeFile(path.join(other,'Two.ppt'),'two');await fs.writeFile(path.join(other,'Notes.txt'),'not a deck');await fs.writeFile(path.join(f.sourceRoot,'~$Locked.pptx'),'lock');
  for(const name of ['Windows','node_modules','.stati-history']){const folder=path.join(f.sourceRoot,name);await fs.mkdir(folder);await fs.writeFile(path.join(folder,'Excluded.pptx'),'excluded');}
  await fs.symlink(other,path.join(f.sourceRoot,'Link'),'dir');await fs.link(chosen,path.join(other,'Hardlink.pptx'));
  const result=await scanPresentations({roots:[other,f.sourceRoot],checkActive:f.checkActive});assert.equal(result.complete,true);assert.equal(result.files.length,2);assert.equal(result.completedRoots.length,1);assert.equal(result.counts.excluded,6);assert.ok(result.files.every(file=>file.sha256.length===64));assert.equal(await fs.readFile(chosen,'utf8'),'one');assert.equal((await fs.readdir(f.outputRoot)).length,0);
 }finally{await f.cleanup();}
});
test('bounded and placeholder-skipping scans report partial coverage rather than claiming all files were found',async()=>{
 const f=await fixture();try{
  for(const name of ['One.pptx','Two.pptx','Three.pptx'])await fs.writeFile(path.join(f.sourceRoot,name),name);
  const bounded=await scanPresentations({roots:[f.sourceRoot],limits:{maxFiles:2},checkActive:f.checkActive});assert.equal(bounded.files.length,2);assert.equal(bounded.reason,'file-limit');assert.equal(bounded.complete,false);assert.deepEqual(bounded.completedRoots,[]);
  let placeholders=0;const result=await scanPresentations({roots:[f.sourceRoot],checkActive:f.checkActive,shouldSkipFile:async()=>{placeholders++;return true;}});assert.equal(placeholders,3);assert.equal(result.files.length,0);assert.equal(result.complete,false);assert.deepEqual(result.completedRoots,[]);assert.equal(result.reason,'unreadable-or-excluded');
 }finally{await f.cleanup();}
});
test('scan cancellation and lost identity stop discovery, including after a native asynchronous callback',async()=>{
 const f=await fixture();try{
  await f.source('One.pptx');const controller=new AbortController();await assert.rejects(scanPresentations({roots:[f.sourceRoot],checkActive:f.checkActive,signal:controller.signal,shouldSkipFile:async()=>{controller.abort();return false;}}),/abort/i);
  await assert.rejects(scanPresentations({roots:[f.sourceRoot],checkActive:f.checkActive,shouldSkipFile:async()=>{f.deny();return false;}}),/Changed identity/);
 }finally{await f.cleanup();}
});
test('computer roots use home and native local volume discovery, reject linked volumes, and tolerate enumeration failure',async()=>{
 const f=await fixture();try{
  const volume=path.join(f.root,'Drive');await fs.mkdir(volume);const linked=path.join(f.root,'LinkedDrive');await fs.symlink(volume,linked,'dir');const selected=await computerRoots({home:f.sourceRoot,platform:'linux',checkActive:f.checkActive,listVolumes:async()=>[volume,linked]});assert.deepEqual(selected.roots,[f.sourceRoot,volume]);assert.equal(selected.issues.length,1);
  const fallback=await computerRoots({home:f.sourceRoot,platform:'linux',checkActive:f.checkActive,listVolumes:async()=>{throw Error('unavailable');}});assert.deepEqual(fallback.roots,[f.sourceRoot]);assert.equal(fallback.issues.length,1);
 }finally{await f.cleanup();}
});
test('history detects actual content changes, records missing only for completed roots, and exposes no private native paths',async()=>{
 const f=await fixture();try{
  let source=await f.source('One.pptx','first');const first=await f.ledger.changes();assert.equal(first.items[0].kind,'found');source=await refresh(f,source,'other');assert.equal((await f.ledger.changes()).items[0].kind,'source-changed');await f.ledger.observe({files:[],completedRoots:[]});assert.equal((await f.ledger.changes()).total,2);await f.ledger.observe({files:[],completedRoots:[f.sourceRoot]});const changes=await f.ledger.changes();assert.equal(changes.items[0].kind,'source-missing');assert.doesNotMatch(JSON.stringify(changes),new RegExp(f.root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const reopened=await openPresentationLedger(f.options);assert.equal((await reopened.changes()).total,3);
 }finally{await f.cleanup();}
});
test('a new conversion reserves a unique output and retry cannot create a duplicate even with nondeterministic generated bytes',async()=>{
 const f=await fixture();try{
  const source=await f.source();await fs.writeFile(path.join(f.outputRoot,'Song.pptx'),'unrelated');const first=await convert(f,source);assert.equal(first.status,'created');assert.equal(first.name,'Song (2).pptx');const second=await convert(f,source,{bytes:Buffer.from('different generated container UUID')});assert.equal(second.status,'unchanged');assert.equal(second.path,first.path);assert.equal(await fs.readFile(path.join(f.outputRoot,'Song.pptx'),'utf8'),'unrelated');assert.equal(await fs.readFile(first.path,'utf8'),'generated slides');assert.deepEqual((await fs.readdir(f.outputRoot)).sort(),['Song (2).pptx','Song.pptx']);
 }finally{await f.cleanup();}
});
test('source updates resync only the owned unchanged target and preserve a verified byte-identical backup',async()=>{
 const f=await fixture();try{
  let source=await f.source();const first=await convert(f,source);source=await refresh(f,source,'edited original presentation');const result=await convert(f,source,{bytes:Buffer.from('new slides')});assert.equal(result.status,'resynced');assert.equal(result.path,first.path);assert.equal(await fs.readFile(result.backup,'utf8'),'generated slides');assert.equal(await fs.readFile(result.path,'utf8'),'new slides');assert.equal((await f.ledger.listLinks()).items[0].sourceChanged,false);
 }finally{await f.cleanup();}
});
test('human edits and existing equivalent songs become conflicts instead of overwrite permission',async()=>{
 const f=await fixture();try{
  let source=await f.source();const first=await convert(f,source);await fs.writeFile(first.path,'human changed slides');source=await refresh(f,source,'new source words');const conflict=await convert(f,source);assert.equal(conflict.status,'conflict');assert.equal(await fs.readFile(first.path,'utf8'),'human changed slides');await f.ledger.inspectOutputs();assert.equal((await f.ledger.listLinks()).items[0].outputStatus,'changed');
  let second=await f.source('Another.pro','different source');const target=path.join(f.outputRoot,'Existing.pptx');await fs.writeFile(target,'existing');const linked=await f.ledger.linkExisting({sourceId:second.id,expectedSourceHash:second.sha256,targetPath:target,expectedTargetHash:hash('existing'),direction:'to-pptx'});assert.equal(linked.status,'linked');second=await refresh(f,second,'changed second source');const refusal=await convert(f,second);assert.equal(refusal.status,'conflict');assert.equal(await fs.readFile(target,'utf8'),'existing');
 }finally{await f.cleanup();}
});
test('a source shared with an unowned relationship cannot replace the shared output',async()=>{
 const f=await fixture();try{
  let source=await f.source();const first=await convert(f,source),second=await f.source('Another.pro','same song');await f.ledger.linkExisting({sourceId:second.id,expectedSourceHash:second.sha256,targetPath:first.path,expectedTargetHash:first.sha256,direction:'to-pptx'});source=await refresh(f,source,'changed');const result=await convert(f,source,{bytes:Buffer.from('replacement')});assert.equal(result.status,'conflict');assert.equal(await fs.readFile(first.path,'utf8'),'generated slides');
 }finally{await f.cleanup();}
});
test('resync uses an opaque id and a native build callback then rechecks a late source edit before writing',async()=>{
 const f=await fixture();try{
  let source=await f.source();const first=await convert(f,source);source=await refresh(f,source,'new source');let called=false;await assert.rejects(f.ledger.resync({id:first.id,build:async context=>{called=true;assert.equal(context.source.path,source.path);assert.equal(context.targetPath,first.path);await fs.writeFile(source.path,'source changed during render');return Buffer.from('replacement');}}),/source changed/i);assert.equal(called,true);assert.equal(await fs.readFile(first.path,'utf8'),'generated slides');
 }finally{await f.cleanup();}
});
test('cancellation and identity loss during a held build cannot write a file or leave a conversion relationship',async()=>{
 for(const kind of ['abort','identity']){const f=await fixture();try{
  let source=await f.source();const first=await convert(f,source);source=await refresh(f,source,'new source');const controller=new AbortController();await assert.rejects(f.ledger.resync({id:first.id,signal:controller.signal,build:async()=>{if(kind==='abort')controller.abort();else f.deny();return Buffer.from('late slides');}}),kind==='abort'?/abort/i:/Changed identity/);assert.equal(await fs.readFile(first.path,'utf8'),'generated slides');assert.ok(!(await fs.readdir(f.outputRoot)).some(name=>name.startsWith('.stati-')));
 }finally{await f.cleanup();}}
});
test('ProPresenter resync requires and enforces the original document identity',async()=>{
 const f=await fixture();try{
  const source=await f.source('Original.pptx','original source'),first=await convert(f,source,{filename:'Song.pro',direction:'to-pro'}),changed=await refresh(f,source,'changed source');const refused=await convert(f,changed,{filename:'Song.pro',direction:'to-pro',bytes:Buffer.from('new pro bytes')});assert.equal(refused.status,'conflict');assert.match(refused.error,/identity validation/);assert.equal(await fs.readFile(first.path,'utf8'),'generated slides');
  const guarded=await openPresentationLedger({...f.options,validateReplacement:async()=>{throw Error('Different ProPresenter UUID');}});await assert.rejects(guarded.writeConversion({sourceId:changed.id,expectedSourceHash:changed.sha256,outputRoot:f.outputRoot,filename:'Song.pro',direction:'to-pro',bytes:Buffer.from('bad identity')}),/Different ProPresenter UUID/);assert.equal(await fs.readFile(first.path,'utf8'),'generated slides');
 }finally{await f.cleanup();}
});
test('journal recovery reconciles an accepted commit after an interrupted metadata write without another delivery',async()=>{
 const f=await fixture();try{
  const source=await f.source(),first=await convert(f,source),stateFile=path.join(f.directory,'relationships.json'),state=JSON.parse(await fs.readFile(stateFile,'utf8')),link=state.links[first.id];delete state.links[first.id];const temporary=path.join(f.outputRoot,'.stati-sync-'+crypto.randomUUID()+'.tmp');await fs.writeFile(temporary,'generated slides');const temp=await fs.stat(temporary);state.pending=[{id:link.id,sourceId:source.id,link,temporary,tempIdentity:{dev:temp.dev,ino:temp.ino},previousHash:null,backup:null}];await fs.writeFile(stateFile,JSON.stringify(state));
  await fs.unlink(first.path);await fs.link(temporary,first.path);const recovered=await openPresentationLedger(f.options);assert.equal((await recovered.changes()).items[0].kind,'recovered');const retry=await recovered.writeConversion({sourceId:source.id,expectedSourceHash:source.sha256,outputRoot:f.outputRoot,filename:'Song.pptx',bytes:Buffer.from('generated twice'),direction:'to-pptx'});assert.equal(retry.status,'unchanged');assert.deepEqual(await fs.readdir(f.outputRoot),['Song.pptx']);
 }finally{await f.cleanup();}
});
test('interrupted prepared writes are discarded rather than resumed and cannot replace a later human edit',async()=>{
 const f=await fixture();try{
  const source=await f.source(),first=await convert(f,source),stateFile=path.join(f.directory,'relationships.json'),state=JSON.parse(await fs.readFile(stateFile,'utf8')),link=state.links[first.id],temporary=path.join(f.outputRoot,'.stati-sync-'+crypto.randomUUID()+'.tmp');await fs.writeFile(temporary,'pending new slides');const temp=await fs.stat(temporary);state.pending=[{id:link.id,sourceId:source.id,link:{...link,targetHash:hash('pending new slides')},temporary,tempIdentity:{dev:temp.dev,ino:temp.ino},previousHash:link.targetHash,backup:null}];await fs.writeFile(stateFile,JSON.stringify(state));await fs.writeFile(first.path,'late human edit');
  const reopened=await openPresentationLedger(f.options);assert.equal((await reopened.changes()).items[0].kind,'conflict');assert.equal(await fs.readFile(first.path,'utf8'),'late human edit');assert.deepEqual(await fs.readdir(f.outputRoot),['Song.pptx']);assert.deepEqual(JSON.parse(await fs.readFile(stateFile,'utf8')).pending,[]);
 }finally{await f.cleanup();}
});
test('native path confinement and stale scan checks reject renderer-style path substitutions and symlink targets',async()=>{
 const f=await fixture();try{
  const source=await f.source();await assert.rejects(convert(f,source,{filename:'../outside.pptx'}),/filename/);await assert.rejects(convert(f,source,{outputRoot:f.root}),/native output folder/);const forged={...source,path:path.join(f.root,'Outside.pro')};await fs.writeFile(forged.path,'outside');await assert.rejects(f.ledger.observe({files:[forged]}),/native presentation scanner/);
  await fs.writeFile(source.path,'changed after scan');await assert.rejects(f.ledger.observe({files:[source]}),/scanned presentation changed/);
  const folder=path.join(f.root,'Unrelated');await fs.mkdir(folder);const linked=path.join(f.root,'LinkedLyrics');await fs.symlink(folder,linked,'dir');await assert.rejects(openPresentationLedger({...f.options,outputRoots:[linked]}),/Linked folders/);
 }finally{await f.cleanup();}
});
test('Mac native roots preserve explicit iCloud discovery beneath the otherwise excluded Library directory',async()=>{
 const f=await fixture();try{
  const cloud=path.join(f.sourceRoot,'Library','Mobile Documents');await fs.mkdir(cloud,{recursive:true});await fs.writeFile(path.join(cloud,'Church.pptx'),'cloud deck');const roots=await computerRoots({home:f.sourceRoot,platform:'darwin',checkActive:f.checkActive,listVolumes:async()=>[]});assert.ok(roots.roots.includes(cloud));
  // Use this fixture's home/Cloud roots, avoiding a real /Users computer scan.
  const scanned=await scanPresentations({roots:roots.roots.filter(root=>root.startsWith(f.sourceRoot)),checkActive:f.checkActive});assert.equal(scanned.files.length,1);assert.equal(scanned.files[0].path,path.join(cloud,'Church.pptx'));assert.equal(scanned.completedRoots.length,2);
  await f.ledger.observe(scanned);await f.ledger.observe({files:[],completedRoots:[f.sourceRoot]});assert.notEqual((await f.ledger.changes()).items[0].kind,'source-missing');
 }finally{await f.cleanup();}
});
test('known-source refresh records edits, missing and unreadable separately without a full computer scan',async()=>{
 const f=await fixture();try{
  const changed=await f.source('Changed.pro'),missing=await f.source('Missing.pro'),unreadable=await f.source('Unreadable.pro');const first=await convert(f,changed);await fs.writeFile(changed.path,'edited source');await fs.unlink(missing.path);await fs.unlink(unreadable.path);await fs.symlink(changed.path,unreadable.path);
  const result=await f.ledger.refreshSources();assert.deepEqual({...result,complete:undefined,reason:undefined},{scanned:3,changed:1,missing:1,unreadable:1,unavailable:0,complete:undefined,reason:undefined});const history=await f.ledger.changes();assert.ok(history.items.some(item=>item.sourceId===unreadable.id&&item.kind==='source-unreadable'));assert.ok(!history.items.some(item=>item.sourceId===unreadable.id&&item.kind==='source-missing'));assert.equal((await f.ledger.listLinks()).items.find(link=>link.id===first.id).sourceChanged,true);assert.equal((await f.ledger.resolveSource(changed.id)).sha256,hash('edited source'));
  const bounded=await f.ledger.refreshSources({limits:{maxFiles:1}});assert.equal(bounded.complete,false);assert.equal(bounded.reason,'file-limit');assert.equal(bounded.scanned,1);
 }finally{await f.cleanup();}
});
test('post-journal CAS preserves an output edited during staging and clears the abandoned temporary write',async()=>{
 const f=await fixture();try{
  let source=await f.source();const first=await convert(f,source);source=await refresh(f,source,'new source');let changed=false;f.hook(()=>{const state=JSON.parse(require('node:fs').readFileSync(path.join(f.directory,'relationships.json'),'utf8'));if(state.pending.length&&!changed){changed=true;require('node:fs').writeFileSync(first.path,'human edit at commit');}});
  await assert.rejects(convert(f,source,{bytes:Buffer.from('new slides')}),/output changed during conversion/);assert.equal(changed,true);assert.equal(await fs.readFile(first.path,'utf8'),'human edit at commit');assert.deepEqual(await fs.readdir(f.outputRoot),['Song.pptx']);assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory,'relationships.json'),'utf8')).pending,[]);
 }finally{await f.cleanup();}
});
test('late cancellation after backup and journal preparation still prevents replacement',async()=>{
 const f=await fixture();try{
  let source=await f.source();const first=await convert(f,source);source=await refresh(f,source,'new source');const controller=new AbortController();f.hook(()=>{const state=JSON.parse(require('node:fs').readFileSync(path.join(f.directory,'relationships.json'),'utf8'));if(state.pending.length)controller.abort();});await assert.rejects(convert(f,source,{bytes:Buffer.from('late slides'),signal:controller.signal}),/abort/i);assert.equal(await fs.readFile(first.path,'utf8'),'generated slides');assert.deepEqual(await fs.readdir(f.outputRoot),['Song.pptx']);
 }finally{await f.cleanup();}
});
test('concurrent native conversions share the same durable reservation and produce one delivery',async()=>{
 const f=await fixture();try{
  const source=await f.source(),other=await openPresentationLedger(f.options),input={sourceId:source.id,expectedSourceHash:source.sha256,outputRoot:f.outputRoot,filename:'Song.pptx',bytes:Buffer.from('generated slides'),direction:'to-pptx'};const results=await Promise.all([f.ledger.writeConversion(input),other.writeConversion(input)]);assert.deepEqual(results.map(result=>result.status),['created','unchanged']);assert.equal(results[0].path,results[1].path);assert.deepEqual(await fs.readdir(f.outputRoot),['Song.pptx']);
 }finally{await f.cleanup();}
});
test('recovery cannot claim a different-inode external file even if its bytes equal a prepared output',async()=>{
 const f=await fixture();try{
  const source=await f.source(),first=await convert(f,source),stateFile=path.join(f.directory,'relationships.json'),state=JSON.parse(await fs.readFile(stateFile,'utf8')),link=state.links[first.id];delete state.links[first.id];const temporary=path.join(f.outputRoot,'.stati-sync-'+crypto.randomUUID()+'.tmp');await fs.writeFile(temporary,'generated slides');const temp=await fs.stat(temporary);state.pending=[{id:link.id,sourceId:source.id,link,temporary,tempIdentity:{dev:temp.dev,ino:temp.ino},previousHash:null,backup:null}];await fs.writeFile(stateFile,JSON.stringify(state));const reopened=await openPresentationLedger(f.options);assert.equal((await reopened.changes()).items[0].kind,'conflict');assert.equal((await reopened.listLinks()).items.length,0);assert.equal(await fs.readFile(first.path,'utf8'),'generated slides');
 }finally{await f.cleanup();}
});
test('filesystem checkpoints reject asynchronous authority callbacks instead of continuing before authorization resolves',async()=>{
 const f=await fixture();try{const source=await f.source();await assert.rejects(fingerprint(source.path,{checkActive:async()=>{throw Error('Denied later');}}),/synchronous native authorization/);}finally{await f.cleanup();}
});
test('stalled native file opens time out or cancel promptly and a late handle is closed without reading bytes',async()=>{
 for(const kind of ['deadline','cancel']){const f=await fixture(),actualOpen=fs.open;let release,opened;const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{opened=resolve;});try{
  const source=await f.source(),controller=new AbortController();fs.open=(file,...args)=>{if(file===source.path){opened();return held;}return actualOpen(file,...args);};const pending=fingerprint(source.path,{checkActive:f.checkActive,signal:controller.signal,maxDurationMs:kind==='deadline'?20:45000});await started;if(kind==='cancel')controller.abort();await assert.rejects(pending,kind==='cancel'?/abort/i:/timed out/);fs.open=actualOpen;
  const handle=await actualOpen(source.path,'r');let reads=0;handle.read=async()=>{reads++;throw Error('A canceled read must never start');};release(handle);await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,0);await assert.rejects(handle.stat(),/closed/);
 }finally{fs.open=actualOpen;await f.cleanup();}}
});
test('real ProPresenter resync preserves UUID/title while updating lyrics and keeping the previous native bytes',async()=>{
 const f=await fixture();try{
  const native=require('../desktop/presentation.cjs'),input=text=>({title:'Saved song',slides:[{section:'Verse',text}],fontSize:96,amenFontSize:36,language:'eng'});let source=await f.source('Original.pptx','original deck');const original=native.buildPresentation(input('Joy to the world\nThe Lord is come')),first=await convert(f,source,{filename:'Song.pro',direction:'to-pro',bytes:original});source=await refresh(f,source,'updated deck');
  const guarded=await openPresentationLedger({...f.options,validateReplacement:({oldBytes,newBytes})=>{const before=native.decode(oldBytes),after=native.decode(newBytes);assert.deepEqual(after.uuid,before.uuid);assert.equal(after.name,before.name);}});
  const result=await guarded.resync({id:first.id,build:async({targetPath})=>native.revisePresentation(await fs.readFile(targetPath),input('Come all ye faithful\nJoyful and triumphant'))});assert.equal(result.status,'resynced');assert.deepEqual(native.decode(await fs.readFile(result.path)).uuid,native.decode(original).uuid);assert.equal(native.decode(await fs.readFile(result.path)).name,'Saved song');assert.deepEqual(await fs.readFile(result.backup),original);assert.match(require('../desktop/library.cjs').songText(await fs.readFile(result.path),'.pro').text,/Come all ye faithful/);
 }finally{await f.cleanup();}
});
test('reopening history with a narrower native root preserves relationships but cannot read or repair an unavailable source',async()=>{
 const f=await fixture();try{
  const source=await f.source(),first=await convert(f,source),other=path.join(f.root,'Another native folder');await fs.mkdir(other);const narrowed=await openPresentationLedger({...f.options,sourceRoots:[other]});const link=(await narrowed.listLinks()).items.find(item=>item.id===first.id);assert.equal(link.sourceUnavailable,true);const refreshed=await narrowed.refreshSources();assert.equal(refreshed.unavailable,1);assert.equal(refreshed.scanned,0);await assert.rejects(narrowed.resolveSource(source.id),/outside the native scan folders/);let built=false;await assert.rejects(narrowed.resync({id:first.id,build:async()=>{built=true;return Buffer.from('unauthorized');}}),/outside the native scan folders/);assert.equal(built,false);assert.equal(await fs.readFile(first.path,'utf8'),'generated slides');assert.equal((await narrowed.changes()).total,(await f.ledger.changes()).total);
  await f.ledger.inspectOutputs();assert.equal((await f.ledger.listLinks()).items[0].outputStatus,'ready');const movedOutput=await openPresentationLedger({...f.options,outputRoots:[other]});await movedOutput.inspectOutputs();assert.equal((await movedOutput.listLinks()).items[0].outputStatus,'unavailable');
 }finally{await f.cleanup();}
});
test('an equivalent changed source can reuse its verified original output without gaining ownership of external edits',async()=>{
 const f=await fixture();try{
  let source=await f.source();const first=await convert(f,source);source=await refresh(f,source,'same lyrics with changed source metadata');const linked=await f.ledger.linkExisting({sourceId:source.id,expectedSourceHash:source.sha256,targetPath:first.path,expectedTargetHash:first.sha256,direction:'to-pptx'});assert.equal(linked.status,'unchanged');assert.equal((await f.ledger.listLinks()).items[0].sourceChanged,false);assert.equal((await f.ledger.listLinks()).items[0].owned,true);assert.deepEqual(await fs.readdir(f.outputRoot),['Song.pptx']);
  await fs.writeFile(first.path,'human edits');await assert.rejects(f.ledger.linkExisting({sourceId:source.id,expectedSourceHash:source.sha256,targetPath:first.path,expectedTargetHash:hash('human edits'),direction:'to-pptx'}),/different output version/);assert.equal(await fs.readFile(first.path,'utf8'),'human edits');
 }finally{await f.cleanup();}
});

test('two-way sync requires explicit opt-in and updates either unchanged peer with verified backups',async()=>{
 const f=await fixture();try{
  const source=await f.source(),created=await convert(f,source);await assert.rejects(f.ledger.enableTwoWay({id:created.id}),/Confirm/);await f.ledger.enableTwoWay({id:created.id,consent:true});
  await fs.writeFile(created.path,'edited PowerPoint');const reverse=await f.ledger.synchronize({id:created.id,build:async({source,target,direction})=>{assert.equal(direction,'to-pro');assert.equal(source.data.toString(),'edited PowerPoint');assert.equal(target.path,f.sourceRoot+'/Original.pro');return Buffer.from('new Pro lyrics');}});
  assert.equal(reverse.status,'resynced');assert.equal(await fs.readFile(source.path,'utf8'),'new Pro lyrics');assert.equal(await fs.readFile(reverse.backup,'utf8'),'original presentation');
  await fs.writeFile(source.path,'next Pro lyrics');const forward=await f.ledger.synchronize({id:created.id,build:async({source,target,direction})=>{assert.equal(direction,'to-pptx');assert.equal(source.data.toString(),'next Pro lyrics');assert.equal(target.data.toString(),'edited PowerPoint');return Buffer.from('updated existing PowerPoint');}});assert.equal(forward.status,'resynced');assert.equal(forward.path,created.path);assert.equal(await fs.readFile(forward.backup,'utf8'),'edited PowerPoint');
  assert.equal((await f.ledger.synchronize({id:created.id,build:async()=>{throw Error('No further write');}})).status,'unchanged');assert.equal((await f.ledger.listLinks()).items[0].twoWay,true);
 }finally{await f.cleanup();}
});
test('simultaneous edits and a missing counterpart never overwrite, delete or recreate either file',async()=>{
 const f=await fixture();try{
  const source=await f.source(),created=await convert(f,source);await f.ledger.enableTwoWay({id:created.id,consent:true});await fs.writeFile(source.path,'human Pro edit');await fs.writeFile(created.path,'human PPTX edit');let builds=0;
  const conflict=await f.ledger.synchronize({id:created.id,build:async()=>{builds++;return Buffer.from('must not write');}});assert.equal(conflict.status,'conflict');assert.equal(builds,0);assert.equal(await fs.readFile(source.path,'utf8'),'human Pro edit');assert.equal(await fs.readFile(created.path,'utf8'),'human PPTX edit');
  await fs.unlink(source.path);const missing=await f.ledger.synchronize({id:created.id,build:async()=>{builds++;return Buffer.from('must not recreate');}});assert.equal(missing.status,'missing');assert.match(missing.error,/Missing song in the ProPresenter library/);await assert.rejects(fs.stat(source.path),{code:'ENOENT'});assert.equal(builds,0);assert.equal(await fs.readFile(created.path,'utf8'),'human PPTX edit');
 }finally{await f.cleanup();}
});
test('late edits and identity loss during two-way preparation keep both endpoints intact',async()=>{
 for(const mode of ['edit','identity']){const f=await fixture();try{
  const source=await f.source(),created=await convert(f,source);await f.ledger.enableTwoWay({id:created.id,consent:true});await fs.writeFile(created.path,'PowerPoint edit');
  await assert.rejects(f.ledger.synchronize({id:created.id,build:async()=>{if(mode==='edit')await fs.writeFile(source.path,'late Pro edit');else f.deny();return Buffer.from('unaccepted update');}}),mode==='edit'?/changed during synchronization/:/Changed identity/);
  assert.equal(await fs.readFile(source.path,'utf8'),mode==='edit'?'late Pro edit':'original presentation');assert.equal(await fs.readFile(created.path,'utf8'),'PowerPoint edit');assert.ok(!(await fs.readdir(f.sourceRoot)).some(name=>name.startsWith('.stati-sync')));
 }finally{await f.cleanup();}}
});
test('ordinary reconversion cannot disable an enabled pair or replace its layout',async()=>{
 const f=await fixture();try{let source=await f.source(),created=await convert(f,source);await f.ledger.enableTwoWay({id:created.id,consent:true});source=await refresh(f,source,'changed source');const refused=await convert(f,source,{bytes:Buffer.from('full rebuild not allowed')});assert.equal(refused.status,'conflict');assert.match(refused.error,/two-way text/);assert.equal(await fs.readFile(created.path,'utf8'),'generated slides');assert.equal((await f.ledger.listLinks()).items[0].twoWay,true);}finally{await f.cleanup();}
});
test('source-side accepted-journal recovery retains its consent and baselines without repeating a write',async()=>{
 const f=await fixture();try{
  const source=await f.source(),created=await convert(f,source);await f.ledger.enableTwoWay({id:created.id,consent:true});const stateFile=path.join(f.directory,'relationships.json'),state=JSON.parse(await fs.readFile(stateFile,'utf8')),link=state.links[created.id],temporary=path.join(f.sourceRoot,'.stati-sync-'+crypto.randomUUID()+'.tmp'),bytes=Buffer.from('accepted source update');await fs.writeFile(temporary,bytes);const stat=await fs.stat(temporary);
  state.pending=[{id:link.id,sourceId:source.id,side:'source',link:{...link,sourceHash:hash(bytes)},temporary,tempIdentity:{dev:stat.dev,ino:stat.ino},previousHash:link.sourceHash}];await fs.writeFile(stateFile,JSON.stringify(state));await fs.rename(temporary,source.path);
  const reopened=await openPresentationLedger(f.options);assert.equal((await reopened.changes()).items[0].kind,'recovered');assert.equal((await reopened.listLinks()).items[0].twoWay,true);assert.equal((await reopened.listLinks()).items[0].sourceChanged,false);assert.equal((await reopened.synchronize({id:link.id,build:async()=>{throw Error('Must not repeat accepted write');}})).status,'unchanged');assert.deepEqual(await fs.readFile(source.path),bytes);
 }finally{await f.cleanup();}
});

test('a Windows sharing violation keeps both linked files and explains the retry',async()=>{
 const f=await fixture(),rename=fs.rename;try{
  const source=await f.source(),created=await convert(f,source);await f.ledger.enableTwoWay({id:created.id,consent:true});await fs.writeFile(created.path,'PowerPoint changed');
  fs.rename=async(from,to)=>{if(to===source.path)throw Object.assign(Error('Sharing violation'),{code:'EBUSY'});return rename(from,to);};
  await assert.rejects(f.ledger.synchronize({id:created.id,build:async()=>Buffer.from('replacement')}),/presentation app.*open/);assert.equal(await fs.readFile(source.path,'utf8'),'original presentation');assert.equal(await fs.readFile(created.path,'utf8'),'PowerPoint changed');assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory,'relationships.json'),'utf8')).pending,[]);
 }finally{fs.rename=rename;await f.cleanup();}
});
