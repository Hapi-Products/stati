'use strict';
// Only the documented local HTTP API is used. ProPresenter 7.11 still needs a
// physical-PC compatibility check; the current spec has no playlist DELETE.
const http=require('node:http');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_TYPES=new Set(['presentation','placeholder','header','media','audio','livevideo']);
class ProPresenterError extends Error{
 constructor(code,message,details={}){super(message);this.name='ProPresenterError';this.code=code;Object.assign(this,details);}
}
const fail=(code,message,details)=>new ProPresenterError(code,message,details);
function uuid(value,label='UUID'){
 if(typeof value!=='string'||!UUID.test(value))throw fail('INVALID_INPUT','A valid '+label+' is required.');
 return value.toLowerCase();
}
function text(value,label,max=200){
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/u.test(value))throw fail('INVALID_INPUT','Choose a valid '+label+'.');
 return value.trim();
}
function servicePlaylistName({serviceId,name,date,time}){
 uuid(serviceId,'service UUID');
 if(date!==undefined||time!==undefined){
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw fail('INVALID_INPUT','Choose a valid service date and time.');
  const day=new Date(date+'T00:00:00Z');if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==date)throw fail('INVALID_INPUT','Choose a valid service date.');
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],hour=Number(time.slice(0,2));
  return months[day.getUTCMonth()]+' '+day.getUTCDate()+', '+(hour%12||12)+time.slice(2)+' '+(hour<12?'AM':'PM');
 }
 // Existing releases used this marker. Keep their saved UUID/name bindings.
 return text(name,'service name',120)+' [Stați:'+serviceId.toLowerCase()+']';
}
function serviceReference(input){
 if(!input||typeof input!=='object')throw fail('INVALID_INPUT','Choose a service created in Stați.');
 const serviceId=uuid(input.serviceId,'service UUID');
 const playlistName=input.playlistName===undefined?servicePlaylistName(input):text(input.playlistName,'playlist name',180);
 if(!playlistName.endsWith(' [Stați:'+serviceId+']')&&!/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([1-9]|[12]\d|3[01])(?: - |, )(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/.test(playlistName))throw fail('UNMANAGED_PLAYLIST','This playlist is not linked to this Stați service.');
 return{serviceId,playlistName,...(input.playlistId?{playlistId:uuid(input.playlistId,'playlist UUID')}:{})};
}
function localBase(value){
 let url;try{url=new URL(value);}catch{throw fail('INVALID_ENDPOINT','Choose a local ProPresenter HTTP address.');}
 if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw fail('INVALID_ENDPOINT','ProPresenter must use a loopback HTTP address without credentials or a path.');
 // Do not let a localhost DNS entry direct this request to another machine.
 if(url.hostname==='localhost')url.hostname='127.0.0.1';
 return url;
}
function integer(value,fallback,min,max,label){
 if(value===undefined)return fallback;
 if(!Number.isSafeInteger(value)||value<min||value>max)throw fail('INVALID_INPUT','Invalid '+label+'.');
 return value;
}
function playlistId(value){return value&&value.id&&uuid(value.id.uuid,'playlist UUID');}
function validItems(value){
 if(!Array.isArray(value)||value.length>5000)throw fail('INVALID_RESPONSE','ProPresenter returned an invalid or oversized playlist.');
 for(const item of value){
  if(!item||typeof item!=='object'||!item.id||!ITEM_TYPES.has(item.type)||typeof item.id.name!=='string'||!Number.isSafeInteger(item.id.index)||typeof item.is_hidden!=='boolean'||typeof item.is_pco!=='boolean'||!(item.id.uuid===null||item.id.uuid===''||typeof item.id.uuid==='string'&&UUID.test(item.id.uuid)))throw fail('INVALID_RESPONSE','ProPresenter returned an unsupported playlist item. Nothing was replaced.');
 }
 return value;
}
function presentationUuid(item){
 if(item.type!=='presentation')return null;
 const id=item.presentation_info?.presentation_uuid||item.target_uuid||item.id.uuid;
 return typeof id==='string'&&UUID.test(id)?id.toLowerCase():null;
}
function itemKey(item){
 // Item indices can change when ProPresenter inserts/reorders entries. A UUID
 // identifies an existing entry; headers have no UUID, so keep their full data.
 if(item.id.uuid)return item.type+':'+item.id.uuid.toLowerCase();
 const copy={...item,id:{...item.id}};delete copy.id.index;return JSON.stringify(copy);
}
function containsItems(items,expected){
 const counts=new Map();for(const item of items){const key=itemKey(item);counts.set(key,(counts.get(key)||0)+1);}
 for(const item of expected){const key=itemKey(item),left=counts.get(key)||0;if(!left)return false;counts.set(key,left-1);}return true;
}
function createProPresenterPlaylists(options={}){
 const base=localBase(options.baseUrl||'http://127.0.0.1:50001/');
 const timeoutMs=integer(options.timeoutMs,5000,25,30000,'request timeout');
 const maxBytes=integer(options.maxBytes,2*1024*1024,64,8*1024*1024,'response limit');
 if(options.blockedPlaylistIds!==undefined&&(!Array.isArray(options.blockedPlaylistIds)||options.blockedPlaylistIds.length>1000))throw fail('INVALID_INPUT','Invalid unresolved playlist records.');
 const uncertainPlaylists=new Set((options.blockedPlaylistIds||[]).map(value=>uuid(value,'playlist UUID')));
 const queues=new Map(),attemptedCreates=new Set();
 function request(method,path,data,signal){
  if(signal?.aborted)return Promise.reject(fail('ABORTED','ProPresenter request canceled.'));
  const payload=data===undefined?undefined:Buffer.from(JSON.stringify(data));
  if(payload?.length>maxBytes)return Promise.reject(fail('TOO_LARGE','This playlist exceeds the local API request limit.'));
  return new Promise((resolve,reject)=>{
   let settled=false,response;
   const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){response?.destroy();req.destroy();reject(error);}else resolve(value);};
   const req=http.request(new URL(path,base),{method,agent:false,headers:{Accept:'application/json',...(payload?{'Content-Type':'application/json','Content-Length':String(payload.length)}:{})}},res=>{
    response=res;const length=Number(res.headers['content-length']);
    if(Number.isFinite(length)&&length>maxBytes)return finish(fail('TOO_LARGE','ProPresenter returned too much data.'));
    const chunks=[];let bytes=0;
    res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)return finish(fail('TOO_LARGE','ProPresenter returned too much data.'));chunks.push(chunk);});
    res.on('error',()=>finish(fail('CONNECTION_LOST','The ProPresenter response was interrupted.')));
    res.on('aborted',()=>finish(fail('CONNECTION_LOST','The ProPresenter response was interrupted.')));
    res.on('end',()=>{
     if(res.statusCode<200||res.statusCode>=300)return finish(fail('HTTP_ERROR','ProPresenter returned HTTP '+res.statusCode+'.',{status:res.statusCode}));
     if(res.statusCode===204)return finish(null,null);
     let value;try{value=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}catch{return finish(fail('INVALID_RESPONSE','ProPresenter returned invalid JSON.'));}
     finish(null,value);
    });
   });
   const abort=()=>finish(fail('ABORTED','ProPresenter request canceled.'));
   const timer=setTimeout(()=>finish(fail('TIMEOUT','ProPresenter did not finish responding in time.')),timeoutMs);
   signal?.addEventListener('abort',abort,{once:true});
   req.on('error',()=>finish(fail('CONNECTION_LOST','Could not connect to ProPresenter. Enable its Network API and check the local port.')));
   req.end(payload);
  });
 }
 function serialized(key,work){
  const prior=queues.get(key)||Promise.resolve();
  const task=prior.catch(()=>{}).then(work);queues.set(key,task);
  void task.finally(()=>{if(queues.get(key)===task)queues.delete(key);}).catch(()=>{});
  return task;
 }
 async function readPlaylistTree(signal){
  const tree=await request('GET','/v1/playlists',undefined,signal),playlists=[];
  const unsupported=()=>fail('INVALID_RESPONSE','Stați could not read ProPresenter’s playlist list. Your songs were kept. Check Services & ProPresenter in Settings before retrying.');
  if(!Array.isArray(tree))throw unsupported();
  const pending=[...tree];let visited=0;
  while(pending.length){
   if(++visited>5000)throw fail('TOO_LARGE','ProPresenter returned too many playlists.');
   const item=pending.pop();if(!item||typeof item!=='object')throw unsupported();
   if(item.type==='group'){
    // Group identifiers are never used to adopt or modify a service playlist.
    // A heading may omit its name/id; its concrete playlist children may not.
    if(!Array.isArray(item.playlists)||item.playlists.length>5000)throw unsupported();
    pending.push(...item.playlists);
   }else if(item.type==='playlist'){
    if(!item.id||typeof item.id.name!=='string'||typeof item.id.uuid!=='string'||!UUID.test(item.id.uuid))throw unsupported();
    playlists.push(item);
   }else throw unsupported();
  }
  return playlists;
 }
 async function probe({signal,playlists=false}={}){
  const data=await request('GET','/version',undefined,signal);
  if(!data||data.api_version!=='v1'||typeof data.host_description!=='string'||!['win','mac','unknown'].includes(data.platform))throw fail('UNSUPPORTED_API','This ProPresenter instance does not report the supported v1 API.');
  const list=playlists?await readPlaylistTree(signal):null;
  return{apiVersion:data.api_version,description:data.host_description,platform:data.platform,playlistDeletionSupported:false,...(list?{playlistCount:list.length}:{})};
 }
 async function findExact(ref,signal){
  const tree=await readPlaylistTree(signal),matches=tree.filter(item=>item.id.name===ref.playlistName);
  if(matches.length>1)throw fail('AMBIGUOUS_PLAYLIST','More than one playlist matches this Stați service. Resolve the duplicate in ProPresenter before continuing.');
  return matches[0]?{playlistId:playlistId(matches[0])}:null;
 }
 async function managed(ref,signal){
  if(!ref.playlistId)throw fail('UNMANAGED_PLAYLIST','Create or reconnect this service playlist first.');
  const data=await request('GET','/v1/playlist/'+ref.playlistId,undefined,signal);
  if(!data||playlistId(data)!==ref.playlistId||data.id.name!==ref.playlistName)throw fail('UNMANAGED_PLAYLIST','This playlist was renamed or no longer matches the Stați service. Nothing was replaced.');
  validItems(data.items);return data;
 }
 async function ensureServicePlaylist(service,{beforeCreate,afterCreate,signal}={}){
  const ref=serviceReference(service);
  return serialized('service:'+ref.serviceId,async()=>{
   if(ref.playlistId){await managed(ref,signal);return{...ref,created:false};}
   const existing=await findExact(ref,signal);if(existing){
    // Plain date names have no embedded ownership marker. A matching name is
    // recoverable only after this service's durable creation checkpoint.
    if(!ref.playlistName.endsWith(' [Stați:'+ref.serviceId+']')){
     if(service.createAttempted||attemptedCreates.has(ref.serviceId))throw fail('CREATE_UNCONFIRMED','A matching date playlist exists, but its ownership could not be confirmed. Check it in ProPresenter; Stați will not create or replace another playlist.',{ambiguous:true,...ref});
     throw fail('PLAYLIST_NAME_IN_USE','A playlist already uses '+ref.playlistName+'. Choose a different service time or use the existing service; no playlist was changed.');
    }
    const found={...ref,...existing};await managed(found,signal);return{...found,created:false};
   }
   if(service.createAttempted||attemptedCreates.has(ref.serviceId))throw fail('CREATE_UNCONFIRMED','The earlier playlist creation is not confirmed. Reconnect to ProPresenter and reconcile this service; do not create another copy.',{ambiguous:true,...ref});
   if(typeof beforeCreate!=='function')throw fail('CHECKPOINT_REQUIRED','Save the service creation checkpoint before creating its ProPresenter playlist.');
   await beforeCreate({...ref,createAttempted:true});attemptedCreates.add(ref.serviceId);
   let postCompleted=false;
   try{
    const created=await request('POST','/v1/playlists',{name:ref.playlistName,type:'playlist'},signal);
    postCompleted=true;
    if(created?.type!=='playlist'||created.id?.name!==ref.playlistName)throw fail('INVALID_RESPONSE','The playlist creation response did not match this service.');
    const result={...ref,playlistId:playlistId(created)};if(afterCreate)await afterCreate(result);await managed(result,signal);return{...result,created:true};
   }catch(error){
    // Documented validation/not-found responses confirm that this POST was
    // rejected. Clear only that checkpoint so fixing the port/API setup can
    // retry. Drops/timeouts and 5xx responses remain ambiguous and never replay.
    if(!postCompleted&&error.code==='HTTP_ERROR'&&[400,401,403,404,405,422].includes(error.status)){
     attemptedCreates.delete(ref.serviceId);
     throw fail('CREATE_REJECTED','ProPresenter rejected playlist creation (HTTP '+error.status+'). Check that its Network API is enabled and the local port is correct, then retry.',{definiteRejection:true,status:error.status,...ref,cause:error});
    }
    // A timeout/drop can happen after ProPresenter committed the POST. Never
    // repeat it. An exact deterministic name may safely recover the UUID.
    let found;try{if(ref.playlistName.endsWith(' [Stați:'+ref.serviceId+']')){found=await findExact(ref,signal);if(found){const result={...ref,...found};if(afterCreate)await afterCreate(result);await managed(result,signal);return{...result,created:true,reconciled:true};}}}catch(reconcileError){if(reconcileError.code==='AMBIGUOUS_PLAYLIST')throw reconcileError;}
    throw fail('CREATE_UNCONFIRMED','Playlist creation could not be confirmed. Its checkpoint was kept to prevent a duplicate.',{ambiguous:true,...ref,cause:error});
   }
  });
 }
 async function libraryPresentations(libraryName,signal){
  const name=text(libraryName,'library name',120);
  // The official API deprecates library UUID addressing; use an exact name.
  const libraries=await request('GET','/v1/libraries',undefined,signal);
  if(!Array.isArray(libraries)||libraries.length>5000)throw fail('INVALID_RESPONSE','ProPresenter returned an invalid library list.');
  if(libraries.filter(item=>item?.id?.name===name).length!==1)throw fail('LIBRARY_NOT_FOUND','Choose the unique ProPresenter library named '+name+'.');
  const result=await request('GET','/v1/library/'+encodeURIComponent(name),undefined,signal);
  if(!result||result.updateType!=='all'||!Array.isArray(result.items)||result.items.length>10000)throw fail('INVALID_RESPONSE','ProPresenter did not return the complete library.');
  for(const item of result.items)if(!item||typeof item.name!=='string'||!UUID.test(item.uuid||''))throw fail('INVALID_RESPONSE','ProPresenter returned an invalid library presentation.');
  return result.items;
 }
 async function resolvePresentation({uuid:rawUuid,libraryName='Lyrics'},{signal}={}){
  const id=uuid(rawUuid,'presentation UUID'),items=await libraryPresentations(libraryName,signal),matches=items.filter(item=>item.uuid.toLowerCase()===id);
  if(matches.length!==1)throw fail('PRESENTATION_NOT_FOUND','This song UUID has not appeared in the ProPresenter library yet. Import or refresh the song, then retry.');
  return{uuid:id,name:matches[0].name,libraryName};
 }
 async function writeAndCheck(ref,before,items,verify,signal,beforeWrite){
  const latest=await managed(ref,signal);
  if(JSON.stringify(latest.items)!==JSON.stringify(before.items))throw fail('CONCURRENT_CHANGE','The playlist changed in ProPresenter. Retry to keep those edits.');
  let writeError;
  // The API replaces the entire list and has no documented conditional-write
  // mechanism. This second read detects intervening edits, but cannot prevent
  // an edit in ProPresenter between this read and its PUT. Never replay a PUT.
  const indexed=items.map((item,index)=>({...item,id:{...item.id,index}}));
  if(beforeWrite)await beforeWrite({...ref,pendingWrite:true});
  try{await request('PUT','/v1/playlist/'+ref.playlistId,indexed,signal);}catch(error){writeError=error;}
  let after;try{after=await managed(ref,signal);}catch(error){uncertainPlaylists.add(ref.playlistId);throw fail('WRITE_UNCONFIRMED','The playlist update is not confirmed. Check ProPresenter before making more changes.',{ambiguous:true,pendingWrite:true,...ref,cause:writeError||error});}
  if(after.items.length!==items.length||!verify(after.items)){uncertainPlaylists.add(ref.playlistId);throw fail('WRITE_UNCONFIRMED','The playlist update did not pass readback verification. Check ProPresenter before making more changes.',{ambiguous:true,pendingWrite:true,...ref,cause:writeError});}
  return{after,reconciled:!!writeError};
 }
 function requireSettled(ref){if(uncertainPlaylists.has(ref.playlistId))throw fail('WRITE_UNCONFIRMED','An earlier update is unresolved. Review it in ProPresenter before making more changes.',{ambiguous:true,pendingWrite:true,...ref});}
 async function getServicePlaylist(service,{signal}={}){return managed(serviceReference(service),signal);}
 async function addPresentations(service,presentations,{libraryName='Lyrics',signal,beforeWrite}={}){
  const ref=serviceReference(service);
  if(!Array.isArray(presentations)||!presentations.length||presentations.length>1000)throw fail('INVALID_INPUT','Choose between 1 and 1000 songs.');
  const ids=[...new Set(presentations.map(item=>uuid(typeof item==='string'?item:item?.uuid,'presentation UUID')))];
  return serialized('playlist:'+ref.playlistId,async()=>{
   requireSettled(ref);
   const library=await libraryPresentations(libraryName,signal),resolved=ids.map(id=>{const found=library.filter(item=>item.uuid.toLowerCase()===id);if(found.length!==1)throw fail('PRESENTATION_NOT_FOUND','A selected song UUID has not appeared in the ProPresenter library yet.');return{uuid:id,name:found[0].name};});
   const before=await managed(ref,signal),existing=new Set(before.items.map(presentationUuid).filter(Boolean)),added=resolved.filter(item=>!existing.has(item.uuid));
   if(!added.length)return{...ref,added:[],existing:ids,reconciled:false};
   if(before.items.length+added.length>5000)throw fail('TOO_LARGE','This playlist has too many items.');
   const items=[...before.items,...added.map((item,index)=>({id:{uuid:item.uuid,name:item.name,index:before.items.length+index},type:'presentation',is_hidden:false,is_pco:false,presentation_info:{presentation_uuid:item.uuid},target_uuid:item.uuid}))];
   const {after,reconciled}=await writeAndCheck(ref,before,items,actual=>containsItems(actual,before.items)&&ids.every(id=>actual.some(item=>presentationUuid(item)===id)),signal,beforeWrite);
   const owned=added.map(item=>{const matches=after.items.filter(entry=>presentationUuid(entry)===item.uuid);if(matches.length!==1||!matches[0].id.uuid){uncertainPlaylists.add(ref.playlistId);throw fail('WRITE_UNCONFIRMED','Song addition is visible but its unique playlist entry is not confirmed.',{ambiguous:true,pendingWrite:true,...ref});}return{presentationUuid:item.uuid,itemUuid:uuid(matches[0].id.uuid,'playlist item UUID')};});
   return{...ref,added:owned,existing:ids.filter(id=>existing.has(id)),reconciled};
  });
 }
 async function cleanupPlaylist(service,{ownedItems=[],signal,beforeWrite}={}){
  const ref=serviceReference(service);
  if(!Array.isArray(ownedItems)||ownedItems.length>5000)throw fail('INVALID_INPUT','Invalid service playlist cleanup records.');
  const owned=new Set(ownedItems.map(item=>uuid(item.itemUuid,'playlist item UUID')+':'+uuid(item.presentationUuid,'presentation UUID')));
  return serialized('playlist:'+ref.playlistId,async()=>{
   requireSettled(ref);
   const before=await managed(ref,signal);
   const remove=item=>item.type==='presentation'&&item.id.uuid&&owned.has(item.id.uuid.toLowerCase()+':'+presentationUuid(item));
   const retained=before.items.filter(item=>!remove(item)),removed=before.items.length-retained.length;
   if(!removed)return{...ref,removed:0,playlistDeleted:false,manualDeletionRequired:true};
   const {reconciled}=await writeAndCheck(ref,before,retained,actual=>containsItems(actual,retained)&&!actual.some(remove),signal,beforeWrite);
   return{...ref,removed,reconciled,playlistDeleted:false,manualDeletionRequired:true};
  });
 }
 async function orderPresentations(service,presentations,{ownedItems=[],libraryName='Lyrics',signal,beforeWrite}={}){
  const ref=serviceReference(service);
  if(!Array.isArray(presentations)||presentations.length>1000||!Array.isArray(ownedItems)||ownedItems.length>5000)throw fail('INVALID_INPUT','Choose a valid service song order.');
  const ids=presentations.map(item=>uuid(typeof item==='string'?item:item?.uuid,'presentation UUID'));
  const ownership=new Map(ownedItems.map(item=>[uuid(item.itemUuid,'playlist item UUID'),uuid(item.presentationUuid,'presentation UUID')]));
  return serialized('playlist:'+ref.playlistId,async()=>{
   requireSettled(ref);const before=await managed(ref,signal);
   const isOwned=item=>item.type==='presentation'&&item.id.uuid&&ownership.get(item.id.uuid.toLowerCase())===presentationUuid(item);
   const byPresentation=new Map();for(const item of before.items)if(isOwned(item)){const id=presentationUuid(item),group=byPresentation.get(id)||[];group.push(item);byPresentation.set(id,group);}
   const fresh=new Set(),selected=ids.map((id,index)=>{const group=byPresentation.get(id)||[],preferred=typeof presentations[index]==='object'&&presentations[index]?.itemUuid;let existing;if(preferred){const itemId=uuid(preferred,'owned playlist item UUID'),position=group.findIndex(item=>item.id.uuid.toLowerCase()===itemId);if(position>=0)existing=group.splice(position,1)[0];}else existing=group.shift();if(existing)return existing;const item={id:{uuid:id,name:'',index:0},type:'presentation',is_hidden:false,is_pco:false,presentation_info:{presentation_uuid:id},target_uuid:id};fresh.add(item);return item;});
   if(fresh.size){const library=await libraryPresentations(libraryName,signal);for(const item of fresh){const matches=library.filter(song=>song.uuid.toLowerCase()===presentationUuid(item));if(matches.length!==1)throw fail('PRESENTATION_NOT_FOUND','A selected song UUID has not appeared in the ProPresenter library yet.');item.id.name=matches[0].name;}}
   // Keep manual entries and headers in their existing relative positions.
   // Replace only Stați-owned slots, append overflow, and remove only exact
   // owned entries removed from this service. Repeated songs get independent
   // playlist-entry UUIDs from ProPresenter; presentation files stay untouched.
   const items=[];let next=0;for(const item of before.items){if(isOwned(item)){if(next<selected.length)items.push(selected[next++]);}else items.push(item);}while(next<selected.length)items.push(selected[next++]);
   if(items.length>5000)throw fail('TOO_LARGE','This playlist has too many items.');
   const same=items.length===before.items.length&&items.every((item,index)=>!fresh.has(item)&&itemKey(item)===itemKey(before.items[index]));
   const existingIds=new Set(before.items.filter(item=>item.id.uuid).map(item=>item.id.uuid.toLowerCase()));
   let after=before;
   if(!same){const result=await writeAndCheck(ref,before,items,actual=>{
    if(actual.length!==items.length)return false;const freshIds=new Set();
    return actual.every((item,index)=>{const expected=items[index];if(!fresh.has(expected))return itemKey(item)===itemKey(expected);const id=item.id.uuid?.toLowerCase();if(item.type!=='presentation'||presentationUuid(item)!==presentationUuid(expected)||!id||existingIds.has(id)||freshIds.has(id))return false;freshIds.add(id);return true;});
   },signal,beforeWrite);after=result.after;}
   const desired=new Set(selected),owned=[];for(let index=0;index<items.length;index++)if(desired.has(items[index])){const entry=after.items[index];owned.push({itemUuid:uuid(entry.id.uuid,'playlist item UUID'),presentationUuid:presentationUuid(entry)});}
   return{...ref,ownedItems:owned,changed:!same};
  });
 }
 async function activeSong({signal}={}){
  const [playlists,slide]=await Promise.all([
   request('GET','/v1/playlist/active',undefined,signal),
   request('GET','/v1/presentation/slide_index',undefined,signal),
  ]);
  const active=playlists?.presentation,cue=slide?.presentation_index;
  if(!active?.playlist?.uuid||!active?.item?.uuid||!cue?.presentation_id?.uuid||!Number.isSafeInteger(cue.index)||cue.index<0)return null;
  return{playlistId:uuid(active.playlist.uuid,'playlist UUID'),itemId:uuid(active.item.uuid,'playlist item UUID'),presentationId:uuid(cue.presentation_id.uuid,'presentation UUID')};
 }
 async function deletePlaylist(){throw fail('UNSUPPORTED_OPERATION','ProPresenter does not document a playlist deletion API. Remove the empty service playlist in ProPresenter.');}
 return{probe,ensureServicePlaylist,getServicePlaylist,resolvePresentation,addPresentations,orderPresentations,cleanupPlaylist,deletePlaylist,activeSong};
}
module.exports={createProPresenterPlaylists,servicePlaylistName,ProPresenterError};
