'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {randomUUID}=require('node:crypto');
const {createProPresenterPlaylists,servicePlaylistName}=require('../desktop/propresenter-playlists.cjs');
// This is an isolated local HTTP simulator of the documented API. It is not a
// ProPresenter runtime check and does not touch a real presentation library.
const songA={uuid:'11111111-1111-4111-8111-111111111111',name:'Same song title'};
const songB={uuid:'22222222-2222-4222-8222-222222222222',name:'Same song title'};
const clone=value=>JSON.parse(JSON.stringify(value));
const header=name=>({id:{uuid:'',name,index:0},type:'header',is_hidden:false,is_pco:false,header_color:{red:1,green:1,blue:1,alpha:1}});
function presentation(song,id=randomUUID(),index=0){return{id:{uuid:id,name:song.name,index},type:'presentation',is_hidden:false,is_pco:false,presentation_info:{presentation_uuid:song.uuid},target_uuid:song.uuid};}
async function fixture(t,{override,items=[],library=[songA,songB],timeoutMs=1500,maxBytes}={}){
 const state={tree:[],items:new Map(),calls:[],library:clone(library),version:{name:'Local simulator',platform:'win',host_description:'HTTP simulator, not ProPresenter 7.11',api_version:'v1'},override};
 state.create=(name,initial=[])=>{const id=randomUUID();const node={id:{uuid:id,name,index:state.tree.length},type:'playlist'};state.tree.push(node);state.items.set(id,clone(initial));return node;};
 const server=http.createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;
   const body=raw?JSON.parse(raw):undefined,url=new URL(req.url,'http://127.0.0.1');
   state.calls.push({method:req.method,path:url.pathname,body});
   if(await state.override?.(req,res,state,{body,url}))return;
   const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(value===undefined?undefined:JSON.stringify(value));};
   if(req.method==='GET'&&url.pathname==='/version')return send(200,state.version);
   if(req.method==='GET'&&url.pathname==='/v1/playlists')return send(200,state.tree);
   if(req.method==='POST'&&url.pathname==='/v1/playlists')return send(200,state.create(body.name));
   if(req.method==='GET'&&url.pathname==='/v1/libraries')return send(200,[{id:{uuid:randomUUID(),name:'Lyrics',index:0}}]);
   if(req.method==='GET'&&url.pathname==='/v1/library/Lyrics')return send(200,{updateType:'all',items:state.library});
   const match=url.pathname.match(/^\/v1\/playlist\/([\w-]+)$/);
   if(match){
    const id=match[1],node=state.tree.flatMap(item=>item.type==='group'?item.playlists:[item]).find(item=>item.id.uuid===id);
    if(!node)return send(404,{});
    if(req.method==='GET')return send(200,{id:node.id,items:state.items.get(id)});
    if(req.method==='PUT'){
     const previous=new Set(state.items.get(id).map(item=>item.id.uuid));
     // ProPresenter can give a presentation its own playlist-entry UUID.
     state.items.set(id,body.map((item,index)=>({...item,id:{...item.id,index,...(item.type==='presentation'&&!previous.has(item.id.uuid)?{uuid:randomUUID()}:{})}})));
     return send(204);
    }
   }
   send(404,{});
  }catch(error){if(!res.destroyed){res.writeHead(500);res.end(JSON.stringify({error:error.message}));}}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const baseUrl='http://127.0.0.1:'+server.address().port;
 const api=createProPresenterPlaylists({baseUrl,timeoutMs,...(maxBytes?{maxBytes}:{})});
 const service={serviceId:randomUUID(),name:'Sunday morning'};
 if(items.length)state.initial=items;
 const ensure=()=>api.ensureServicePlaylist(service,{beforeCreate:async()=>{}});
 return{api,state,service,ensure,baseUrl};
}
test('rejects external, credentialed and path-bearing endpoints before any request',()=>{
 for(const baseUrl of ['https://127.0.0.1:50001','http://192.168.1.2:50001','http://example.com','http://user:secret@localhost:50001','http://127.0.0.1:50001/path','http://127.0.0.1:50001/?token=secret','file:///tmp/api'])assert.throws(()=>createProPresenterPlaylists({baseUrl}),{code:'INVALID_ENDPOINT'});
 assert.throws(()=>servicePlaylistName({serviceId:'not-a-uuid',name:'Sunday'}),{code:'INVALID_INPUT'});
});
test('probes the documented API version without claiming a physical-device test',async t=>{
 const {api,state}=await fixture(t);
 assert.deepEqual(await api.probe(),{apiVersion:'v1',description:state.version.host_description,platform:'win',playlistDeletionSupported:false});
 state.version.api_version='v2';await assert.rejects(api.probe(),{code:'UNSUPPORTED_API'});
});
test('requires a saved creation checkpoint, creates once and reuses the exact marker',async t=>{
 const {api,state,service}=await fixture(t);let checkpoint;
 await assert.rejects(api.ensureServicePlaylist(service),{code:'CHECKPOINT_REQUIRED'});
 const ref=await api.ensureServicePlaylist(service,{beforeCreate:async value=>{assert.equal(state.calls.filter(call=>call.method==='POST').length,0);checkpoint=value;}});
 assert.equal(checkpoint.createAttempted,true);assert.equal(ref.playlistName,servicePlaylistName(service));assert.equal(ref.created,true);
 assert.equal((await api.ensureServicePlaylist(service)).playlistId,ref.playlistId);
 assert.equal((await api.ensureServicePlaylist(ref)).playlistId,ref.playlistId);
 assert.equal(state.calls.filter(call=>call.method==='POST').length,1);
});
test('recovers an accepted create whose response was lost by exact marker lookup',async t=>{
 const {api,state,service}=await fixture(t,{override:(req,res,state,{body})=>{if(req.method==='POST'){state.create(body.name);req.socket.destroy();return true;}}});
 const result=await api.ensureServicePlaylist(service,{beforeCreate:async()=>{}});
 assert.equal(result.reconciled,true);assert.equal(state.tree.length,1);assert.equal(state.calls.filter(call=>call.method==='POST').length,1);
});
test('never replays an ambiguous create, including after restart, and can reconcile its late appearance',async t=>{
 const {api,state,service,baseUrl}=await fixture(t,{override:(req,res)=>{if(req.method==='POST'){req.socket.destroy();return true;}}});
 await assert.rejects(api.ensureServicePlaylist(service,{beforeCreate:async()=>{}}),{code:'CREATE_UNCONFIRMED',ambiguous:true});
 await assert.rejects(api.ensureServicePlaylist(service,{beforeCreate:async()=>{}}),{code:'CREATE_UNCONFIRMED'});
 const restarted=createProPresenterPlaylists({baseUrl});
 await assert.rejects(restarted.ensureServicePlaylist({...service,createAttempted:true}),{code:'CREATE_UNCONFIRMED'});
 const late=state.create(servicePlaylistName(service));
 assert.equal((await restarted.ensureServicePlaylist({...service,createAttempted:true})).playlistId,late.id.uuid);
 assert.equal(state.calls.filter(call=>call.method==='POST').length,1);
});
test('finds nested exact names and refuses duplicate names instead of mutating an arbitrary playlist',async t=>{
 const {api,state,service}=await fixture(t);
 const node=state.create(servicePlaylistName(service));state.tree=[{id:{uuid:randomUUID(),name:'Services',index:0},type:'group',playlists:[node]}];
 assert.equal((await api.ensureServicePlaylist(service)).playlistId,node.id.uuid);
 state.create(servicePlaylistName(service));await assert.rejects(api.ensureServicePlaylist(service),{code:'AMBIGUOUS_PLAYLIST'});
 assert.equal(state.calls.filter(call=>call.method==='PUT'||call.method==='POST').length,0);
});
test('resolves presentation UUIDs in Lyrics and never substitutes an equal title',async t=>{
 const {api}=await fixture(t);
 assert.deepEqual(await api.resolvePresentation({uuid:songB.uuid.toUpperCase()}),{...songB,libraryName:'Lyrics'});
 await assert.rejects(api.resolvePresentation({uuid:randomUUID()}),{code:'PRESENTATION_NOT_FOUND'});
});
test('adds songs idempotently while preserving manual entries and returns real playlist-item IDs',async t=>{
 const {api,state,ensure}=await fixture(t),ref=await ensure();
 const manual=[header('Manual header'),{id:{uuid:randomUUID(),name:'Announcement',index:1},type:'media',is_hidden:true,is_pco:false,duration:17,custom:{preserve:'all fields'}}];
 state.items.set(ref.playlistId,clone(manual));
 const added=await api.addPresentations(ref,[songA,songA]);assert.equal(added.added.length,1);assert.notEqual(added.added[0].itemUuid,songA.uuid);assert.equal(added.added[0].presentationUuid,songA.uuid);
 assert.deepEqual(state.items.get(ref.playlistId).slice(0,2),manual);
 const again=await api.addPresentations(ref,[songA]);assert.deepEqual(again.added,[]);assert.deepEqual(again.existing,[songA.uuid]);
 assert.equal(state.calls.filter(call=>call.method==='PUT').length,1);
});
test('serializes concurrent additions so both songs and the manual header survive',async t=>{
 const {api,state,ensure}=await fixture(t),ref=await ensure();state.items.set(ref.playlistId,[header('Keep')]);
 await Promise.all([api.addPresentations(ref,[songA]),api.addPresentations(ref,[songB])]);
 assert.equal(state.items.get(ref.playlistId).length,3);assert.equal(state.items.get(ref.playlistId)[0].id.name,'Keep');
});
test('refuses an update when a manual edit is detected between the reads',async t=>{
 const {api,state,ensure}=await fixture(t),ref=await ensure();let reads=0;
 state.override=(req,res,state,{url})=>{if(req.method==='GET'&&url.pathname==='/v1/playlist/'+ref.playlistId&&++reads===2)state.items.get(ref.playlistId).push(header('Added manually'));};
 await assert.rejects(api.addPresentations(ref,[songA]),{code:'CONCURRENT_CHANGE'});
 assert.equal(state.calls.filter(call=>call.method==='PUT').length,0);assert.equal(state.items.get(ref.playlistId)[0].id.name,'Added manually');
});
test('reconciles a committed PUT with a lost response and does not issue a second PUT',async t=>{
 const {api,state,ensure}=await fixture(t),ref=await ensure();
 state.override=(req,res,state,{body})=>{if(req.method==='PUT'){state.items.set(ref.playlistId,body);req.socket.destroy();return true;}};
 const result=await api.addPresentations(ref,[songA]);assert.equal(result.reconciled,true);assert.equal(result.added.length,1);assert.equal(state.calls.filter(call=>call.method==='PUT').length,1);
});
test('keeps an unconfirmed PUT explicit and never retries its mutation automatically',async t=>{
 const {api,state,ensure}=await fixture(t),ref=await ensure();state.override=(req,res)=>{if(req.method==='PUT'){req.socket.destroy();return true;}};
 await assert.rejects(api.addPresentations(ref,[songA]),{code:'WRITE_UNCONFIRMED',ambiguous:true,pendingWrite:true,playlistId:ref.playlistId});
 await assert.rejects(api.addPresentations(ref,[songB]),{code:'WRITE_UNCONFIRMED'});
 await assert.rejects(api.cleanupPlaylist(ref,{ownedItems:[]}),{code:'WRITE_UNCONFIRMED'});
 assert.equal(state.calls.filter(call=>call.method==='PUT').length,1);
});
test('restores durable unresolved-write guards while allowing read-only operator inspection',async t=>{
 const {state,ensure,baseUrl}=await fixture(t),ref=await ensure();
 const restarted=createProPresenterPlaylists({baseUrl,blockedPlaylistIds:[ref.playlistId]});
 assert.equal((await restarted.getServicePlaylist(ref)).id.uuid,ref.playlistId);
 await assert.rejects(restarted.addPresentations(ref,[songA]),{code:'WRITE_UNCONFIRMED',pendingWrite:true});
 await assert.rejects(restarted.cleanupPlaylist(ref,{ownedItems:[]}),{code:'WRITE_UNCONFIRMED'});
 assert.equal(state.calls.filter(call=>call.method==='PUT').length,0);
});
test('cleans only the recorded app entries, preserves manual duplicates and never sends DELETE',async t=>{
 const {api,state,ensure}=await fixture(t),ref=await ensure();state.items.set(ref.playlistId,[header('Manual header')]);
 const added=await api.addPresentations(ref,[songA]);const manual=presentation(songA,randomUUID(),2);state.items.get(ref.playlistId).push(manual);
 const result=await api.cleanupPlaylist(ref,{ownedItems:added.added});assert.equal(result.removed,1);assert.equal(result.playlistDeleted,false);assert.equal(result.manualDeletionRequired,true);
 assert.deepEqual(state.items.get(ref.playlistId).map(item=>item.id.name),['Manual header',songA.name]);assert.equal(state.items.get(ref.playlistId)[1].id.uuid,manual.id.uuid);
 assert.deepEqual(state.calls.filter(call=>call.method==='PUT').at(-1).body.map(item=>item.id.index),[0,1]);
 assert.equal((await api.cleanupPlaylist(ref,{ownedItems:added.added})).removed,0);
 await assert.rejects(api.deletePlaylist(ref),{code:'UNSUPPORTED_OPERATION'});assert.equal(state.calls.filter(call=>call.method==='DELETE').length,0);
});
test('rejects a renamed or unrelated playlist without writing to it',async t=>{
 const {api,state,ensure}=await fixture(t),ref=await ensure();state.tree[0].id.name='Renamed by operator';
 await assert.rejects(api.addPresentations(ref,[songA]),{code:'UNMANAGED_PLAYLIST'});
 await assert.rejects(api.cleanupPlaylist({...ref,playlistName:'Other playlist'},{ownedItems:[]}),{code:'UNMANAGED_PLAYLIST'});
 assert.equal(state.calls.filter(call=>call.method==='PUT').length,0);
});
test('bounds the complete response body, including a server that sends headers then stalls',async t=>{
 const {api}=await fixture(t,{timeoutMs:50,override:(req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write('{');return true;}});
 await assert.rejects(api.probe(),{code:'TIMEOUT'});
});
test('rejects both declared and streamed oversized responses and does not follow redirects',async t=>{
 for(const mode of ['declared','streamed','redirect']){
  const {api,state}=await fixture(t,{maxBytes:128,override:(req,res)=>{if(mode==='redirect'){res.writeHead(302,{Location:'http://example.com/'});res.end();}else{res.writeHead(200,mode==='declared'?{'Content-Length':'99999'}:{});res.end('x'.repeat(200));}return true;}});
  await assert.rejects(api.probe(),mode==='redirect'?{code:'HTTP_ERROR',status:302}:{code:'TOO_LARGE'});assert.equal(state.calls.length,1);
 }
});
test('rejects malformed JSON and supports cancellation before network activity',async t=>{
 const {api,state}=await fixture(t,{override:(req,res)=>{res.writeHead(200);res.end('not json');return true;}});
 await assert.rejects(api.probe(),{code:'INVALID_RESPONSE'});
 const controller=new AbortController();controller.abort();await assert.rejects(api.probe({signal:controller.signal}),{code:'ABORTED'});assert.equal(state.calls.length,1);
});
test('uses service date and local time exactly, including future Tuesday at 9 PM',async t=>{
 const {api,state,service}=await fixture(t);Object.assign(service,{date:'2026-10-27',time:'21:00'});
 assert.equal(servicePlaylistName({...service,date:'2026-08-22',time:'20:48'}),'Aug 22, 8:48 PM');
 assert.equal(servicePlaylistName({...service,date:'2026-01-01',time:'00:05'}),'Jan 1, 12:05 AM');
 const ref=await api.ensureServicePlaylist(service,{beforeCreate:async()=>{}});assert.equal(ref.playlistName,'Oct 27, 9:00 PM');assert.equal(state.tree[0].id.name,'Oct 27, 9:00 PM');
 assert.equal((await api.ensureServicePlaylist(ref)).playlistId,ref.playlistId);
 const foreign={...service,serviceId:randomUUID()};await assert.rejects(api.ensureServicePlaylist(foreign,{beforeCreate:async()=>{}}),{code:'PLAYLIST_NAME_IN_USE'});assert.equal(state.calls.filter(call=>call.method==='POST').length,1);
});
test('definite creation rejection permits a corrected retry; timeouts still never replay',async t=>{
 const {api,state,service}=await fixture(t);let reject=true;state.override=(req,res)=>{if(req.method==='POST'&&reject){res.writeHead(400);res.end('{}');return true;}};
 await assert.rejects(api.ensureServicePlaylist(service,{beforeCreate:async()=>{}}),{code:'CREATE_REJECTED',status:400,definiteRejection:true});
 reject=false;const ref=await api.ensureServicePlaylist(service,{beforeCreate:async()=>{}});assert.ok(ref.playlistId);assert.equal(state.calls.filter(call=>call.method==='POST').length,2);assert.equal(state.tree.length,1);
});
test('reorders and removes only exact owned playlist entries while preserving manual material and presentation files',async t=>{
 const {api,state,ensure}=await fixture(t),ref=await ensure();state.items.set(ref.playlistId,[header('Before')]);const added=await api.addPresentations(ref,[songA,songB]);
 const owned=[...added.added],manual=presentation(songA,randomUUID(),3);state.items.get(ref.playlistId).splice(2,0,header('Middle'));state.items.get(ref.playlistId).push(manual);
 const ordered=await api.orderPresentations(ref,[songB,songA],{ownedItems:owned,beforeWrite:async()=>{}});assert.equal(ordered.changed,true);
 assert.deepEqual(state.items.get(ref.playlistId).map(item=>item.id.uuid||item.id.name),['Before',owned[1].itemUuid,'Middle',owned[0].itemUuid,manual.id.uuid]);
 const puts=state.calls.filter(call=>call.method==='PUT').length;assert.equal((await api.orderPresentations(ref,[songB,songA],{ownedItems:ordered.ownedItems})).changed,false);assert.equal(state.calls.filter(call=>call.method==='PUT').length,puts);
 const removed=await api.orderPresentations(ref,[songB],{ownedItems:ordered.ownedItems,beforeWrite:async()=>{}});assert.equal(removed.ownedItems.length,1);assert.deepEqual(state.items.get(ref.playlistId).map(item=>item.id.uuid||item.id.name),['Before',owned[1].itemUuid,'Middle',manual.id.uuid]);assert.equal(state.calls.some(call=>call.method==='DELETE'),false);
});
test('reordering preserves an uncertain-write checkpoint instead of blindly replaying it',async t=>{
 const {api,state,ensure}=await fixture(t),ref=await ensure(),added=await api.addPresentations(ref,[songA,songB]);state.override=(req,res)=>{if(req.method==='PUT'){req.socket.destroy();return true;}};
 await assert.rejects(api.orderPresentations(ref,[songB,songA],{ownedItems:added.added,beforeWrite:async()=>{}}),{code:'WRITE_UNCONFIRMED'});
 const puts=state.calls.filter(call=>call.method==='PUT').length;await assert.rejects(api.orderPresentations(ref,[songB,songA],{ownedItems:added.added}),{code:'WRITE_UNCONFIRMED'});assert.equal(state.calls.filter(call=>call.method==='PUT').length,puts);
});
test('repeated songs have independent owned playlist entries and can be reordered and removed without touching a manual repeat',async t=>{
 const {api,state,ensure}=await fixture(t),ref=await ensure(),manual=presentation(songA);state.items.set(ref.playlistId,[header('Keep'),manual]);
 let result=await api.orderPresentations(ref,[songA,songB,songA],{ownedItems:[],beforeWrite:async()=>{}});assert.equal(result.ownedItems.length,3);assert.equal(new Set(result.ownedItems.map(item=>item.itemUuid)).size,3);assert.ok(!result.ownedItems.some(item=>item.itemUuid===manual.id.uuid));
 assert.deepEqual(state.items.get(ref.playlistId).slice(2).map(item=>item.presentation_info.presentation_uuid),[songA.uuid,songB.uuid,songA.uuid]);
 result=await api.orderPresentations(ref,[songA,songA,songB],{ownedItems:result.ownedItems,beforeWrite:async()=>{}});assert.deepEqual(state.items.get(ref.playlistId).slice(2).map(item=>item.presentation_info.presentation_uuid),[songA.uuid,songA.uuid,songB.uuid]);
 result=await api.orderPresentations(ref,[songA],{ownedItems:result.ownedItems,beforeWrite:async()=>{}});assert.equal(result.ownedItems.length,1);assert.equal(state.items.get(ref.playlistId).length,3);assert.equal(state.items.get(ref.playlistId)[1].id.uuid,manual.id.uuid);
});
test('a rejected read after a successful POST does not clear creation proof or create a duplicate',async t=>{
 const {api,state,service}=await fixture(t);Object.assign(service,{date:'2026-10-27',time:'21:00'});let saved,unavailable=true;
 state.override=(req,res,_state,{url})=>{if(req.method==='GET'&&url.pathname.startsWith('/v1/playlist/')&&unavailable){res.writeHead(404);res.end('{}');return true;}};
 await assert.rejects(api.ensureServicePlaylist(service,{beforeCreate:async()=>{},afterCreate:async ref=>{saved=ref;}}),{code:'CREATE_UNCONFIRMED'});assert.ok(saved.playlistId);assert.equal(state.tree.length,1);unavailable=false;
 assert.equal((await api.ensureServicePlaylist({...saved,createAttempted:true})).playlistId,saved.playlistId);assert.equal(state.calls.filter(call=>call.method==='POST').length,1);
});
test('lost date-only creation response cannot adopt another matching playlist without UUID ownership',async t=>{
 const {api,state,service}=await fixture(t);Object.assign(service,{date:'2026-10-27',time:'21:00'});state.override=(req,res,_state,{body})=>{if(req.method==='POST'){state.create(body.name);req.socket.destroy();return true;}};
 await assert.rejects(api.ensureServicePlaylist(service,{beforeCreate:async()=>{}}),{code:'CREATE_UNCONFIRMED'});await assert.rejects(api.ensureServicePlaylist({...service,createAttempted:true}),{code:'CREATE_UNCONFIRMED'});assert.equal(state.tree.length,1);assert.equal(state.calls.filter(call=>call.method==='POST').length,1);
});

