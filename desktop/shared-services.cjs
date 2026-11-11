// Authoritative plans live per station. The encrypted local snapshot is only a
// cache for the local ProPresenter adapter; it never wins over a server revision.
function createSharedServiceStore({current,local,send,beforeAttach=async()=>{},migrate=async()=>{},onCacheError=()=>{}}){
 const queues=new Map();
 const sameScope=(a,b)=>!!a&&a.credential===b.credential&&a.deviceId===b.deviceId&&a.userId===b.userId&&a.generation===b.generation&&a.lease===b.lease&&a.proof===b.proof;
 const assert=context=>{if(!sameScope(current(),context))throw Error('The selected user or computer changed.');};
 function operation(stationId,action){
  const context=current();if(!context||context.deviceId!==stationId)throw Error('Choose your profile on this computer first.');
  const tail=queues.get(stationId);
  if(!action&&tail?.read&&sameScope(tail.context,context))return tail.task;
  const pending=(tail?.task||Promise.resolve()).catch(()=>{}).then(async()=>{
   assert(context);
   try{await migrate(context);}
   catch(error){if([401,403].includes(error.status))throw error;onCacheError(error);}
   assert(context);
   // Publish newly referenced songs, but avoid rescanning the library for each notes autosave.
   let publish=action?.type==='attach-songs';
   if(action?.type==='save'&&action.plan?.songs?.length){
    const cached=typeof local.state==='function'?await local.state(stationId):null;assert(context);
    const known=new Set((cached?.plans||[]).flatMap(plan=>plan.songs||[]).map(song=>JSON.stringify([song.songId,song.contentHash])));
    publish=action.plan.songs.some(song=>!known.has(JSON.stringify([song.songId,song.contentHash])));
   }
   if(publish){await beforeAttach(context);assert(context);}
   const remoteAction=action?.type==='attach-songs'?{type:'attach-songs',expectedActiveServiceId:action.expectedActiveServiceId,songs:action.songs}:action;
   const snapshot=await send(context,action?'POST':'GET',remoteAction);assert(context);
   // A confirmed server write stays successful even if the local cache cannot
   // be refreshed. Reporting it as failed could lead to a duplicate creation.
   try{await local.replaceSharedSnapshot(stationId,snapshot);}
   catch(error){onCacheError(error);}
   assert(context);
   return snapshot;
  });
  const entry={context,read:!action,task:pending.finally(()=>{if(queues.get(stationId)===entry)queues.delete(stationId);})};
  queues.set(stationId,entry);
  return entry.task;
 }
 return{
  state:stationId=>operation(stationId),
  list:async stationId=>(await operation(stationId)).plans,
  active:async stationId=>(await operation(stationId)).activeServiceId,
  change:async(stationId,action)=>(await operation(stationId,action)).plans,
  templates:async()=>[],
  isShared:async()=>true,
  flush:async()=>{await Promise.allSettled([...queues.values()].map(entry=>entry.task));await local.flush();},
 };
}
module.exports={createSharedServiceStore};
