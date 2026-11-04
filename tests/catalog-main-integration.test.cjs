const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const fixturePath=path.resolve(__dirname,'background-receiver.test.cjs'),fixtureSource=fs.readFileSync(fixturePath,'utf8');
const load=vm.runInThisContext('(function(require,__dirname){'+fixtureSource.slice(0,fixtureSource.indexOf('\ntest('))+'\nreturn{fixture,drain,deferred};})',{filename:fixturePath});
const {fixture,drain,deferred}=load(createRequire(fixturePath),path.dirname(fixturePath));
const {createCatalogPublisher}=require('../desktop/catalog-publisher.cjs');
const directory='/mock/documents/ProPresenter/Libraries/Lyrics',config='/mock/userData/lyrics-folder.json',userId='catalog-admin-fixture-000001';
const entry=index=>({id:String(index).padStart(64,'0'),contentHash:'a'.repeat(64),title:'Fixture song '+index,filename:'Fixture '+index+'.pro',category:'Uncategorized',language:'eng',fontSize:96,text:'Fixture lyric '+index,firstSlide:'Fixture lyric '+index,addedAt:1,modifiedAt:1});
function nativeFixture({saved=true,readOnly=false,createOnly=false,activeTarget=null}={}){
 let publisher,folderPrompts=0,writes=0,beforeWrite=null,capabilities={readSongs:true,createSlides:createOnly||!readOnly,editLyrics:!readOnly,planServices:!readOnly},snapshot={songs:[entry(1)],unreadable:0};
 const workCalls=[],attachments=[];let f,targetReads=0;
 async function savedWrite(){await beforeWrite?.();writes++;snapshot={songs:[entry(1),entry(2)],unreadable:0};return{path:directory+'/Fixture 2.pro',contentHash:'b'.repeat(64)};}
 const advanced={
  async songsFolder(){if(!f.diskFiles.has(config)){folderPrompts++;f.diskFiles.set(config,Buffer.from(JSON.stringify({path:directory})));}return directory;},
  exportLyrics:savedWrite,exportPresentation:savedWrite,insertPresentation:savedWrite,
 };
 // Exercise the current presentation-tools handler while keeping its picker,
 // filesystem and conversion core isolated. The catalog must still wait for
 // the actual handler's completed conversion, not a legacy main-process path.
 const core={isRunning:()=>false,cancel(){},start:async(_window,_documents,_progress,options)=>{await options.checkActive();const result=await savedWrite();await options.checkActive();return{directory,results:[{status:'converted',path:result.path}]};}};
 const toolsPath=path.resolve(__dirname,'../desktop/presentation-tools.cjs'),toolsModule={exports:{}},toolsRequire=createRequire(toolsPath),toolDependencies={
  'node:fs/promises':{realpath:async value=>value,mkdir:async()=>{}},
  'electron':{dialog:{showOpenDialog:async()=>({canceled:false,filePaths:['/mock/documents/source.pptx']})}},
  './powerpoint-batch.cjs':core,
  './presentation-scan.cjs':{computerRoots:async({checkActive})=>{checkActive();return{roots:['/mock/documents'],issues:[]};},inside:(root,file)=>file===root||file.startsWith(root+'/')},
  './presentation-ledger.cjs':{openPresentationLedger:async()=>({})},
 };
 vm.runInThisContext('(function(require,module){'+fs.readFileSync(toolsPath,'utf8')+'\n})',{filename:toolsPath})(name=>Object.hasOwn(toolDependencies,name)?toolDependencies[name]:toolsRequire(name),toolsModule);
 f=fixture({startup:false,route:({endpoint})=>endpoint==='/station/workspace'?Response.json({deviceId:'station-fixture',userId,capabilities}):undefined,modules:{
  './advanced.cjs':advanced,
  './presentation-tools.cjs':toolsModule.exports,
  './catalog-publisher.cjs':{createCatalogPublisher:options=>(publisher=createCatalogPublisher({...options,delay:3600000}))},
  './conversion-work.cjs':async(task,...args)=>{workCalls.push({task,args});if(task==='catalog-snapshot')return snapshot;if(task==='catalog-search')return{items:[],total:0,scanned:0,categories:[],unreadable:0,warnings:[],offset:0};throw Error('Unexpected isolated work task: '+task);},
  './shared-services.cjs':{createSharedServiceStore:()=>({active:async()=>{targetReads++;return activeTarget;}})},
  './service-playlist-sync.cjs':{createServicePlaylistSync:()=>({})},
  './service-playlist-jobs.cjs':{createServicePlaylistJobs:()=>({attach:async(_operator,result,_paths,target)=>{attachments.push(target);return result;},schedule(){},cancel(){},async flush(){}})},
  './song-save.cjs':{saveLibrarySong:async(_directory,_id,_hash,_data,beforeCommit)=>{beforeCommit();return savedWrite();}},
  './powerpoint-batch.cjs':core,
 }});
 if(saved)f.diskFiles.set(config,Buffer.from(JSON.stringify({path:directory})));
 f.hooks.stat=async file=>file===directory?{isDirectory:()=>true}:undefined;
 return{...f,async ready(){await f.start();await drain();await f.invoke('access-status');f.selectOperator({id:userId,role:readOnly?'member':'admin',capabilities});await publisher.flush();await drain();},publisher:()=>publisher,workCalls,attachments,folderPrompts:()=>folderPrompts,targetReads:()=>targetReads,writes:()=>writes,setBeforeWrite:value=>{beforeWrite=value;},denyRead:()=>{capabilities={...capabilities,readSongs:false};}};
}
const publications=f=>f.http().filter(call=>call[2]==='/station/catalog').map(call=>JSON.parse(call[3].body));