test('formats the requested service label without the service name and preserves existing saved date bindings',async t=>{
 const {api,state,service}=await fixture(t);
 assert.equal(servicePlaylistName({...service,date:'2026-10-12',time:'09:25'}),'Oct 12, 9:25 AM');
 const playlistName='Oct 12 - 9:25 AM',existing=state.create(playlistName);
 const bound=await api.ensureServicePlaylist({...service,playlistId:existing.id.uuid,playlistName});
 assert.equal(bound.playlistName,playlistName);assert.equal(state.calls.filter(call=>call.method==='POST').length,0);
});

test('service manager resolves saved native bytes through HTTP and syncs additions and removal despite a missing remaining file',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const {servicePlans}=require('../desktop/service-plans.cjs'),{createServicePlaylistSync}=require('../desktop/service-playlist-sync.cjs');
 const {buildPresentation,decode}=require('../desktop/presentation.cjs'),{readSong}=require('../desktop/song-catalog.cjs'),{playlistReferences}=require('../desktop/playlist-library.cjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-service-http-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const lyrics=path.join(root,'Lyrics');await fs.mkdir(lyrics);const saved=[],library=[];
 for(let index=0;index<3;index++){
  const file=path.join(lyrics,'song-'+index+'.pro'),bytes=buildPresentation({title:'Song '+index,slides:[{section:'Lyrics',text:'We sing with hope '+index}]});
  await fs.writeFile(file,bytes);const info=await readSong(lyrics,file);saved.push({file,bytes,reference:{songId:info.id,contentHash:info.contentHash,title:info.title,filename:path.basename(file)}});library.push({uuid:decode(bytes).uuid.string,name:info.title});
 }
 const {api,state}=await fixture(t,{library}),user=randomUUID(),protection={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
 const plans=servicePlans(root,protection);let [plan]=await plans.change(user,{type:'create',title:'Not shown',date:'2026-10-12',time:'09:25'});
 const make=()=>createServicePlaylistSync({userData:root,protection,plansStore:plans,apiFactory:()=>api,readLibrary:(_user,plan)=>playlistReferences(lyrics,plan.songs,{allowUnavailable:true})});
 await plans.change(user,{type:'attach-songs',songs:saved.slice(0,2).map(item=>item.reference)});assert.equal((await make().sync(user))[0].phase,'synced');
 assert.equal(state.tree[0].id.name,'Oct 12, 9:25 AM');const playlistId=state.tree[0].id.uuid,manual=header('Keep manual header');state.items.get(playlistId).push(manual);
 await fs.unlink(saved[0].file);[plan]=await plans.list(user);await plans.change(user,{type:'save',id:plan.id,plan:{...plan,songs:[plan.songs[0]]}});await plans.change(user,{type:'attach-songs',songs:[saved[2].reference]});
 assert.equal((await make().sync(user))[0].phase,'waiting');const actual=state.items.get(playlistId);
 assert.deepEqual(actual.filter(item=>item.type==='presentation').map(item=>item.presentation_info.presentation_uuid),[library[0].uuid,library[2].uuid]);assert.ok(actual.some(item=>item.type==='header'&&item.id.name==='Keep manual header'));
 assert.equal(state.calls.filter(call=>call.method==='PUT').length,2,'Each changed setlist uses one verified ordered update');
 [plan]=await plans.list(user);await plans.change(user,{type:'save',id:plan.id,plan:{...plan,songs:[]}});assert.equal((await make().sync(user))[0].phase,'synced');assert.deepEqual(state.items.get(playlistId).map(item=>item.type),['header']);
 for(const savedFile of saved.slice(1))assert.deepEqual(await fs.readFile(savedFile.file),savedFile.bytes);
});

test('unnamed group headings are traversed while concrete playlists still require exact names and UUIDs',async t=>{
 const {api,state,service}=await fixture(t);const node=state.create(servicePlaylistName(service));state.tree=[{type:'group',playlists:[node]}];
 const result=await api.ensureServicePlaylist(service);assert.equal(result.playlistId,node.id.uuid);assert.equal(state.calls.some(call=>call.method==='POST'),false);
 const report=await api.probe({playlists:true});assert.equal(report.playlistCount,1);assert.ok(state.calls.every(call=>call.method==='GET'));
});
test('connection check catches unsupported playlist shapes without writing or adopting an unidentified playlist',async t=>{
 const {api,state,service}=await fixture(t);state.tree=[{type:'group',children:[]}];
 await assert.rejects(api.probe({playlists:true}),{code:'INVALID_RESPONSE',message:/songs were kept/});assert.ok(state.calls.every(call=>call.method==='GET'));
 state.tree=[{type:'playlist',id:{name:servicePlaylistName(service)}}];await assert.rejects(api.ensureServicePlaylist(service),{code:'INVALID_RESPONSE'});assert.equal(state.calls.some(call=>call.method!=='GET'),false);
});

test('reads the exact active presentation and confirms a guarded slide jump', async t => {
 const presentationId = songA.uuid;
 let index = 0, id = presentationId, triggers = 0;
 const {api} = await fixture(t, {override: (req, res, _state, {url}) => {
  if (url.pathname === '/v1/presentation/slide_index') {
   res.writeHead(200, {'Content-Type':'application/json'});
   res.end(JSON.stringify({presentation_index:{index,presentation_id:{uuid:id}}}));
   return true;
  }
  if (url.pathname === '/v1/presentation/'+presentationId+'/3/trigger') {
   triggers++;
   index = 3;
   res.writeHead(204);
   res.end();
   return true;
  }
  return false;
 }});
 const current = await api.activeSlide();
 assert.deepEqual(current,{presentationId,index:0});
 assert.deepEqual(await api.triggerActiveSlide(current,3),{presentationId,index:3});
 await assert.rejects(api.triggerActiveSlide(current,3),{code:'SLIDE_CHANGED'});
 id = songB.uuid;
 await assert.rejects(api.triggerActiveSlide({presentationId,index:3},0),{code:'SLIDE_CHANGED'});
 assert.equal(triggers,1);
});
