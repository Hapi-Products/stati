'use strict';
// Scheduling only. The native synchronization adapter authorizes and verifies
// each filesystem change; this monitor never obtains replacement rights.
function createPresentationMonitor({current,sync,onAttention=()=>{},onError=()=>{},now=Date.now,intervalMs=60000}){
 let pending=null,epoch=0,lastKey=null,lastStarted=-Infinity,lastAttention='';
 function clear(){epoch++;lastKey=null;lastStarted=-Infinity;lastAttention='';}
 function tick(){
  if(pending)return pending;
  const context=current();if(!context){clear();return Promise.resolve();}
  if(context.key!==lastKey){epoch++;lastKey=context.key;lastStarted=-Infinity;lastAttention='';}
  if(now()-lastStarted<intervalMs)return Promise.resolve();
  const generation=epoch;lastStarted=now();
  const live=()=>generation===epoch&&current()?.key===context.key;
  const task=(async()=>{
   try{
    const result=await sync(context);if(!live()||result?.skipped)return;
    const warnings=Array.isArray(result?.warnings)?result.warnings.slice(0,100):[];
    const fingerprint=JSON.stringify(warnings.map(item=>[item.id||'',item.kind,item.name,item.message]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
    if(!warnings.length){lastAttention='';return;}
    if(fingerprint!==lastAttention){lastAttention=fingerprint;onAttention({warnings,updated:result.updated||0},context);}
   }catch(error){if(live())onError(error,context);}
  })();
  const tracked=task.finally(()=>{if(pending===tracked)pending=null;});pending=tracked;return tracked;
 }
 return{tick,clear,drain:async()=>{if(pending)await pending;}};
}
module.exports={createPresentationMonitor};