test('actual native exports, insertion, batch conversion and editing share completed songs immediately without an active service',async()=>{
 for(const action of ['lyrics-export','presentation-export','presentation-insert','powerpoint-batch','song-library-save']){
  const f=nativeFixture();try{
   await f.ready();assert.equal(f.publisher().status().state,'ready');const before=publications(f).length;
   const started=deferred(),held=deferred();f.setBeforeWrite(async()=>{started.resolve();await held.promise;});
   const request=f.invoke(action,undefined,action==='song-library-save'?{id:'a'.repeat(64),contentHash:'b'.repeat(64),data:{}}:{});await started.promise;
   assert.equal(publications(f).length,before,action+' must wait for the local write');assert.equal(f.publisher().status().state,'ready');
   held.resolve();await request;assert.equal(f.publisher().status().state,'scheduled',action);await f.publisher().flush();
   const sent=publications(f).slice(before);assert.deepEqual(sent.map(row=>row.action),['begin','chunk','finish'],action);assert.equal(sent[0].count,2,action);assert.equal(f.writes(),1,action);
   assert.ok(f.attachments.every(target=>target===null));
  }finally{f.publisher()?.cancel();}
 }
});
test('first explicit Lyrics folder choice schedules sharing, while later library searches do not restart it',async()=>{
 const f=nativeFixture({saved:false});try{
  await f.ready();assert.equal(f.publisher().status().state,'waiting');assert.equal(f.folderPrompts(),0);assert.equal(publications(f).length,0);
  await f.invoke('song-library-search',undefined,{});assert.equal(f.folderPrompts(),1);assert.equal(f.publisher().status().state,'scheduled');await f.publisher().flush();
  const count=publications(f).length;assert.equal(f.publisher().status().state,'ready');
  await f.invoke('song-library-search',undefined,{});await f.invoke('song-library-search',undefined,{});
  assert.equal(f.folderPrompts(),1);assert.equal(f.publisher().status().state,'ready');assert.equal(publications(f).length,count);
 }finally{f.publisher()?.cancel();}
});
test('manual rescan is protected, can choose a missing folder for an administrator, and exposes only a safe sync summary',async()=>{
 const f=nativeFixture({saved:false});try{
  await f.ready();const result=await f.invoke('song-library-rescan');assert.equal(result.state,'ready');assert.equal(result.songCount,1);assert.ok(result.updatedAt>0);assert.equal(f.folderPrompts(),1);
  await drain();const disk=JSON.parse(f.diskFiles.get('/mock/userData/catalog-sync.json'));assert.equal(disk.deviceId,'station-fixture');assert.equal(disk.songCount,1);assert.equal(disk.updatedAt,result.updatedAt);
  const status=await f.invoke('song-library-sync-status');assert.equal(status.state,'ready');assert.doesNotMatch(JSON.stringify(status),/device-fixture|ProPresenter|Lyrics|private|credential/);
  f.denyRead();const count=publications(f).length;await assert.rejects(f.invoke('song-library-sync-status'),/role does not allow/);await assert.rejects(f.invoke('song-library-rescan'),/role does not allow/);assert.equal(publications(f).length,count);
  f.api.setState({activeOperator:null});await assert.rejects(f.invoke('song-library-sync-status'),/Choose your profile/);await assert.rejects(f.invoke('song-library-rescan'),/Choose your profile/);
 }finally{f.publisher()?.cancel();}
});
test('read-only profiles cannot trigger a background folder chooser when no Lyrics folder is configured',async()=>{
 const f=nativeFixture({saved:false,readOnly:true});try{
  await f.ready();await assert.rejects(f.invoke('song-library-rescan'),/Ask an administrator to choose/);assert.equal(f.folderPrompts(),0);assert.equal(publications(f).length,0);
 }finally{f.publisher()?.cancel();}
});
test('a late completed export after Switch User does not schedule a catalog under the changed profile',async()=>{
 const f=nativeFixture();try{
  await f.ready();const count=publications(f).length,held=deferred(),started=deferred();f.setBeforeWrite(async()=>{started.resolve();await held.promise;});
  const pending=f.invoke('presentation-insert',undefined,{}),failed=assert.rejects(pending,error=>error.name==='AbortError'||/selected user changed/.test(error.message));await started.promise;
  await f.invoke('operator',undefined,{id:null});held.resolve();await failed;
  assert.equal(f.publisher().status().state,'ready');assert.equal(publications(f).length,count);
 }finally{f.publisher()?.cancel();}
});

