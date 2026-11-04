import {ApiError} from './api';
import {safeTransferFilename} from '../shared/file-name.js';

const protocol='stati-upload-v1';
const maximumBytes=50*1024*1024;
const lifetimeMs=60*60*1000;
const retryDelays=[1000,2000,4000];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const transientStatuses=new Set([500,502,503,504]);

export type UploadIntent=Readonly<{originalFile:File;deviceId:string;intentId:string;createdAt:number}>;
export type UploadReceipt=Readonly<{
 protocol:'stati-upload-v1';intentId:string;id:string;deviceId:string;accepted:true;
 status:'queued'|'delivered'|'rejected'|'expired';filename:string;bytes:number;sha256:string;replayed:boolean;rejectionReason?:string;
}>;
type IntentState={file:File;name:string;filename:string;bytes:number;deviceId:string;intentId:string;createdAt:number;started:boolean;active:boolean;receipt?:UploadReceipt};
type UploadOptions={
 signal:AbortSignal;progress:(bytes:number)=>void;onRetry?:(retry:{attempt:number;delayMs:number})=>void;
 createRequest?:()=>XMLHttpRequest;
 fetchReceipt?:(url:string,init:RequestInit)=>Promise<Response>;
 wait?:(delayMs:number,signal:AbortSignal)=>Promise<void>;
 now?:()=>number;
};
const intents=new WeakMap<UploadIntent,IntentState>();
const digests=new WeakMap<File,Promise<string>>();

class InterruptedUpload extends Error {}
class InvalidReceipt extends Error {
 readonly retryable=false;
 constructor(){super('Stați returned an invalid upload confirmation. Check Your files before retrying.');}
}
function stopped(){return new DOMException('Upload stopped.','AbortError');}
function asError(error:unknown){return error instanceof Error?error:new Error('The selected file could not be sent.');}

/** An intentional Send again creates another intent; retries keep this exact object. */
export function createUploadIntent(file:File,deviceId:string):UploadIntent{
 if(!file||typeof file.arrayBuffer!=='function'||typeof file.name!=='string'||!Number.isSafeInteger(file.size)||file.size<=0||file.size>maximumBytes)throw new Error('Choose a non-empty file up to 50 MB.');
 if(typeof deviceId!=='string'||!uuid.test(deviceId))throw new Error('Choose a valid receiving computer.');
 if(typeof crypto==='undefined'||typeof crypto.randomUUID!=='function')throw new Error('Secure sending is unavailable. Open the secure Stați website in an updated browser.');
 const intent=Object.freeze({originalFile:file,deviceId:deviceId.toLowerCase(),intentId:crypto.randomUUID(),createdAt:Date.now()});
 intents.set(intent,{file,name:file.name,filename:safeTransferFilename(file.name),bytes:file.size,deviceId:intent.deviceId,intentId:intent.intentId,createdAt:intent.createdAt,started:false,active:false});
 return intent;
}

function check(state:IntentState,signal:AbortSignal,now:()=>number){
 if(signal.aborted)throw stopped();
 const elapsed=now()-state.createdAt;
 if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=lifetimeMs)throw new Error('This send is more than an hour old or the device clock changed. Check Your files before choosing Send again.');
 if(state.file.name!==state.name||state.file.size!==state.bytes)throw new Error('The selected file changed. Choose the original file again before sending.');
}

// File reads, Web Crypto, injected fetches and waits may not obey AbortSignal.
// Race every boundary ourselves and ignore its late completion after cancellation.
function abortable<T>(start:()=>Promise<T>|T,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  let finished=false;
  const finish=(error:unknown,value?:T)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(value as T);};
  const abort=()=>finish(stopped());
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){abort();return;}
  try{Promise.resolve(start()).then(value=>finish(signal.aborted?stopped():null,value),error=>finish(error));}catch(error){finish(error);}
 });
}

