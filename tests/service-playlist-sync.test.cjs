'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {servicePlans,serviceExpired}=require('../desktop/service-plans.cjs');
const {createServicePlaylistSync,DEFAULT_SETTINGS}=require('../desktop/service-playlist-sync.cjs');
const {servicePlaylistName}=require('../desktop/propresenter-playlists.cjs');
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
// Protection and the API below are isolated test doubles, not OS encryption or
// a physical ProPresenter instance. No production accounts/files are used.
const protection={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).map(byte=>byte^0xa9),decryptString:value=>Buffer.from(value).map(byte=>byte^0xa9).toString()};
const song=(index=1)=>({songId:crypto.createHash('sha256').update('song-'+index).digest('hex'),contentHash:crypto.createHash('sha256').update('bytes-'+index).digest('hex'),title:'Song '+index,filename:'song-'+index+'.pro'});
const problem=(code,message=code)=>Object.assign(Error(message),{code});
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stati-playlist-manager-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=servicePlans(directory,protection),remote={playlists:new Map(),calls:[],offline:false,failCreate:false,failWrite:false,factories:[]};
 const readLedger=async owner=>JSON.parse(protection.decryptString(await fs.readFile(path.join(directory,'service-playlist-sync-'+owner+'.bin'))));
 const apiFactory=options=>{
  remote.factories.push(options);
  return{
   activeSong:async()=>remote.active||null,
   probe:async()=>{remote.calls.push('probe');if(remote.offline)throw problem('CONNECTION_LOST','ProPresenter is offline.');return{apiVersion:'v1'};},
   ensureServicePlaylist:async(service,{beforeCreate,signal})=>{
    remote.calls.push('ensure:'+service.serviceId);if(signal?.aborted)throw problem('ABORTED');
    let value=remote.playlists.get(service.serviceId);if(!value){if(service.createAttempted)throw problem('CREATE_UNCONFIRMED');const playlistName=service.playlistName||servicePlaylistName(service);await beforeCreate({playlistName});const saved=(await readLedger(user)).services[service.serviceId];assert.equal(saved.createAttempted,true);if(remote.failCreate)throw problem('CREATE_UNCONFIRMED');value={serviceId:service.serviceId,name:service.name,playlistId:crypto.randomUUID(),playlistName,items:[]};remote.playlists.set(service.serviceId,value);}return{...value};
   },
   addPresentations:async(ref,songs,{beforeWrite,signal})=>{
    remote.calls.push('add:'+ref.serviceId);if(signal?.aborted)throw problem('ABORTED');
    assert.equal(options.blockedPlaylistIds.includes(ref.playlistId),false);
    const value=remote.playlists.get(ref.serviceId),added=[];
    const fresh=songs.filter(song=>!value.items.some(item=>item.presentationUuid===song.uuid));
    if(fresh.length){await beforeWrite();assert.equal((await readLedger(user)).services[ref.serviceId].pendingWrite,true);if(remote.failWrite)throw problem('WRITE_UNCONFIRMED');for(const song of fresh){const item={itemUuid:crypto.randomUUID(),presentationUuid:song.uuid};value.items.push(item);added.push(item);}}
    return{added};
   },
   orderPresentations:async(ref,songs,{ownedItems,beforeWrite,signal})=>{
    remote.calls.push('order:'+ref.serviceId);if(signal?.aborted)throw problem('ABORTED');assert.equal(options.blockedPlaylistIds.includes(ref.playlistId),false);
    const value=remote.playlists.get(ref.serviceId),owned=new Set(ownedItems.map(item=>item.itemUuid)),groups=new Map();
    for(const item of value.items)if(owned.has(item.itemUuid)){const group=groups.get(item.presentationUuid)||[];group.push(item);groups.set(item.presentationUuid,group);}
    const next=songs.map(song=>{const group=groups.get(song.uuid)||[],index=song.itemUuid?group.findIndex(item=>item.itemUuid===song.itemUuid):0;return(index>=0?group.splice(index,1)[0]:null)||{itemUuid:crypto.randomUUID(),presentationUuid:song.uuid};}),manual=value.items.filter(item=>!owned.has(item.itemUuid));
    if(JSON.stringify([...manual,...next])!==JSON.stringify(value.items)){await beforeWrite();assert.equal((await readLedger(user)).services[ref.serviceId].pendingWrite,true);if(remote.failWrite)throw problem('WRITE_UNCONFIRMED');value.items=[...manual,...next];}
    return{ownedItems:next};
   },
   cleanupPlaylist:async(ref,{ownedItems,beforeWrite,signal})=>{remote.calls.push('clear:'+ref.serviceId);if(signal?.aborted)throw problem('ABORTED');await beforeWrite();assert.equal((await readLedger(user)).services[ref.serviceId].pendingWrite,true);if(remote.failWrite)throw problem('WRITE_UNCONFIRMED');const value=remote.playlists.get(ref.serviceId),keys=new Set(ownedItems.map(item=>item.itemUuid));value.items=value.items.filter(item=>!keys.has(item.itemUuid));return{removed:ownedItems.length,playlistDeleted:false};}
  };
 };
 const references=new Map(),readLibrary=async(_user,plan)=>plan.songs.flatMap(song=>references.has(song.songId)?[{songId:song.songId,uuid:references.get(song.songId),name:song.title}]:[]);
 const make=(customReadLibrary=readLibrary)=>createServicePlaylistSync({userData:directory,protection,plansStore:store,apiFactory,readLibrary:customReadLibrary});
 const create=async(title='Sunday',date='2026-10-25')=>{const plans=await store.change(user,{type:'create',title,date,time:'10:00'});return plans.at(-1);};
 return{directory,store,remote,readLedger,references,make,manager:make(),create};
}
test('new services become active; selection persists by profile without changing revisions',async t=>{
 const {directory,store,create}=await fixture(t),first=await create('Morning'),second=await create('Evening');
 assert.equal(await store.active(user),second.id);await store.change(user,{type:'select',id:first.id});assert.equal(await servicePlans(directory,protection).active(user),first.id);
 assert.deepEqual((await store.state(user)).plans.map(plan=>[plan.id,plan.active,plan.revision]),[[first.id,true,1],[second.id,false,1]]);assert.equal(await store.active(other),null);
 await store.change(user,{type:'select',id:null});assert.equal(await store.active(user),null);assert.ok((await store.state(user)).plans.every(plan=>!plan.active));
});
test('bulk attachment deduplicates song IDs, updates a saved copy and accepts 400 songs',async t=>{
 const {store,create}=await fixture(t),plan=await create(),songs=Array.from({length:400},(_,index)=>song(index));
 await store.change(user,{type:'attach-songs',expectedActiveServiceId:plan.id,songs:[...songs,songs[0]]});let current=(await store.list(user))[0];assert.equal(current.songs.length,400);assert.equal(current.revision,2);
 const id=current.songs[0].id;await store.change(user,{type:'attach-songs',expectedActiveServiceId:plan.id,songs:[{...songs[0],contentHash:'b'.repeat(64)}]});current=(await store.list(user))[0];assert.equal(current.songs.length,400);assert.equal(current.songs[0].id,id);assert.equal(current.songs[0].contentHash,'b'.repeat(64));assert.equal(current.revision,3);
});
test('selection changes reject late attachments and stale editor saves cannot overwrite them',async t=>{
 const {store,create}=await fixture(t),first=await create('Morning');await create('Evening');
 await assert.rejects(store.change(user,{type:'attach-songs',expectedActiveServiceId:first.id,songs:[song()]}),/selected service changed/);
 await store.change(user,{type:'select',id:first.id});await store.change(user,{type:'attach-songs',expectedActiveServiceId:first.id,songs:[song()]});
 await assert.rejects(store.change(user,{type:'save',id:first.id,plan:{...first,notes:'Stale editor'}}),/changed while it was being edited/);assert.equal((await store.list(user))[0].songs.length,1);
 const current=(await store.list(user))[0];await store.change(user,{type:'save',id:first.id,plan:{...current,notes:'Fresh editor'}});assert.equal((await store.list(user))[0].revision,3);
});
test('old plan files acquire revision zero without a read-time rewrite',async t=>{
 const {directory,store,create}=await fixture(t),plan=await create();delete plan.revision;
 const file=path.join(directory,'service-plans-'+user+'.bin'),raw=protection.encryptString(JSON.stringify({version:1,plans:[plan]}));await fs.writeFile(file,raw);
 assert.equal((await store.list(user))[0].revision,0);assert.deepEqual(await fs.readFile(file),raw);
 await store.change(user,{type:'save',id:plan.id,plan:{...(await store.list(user))[0],notes:'New notes'}});assert.equal((await store.list(user))[0].revision,1);
});
test('retention uses Phoenix midnight and a week ending on Sunday',()=>{
 const sunday={date:'2026-10-25'},tuesday={date:'2026-10-20'};
 assert.equal(serviceExpired(sunday,'day',Date.parse('2026-10-26T06:59:59Z')),false);assert.equal(serviceExpired(sunday,'day',Date.parse('2026-10-26T07:00:00Z')),true);
 assert.equal(serviceExpired(tuesday,'week',Date.parse('2026-10-26T06:59:59Z')),false);assert.equal(serviceExpired(tuesday,'week',Date.parse('2026-10-26T07:00:00Z')),true);assert.equal(serviceExpired(tuesday,'never',Date.parse('2099-01-01')),false);
});
test('settings default to keeping services and playlist items and are shared, encrypted and validated',async t=>{
 const {manager,make,directory}=await fixture(t);assert.deepEqual(await manager.settings(),DEFAULT_SETTINGS);
 assert.equal((await manager.saveSettings({port:50002,serviceRetention:'week'})).clearPlaylistItems,false);assert.equal((await make().settings()).port,50002);
 assert.equal((await fs.readFile(path.join(directory,'service-playlist-settings.bin'))).includes(Buffer.from('serviceRetention')),false);
 await assert.rejects(manager.saveSettings({port:0}),/settings/);assert.throws(()=>manager.saveSettings({unexpected:true}),/settings/);
 assert.equal((await manager.settings()).port,50002);
});
test('sync checkpoints creation and writes, records owned items, and does not duplicate songs after restart',async t=>{
 const {manager,store,create,references,remote,readLedger,make}=await fixture(t),plan=await create(),saved=song();references.set(saved.songId,crypto.randomUUID());await store.change(user,{type:'attach-songs',songs:[saved]});
 assert.equal((await manager.sync(user))[0].phase,'synced');const ledger=await readLedger(user),record=ledger.services[plan.id];assert.equal(record.pendingWrite,false);assert.equal(record.ownedItems.length,1);assert.equal(record.createAttempted,true);
 await make().sync(user);assert.equal(remote.playlists.size,1);assert.equal(remote.playlists.get(plan.id).items.length,1);assert.deepEqual(await manager.list(other),[]);
});
test('missing .pro UUIDs report waiting instead of substituting another song',async t=>{
 const {manager,store,create,remote}=await fixture(t);await create();await store.change(user,{type:'attach-songs',songs:[song()]});const [summary]=await manager.sync(user);assert.equal(summary.phase,'waiting');assert.match(summary.message,/waiting for their saved ProPresenter/);assert.equal(remote.calls.filter(call=>call.startsWith('add:')).length,0);
});
test('one offline probe prevents fanout and rotating batches eventually create every service',async t=>{
 const {manager,create,remote}=await fixture(t);for(let index=0;index<12;index++)await create('Service '+index);remote.offline=true;
 await manager.sync(user);assert.deepEqual(remote.calls,['probe']);remote.offline=false;remote.calls=[];
 await manager.sync(user);assert.equal(remote.calls.filter(call=>call.startsWith('ensure:')).length,10);await manager.sync(user);assert.equal(remote.playlists.size,12);
});
test('listing uses the durable snapshot while a network probe is still pending',async t=>{
 const f=await fixture(t);await f.create();let release,entered;
 const started=new Promise(resolve=>{entered=resolve;}),waiting=new Promise(resolve=>{release=resolve;});
 const manager=createServicePlaylistSync({userData:f.directory,protection,plansStore:f.store,readLibrary:async()=>[],apiFactory:()=>({probe:async()=>{entered();await waiting;throw problem('CONNECTION_LOST');}})});
 const syncing=manager.sync(user);await started;
 const summaries=await Promise.race([manager.list(user),new Promise((_,reject)=>setTimeout(()=>reject(Error('Listing waited for network sync.')),200))]);assert.equal(summaries[0].phase,'waiting');release();await syncing;
});
test('creation ambiguity and unresolved writes remain protected across manager restart',async t=>{
 const f=await fixture(t),plan=await f.create();f.remote.failCreate=true;assert.equal((await f.manager.sync(user))[0].phase,'review');f.remote.failCreate=false;assert.equal((await f.make().sync(user))[0].phase,'review');assert.equal(f.remote.playlists.size,0);
 // A later exact marker appearance can reconcile a lost create response.
 const saved=await f.readLedger(user),record=saved.services[plan.id];f.remote.playlists.set(plan.id,{serviceId:plan.id,name:record.name,playlistId:crypto.randomUUID(),playlistName:record.playlistName,items:[]});
 const lyrics=song();f.references.set(lyrics.songId,crypto.randomUUID());await f.store.change(user,{type:'attach-songs',songs:[lyrics]});f.remote.failWrite=true;assert.equal((await f.make().sync(user))[0].phase,'review');assert.equal((await f.readLedger(user)).services[plan.id].pendingWrite,true);
 f.remote.failWrite=false;f.remote.calls=[];assert.equal((await f.make().sync(user))[0].phase,'review');assert.equal(f.remote.calls.filter(call=>call.startsWith('add:')).length,0);assert.ok(f.remote.factories.at(-1).blockedPlaylistIds.includes(record.playlistId||f.remote.playlists.get(plan.id).playlistId));
});
test('retention removes local plans while preserving Lyrics and keeps playlist cleanup opt-in',async t=>{
 const f=await fixture(t),plan=await f.create('Old service','2026-10-20'),lyrics=path.join(f.directory,'Lyrics');await fs.mkdir(lyrics);await fs.writeFile(path.join(lyrics,'song.pro'),'preserved original');await f.manager.sync(user);
 await f.manager.saveSettings({serviceRetention:'day'});const result=await f.manager.cleanup(user,{now:Date.parse('2026-10-21T07:00:00Z')});assert.deepEqual(result.removed,[plan.id]);assert.equal(result.playlistDeletionSupported,false);assert.equal((await f.store.list(user)).length,0);assert.equal(await fs.readFile(path.join(lyrics,'song.pro'),'utf8'),'preserved original');assert.equal(f.remote.calls.filter(call=>call.startsWith('clear:')).length,0);assert.equal(f.remote.playlists.size,1);
});
test('optional cleanup clears only owned entries and retries after an offline computer returns',async t=>{
 const f=await fixture(t),plan=await f.create(),lyrics=song();f.references.set(lyrics.songId,crypto.randomUUID());await f.store.change(user,{type:'attach-songs',songs:[lyrics]});await f.manager.sync(user);
 const manual={itemUuid:crypto.randomUUID(),presentationUuid:crypto.randomUUID()};f.remote.playlists.get(plan.id).items.push(manual);await f.manager.saveSettings({clearPlaylistItems:true});f.remote.offline=true;
 const removed=await f.manager.remove(user,plan.id);assert.equal(removed.pendingCleanup,true);assert.equal(removed.playlistDeleted,false);assert.equal((await f.store.list(user)).length,0);
 f.remote.offline=false;const cleaned=await f.make().cleanup(user);assert.equal(cleaned.pendingCleanup,0);assert.deepEqual(f.remote.playlists.get(plan.id).items,[manual]);assert.equal(f.remote.playlists.size,1);
});
test('aborted operations do not remove plans or create playlists and disabled sync makes no API calls',async t=>{
 const f=await fixture(t),plan=await f.create('Old','2026-10-20');await f.manager.saveSettings({serviceRetention:'day'});const controller=new AbortController();controller.abort();
 await assert.rejects(f.manager.cleanup(user,{signal:controller.signal,now:Date.parse('2026-10-21T07:00:00Z')}),{code:'ABORTED'});await assert.rejects(f.manager.remove(user,plan.id,{signal:controller.signal}),{code:'ABORTED'});assert.equal((await f.store.list(user)).length,1);assert.equal(f.remote.calls.length,0);
 await f.manager.saveSettings({enabled:false,serviceRetention:'never'});assert.equal((await f.manager.sync(user))[0].phase,'disabled');assert.equal(f.remote.calls.length,0);
});
test('damaged encrypted sync records fail closed without overwriting their bytes',async t=>{
 const f=await fixture(t);await f.create();const file=path.join(f.directory,'service-playlist-sync-'+user+'.bin');await fs.writeFile(file,'damaged');await assert.rejects(f.manager.sync(user),/preserved/);assert.equal(await fs.readFile(file,'utf8'),'damaged');
});
test('future Tuesday services sync immediately with date/time names and propagate saved order and removal',async t=>{
 const f=await fixture(t);let plan=await f.create('Tuesday','2026-10-27');plan=(await f.store.change(user,{type:'save',id:plan.id,plan:{...plan,time:'21:00'}}))[0];
 const first=song(1),second=song(2);f.references.set(first.songId,crypto.randomUUID());f.references.set(second.songId,crypto.randomUUID());await f.store.change(user,{type:'attach-songs',songs:[first,second]});
 assert.equal((await f.manager.sync(user,{now:Date.parse('2026-10-22T12:00:00Z')}))[0].phase,'synced');const remote=f.remote.playlists.get(plan.id);assert.equal(remote.playlistName,'Oct 27, 9:00 PM');assert.deepEqual(remote.items.map(item=>item.presentationUuid),[f.references.get(first.songId),f.references.get(second.songId)]);
 plan=(await f.store.list(user))[0];await f.store.change(user,{type:'save',id:plan.id,plan:{...plan,songs:[...plan.songs].reverse()}});await f.manager.sync(user);assert.deepEqual(remote.items.map(item=>item.presentationUuid),[f.references.get(second.songId),f.references.get(first.songId)]);
 plan=(await f.store.list(user))[0];await f.store.change(user,{type:'save',id:plan.id,plan:{...plan,songs:[]}});await f.manager.sync(user);assert.equal(remote.items.length,0);assert.equal((await f.readLedger(user)).services[plan.id].ownedItems.length,0);
});
test('shared station caches do not expire locally and reappear from the cloud snapshot',async t=>{const f=await fixture(t),plan=await f.create('Shared old service','2026-10-20');await f.store.replaceSharedSnapshot(user,{plans:[plan],activeServiceId:plan.id});await f.manager.saveSettings({serviceRetention:'day'});const result=await f.manager.cleanup(user,{now:Date.parse('2026-10-22T07:00:00Z')});assert.deepEqual(result.removed,[]);assert.equal((await f.store.list(user))[0].id,plan.id);});


