const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync('desktop/main.cjs','utf8');
function fixture(){
 const handlers={},writes=[];let admin=false,role='admin',response=1;
 const settings={enabled:true,port:50001,serviceRetention:'never',clearPlaylistItems:false};
 const context={localAudioPlayback:null,clearAudioPlayback:()=>{writes.push('audio-clear');context.localAudioPlayback=null;},operatorGeneration:8,activeOperator:{id:'unit-admin',role:'admin'},main:null,localPlaylistJobs:{cancel:()=>writes.push('cancel')},draftOperator:()=>({id:'unit-admin',generation:8}),assertIdentity:generation=>{if(generation!==context.operatorGeneration)throw Error('Changed user');},
  sharedStationPoll:async()=>({paired:true,operatorGeneration:context.operatorGeneration,adminUnlocked:admin,device:{operator_id:'unit-admin'},members:[{id:'unit-admin',role}],transfers:[],requests:[]}),
  playlistManager:()=>({settings:async()=>({...settings}),saveSettings:async patch=>{writes.push(patch);return{...settings,...patch};}}),playlistJobs:()=>({schedule:()=>writes.push('scheduled')}),notifyServiceChange:()=>writes.push('changed'),handle:(name,fn)=>{handlers[name]=fn;},require:name=>name==='electron'?{dialog:{showMessageBox:async()=>({response})}}:require('node:module').createRequire(path.resolve('desktop/main.cjs'))(name)};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function playlistAdministrator('),source.indexOf("handle('service-templates-list'")),context);
 return{handlers,writes,context,allow:()=>{admin=true;},member:()=>{admin=true;role='member';},cancel:()=>{response=0;}};
}
test('playlist settings require a verified current administrator, including reads and cleanup changes',async()=>{
 const f=fixture();await assert.rejects(f.handlers['playlist-settings'](),/administrator/);await assert.rejects(f.handlers['playlist-settings-save']({enabled:false}),/administrator/);assert.deepEqual(f.writes,[]);
 f.member();await assert.rejects(f.handlers['playlist-settings-save']({serviceRetention:'day'}),/administrator/);assert.deepEqual(f.writes,[]);
 const g=fixture();g.allow();assert.equal((await g.handlers['playlist-settings']()).port,50001);await g.handlers['playlist-settings-save']({enabled:false});assert.equal(g.writes[1].enabled,false);
});
test('shared cleanup stays disabled and a stale operator cannot commit other playlist settings',async()=>{
 const f=fixture();f.allow();assert.equal((await f.handlers['playlist-settings']()).sharedServices,true);await assert.rejects(f.handlers['playlist-settings-save']({serviceRetention:'day'}),/cleanup for shared services/);assert.deepEqual(f.writes,[]);
 const g=fixture();g.allow();const original=g.context.playlistManager;g.context.playlistManager=()=>({...original(),settings:async()=>{const settings=await original().settings();g.context.operatorGeneration++;return settings;}});
 await assert.rejects(g.handlers['playlist-settings-save']({port:50002}),/Changed user/);assert.deepEqual(g.writes,[]);
});

test('changing the ProPresenter port invalidates prepared audio capabilities, while unchanged-port settings preserve them',async()=>{
 const f=fixture();f.allow();const scope={port:50001};f.context.localAudioPlayback=scope;
 await f.handlers['playlist-settings-save']({enabled:false});assert.equal(f.context.localAudioPlayback,scope);assert.equal(f.writes.includes('audio-clear'),false);
 await f.handlers['playlist-settings-save']({port:50002});assert.equal(f.context.localAudioPlayback,null);assert.equal(f.writes.filter(value=>value==='audio-clear').length,1);assert.equal(f.writes.at(-1),'changed');
});
