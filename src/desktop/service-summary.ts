import {useEffect,useRef} from 'react';
import type {ServicePlan} from './service-plan-types';

export const SERVICES_CHANGED='stati-services-changed';
export function servicesChanged(){window.dispatchEvent(new window.Event(SERVICES_CHANGED));}

// IPC cannot be aborted. Keep at most one real request per mounted summary,
// ignore late answers, and stop all refresh work while its workspace is hidden.
export function useServiceSummary(active:boolean,onPlans:(plans:ServicePlan[])=>void,onError:(message:string)=>void,immediate=true,source:Pick<Window['stati'],'listServicePlans'>=window.stati){
 const callbacks=useRef({onPlans,onError}),pending=useRef<Promise<ServicePlan[]>|null>(null);
 callbacks.current={onPlans,onError};
 useEffect(()=>{
  if(!active)return;
  let live=true,version=0,queued=false,deadline:ReturnType<typeof setTimeout>|undefined;
  const visible=()=>document.visibilityState!=='hidden';
  function refresh(){
   if(!live||!visible())return;
   if(pending.current){queued=true;return;}
   queued=false;const token=++version,request=Promise.resolve().then(()=>source.listServicePlans());pending.current=request;
   deadline=setTimeout(()=>{if(live&&visible()&&token===version){callbacks.current.onError('Service status is taking too long. Waiting for the current request.');}},8000);
   void request.then(plans=>{if(live&&visible()&&token===version){callbacks.current.onPlans(plans);callbacks.current.onError('');}},error=>{if(live&&visible()&&token===version)callbacks.current.onError(error instanceof Error?error.message:'Service status could not be loaded.');}).finally(()=>{
    clearTimeout(deadline);if(pending.current===request)pending.current=null;
    if(live&&queued&&visible())refresh();
   });
  }
  const changed=()=>{version++;refresh();};
  const visibility=()=>{version++;clearTimeout(deadline);if(visible())refresh();};
  if(immediate)refresh();
  const interval=setInterval(refresh,30000);
  window.addEventListener(SERVICES_CHANGED,changed);document.addEventListener('visibilitychange',visibility);
  return()=>{live=false;version++;clearTimeout(deadline);clearInterval(interval);window.removeEventListener(SERVICES_CHANGED,changed);document.removeEventListener('visibilitychange',visibility);};
 },[active,immediate,source]);
}

export function editableService(plan:ServicePlan|undefined){
 if(!plan)return '';
 const {active,playlist,status,leadership,...editable}=plan;
 return JSON.stringify(editable);
}