test('moving local services to a station keeps the existing ProPresenter binding and its source recovery copy',async t=>{
 const f=await fixture(t),plan=await f.create();await f.manager.sync(user);const sourceFile=path.join(f.directory,'service-playlist-sync-'+user+'.bin'),sourceBytes=await fs.readFile(sourceFile),source=await f.readLedger(user);
 await f.store.replaceSharedSnapshot(other,{plans:await f.store.list(user),activeServiceId:plan.id});
 assert.deepEqual(await f.manager.importBindings(user,other,[plan.id]),{imported:1});const target=await f.readLedger(other);assert.equal(target.services[plan.id].playlistId,source.services[plan.id].playlistId);assert.equal(target.services[plan.id].playlistName,source.services[plan.id].playlistName);assert.deepEqual(await fs.readFile(sourceFile),sourceBytes);
 assert.deepEqual(await f.manager.importBindings(user,other,[plan.id]),{imported:0});await f.manager.sync(other);assert.equal(f.remote.playlists.size,1);
});

test('missing remaining songs keep their owned entries while additions and removals still sync, including after restart',async t=>{
 const f=await fixture(t),plan=await f.create(),first=song(1),second=song(2),third=song(3);
 for(const source of [first,second,third])f.references.set(source.songId,crypto.randomUUID());
 await f.store.change(user,{type:'attach-songs',songs:[first,second]});await f.manager.sync(user);
 const remote=f.remote.playlists.get(plan.id),kept=remote.items[0],manual={itemUuid:crypto.randomUUID(),presentationUuid:crypto.randomUUID()};remote.items.push(manual);
 f.references.delete(first.songId);let current=(await f.store.list(user))[0];
 await f.store.change(user,{type:'save',id:plan.id,plan:{...current,songs:[current.songs[0]]}});
 await f.store.change(user,{type:'attach-songs',songs:[third]});
 const summary=(await f.make().sync(user))[0];assert.equal(summary.phase,'waiting');
 assert.deepEqual(remote.items.map(item=>item.presentationUuid),[manual.presentationUuid,kept.presentationUuid,f.references.get(third.songId)]);
 assert.equal(remote.items.find(item=>item.presentationUuid===kept.presentationUuid).itemUuid,kept.itemUuid);
 current=(await f.store.list(user))[0];await f.store.change(user,{type:'save',id:plan.id,plan:{...current,songs:[]}});
 assert.equal((await f.make().sync(user))[0].phase,'synced');assert.deepEqual(remote.items,[manual]);
});

