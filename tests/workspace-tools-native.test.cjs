const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync('desktop/main.cjs','utf8');
const user='11111111-1111-4111-8111-111111111111',service='22222222-2222-4222-8222-222222222222',device='33333333-3333-4333-8333-333333333333';
function fixture(){
 const handlers={},calls=[],held={},plan={id:service,title:'Local service',date:'2026-10-25',time:'10:00',notes:'Local note',revision:1,songs:[],tasks:[]};
 const context={AbortController,Set,path,credential:'local-credential',quitting:false,sessionLocked:false,privacyUnlocked:true,operatorGeneration:1,activeOperator:{id:user,capabilities:{readSongs:true,createSlides:true,editLyrics:true}},workspaceFileJobs:new Set(),prepareWindow:null,main:null,
  assertIdentity:generation=>{if(generation!==context.operatorGeneration)throw Error('Changed identity');},
  workspaceOperator:async capability=>{calls.push(['authorize',capability]);if(!context.activeOperator?.capabilities[capability])throw Error('Not allowed');return{id:user,deviceId:device,generation:context.operatorGeneration,capabilities:context.activeOperator.capabilities};},
  libraryDirectory:async()=>'/isolated/Lyrics',servicePlans:()=>({list:async id=>{calls.push(['list',id]);return[plan];}}),
  catalogChanged:()=>calls.push(['catalog']),playlistJobs:()=>({schedule:()=>calls.push(['schedule'])}),notifyServiceChange:()=>calls.push(['changed']),
  app:{getPath:name=>'/isolated/'+name},handle:(name,fn)=>{handlers[name]=fn;},
  advanced:{exportPowerPoint:async(data,_parent,_directory,checkActive,signal)=>{checkActive();calls.push(['powerpoint',data,signal]);return{path:'/isolated/output.pptx'};}},
  require:name=>{
   if(name==='electron')return{dialog:{showOpenDialog:async()=>held.open?held.open():{canceled:false,filePaths:['/isolated/chosen.mp3']},showSaveDialog:async()=>held.save?held.save():{canceled:false,filePath:'/isolated/service.zip'}}};
   if(name==='./song-save.cjs')return{
    listSongVersions:async(directory,id,check)=>{check();calls.push(['versions',directory,id]);return{versions:[]};},previewSongVersion:async(...args)=>{args.at(-1)();calls.push(['preview',...args.slice(0,-1)]);return{currentHash:'current'};},
    restoreSongVersion:async(...args)=>{if(held.restore)await held.restore();args.at(-1)();calls.push(['restore',...args.slice(0,-1)]);return{path:'/isolated/Lyrics/song.pro',title:'Song',contentHash:'restored'};},
   };
   if(name==='./service-rehearsal.cjs')return{readServiceRehearsal:async(directory,selected,options)=>{options.checkActive();calls.push(['rehearsal',directory,selected,options.signal]);if(held.rehearsal)await held.rehearsal(options);return{id:selected.id};}};
   if(name==='./service-package.cjs')return{exportServicePackage:async options=>{options.checkActive();calls.push(['package',options]);return{path:options.destination,complete:true};}};
   throw Error('Unexpected boundary '+name);
  },
 };
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function withWorkspaceFiles('),source.indexOf('function draftOperator(')),context);
 return{context,handlers,calls,held,plan};
}
test('native tools authorize every operation before any filesystem or chooser boundary',async()=>{
 for(const [name,input,capability] of [['song-versions-list','song','editLyrics'],['song-version-preview',{},'editLyrics'],['song-version-restore',{},'editLyrics'],['powerpoint-export',{},'createSlides'],['service-rehearsal',service,'readSongs'],['rehearsal-audio',null,'readSongs'],['service-package-export',{id:service,options:{includeAudio:false}},'readSongs']]){
  const f=fixture();f.context.activeOperator.capabilities[capability]=false;await assert.rejects(f.handlers[name](input),/Not allowed/);assert.deepEqual(f.calls,[['authorize',capability]]);assert.equal(f.context.workspaceFileJobs.size,0);
 }
});
test('restoring uses current library/hash/version, refreshes catalog and playlists, and never attaches to the active service',async()=>{
 const f=fixture(),result=await f.handlers['song-version-restore']({id:'song',currentHash:'current',versionHash:'earlier'});
 assert.equal(result.contentHash,'restored');assert.deepEqual(f.calls.map(call=>call[0]),['authorize','restore','catalog','schedule','changed']);assert.deepEqual(f.calls[1].slice(1),['/isolated/Lyrics','song','current','earlier']);assert.equal(f.context.workspaceFileJobs.size,0);
});
test('service snapshots use the authorized native plan and cannot accept renderer paths or forged plans',async()=>{
 const f=fixture();await f.handlers['service-rehearsal'](service);const read=f.calls.find(call=>call[0]==='rehearsal');assert.equal(read[1],'/isolated/Lyrics');assert.equal(read[2],f.plan);assert.ok(read[3] instanceof AbortSignal);
 await assert.rejects(f.handlers['service-rehearsal']({id:service,songs:[{path:'/private/file'}]}),/saved service/);await assert.rejects(f.handlers['service-rehearsal']('44444444-4444-4444-8444-444444444444'),/no longer available/);
});
test('export includes only optional native-picked audio paths; renderer file paths are ignored',async()=>{
 const f=fixture();await f.handlers['service-package-export']({id:service,options:{includeAudio:true},audioPaths:['/private/renderer-file']});const options=f.calls.find(call=>call[0]==='package')[1];assert.equal(options.plan,f.plan);assert.deepEqual(Array.from(options.audioPaths),['/isolated/chosen.mp3']);assert.equal(options.destination,'/isolated/service.zip');assert.equal(options.directory,'/isolated/Lyrics');
 const g=fixture();g.held.open=()=>{assert.fail('No audio chooser for a song-only package');};await g.handlers['service-package-export']({id:service,options:{includeAudio:false}});assert.equal(g.calls.find(call=>call[0]==='package')[1].audioPaths.length,0);
});
test('native picker cancellation performs no export or rehearsal audio read',async()=>{
 const f=fixture();f.held.open=()=>({canceled:true});assert.equal((await f.handlers['service-package-export']({id:service,options:{includeAudio:true}})).canceled,true);assert.equal((await f.handlers['rehearsal-audio']()).canceled,true);assert.ok(!f.calls.some(call=>call[0]==='package'));
 const g=fixture();g.held.save=()=>({canceled:true});assert.equal((await g.handlers['service-package-export']({id:service,options:{includeAudio:false}})).canceled,true);assert.ok(!g.calls.some(call=>call[0]==='package'));
});
test('identity or access changes while a native chooser is open prevent publication',async()=>{
 for(const change of [f=>{f.context.operatorGeneration++;},f=>{f.context.sessionLocked=true;},f=>{f.context.privacyUnlocked=false;},f=>{f.context.credential='changed';},f=>{f.context.activeOperator.capabilities.readSongs=false;},f=>{f.context.quitting=true;}]){
  const f=fixture();f.held.save=()=>{change(f);return{canceled:false,filePath:'/isolated/service.zip'};};await assert.rejects(f.handlers['service-package-export']({id:service,options:{includeAudio:false}}));assert.ok(!f.calls.some(call=>call[0]==='package'));assert.equal(f.context.workspaceFileJobs.size,0);
 }
});
test('identity cancellation aborts in-flight rehearsal work and prevents a stale success response',async()=>{
 const f=fixture();f.held.rehearsal=async options=>{for(const controller of f.context.workspaceFileJobs)controller.abort();options.checkActive();};await assert.rejects(f.handlers['service-rehearsal'](service),{name:'AbortError'});assert.equal(f.context.workspaceFileJobs.size,0);
});
test('native tools reject malformed options and wrong archive extensions before publishing',async()=>{
 const f=fixture();await assert.rejects(f.handlers['service-package-export']({id:service,options:{includeAudio:'yes'}}),/valid service package/);f.held.save=()=>({filePath:'/isolated/wrong.exe'});await assert.rejects(f.handlers['service-package-export']({id:service,options:{includeAudio:false}}),/\.zip/);assert.ok(!f.calls.some(call=>call[0]==='package'));
});
test('the converter allows only local/blob rehearsal media under its content security policy',()=>{
 const html=fs.readFileSync('desktop/prepare.html','utf8'),policy=html.match(/Content-Security-Policy" content="([^"]+)"/)[1],media=policy.split(';').find(rule=>rule.trim().startsWith('media-src'));
 assert.equal(media.trim(),"media-src 'self' blob:");assert.doesNotMatch(media,/https?:|\*/);assert.match(policy,/script-src 'self' 'wasm-unsafe-eval'/);assert.match(policy,/object-src 'none'/);
});

test('create-only native members export new slides while existing-song history stays administrator-only',async()=>{
 const f=fixture();f.context.activeOperator.capabilities.editLyrics=false;
 const result=await f.handlers['powerpoint-export']({title:'New member slides'});assert.equal(result.path,'/isolated/output.pptx');assert.deepEqual(f.calls.filter(call=>call[0]==='authorize').map(call=>call[1]),['createSlides']);
 for(const name of ['song-versions-list','song-version-preview','song-version-restore'])await assert.rejects(f.handlers[name]({}),/Not allowed/);
});
