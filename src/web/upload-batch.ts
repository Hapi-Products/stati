import {createUploadIntent,uploadWithRetry} from './upload-retry';
import type {UploadIntent,UploadReceipt} from './upload-retry';

export type UploadEntry={file:File;deviceId:string;intent:UploadIntent;state:'ready'|'sending'|'accepted'|'failed'|'stopped';receipt?:UploadReceipt;error?:string};
export type BatchProgress={loaded:number;total:number;entry:UploadEntry};
type Deliver=(target:string,intent:UploadIntent,options:{signal:AbortSignal;progress:(bytes:number)=>void;onRetry?:(retry:{attempt:number;delayMs:number})=>void})=>Promise<UploadReceipt>;
const aborted=()=>new DOMException('Sending stopped.','AbortError');

/** A visit-local ledger: one deliberate operation for each original File and computer. */
export function createUploadBatch(){
 const files=new WeakMap<File,Map<string,UploadEntry>>();let running=false;
 function select(selectedFiles:File[],deviceIds:string[]){
  const entries:UploadEntry[]=[];
  for(const file of new Set(selectedFiles)){
   let destinations=files.get(file);if(!destinations){destinations=new Map();files.set(file,destinations);}
   for(const deviceId of new Set(deviceIds)){
    let entry=destinations.get(deviceId);
    if(!entry){entry={file,deviceId,intent:createUploadIntent(file,deviceId),state:'ready'};destinations.set(deviceId,entry);}
    entries.push(entry);
   }
  }
  return entries;
 }
 function again(entries:UploadEntry[]){
  if(running)throw Error('Finish or stop sending before starting another send.');
  if(entries.some(entry=>!entry.receipt))throw Error('Retry the remaining files before starting another send.');
  for(const entry of entries)files.get(entry.file)?.delete(entry.deviceId);
 }
 async function run(entries:UploadEntry[],{signal,deliver=uploadWithRetry,target=entry=>'device:'+entry.deviceId,onChange=()=>{},onProgress=()=>{},onRetry=()=>{}}:{signal:AbortSignal;deliver?:Deliver;target?:(entry:UploadEntry)=>string;onChange?:()=>void;onProgress?:(progress:BatchProgress)=>void;onRetry?:(entry:UploadEntry,retry:{attempt:number;delayMs:number})=>void}){
  if(running)throw Error('Files are already being sent.');
  running=true;
  const unique=[...new Set(entries)],total=unique.reduce((sum,entry)=>sum+entry.file.size,0);
  // Bound both requests and in-flight file bytes. Shared File digests are still
  // memoized by uploadWithRetry, even when sent to several computers.
  const queue=unique.filter(entry=>!entry.receipt),active=new Map<UploadEntry,Promise<void>>(),loaded=new Map(unique.map(entry=>[entry,entry.receipt?entry.file.size:0]));
  let activeBytes=0;
  const changed=()=>{try{onChange();}catch{}};
  const report=(entry:UploadEntry,bytes:number)=>{if(signal.aborted)return;loaded.set(entry,Math.max(loaded.get(entry)||0,Math.min(entry.file.size,Math.max(0,bytes))));onProgress({loaded:[...loaded.values()].reduce((sum,value)=>sum+value,0),total,entry});};
  async function send(entry:UploadEntry){
   entry.state='sending';entry.error=undefined;changed();
   try{
    const receipt=await deliver(target(entry),entry.intent,{signal,progress:bytes=>report(entry,bytes),onRetry:retry=>{if(!signal.aborted)onRetry(entry,retry);}});
    if(signal.aborted)throw aborted();
    entry.receipt=receipt;entry.state='accepted';report(entry,entry.file.size);
   }catch(error){
    entry.state=signal.aborted||(error as Error)?.name==='AbortError'?'stopped':'failed';
    entry.error=entry.state==='stopped'?'Sending stopped. Retry uses the same send.':(error as Error)?.message||'The file could not be sent.';
   }
   changed();
  }
  try{
   while(queue.length||active.size){
    while(!signal.aborted&&queue.length&&active.size<3){
     const index=queue.findIndex(entry=>active.size===0||activeBytes+entry.file.size<=64*1024*1024);if(index<0)break;
     const [entry]=queue.splice(index,1);activeBytes+=entry.file.size;
     const task=send(entry).finally(()=>{active.delete(entry);activeBytes-=entry.file.size;});active.set(entry,task);
    }
    if(!active.size)break;
    await Promise.race(active.values());
   }
  }finally{running=false;}
  return unique;
 }
 return{select,again,run};
}
