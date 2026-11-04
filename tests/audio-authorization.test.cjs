const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
// Execute the actual native audio boundary with isolated authorities and clients.
// No OS dialog, real account, audio, credential, or ProPresenter is accessed.
function fixture(){
 const handlers=new Map(),events=[],drags=[],calls=[],held={};
 const authority={credential:'device-secret',userId:'admin-id',deviceId:'station-id',generation:4,lease:'lease-id',proof:'admin-proof'};
 const client={clear:()=>calls.push('clear'),prepareFiles:async(paths,{checkActive})=>{checkActive();calls.push(['prepare',paths]);return{state:'ready-to-import',files:[],failures:[],imported:false};},getPlaybackPlaylist:async()=>({state:'needs-playlist',playlist:null,imported:false}),focusPlayback:async()=>({focused:true,imported:false}),preparedPath:id=>{calls.push(['reveal',id]);return'/isolated/Playback/track.mp3';},startDrag:(ids,sender,_icon,{checkActive})=>{checkActive();drags.push(ids);}};
 const contents={isDestroyed:()=>false,send:(...args)=>events.push(args)},prepareWindow={isDestroyed:()=>false,webContents:contents};
 const context={AbortController,Map,Set,Promise,path,__dirname:path.resolve(__dirname,'../desktop'),quitting:false,sessionLocked:false,identitySkipped:false,privacyUnlocked:true,credential:authority.credential,operatorGeneration:authority.generation,operatorProof:authority.proof,activeOperator:{id:authority.userId,role:'admin',capabilities:{editLyrics:true}},main:prepareWindow,
  localOperatorSelection:{privateAuthority:()=>held.authority===null?null:{...authority,...held.authority}},
  workspaceOperator:async()=>{if(held.workspace)await held.workspace;return{id:authority.userId,deviceId:authority.deviceId,generation:4,capabilities:{editLyrics:true}};},
  playlistManager:()=>({settings:async()=>({port:50001})}),assertIdentity:generation=>{if(generation!==context.operatorGeneration)throw Error('Changed user');},
  app:{getPath:()=>'/isolated/Documents'},shell:{showItemInFolder:file=>calls.push(['show',file])},nativeImage:{createFromPath:()=>({})},process:{platform:'win32'},validSender:event=>event.trusted,
  handle:(name,fn)=>handlers.set(name,fn),ipcMain:{on:(name,fn)=>handlers.set(name,fn)},
  require:name=>name==='electron'?{dialog:{showOpenDialog:async()=>held.dialog?await held.dialog:{canceled:false,filePaths:['/isolated/original.mp3']}}}:name==='./audio-playback.cjs'?{createAudioPlayback:()=>client}:(()=>{throw Error('Unexpected module '+name);})(),
 };
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('let localAudioPlayback=null;'),source.indexOf("handle('workspace-context'")),context);
 return{context,handlers,held,authority,drags,calls,events,contents,client};
}
test('audio preparation requires a current administrator capability, lease, proof and unlocked identity before showing a chooser',async()=>{
 for(const mutate of [f=>{f.context.activeOperator.role='member';},f=>{f.context.activeOperator.capabilities.editLyrics=false;},f=>{f.context.operatorProof='stale';},f=>{f.held.authority=null;},f=>{f.held.authority={proof:'different'};},f=>{f.context.sessionLocked=true;},f=>{f.context.privacyUnlocked=false;},f=>{f.context.identitySkipped=true;},f=>{f.context.quitting=true;}]){
  const f=fixture();mutate(f);await assert.rejects(f.handlers.get('audio-choose')(),/administrator/);assert.equal(f.calls.filter(call=>Array.isArray(call)&&call[0]==='prepare').length,0);
 }
});
test('a chooser returning after an operator change cannot prepare or expose its files',async()=>{
 const f=fixture();let resolve;f.held.dialog=new Promise(done=>{resolve=done;});const choosing=f.handlers.get('audio-choose')();await new Promise(done=>setImmediate(done));f.context.operatorGeneration++;resolve({canceled:false,filePaths:['/isolated/original.mp3']});await assert.rejects(choosing,/administrator/);assert.equal(f.calls.filter(call=>Array.isArray(call)&&call[0]==='prepare').length,0);
});
test('trusted native audio drag is synchronous and cleared capabilities cannot be reused after switch or lock',async()=>{
 const f=fixture();await f.handlers.get('audio-choose')();const drag=f.handlers.get('audio-drag');
 drag({sender:f.contents,trusted:true},['private-id']);assert.deepEqual(f.drags,[['private-id']]);
 drag({sender:{},trusted:true},['private-id']);drag({sender:f.contents,trusted:false},['private-id']);assert.equal(f.drags.length,1);
 f.context.sessionLocked=true;drag({sender:f.contents,trusted:true},['private-id']);assert.equal(f.drags.length,1);assert.match(f.events.at(-1)[1],/administrator/);
 f.context.sessionLocked=false;f.context.clearAudioPlayback();drag({sender:f.contents,trusted:true},['private-id']);assert.equal(f.drags.length,1);assert.ok(f.calls.includes('clear'));
});
test('canceled chooser does not stage files or claim import',async()=>{
 const f=fixture();f.held.dialog=Promise.resolve({canceled:true,filePaths:[]});const result=await f.handlers.get('audio-choose')();assert.equal(result.canceled,true);assert.equal(result.imported,false);assert.equal(f.calls.filter(call=>Array.isArray(call)&&call[0]==='prepare').length,0);
});
