'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {serviceExpired}=require('./service-plans.cjs');
const {createProPresenterPlaylists,servicePlaylistName}=require('./propresenter-playlists.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const PHASES=new Set(['waiting','error','synced','disabled','review']);
const DEFAULT_SETTINGS=Object.freeze({enabled:true,port:50001,serviceRetention:'never',clearPlaylistItems:false});
function settingsValue(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(DEFAULT_SETTINGS,key))||typeof value.enabled!=='boolean'||typeof value.clearPlaylistItems!=='boolean'||!Number.isInteger(value.port)||value.port<1||value.port>65535||!['never','day','week'].includes(value.serviceRetention))throw Error('Choose valid service playlist settings.');
 return{enabled:value.enabled,port:value.port,serviceRetention:value.serviceRetention,clearPlaylistItems:value.clearPlaylistItems};
}
const fingerprint=plan=>crypto.createHash('sha256').update(JSON.stringify({title:plan.title,date:plan.date,time:plan.time,approvedVersionId:plan.approvedVersionId||null,songs:plan.songs.map(song=>[song.id,song.songId,song.contentHash,song.arrangement||null])})).digest('hex');
function createServicePlaylistSync({userData,protection,plansStore,apiFactory=createProPresenterPlaylists,readLibrary}={}){
 if(typeof userData!=='string'||!plansStore||typeof plansStore.list!=='function'||typeof plansStore.change!=='function'||typeof readLibrary!=='function'||typeof apiFactory!=='function')throw Error('Service playlist storage is not configured.');
 const pending=new Map(),cursors=new Map();let settingsPending=Promise.resolve();
 const profilePath=user=>{if(typeof user!=='string'||! /^[\w-]{20,60}$/.test(user))throw Error('Choose your profile first.');return path.join(userData,'service-playlist-sync-'+user+'.bin');};
 function secure(){if(!protection?.isEncryptionAvailable()||protection.getSelectedStorageBackend?.()==='basic_text')throw Error('Protected service playlist storage is unavailable.');}
 async function read(file,fallback){
  secure();try{const raw=await fs.readFile(file);if(raw.length>8*1024*1024)throw Error('Storage limit exceeded.');const data=JSON.parse(protection.decryptString(raw));if(data.version!==1)throw Error('Unsupported service playlist data.');return data;}catch(error){if(error.code==='ENOENT')return fallback();throw Error('Saved service playlist data could not be opened. It has been preserved.');}
 }
 async function write(file,value){
  secure();const raw=protection.encryptString(JSON.stringify(value));if(raw.length>8*1024*1024)throw Error('Service playlist storage is full. Existing data was preserved.');
  await fs.mkdir(userData,{recursive:true,mode:0o700});const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try{const output=await fs.open(temporary,'wx',0o600);try{await output.writeFile(raw);await output.sync();}finally{await output.close();}await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}
 }
 async function settings(){await settingsPending.catch(()=>{});const data=await read(path.join(userData,'service-playlist-settings.bin'),()=>({version:1,settings:{...DEFAULT_SETTINGS}}));return settingsValue(data.settings);}
 function saveSettings(patch){
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!Object.hasOwn(DEFAULT_SETTINGS,key)))throw Error('Choose valid service playlist settings.');
  const task=settingsPending.catch(()=>{}).then(async()=>{const file=path.join(userData,'service-playlist-settings.bin'),data=await read(file,()=>({version:1,settings:{...DEFAULT_SETTINGS}}));const next=settingsValue({...settingsValue(data.settings),...patch});await write(file,{version:1,settings:next});return next;});
  settingsPending=task;return task;
 }
 async function ledger(user){
  const data=await read(profilePath(user),()=>({version:1,services:{}}));
  try{
   if(!data.services||typeof data.services!=='object'||Array.isArray(data.services)||Object.keys(data.services).length>1000)throw Error();
   for(const [id,record] of Object.entries(data.services)){
    if(!UUID.test(id)||!record||typeof record.name!=='string'||record.name.length>120||!PHASES.has(record.phase)||typeof record.message!=='string'||record.message.length>600||typeof record.createAttempted!=='boolean'||typeof record.pendingWrite!=='boolean'||typeof record.removalRequested!=='boolean'||typeof record.cleanupPending!=='boolean'||!Array.isArray(record.ownedItems)||record.ownedItems.length>5000)throw Error();
    if(record.playlistId!==undefined&&!UUID.test(record.playlistId)||record.playlistName!==undefined&&(typeof record.playlistName!=='string'||record.playlistName.length>180)||record.fingerprint!==undefined&&!HASH.test(record.fingerprint))throw Error();
    for(const item of record.ownedItems)if(!item||!UUID.test(item.itemUuid)||!UUID.test(item.presentationUuid)||item.songId!==undefined&&!HASH.test(item.songId)||item.appearanceId!==undefined&&!(typeof item.appearanceId==='string'&&/^[\w-]{20,60}$/.test(item.appearanceId)))throw Error();
   }
  }catch{throw Error('Saved service playlist records are invalid. They have been preserved.');}
  return data;
 }
 function queue(user,work){
  profilePath(user);secure();const task=(pending.get(user)||Promise.resolve()).catch(()=>{}).then(work);pending.set(user,task);
  return task.finally(()=>{if(pending.get(user)===task)pending.delete(user);});
 }
 function recordFor(data,plan){
  if(!UUID.test(plan.id))throw Error('This service has an unsupported identifier. Keep it locally or create a new service.');
  let record=data.services[plan.id];if(!record){if(Object.keys(data.services).length>=1000)throw Error('Service playlist records have reached their storage limit.');const name=servicePlaylistName({serviceId:plan.id,date:plan.date,time:plan.time});record=data.services[plan.id]={name,playlistName:name,phase:'waiting',message:'Waiting for ProPresenter.',createAttempted:false,pendingWrite:false,removalRequested:false,cleanupPending:false,ownedItems:[]};}return record;
 }
 const refFor=(id,record)=>({serviceId:id,name:record.name,...(record.playlistName?{playlistName:record.playlistName}:{}),...(record.playlistId?{playlistId:record.playlistId}:{})});
 function summary(id,record,config,plan){
  let phase=record?.phase||'waiting',message=record?.message||'Waiting for ProPresenter.';
  if(!config.enabled){phase='disabled';message='ProPresenter playlist syncing is off.';}
  else if(record?.pendingWrite){phase='review';message='An earlier playlist update needs review in ProPresenter before more changes.';}
  else if(plan&&phase==='synced'&&record.fingerprint!==fingerprint(plan)){phase='waiting';message='Waiting to sync the latest service songs.';}
  return{serviceId:id,phase,message,...(record?.playlistName?{playlistName:record.playlistName}:{})};
 }
 function summaries(data,plans,config){
  const visible=plans.map(plan=>summary(plan.id,data.services[plan.id],config,plan));
  for(const [id,record] of Object.entries(data.services))if(record.removalRequested&&(record.cleanupPending||record.pendingWrite)&&!plans.some(plan=>plan.id===id))visible.push(summary(id,record,config));
  return visible;
 }
 // Atomic file replacement allows UI reads to use the last durable snapshot
 // without waiting for a network sync that may include ten slow API requests.
 async function list(user,{plans:knownPlans}={}){const [data,plans,config]=await Promise.all([ledger(user),knownPlans??plansStore.list(user),settings()]);return summaries(data,plans,config);}
 const canceled=signal=>{if(signal?.aborted){const error=Error('Service playlist sync canceled.');error.code='ABORTED';throw error;}};
 function apiFor(data,config){return apiFactory({baseUrl:'http://127.0.0.1:'+config.port+'/',blockedPlaylistIds:Object.values(data.services).filter(record=>record.pendingWrite&&record.playlistId).map(record=>record.playlistId)});}
 const failure=(record,error)=>{if(error.code==='WRITE_UNCONFIRMED'||record.pendingWrite){record.pendingWrite=true;record.phase='review';record.message='An earlier playlist update needs review in ProPresenter before more changes.';}else if(error.code==='CREATE_UNCONFIRMED'){record.phase='review';record.message='Playlist creation is not confirmed. Stați will look for its saved name without creating another copy.';}else{if(error.code==='CREATE_REJECTED'&&error.definiteRejection===true)record.createAttempted=false;record.phase=['CONNECTION_LOST','TIMEOUT','ABORTED','PRESENTATION_NOT_FOUND','LIBRARY_NOT_FOUND'].includes(error.code)?'waiting':'error';record.message=typeof error.message==='string'?error.message.slice(0,600):'Could not sync this service playlist.';}};
 async function requestRemoval(user,data,plan,config,signal){
  canceled(signal);
  const record=recordFor(data,plan);record.removalRequested=true;record.cleanupPending=!!(config.clearPlaylistItems&&record.playlistId&&record.ownedItems.length);record.phase=record.cleanupPending?'waiting':'review';record.message=record.cleanupPending?'Local service removed; waiting to clear its Stați-added playlist entries.':'Service removed locally. Its ProPresenter playlist is kept; playlist deletion is manual.';
  await write(profilePath(user),data);canceled(signal);await plansStore.change(user,{type:'delete',id:plan.id});
 }
 async function prepareRetention(user,data,plans,config,at,signal){
  // A station-wide snapshot is a cache of the cloud's authoritative plans.
  // Deleting only its local copy would resurrect it on the next fresh pull.
  // Shared retention must be committed to that authority before cache cleanup.
  const shared=typeof plansStore.isShared==='function'&&await plansStore.isShared(user);
  const removed=[];for(const plan of plans){canceled(signal);if(data.services[plan.id]?.removalRequested||!shared&&serviceExpired(plan,config.serviceRetention,at)){await requestRemoval(user,data,plan,config,signal);removed.push(plan.id);}}return removed;
 }
 async function clearRemoved(user,data,id,api,signal){
  const record=data.services[id];if(record.pendingWrite){failure(record,{code:'WRITE_UNCONFIRMED'});return;}
  try{
   canceled(signal);
   if(record.cleanupPending){await api.cleanupPlaylist(refFor(id,record),{ownedItems:record.ownedItems,signal,beforeWrite:async()=>{canceled(signal);record.pendingWrite=true;await write(profilePath(user),data);}});record.pendingWrite=false;record.ownedItems=[];record.cleanupPending=false;}
   record.phase='review';record.message='Service removed locally. Stați-added entries were cleared; the ProPresenter playlist itself remains.';
  }catch(error){failure(record,error);}await write(profilePath(user),data);
 }
 async function syncPlan(user,data,plan,api,signal){
  const record=recordFor(data,plan);if(record.pendingWrite){failure(record,{code:'WRITE_UNCONFIRMED'});return;}
  try{
   canceled(signal);
   const versions=new Map();for(const song of plan.songs){if(versions.has(song.songId)&&versions.get(song.songId)!==song.contentHash)throw Error('A repeated service song has a different saved version. Refresh its reference.');versions.set(song.songId,song.contentHash);}
   const ref=await api.ensureServicePlaylist({...refFor(plan.id,record),createAttempted:record.createAttempted},{signal,beforeCreate:async checkpoint=>{canceled(signal);record.createAttempted=true;record.playlistName=checkpoint.playlistName;await write(profilePath(user),data);},afterCreate:async created=>{record.playlistId=created.playlistId;record.playlistName=created.playlistName;await write(profilePath(user),data);canceled(signal);}});
   record.playlistId=ref.playlistId;record.playlistName=ref.playlistName;await write(profilePath(user),data);canceled(signal);
   const references=await readLibrary(user,plan,{signal});if(!Array.isArray(references)||references.length>1000)throw Error('The Lyrics service references are invalid.');
   const desired=[],missing=[],used=new Set();
   // Keep the exact owned entry for an unresolved song, while allowing other
   // additions/removals to proceed. An old unmapped ledger stays conservative
   // until every desired song resolves; never guess ownership from a title.
   for(const song of plan.songs){
    const matches=references.filter(item=>item?.songId===song.songId&&(!item.appearanceId||item.appearanceId===song.id)),ids=new Set(matches.map(item=>item.uuid?.toLowerCase()));
    if(ids.size===1&&UUID.test(matches[0]?.uuid||'')){const saved=record.ownedItems.find(item=>!used.has(item.itemUuid)&&(item.appearanceId===song.id||!item.appearanceId&&(!item.songId||item.songId===song.songId))&&item.presentationUuid===matches[0].uuid.toLowerCase());if(saved)used.add(saved.itemUuid);desired.push({uuid:matches[0].uuid.toLowerCase(),songId:song.songId,appearanceId:song.id,...(saved?{itemUuid:saved.itemUuid}:{})});continue;}
    missing.push(song.songId);
    const saved=record.ownedItems.find(item=>!used.has(item.itemUuid)&&(item.appearanceId===song.id||!item.appearanceId&&item.songId===song.songId));
    if(saved){used.add(saved.itemUuid);desired.push({uuid:saved.presentationUuid,itemUuid:saved.itemUuid,songId:song.songId,appearanceId:song.id});}
   }
   if(missing.length)for(const saved of record.ownedItems)if(!saved.songId&&!saved.appearanceId&&!used.has(saved.itemUuid)){used.add(saved.itemUuid);desired.push({uuid:saved.presentationUuid,itemUuid:saved.itemUuid});}
   const ordered=await api.orderPresentations(ref,desired,{ownedItems:record.ownedItems,signal,beforeWrite:async()=>{canceled(signal);record.pendingWrite=true;await write(profilePath(user),data);}});
   if(ordered.ownedItems.length!==desired.length)throw Object.assign(Error('Service playlist ownership could not be confirmed.'),{code:'WRITE_UNCONFIRMED'});
   record.ownedItems=ordered.ownedItems.map((item,index)=>({...item,...(desired[index].songId?{songId:desired[index].songId,appearanceId:desired[index].appearanceId}:{})}));record.pendingWrite=false;
   record.phase=missing.length?'waiting':'synced';record.message=missing.length?missing.length+' song(s) are waiting for their saved ProPresenter presentation.':'Service playlist is up to date.';if(!missing.length)record.fingerprint=fingerprint(plan);
  }catch(error){failure(record,error);}await write(profilePath(user),data);
 }
 function sync(user,{signal,now=Date.now()}={}){return queue(user,async()=>{
  canceled(signal);const config=await settings(),data=await ledger(user);let plans=await plansStore.list(user);await prepareRetention(user,data,plans,config,now,signal);plans=await plansStore.list(user);
  if(!config.enabled||signal?.aborted)return summaries(data,plans,config);
  const jobs=[...Object.entries(data.services).filter(([,record])=>record.removalRequested&&record.cleanupPending).map(([id])=>({id})),...plans.filter(plan=>!plan.archived&&!data.services[plan.id]?.removalRequested).map(plan=>({id:plan.id,plan}))];
  if(!jobs.length)return summaries(data,plans,config);
  const cursor=(cursors.get(user)||0)%jobs.length,selected=Array.from({length:Math.min(10,jobs.length)},(_,index)=>jobs[(cursor+index)%jobs.length]);cursors.set(user,(cursor+selected.length)%jobs.length);
  const api=apiFor(data,config);try{await api.probe({signal});}catch(error){for(const job of selected){const record=job.plan?recordFor(data,job.plan):data.services[job.id];failure(record,error);}await write(profilePath(user),data);return summaries(data,plans,config);}
  for(const job of selected){if(signal?.aborted)break;if(job.plan)await syncPlan(user,data,job.plan,api,signal);else await clearRemoved(user,data,job.id,api,signal);}
  return summaries(data,await plansStore.list(user),config);
 });}
 function cleanup(user,{now=Date.now(),signal}={}){return queue(user,async()=>{
  canceled(signal);const config=await settings(),data=await ledger(user),plans=await plansStore.list(user),removed=await prepareRetention(user,data,plans,config,now,signal);
  const jobs=Object.entries(data.services).filter(([,record])=>record.removalRequested&&record.cleanupPending).slice(0,10);
  if(config.enabled&&jobs.length&&!signal?.aborted){const api=apiFor(data,config);try{await api.probe({signal});for(const [id] of jobs){if(signal?.aborted)break;await clearRemoved(user,data,id,api,signal);}}catch(error){for(const [,record] of jobs)failure(record,error);await write(profilePath(user),data);}}
  return{removed,playlistDeletionSupported:false,pendingCleanup:Object.values(data.services).filter(record=>record.cleanupPending).length,summaries:summaries(data,await plansStore.list(user),config)};
 });}
 function remove(user,serviceId,{signal}={}){return queue(user,async()=>{
  canceled(signal);const config=await settings(),data=await ledger(user),plans=await plansStore.list(user),plan=plans.find(item=>item.id===serviceId);if(!plan)throw Error('Service plan unavailable.');await requestRemoval(user,data,plan,config,signal);
  const record=data.services[serviceId];if(config.enabled&&record.cleanupPending&&!signal?.aborted){const api=apiFor(data,config);try{await api.probe({signal});await clearRemoved(user,data,serviceId,api,signal);}catch(error){failure(record,error);await write(profilePath(user),data);}}
  return{serviceId,removed:true,playlistDeleted:false,manualDeletionRequired:!!(record.playlistId||record.createAttempted),pendingCleanup:record.cleanupPending,summary:summary(serviceId,record,config)};
 });}
 function importBindings(from,to,serviceIds){return queue(to,async()=>{if(from===to)return{imported:0};if(!Array.isArray(serviceIds)||serviceIds.length>100||serviceIds.some(id=>!UUID.test(id)))throw Error('Choose valid service bindings.');const [source,target]=await Promise.all([ledger(from),ledger(to)]);let imported=0;for(const id of serviceIds){if(source.services[id]&&!target.services[id]){target.services[id]=structuredClone(source.services[id]);imported++;}}if(Object.keys(target.services).length>1000)throw Error('Service playlist records are full. Existing records have been preserved.');if(imported)await write(profilePath(to),target);return{imported};});}
 async function flush(){await settingsPending;await Promise.all([...pending.values()]);}
 async function activeSong(station){
  const config=await settings();
  if(!config.enabled)return null;
  const data=await ledger(station);
  const records=Object.entries(data.services).filter(([,record])=>record.playlistId&&!record.pendingWrite&&!record.removalRequested);
  if(!records.length)return null;
  const live=await apiFor(data,config).activeSong();
  if(!live)return null;
  const matches=records.filter(([,record])=>record.playlistId.toLowerCase()===live.playlistId);
  if(matches.length!==1)return null;
  const [serviceId,record]=matches[0];
  const candidates=record.ownedItems.filter(item=>item.songId&&item.presentationUuid.toLowerCase()===live.presentationId);
  const byItem=candidates.filter(item=>item.itemUuid.toLowerCase()===live.itemId);
  const songIds=new Set((byItem.length?byItem:live.itemId===live.presentationId?candidates:[]).map(item=>item.songId));
  return songIds.size===1?{serviceId,songId:[...songIds][0]}:null;
 }
 return{settings,saveSettings,list,sync,cleanup,remove,importBindings,activeSong,flush};
}
module.exports={createServicePlaylistSync,DEFAULT_SETTINGS};
