import {useEffect} from 'react';
import type {DependencyList} from 'react';
import {api,ApiError} from './api';

type Poll=(signal:AbortSignal)=>Promise<void|boolean>;
type Visibility=Pick<Document,'visibilityState'|'addEventListener'|'removeEventListener'>;

export function abortable<T>(work:()=>Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(new DOMException('Request stopped.','AbortError'));
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){signal.removeEventListener('abort',abort);abort();return;}
  Promise.resolve().then(()=>signal.aborted?Promise.reject(new DOMException('Request stopped.','AbortError')):work()).then(value=>{signal.removeEventListener('abort',abort);if(!signal.aborted)resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}

/** One current visible job. Callbacks check its signal before applying state;
 * an underlying fetch that ignores abort may still settle after cancellation. */
export function startVisiblePolling(poll:Poll,{intervalMs=15000,timeoutMs=8000,visibility=document}:{intervalMs?:number;timeoutMs?:number;visibility?:Visibility}={}){
 let stopped=false,terminal=false,refreshPending=false,timer:ReturnType<typeof setTimeout>|undefined,current:AbortController|null=null;
 function cancel(){if(timer!==undefined)clearTimeout(timer);timer=undefined;refreshPending=false;const previous=current;current=null;previous?.abort();}
 async function run(){
  if(stopped||terminal||current||visibility.visibilityState!=='visible')return;
  const controller=new AbortController();current=controller;
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const result=await abortable(()=>poll(controller.signal),controller.signal);
   if(!controller.signal.aborted&&result===false)terminal=true;
  }catch{/* A later visible poll can recover from a transient network error. */}
  finally{
   clearTimeout(timeout);
   if(current===controller){
    current=null;
    if(!stopped&&!terminal&&visibility.visibilityState==='visible'){
     if(refreshPending){refreshPending=false;void run();}
     else timer=setTimeout(()=>void run(),intervalMs);
    }
   }
  }
 }
 const changed=()=>{cancel();if(!stopped&&!terminal&&visibility.visibilityState==='visible')void run();};
 visibility.addEventListener('visibilitychange',changed);
 void run();
 const stop=()=>{stopped=true;cancel();visibility.removeEventListener('visibilitychange',changed);};
 // A user action can wake this job without restarting another poll or creating
 // parallel work. Requests during one active job coalesce into one follow-up.
 return Object.assign(stop,{refresh(){
  if(stopped||terminal||visibility.visibilityState!=='visible')return;
  if(current){refreshPending=true;return;}
  if(timer!==undefined)clearTimeout(timer);timer=undefined;void run();
 }});
}

export function useVisiblePolling(poll:Poll,dependencies:DependencyList,intervalMs=15000){
 useEffect(()=>startVisiblePolling(poll,{intervalMs}),dependencies);
}

/** Presence belongs to this visible sending workspace, never account history. */
export function useConnectionPresence(deviceIds:string[]){
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const key=[...new Set(deviceIds.filter(id=>uuid.test(id)).map(id=>id.toLowerCase()))].sort().join(',');
 useVisiblePolling(async signal=>{
  if(!key)return false;
  const ids=key.split(',');
  try{
   // The server limit applies per request; separate tabs/batches are additive.
   for(let offset=0;offset<ids.length;offset+=100){
    if(signal.aborted)return;
    await api('/connections/presence',{method:'POST',body:JSON.stringify({deviceIds:ids.slice(offset,offset+100)}),signal});
   }
  }catch(error){if(error instanceof ApiError&&[401,403].includes(error.status))return false;throw error;}
 },[key],20000);
}
