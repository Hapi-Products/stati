'use strict';
const {performance}=require('node:perf_hooks');
const PROTOCOL='stati-operator-v1',LEASE_SECONDS=45,PENDING_SECONDS=300,PROOF_SECONDS=8*3600;
const secret=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(value);
const id=value=>typeof value==='string'&&/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>0;

/** Trusted-main only. No method/result from this module belongs in renderer IPC.
 * `status` and invalidation events are redacted; privateAuthority/pendingRequest
 * and the renew/reset callbacks deliberately carry RAM-only authentication.
 * start times and deadlines use one monotonic clock, independent of wall time.
 */
function createOperatorSelection({renew,reset=async()=>{},canUse=()=>true,onInvalidated=()=>{},now=()=>performance.now(),timers={setTimeout,clearTimeout},renewIntervalMs=10000,requestTimeoutMs=8000}={}){
 if(typeof renew!=='function'||typeof reset!=='function'||typeof canUse!=='function'||typeof onInvalidated!=='function'||typeof now!=='function'||typeof timers.setTimeout!=='function'||typeof timers.clearTimeout!=='function')throw TypeError('Operator selection needs trusted lifecycle callbacks.');
 if(!Number.isFinite(renewIntervalMs)||renewIntervalMs<1||renewIntervalMs>10000||!Number.isFinite(requestTimeoutMs)||requestTimeoutMs<1||requestTimeoutMs>10000)throw TypeError('Invalid operator selection timing.');
 const tickets=new WeakMap();let current=null,serial=0,disposed=false;
 const time=()=>now();
 const later=(callback,delay)=>{const timer=timers.setTimeout(callback,Math.max(0,delay));timer?.unref?.();return timer;};
 const cancel=timer=>{if(timer!==null&&timer!==undefined)timers.clearTimeout(timer);};
 const matches=ticket=>!!current&&current.ticket===ticket;
 const publicState=context=>context?{phase:context.phase,userId:context.userId,deviceId:context.deviceId,generation:context.generation,expiresInMs:context.deadline===null?null:Math.max(0,context.deadline-time())}:{phase:'none'};
 const capture=context=>Object.freeze({credential:context.credential,deviceId:context.deviceId,userId:context.userId,generation:context.generation,lease:context.lease,proof:context.proof||null,proofExpiresAt:context.proofExpiresAt||null});
 function bounded(callback,value){
  const controller=new AbortController();let timeout;
  const stopped=new Promise((resolve,reject)=>{
   controller.signal.addEventListener('abort',()=>{const error=Error('Operator request stopped.');error.code='ABORT_ERR';reject(error);},{once:true});
   timeout=later(()=>controller.abort(),requestTimeoutMs);
  });
  // An underlying request that ignores abort can still settle later. The race
  // bounds this job; all result application additionally checks current context.
  const network=Promise.resolve().then(()=>callback({...value,signal:controller.signal}));
  const promise=Promise.race([network,stopped]).finally(()=>cancel(timeout));
  return{controller,promise};
 }
 function resetCaptured(context){
  if(!context?.lease)return;
  const task=bounded(reset,capture(context));void task.promise.catch(()=>{});
 }
 function clear(reason='switch',{reset:shouldReset=true,notify=false}={}){
  const previous=current;current=null;
  if(!previous)return;
  cancel(previous.renewTimer);cancel(previous.expiryTimer);previous.controller?.abort();
  if(shouldReset)resetCaptured(previous);
  if(notify)try{onInvalidated({...publicState(previous),phase:'none',reason});}catch{}
 }
 function invalidate(reason){clear(reason,{notify:true});}
 function usable(context){
  if(disposed||context!==current)return false;
  if(!canUse()){invalidate('unavailable');return false;}
  if(context.deadline!==null&&time()>=context.deadline){invalidate('expired');return false;}
  return true;
 }
 function expiry(context){
  cancel(context.expiryTimer);context.expiryTimer=later(()=>{
   if(context!==current)return;
   if(time()>=context.deadline)invalidate('expired');else expiry(context);
  },context.deadline-time());
 }
 function scheduleRenew(context){
  cancel(context.renewTimer);context.renewTimer=null;
  if(!usable(context)||context.phase!=='active')return;
  context.renewTimer=later(()=>{context.renewTimer=null;void renewNow();},Math.min(renewIntervalMs,Math.max(0,context.deadline-time())));
 }
 function responseDeadline(result,startedAt,maximum){
  if(!integer(result?.ttlSeconds)||result.ttlSeconds>maximum||!integer(result.expiresAt)||!Number.isFinite(startedAt)||startedAt>time())return null;
  const deadline=startedAt+result.ttlSeconds*1000;
  return deadline>time()?deadline:null;
 }
 function discardLate(ticket,result){
  const previous=tickets.get(ticket);
  if(previous&&result?.protocol===PROTOCOL&&result.userId===previous.userId&&secret(result.lease))resetCaptured({...previous,lease:result.lease,proof:null,proofExpiresAt:null});
 }
 function begin({credential,deviceId,userId,role,requiresUnlock=role==='admin',generation}={}){
  if(disposed)throw Error('Operator selection is closed.');
  if(typeof credential!=='string'||!credential||credential.length>4096||!id(deviceId)||!id(userId)||!['member','admin'].includes(role)||!Number.isSafeInteger(generation)||generation<0)throw Error('Invalid operator selection.');
  clear('switch');
  const ticket=Object.freeze({deviceId,userId,generation,startedAt:time(),serial:++serial});
  current={ticket,credential,deviceId,userId,role,requiresUnlock:role==='admin'||requiresUnlock===true,generation,phase:'choosing',lease:null,proof:null,proofExpiresAt:null,proofDeadline:null,deadline:null,renewTimer:null,expiryTimer:null,controller:null,renewing:null,phoneToken:null};
  tickets.set(ticket,current);return ticket;
 }
 function bindPending(ticket,result,{startedAt=ticket?.startedAt}={}){
  if(!matches(ticket)){discardLate(ticket,result);return false;}
  const context=current;if(!usable(context))return false;
  const deadline=responseDeadline(result,startedAt,PENDING_SECONDS);
  if(context.phase!=='choosing'||!context.requiresUnlock||result?.protocol!==PROTOCOL||result.active!==false||result.userId!==context.userId||!secret(result.lease)||!secret(result.token)||!deadline){invalidate('invalid-response');return false;}
  context.phase='pending';context.lease=result.lease;context.phoneToken=result.token;context.deadline=deadline;expiry(context);return true;
 }
 function activate(ticket,result,{startedAt=ticket?.startedAt,token}={}){
  if(!matches(ticket)){discardLate(ticket,result);return false;}
  const context=current;if(!usable(context))return false;
  const deadline=responseDeadline(result,startedAt,LEASE_SECONDS);
  const phone=context.phase==='pending';
  if(!['choosing','pending'].includes(context.phase)||result?.protocol!==PROTOCOL||result.active!==true||result.userId!==context.userId||!secret(result.lease)||!deadline||phone&&(context.lease!==result.lease||context.phoneToken!==token)){
   invalidate('invalid-response');return false;
  }
  let proofDeadline=null;
  if(context.requiresUnlock){
   const seconds=result.proofExpiresAt-result.expiresAt+result.ttlSeconds;
   if(!secret(result.proof)||!integer(result.proofExpiresAt)||!Number.isSafeInteger(seconds)||seconds<1||seconds>PROOF_SECONDS){invalidate('invalid-response');return false;}
   proofDeadline=startedAt+seconds*1000;if(proofDeadline<=time()){invalidate('expired');return false;}
  }else if(result.proof!==undefined||result.proofExpiresAt!==undefined){invalidate('invalid-response');return false;}
  context.phase='active';context.lease=result.lease;context.proof=context.requiresUnlock?result.proof:null;context.proofExpiresAt=context.requiresUnlock?result.proofExpiresAt:null;
  context.proofDeadline=proofDeadline;context.phoneToken=null;context.deadline=Math.min(deadline,proofDeadline??Infinity);expiry(context);scheduleRenew(context);return true;
 }
 function privateAuthority(expected={}){
  const context=current;
  if(!context||!usable(context)||context.phase!=='active'||expected.userId!==undefined&&expected.userId!==context.userId||expected.generation!==undefined&&expected.generation!==context.generation||expected.deviceId!==undefined&&expected.deviceId!==context.deviceId)return null;
  return capture(context);
 }
 function pendingRequest(ticket,token){
  if(!matches(ticket)||!usable(current)||current.phase!=='pending'||token!==current.phoneToken)return null;
  return Object.freeze({...capture(current),token,startedAt:time()});
 }
 function renewNow(){
  const context=current;
  if(!context||!usable(context)||context.phase!=='active')return Promise.resolve(false);
  if(context.renewing)return context.renewing;
  cancel(context.renewTimer);context.renewTimer=null;
  const startedAt=time(),task=bounded(renew,capture(context));context.controller=task.controller;
  const result=(async()=>{
   try{
    const response=await task.promise;
    if(context!==current||task.controller.signal.aborted||!usable(context))return false;
    const deadline=responseDeadline(response,startedAt,LEASE_SECONDS);
    if(response?.active!==true||response.userId!==context.userId||!deadline||response.lease!==undefined||response.proof!==undefined||response.proofExpiresAt!==undefined){invalidate('invalid-response');return false;}
    context.deadline=Math.min(deadline,context.proofDeadline??Infinity);expiry(context);return true;
   }catch(error){
    if(context!==current)return false;
    if([401,403,404,409,410,426].includes(error?.status)){invalidate('rejected');return false;}
    // A timeout/offline response does not extend the existing deadline.
    if(!usable(context))return false;return false;
   }finally{
    if(context===current){context.controller=null;context.renewing=null;scheduleRenew(context);}
   }
  })();context.renewing=result;return result;
 }
 function status(){if(current)usable(current);return publicState(current);}
 function dispose(){disposed=true;clear('quit');}
 return{begin,bindPending,activate,pendingRequest,privateAuthority,renewNow,clear,status,dispose};
}
module.exports={PROTOCOL,createOperatorSelection};
