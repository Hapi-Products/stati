'use strict';
// Coordinate local preparation with the selected profile. Network work never
// holds a save dialog open and is aborted on a switch, Windows lock or quit.
function createServicePlaylistJobs({manager,plansStore,current,readDirectory,work,onChanged=()=>{},onError=()=>{},beforeSync=async()=>{},delay=250}){
 let timer=null,running=null,controller=null,again=false;
 const same=operator=>{const now=current();return !!now&&now.id===operator.id&&now.generation===operator.generation;};
 const assert=operator=>{if(!same(operator))throw Error('The selected user changed. Open the song again.');};
 function cancel(){clearTimeout(timer);timer=null;again=false;controller?.abort();}
 function schedule(){if(!current())return;again=true;if(running||timer)return;timer=setTimeout(()=>{timer=null;void run();},delay);timer.unref?.();}
 async function run(){
  if(running){again=true;return running;}
  const operator=current();if(!operator)return;
  again=false;const abort=new AbortController();controller=abort;
  running=(async()=>{try{await beforeSync(operator);assert(operator);abort.signal.throwIfAborted();await manager.sync(operator.id,{signal:abort.signal});if(same(operator)&&!abort.signal.aborted)onChanged(operator);}catch(error){if(same(operator)&&!abort.signal.aborted)onError(error);}})();
  try{await running;}finally{running=null;if(controller===abort)controller=null;if(again)schedule();}
 }
 async function attach(operator,result,paths,expectedActiveServiceId){
  if(!expectedActiveServiceId||!paths.length)return result;
  try{
   assert(operator);const directory=await readDirectory();assert(operator);
   if(!directory)throw Error('Choose the ProPresenter Lyrics folder before adding songs to a service.');
   const songs=await work('playlist-attachment-references',directory,paths);assert(operator);
   if(!songs.length)throw Error('Save the ProPresenter song inside Lyrics to add it to this service.');
   await plansStore.change(operator.id,{type:'attach-songs',id:expectedActiveServiceId,expectedActiveServiceId,songs});assert(operator);
   onChanged(operator);schedule();return result;
  }catch(error){return{...result,playlistMessage:'The file was saved. '+error.message};}
 }
 async function flush(){cancel();if(running)await running;await manager.flush();}
 return{schedule,cancel,run,attach,flush};
}
module.exports={createServicePlaylistJobs};
