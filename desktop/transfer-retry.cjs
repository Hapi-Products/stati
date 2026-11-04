// Fresh authenticated server polls drive retries; this policy owns no timers or files.
function createTransferRetry({deliver,isBusy=()=>false,onFailure=()=>{},now=Date.now,baseDelayMs=8_000,maxDelayMs=300_000}){
 if(typeof deliver!=='function'||typeof isBusy!=='function'||typeof onFailure!=='function'||typeof now!=='function'||!Number.isSafeInteger(baseDelayMs)||baseDelayMs<1||!Number.isSafeInteger(maxDelayMs)||maxDelayMs<baseDelayMs)throw Error('Invalid transfer retry configuration.');
 const tasks=new Map(),closed=new Set();let active=null,stopped=false,lastSequence=-1,failureEpisode=false;
 function cancel(id){closed.add(id);tasks.delete(id);}
 function stop(){stopped=true;tasks.clear();}
 function observe(transfers,{allowed=true,sequence=lastSequence+1}={}){
  if(stopped||!Number.isSafeInteger(sequence)||sequence<0||sequence<=lastSequence)return null;
  lastSequence=sequence;
  if(!allowed){tasks.clear();failureEpisode=false;return null;}
  // Feed the server queue before merging locally saved history. Sequence numbers
  // belong to poll start time so an older response cannot revive removed work.
  const queued=new Map((Array.isArray(transfers)?transfers:[]).filter(t=>t&&typeof t.id==='string'&&t.id.length&&t.status==='queued'&&t.sender_role==='admin').map(t=>[t.id,t]));
  if(!queued.size)failureEpisode=false;
  for(const id of tasks.keys())if(!queued.has(id)||closed.has(id))tasks.delete(id);
  for(const id of queued.keys())if(!closed.has(id)&&!tasks.has(id))tasks.set(id,{id,attempts:0,nextAttemptAt:0});
  if(active)return null;
  const task=Array.from(queued.keys(),id=>tasks.get(id)).find(t=>t&&t.nextAttemptAt<=now());
  if(!task)return null;
  active=task;
  const current=()=>!stopped&&tasks.get(task.id)===task&&!closed.has(task.id);
  const failed=error=>{
   if(!current())return{id:task.id,status:'stopped'};
   const status=Number(error?.status),terminal=error?.retryable===false||error?.cancelled===true||error?.name==='AbortError'||(status>=400&&status<500&&status!==408&&status!==429);
   if(!failureEpisode){failureEpisode=true;try{onFailure({id:task.id,error,terminal,attempts:task.attempts});}catch{}}
   if(status===401||status===403){stop();return{id:task.id,status:'stopped'};}
   if(!current())return{id:task.id,status:'stopped'};
   if(terminal){cancel(task.id);return{id:task.id,status:'terminal'};}
   task.nextAttemptAt=now()+Math.min(maxDelayMs,baseDelayMs*2**Math.min(30,task.attempts-1));
   return{id:task.id,status:'retry',nextAttemptAt:task.nextAttemptAt};
  };
  const pending=Promise.resolve().then(()=>{
   if(!current())return{id:task.id,status:'stopped'};
   // Check again at invocation, after any manual task started this turn. deliver
   // must reserve its shared download slot synchronously, before its first await.
   if(isBusy(task.id))return{id:task.id,status:'busy'};
   task.attempts++;
   let delivery;try{delivery=deliver(task.id);}catch(error){return failed(error);}
   return Promise.resolve(delivery).then(result=>{
    if(!current())return{id:task.id,status:'stopped'};
    cancel(task.id);failureEpisode=false;return{id:task.id,status:'saved',result};
   },failed);
  }).finally(()=>{if(active===task)active=null;});
  return pending;
 }
 return{observe,cancel,stop};
}
module.exports={createTransferRetry};