test('a repeated service song has separate owned appearances and deleting one preserves the other',async t=>{
 const f=await fixture(t),plan=await f.create(),source=song();f.references.set(source.songId,crypto.randomUUID());
 await f.store.change(user,{type:'attach-songs',songs:[source]});let current=(await f.store.list(user))[0];
 await f.store.change(user,{type:'save',id:plan.id,plan:{...current,songs:[current.songs[0],{...current.songs[0],id:crypto.randomUUID()}]}});
 await f.manager.sync(user);const remote=f.remote.playlists.get(plan.id);assert.equal(remote.items.length,2);assert.notEqual(remote.items[0].itemUuid,remote.items[1].itemUuid);
 const second=remote.items[1];current=(await f.store.list(user))[0];await f.store.change(user,{type:'save',id:plan.id,plan:{...current,songs:[current.songs[1]]}});
 await f.make().sync(user);assert.equal(remote.items.length,1);assert.equal(remote.items[0].presentationUuid,second.presentationUuid);assert.equal(remote.items[0].itemUuid,second.itemUuid);
});

test('conflicting version appearances never borrow one UUID from songId-only references, whichever version appears first',async t=>{
 for(const staleFirst of [true,false]){
  const f=await fixture(t),plan=await f.create(),source=song();f.references.set(source.songId,crypto.randomUUID());await f.store.change(user,{type:'attach-songs',songs:[source]});
  const current=(await f.store.list(user))[0],good=current.songs[0],stale={...good,id:crypto.randomUUID(),contentHash:'f'.repeat(64)};
  await f.store.change(user,{type:'save',id:plan.id,plan:{...current,songs:staleFirst?[stale,good]:[good,stale]}});
  const [summary]=await f.manager.sync(user);assert.equal(summary.phase,'error');assert.match(summary.message,/different saved version/);assert.equal(f.remote.playlists.size,0);assert.ok(f.remote.calls.every(call=>call==='probe'));
 }
});


