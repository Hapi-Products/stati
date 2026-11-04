// Keep one file write in flight. Later edits use the hash returned by that write,
// rather than racing with the hash that was current when typing started.
export function createSongAutosave({save,onState=()=>{},onSaved=()=>{},delay=850,timers={setTimeout:(callback,timeout)=>setTimeout(callback,timeout),clearTimeout:timer=>clearTimeout(timer)}}){
 let current=null,serial=0,timer=null,running=null;
 const cancel=()=>{if(timer!==null)timers.clearTimeout(timer);timer=null;};
 const report=(state,error)=>onState({state,error:error?.message||''});
 function open({id,contentHash,data}){cancel();current={id,hash:contentHash,saved:JSON.stringify(data),data,version:++serial,error:null,paused:false};report('saved');}
 function edit(data){if(!current)return;current.data=data;current.error=null;current.paused=false;cancel();if(JSON.stringify(data)===current.saved){report('saved');return;}report('pending');timer=timers.setTimeout(()=>{timer=null;void flush().catch(()=>{});},delay);}
 async function flush({force=false}={}){
  cancel();const context=current;if(!context)return null;
  while(running){await running;if(context!==current)return null;}
  if(context!==current||context.paused||!force&&JSON.stringify(context.data)===context.saved)return null;
  const job=(async()=>{
   let result=null;
   while(context===current&&!context.paused&&(force||JSON.stringify(context.data)!==context.saved)){
    const data=context.data,serialized=JSON.stringify(data);force=false;report('saving');
    try{result=await save(context.id,context.hash,data);}
    catch(error){if(context===current){context.error=error;report('error',error);}throw error;}
    if(context!==current)return result;
    context.hash=result.contentHash;context.saved=serialized;context.error=null;onSaved(result);
   }
   if(context===current&&!context.paused)report('saved');return result;
  })();running=job;
  try{return await job;}finally{if(running===job)running=null;}
 }
 function pause(){cancel();if(current)current.paused=true;}
 function discard(){cancel();current=null;serial++;}
 function dispose(){discard();}
 return{open,edit,flush,pause,discard,dispose};
}