function digest(file:File):Promise<string>{
 const existing=digests.get(file);if(existing)return existing;
 const pending=(async()=>{
  if(typeof crypto==='undefined'||!crypto.subtle)throw new Error('File verification is unavailable. Open the secure Stați website in an updated browser.');
  const bytes=await file.arrayBuffer();
  if(bytes.byteLength!==file.size)throw new Error('The selected file could not be read completely. Choose it again before sending.');
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  if(hash.byteLength!==32)throw new Error('File verification failed. Choose the original file again before sending.');
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
 })();
 digests.set(file,pending);
 void pending.catch(()=>{if(digests.get(file)===pending)digests.delete(file);});
 return pending;
}

function validateReceipt(value:unknown,state:IntentState,sha256:string,source:'lookup'|'post',status:number):UploadReceipt{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new InvalidReceipt();
 const receipt=value as Record<string,unknown>;
 if(receipt.protocol!==protocol||receipt.accepted!==true||receipt.intentId!==state.intentId||receipt.deviceId!==state.deviceId||
    typeof receipt.id!=='string'||!uuid.test(receipt.id)||typeof receipt.status!=='string'||!['queued','delivered','rejected','expired'].includes(receipt.status)||
    receipt.filename!==state.filename||receipt.bytes!==state.bytes||receipt.sha256!==sha256||typeof receipt.replayed!=='boolean'||
    source==='lookup'&&(status!==200||receipt.replayed!==true)||source==='post'&&(status!==200&&status!==201||receipt.replayed!==(status===200))||
    receipt.rejectionReason!==undefined&&(typeof receipt.rejectionReason!=='string'||receipt.rejectionReason.length>500||receipt.status!=='rejected'))throw new InvalidReceipt();
 return Object.freeze({protocol,intentId:state.intentId,id:receipt.id,deviceId:state.deviceId,accepted:true,status:receipt.status as UploadReceipt['status'],filename:state.filename,bytes:state.bytes,sha256,replayed:receipt.replayed,...(receipt.rejectionReason!==undefined?{rejectionReason:receipt.rejectionReason as string}:{})});
}

function httpError(status:number,text:string){
 let message='The file could not be sent. Please try again.';
 try{const body=JSON.parse(text);if(typeof body?.error==='string'&&body.error.length)message=body.error;}catch{}
 return new ApiError(message,status);
}
function transient(error:unknown){return error instanceof InterruptedUpload||error instanceof ApiError&&transientStatuses.has(error.status);}

function uploadAttempt(target:string,state:IntentState,sha256:string,options:UploadOptions,now:()=>number):Promise<UploadReceipt>{
 return new Promise((resolve,reject)=>{
  let request:XMLHttpRequest|undefined,finished=false;
  const finish=(error?:unknown,receipt?:UploadReceipt)=>{if(finished)return;finished=true;options.signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(receipt!);};
  const abort=()=>{finish(stopped());request?.abort();};
  options.signal.addEventListener('abort',abort,{once:true});
  if(options.signal.aborted){abort();return;}
  try{
   check(state,options.signal,now);options.progress(0);check(state,options.signal,now);
   request=(options.createRequest||(()=>new XMLHttpRequest()))();const current=request;
   if(finished||options.signal.aborted){abort();return;}
   current.open('POST','/api/receive/'+target+'/uploads/'+state.intentId);current.timeout=120000;
   current.setRequestHeader('X-Filename',encodeURIComponent(state.name));current.setRequestHeader('X-Checksum-SHA256',sha256);
   current.upload.onprogress=event=>{if(finished)return;try{check(state,options.signal,now);if(Number.isFinite(event.loaded))options.progress(Math.min(state.bytes,Math.max(0,event.loaded)));}catch(error){finish(error);current.abort();}};
   current.onload=()=>{
    if(finished)return;
    try{
     check(state,options.signal,now);
     if(current.status<200||current.status>=300){finish(httpError(current.status,current.responseText));return;}
     let value:unknown;try{value=JSON.parse(current.responseText);}catch{throw new InvalidReceipt();}
     finish(undefined,validateReceipt(value,state,sha256,'post',current.status));
    }catch(error){finish(error);}
   };
   current.onerror=()=>finish(new InterruptedUpload('Connection lost while sending the file.'));
   current.ontimeout=()=>finish(new InterruptedUpload('The file upload timed out.'));
   current.onabort=()=>finish(stopped());
   check(state,options.signal,now);if(finished)return;
   state.started=true;current.send(state.file);
  }catch(error){finish(asError(error));}
 });
}