test('appearance-scoped arranged references sync independently and arrangement edits invalidate the synced fingerprint',async t=>{
 const f=await fixture(t),plan=await f.create(),source=song();await f.store.change(user,{type:'attach-songs',songs:[source]});let current=(await f.store.list(user))[0],first={...current.songs[0],arrangement:{name:'Refrain',slides:[1,1]}},second={...first,id:crypto.randomUUID(),arrangement:{name:'Once',slides:[1]}};await f.store.change(user,{type:'save',id:plan.id,plan:{...current,songs:[first,second]}});
 const firstUuid=crypto.randomUUID(),secondUuid=crypto.randomUUID(),manager=f.make(async()=>[{songId:source.songId,appearanceId:first.id,uuid:firstUuid},{songId:source.songId,appearanceId:second.id,uuid:secondUuid}]);assert.equal((await manager.sync(user))[0].phase,'synced');assert.deepEqual(f.remote.playlists.get(plan.id).items.map(item=>item.presentationUuid),[firstUuid,secondUuid]);
 current=(await f.store.list(user))[0];await f.store.change(user,{type:'save',id:plan.id,plan:{...current,songs:[{...first,arrangement:{name:'Changed',slides:[1]}},second]}});assert.equal((await manager.list(user))[0].phase,'waiting');
});

