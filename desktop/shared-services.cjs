// Authoritative plans live per station. The encrypted local snapshot is only a
// cache for the local ProPresenter adapter; it never wins over a server revision.
function createSharedServiceStore({current,local,send,beforeAttach=async()=>{},migrate=async()=>{}}){
 const queues=new Map();
 const assert=context=>{const next=current();if(!next||next.credential!==context.credential||next.deviceId!==context.deviceId||next.userId!==context.userId||next.generation!==context.generation)throw Error('The selected user or computer changed.');};
 function operation(stationId,action){
  const context=current();if(!context||context.deviceId!==stationId)throw Error('Choose your profile on this computer first.');
  const pending=(queues.get(stationId)||Promise.resolve()).catch(()=>{}).then(async()=>{
   assert(context);await migrate(context);assert(context);
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
   await local.replaceSharedSnapshot(stationId,snapshot);assert(context);
   return snapshot;
  });queues.set(stationId,pending);
  return pending.finally(()=>{if(queues.get(stationId)===pending)queues.delete(stationId);});
 }
 return{
  state:stationId=>operation(stationId),
  list:async stationId=>(await operation(stationId)).plans,
  active:async stationId=>(await operation(stationId)).activeServiceId,
  change:async(stationId,action)=>(await operation(stationId,action)).plans,
  templates:async()=>[],
  isShared:async()=>true,
  flush:async()=>{await Promise.allSettled([...queues.values()]);await local.flush();},
 };
}
module.exports={createSharedServiceStore};