test('separate church and livestream exports do not look up or attach to an active service',async()=>{
 const selected={id:'active-service-fixture',title:'Active service'};
 const f=nativeFixture({activeTarget:selected});try{
  await f.ready();const targets=f.targetReads();
  for(const layoutCopy of ['church','stream-lyrics','stream-translation'])await f.invoke('presentation-export',undefined,{layoutCopy});
  assert.equal(f.writes(),3);assert.equal(f.targetReads(),targets,'output copies do not even resolve the active service');assert.deepEqual(f.attachments,[]);
  await f.invoke('presentation-export',undefined,{});assert.equal(f.targetReads(),targets+1);assert.deepEqual(f.attachments,[selected],'ordinary song export retains its existing service behavior');
 }finally{f.publisher()?.cancel();}
});

test('a create-only native profile saves new slides without changing the active service or existing library songs',async()=>{
 const f=nativeFixture({readOnly:true,createOnly:true,activeTarget:{id:'another-leaders-service'}});try{
  await f.ready();const reads=f.targetReads();await f.invoke('presentation-insert',undefined,{});await f.invoke('presentation-export',undefined,{});
  assert.equal(f.writes(),2);assert.equal(f.targetReads(),reads);assert.deepEqual(f.attachments,[]);await assert.rejects(f.invoke('song-library-save',undefined,{id:'song',contentHash:'hash',data:{}}),/role does not allow/);
 }finally{f.publisher()?.cancel();}
});