test('summary rendering reuses the authoritative plans without another queued cloud read',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stati-summary-snapshot-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 let reads=0;const manager=createServicePlaylistSync({userData:directory,protection,plansStore:{list:async()=>{reads++;return[];},change:async()=>[]},readLibrary:async()=>[]});
 await manager.list(user,{plans:[]});assert.equal(reads,0);
 await manager.list(user);assert.equal(reads,1);
});


test('only a confirmed on-screen presentation in an owned service playlist is reported live',async t=>{
 const f=await fixture(t),plan=await f.create(),lyrics=song();
 f.references.set(lyrics.songId,crypto.randomUUID());
 await f.store.change(user,{type:'attach-songs',songs:[lyrics]});
 await f.manager.sync(user);
 assert.equal(await f.manager.activeSong(user),null);
 const {playlistId,items:[item]}=f.remote.playlists.get(plan.id);
 f.remote.active={playlistId,itemId:item.itemUuid,presentationId:item.presentationUuid};
 assert.deepEqual(await f.manager.activeSong(user),{serviceId:plan.id,songId:lyrics.songId});
 f.remote.active.itemId=crypto.randomUUID();
 assert.equal(await f.manager.activeSong(user),null);
 f.remote.active.itemId=item.itemUuid;
 f.remote.active.presentationId=crypto.randomUUID();
 assert.equal(await f.manager.activeSong(user),null);
 f.remote.active.presentationId=item.presentationUuid;
 f.remote.active.playlistId=crypto.randomUUID();
 assert.equal(await f.manager.activeSong(user),null);
});