async function lookup(state:IntentState,sha256:string,options:UploadOptions,now:()=>number):Promise<UploadReceipt|null>{
 check(state,options.signal,now);
 const controller=new AbortController(),abort=()=>controller.abort();
 options.signal.addEventListener('abort',abort,{once:true});
 if(options.signal.aborted)abort();
 const timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await abortable(()=>(options.fetchReceipt||fetch)('/api/uploads/'+state.intentId+'?deviceId='+state.deviceId,{credentials:'same-origin',cache:'no-store',signal:controller.signal}),controller.signal);
  check(state,options.signal,now);
  if(response.status===404){void response.body?.cancel().catch(()=>{});return null;}
  const text=await abortable(()=>response.text(),controller.signal);check(state,options.signal,now);
  if(!response.ok)throw httpError(response.status,text);
  let value:unknown;try{value=JSON.parse(text);}catch{throw new InvalidReceipt();}
  return validateReceipt(value,state,sha256,'lookup',response.status);
 }catch(error){
  if(options.signal.aborted)throw stopped();
  if(error instanceof ApiError||error instanceof InvalidReceipt)throw error;
  throw new InterruptedUpload('The upload confirmation could not be checked.',{cause:error});
 }finally{clearTimeout(timer);options.signal.removeEventListener('abort',abort);}
}

function pause(delayMs:number,signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(stopped());};
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){abort();return;}
  timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},delayMs);
 });
}

/** Safe whole-file retries. This protocol never calls the legacy upload route. */
export async function uploadWithRetry(target:string,intent:UploadIntent,options:UploadOptions):Promise<UploadReceipt>{
 const state=intents.get(intent),now=options.now||Date.now;
 if(!state||state.file!==intent.originalFile||state.deviceId!==intent.deviceId||state.intentId!==intent.intentId||state.createdAt!==intent.createdAt)throw new Error('Use the original send operation. Check Your files before choosing Send again.');
 check(state,options.signal,now);
 if(typeof target!=='string'||!(/^[a-zA-Z0-9_-]{8,120}$/.test(target)||target.startsWith('device:')&&uuid.test(target.slice(7))&&target.slice(7).toLowerCase()===state.deviceId))throw new Error('Choose the original receiving computer again.');
 if(state.active)throw new Error('This file is already being sent. Wait for the current attempt to finish.');
 state.active=true;
 try{
  const sha256=await abortable(()=>digest(state.file),options.signal);check(state,options.signal,now);
  const accept=(receipt:UploadReceipt)=>{check(state,options.signal,now);state.receipt=receipt;options.progress(state.bytes);check(state,options.signal,now);return receipt;};
  const probe=async()=>{try{return await lookup(state,sha256,options,now);}catch(error){if(transient(error))return null;throw error;}};
  if(state.started){const known=await probe();if(known)return accept(known);if(state.receipt)throw new Error('Stați could not confirm this previously accepted file. Check Your files before choosing Send again.');}
  for(let attempt=0;attempt<=retryDelays.length;attempt++){
   check(state,options.signal,now);
   // The previous request may commit while the browser is backing off. Recheck
   // immediately before resending, so that late acceptance needs no more bytes.
   if(attempt>0){const known=await probe();if(known)return accept(known);}
   try{return accept(await uploadAttempt(target,state,sha256,options,now));}
   catch(error){
    if(!transient(error))throw error;
    const known=await probe();if(known)return accept(known);
    if(attempt===retryDelays.length)throw new Error('Stați could not confirm this file after several attempts. Retry this file without selecting it again, or check Your files.');
    const delayMs=retryDelays[attempt];check(state,options.signal,now);options.onRetry?.({attempt:attempt+2,delayMs});check(state,options.signal,now);
    await abortable(()=>(options.wait||pause)(delayMs,options.signal),options.signal);check(state,options.signal,now);
   }
  }
  throw new Error('The file could not be confirmed. Check Your files before retrying.');
 }finally{state.active=false;}
}
