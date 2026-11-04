import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {api,ApiError} from './api';
import {startVisiblePolling} from './useConnectionPresence';
import type {UploadReceipt} from './upload-retry';

export type Delivery={id:string;filename:string;status:'queued'|'delivered'|'rejected'|'expired';rejection_reason:string|null;computer_name:string;created_at:number;updated_at:number;dismissed_at:number|null;history_hidden_at?:number|null};
const maximumKnown=1000,maximumSeen=2000;
const decided=(status:Delivery['status'])=>status!=='queued';
const alertable=(record:Delivery)=>record.status==='delivered'||record.status==='rejected';
const recent=(a:Delivery,b:Delivery)=>b.updated_at-a.updated_at||b.id.localeCompare(a.id);
function loadSeen(userId:string){
 const ids=new Set<string>();
 for(const name of ['localStorage','sessionStorage'] as const)try{const saved=JSON.parse(window[name].getItem('stati-rejections-'+userId)||'[]');if(Array.isArray(saved))for(const id of saved.slice(-maximumSeen))if(typeof id==='string'&&/^[\w-]{20,60}$/.test(id))ids.add(id);}catch{}
 return new Set([...ids].slice(-maximumSeen));
}
function persistSeen(userId:string,seen:Set<string>){
 const value=JSON.stringify([...seen].slice(-maximumSeen));
 for(const name of ['localStorage','sessionStorage'] as const)try{window[name].setItem('stati-rejections-'+userId,value);}catch{}
}
function checkedRecords(value:unknown):Delivery[]{
 if(!Array.isArray(value)||value.length>100)throw Error('Invalid delivery status response.');
 return value.map(record=>{
  if(!record||typeof record!=='object'||typeof record.id!=='string'||!/^[\w-]{20,60}$/.test(record.id)||typeof record.filename!=='string'||record.filename.length>500||typeof record.computer_name!=='string'||record.computer_name.length>200||!['queued','delivered','rejected','expired'].includes(record.status)||!Number.isSafeInteger(record.created_at)||record.created_at<0||!Number.isSafeInteger(record.updated_at)||record.updated_at<0||record.dismissed_at!==null&&(!Number.isSafeInteger(record.dismissed_at)||record.dismissed_at<0)||record.rejection_reason!==null&&(typeof record.rejection_reason!=='string'||record.rejection_reason.length>500))throw Error('Invalid delivery status response.');
  if(record.history_hidden_at!==undefined&&record.history_hidden_at!==null&&(!Number.isSafeInteger(record.history_hidden_at)||record.history_hidden_at<0))throw Error('Invalid history visibility.');
  return {...record,rejection_reason:record.status==='rejected'?record.rejection_reason:null} as Delivery;
 });
}
type Snapshot={files:Delivery[];pending:Delivery[]};
type DeliveryStore={snapshot:()=>Snapshot;subscribe:(listener:()=>void)=>()=>void;dismiss:(id:string)=>void;acquire:()=>()=>void};
const stores=new Map<string,DeliveryStore>();
function createStore(userId:string):DeliveryStore{
 let records=new Map<string,Delivery>(),seen=loadSeen(userId),snapshot:Snapshot={files:[],pending:[]},owners=0,stop:(()=>void)|undefined,refreshAck:(()=>void)|undefined,ackCursor=0;
 const listeners=new Set<()=>void>();
 function publish(){
  // Admit outstanding decisions before history, including locally dismissed
  // ones whose server ACK still needs retry. Older outcomes must not disappear
  // behind a full cache of newer cards that are already acknowledged.
  const awaiting=(record:Delivery)=>Number(alertable(record)&&!record.dismissed_at);
  const files=[...records.values()].sort((a,b)=>awaiting(b)-awaiting(a)||recent(a,b)).slice(0,maximumKnown).sort(recent);
  records=new Map(files.map(record=>[record.id,record]));
  snapshot={files,pending:files.filter(record=>alertable(record)&&!record.dismissed_at&&!seen.has(record.id))};
  for(const listener of listeners)listener();
 }
 function merge(value:unknown){
  for(const record of checkedRecords(value)){
   const previous=records.get(record.id);
   // Decisions cannot revert to queued, including a late older response. Keep
   // confirmed dismissals when an earlier GET arrives after acknowledgement.
   const next=previous&&(decided(previous.status)&&record.status==='queued'||previous.updated_at>record.updated_at&&decided(previous.status)===decided(record.status))?previous:record;
   records.set(record.id,{...next,dismissed_at:Math.max(previous?.dismissed_at||0,record.dismissed_at||0)||null,history_hidden_at:Math.max(previous?.history_hidden_at||0,record.history_hidden_at||0)||null});
  }
  publish();
 }
 function dismiss(id:string){
  const record=records.get(id);if(!record||!alertable(record))return;
  seen.delete(id);seen.add(id);if(seen.size>maximumSeen)seen.delete(seen.values().next().value!);
  persistSeen(userId,seen);publish();refreshAck?.();
 }
 function confirmed(id:string){const record=records.get(id);if(record){records.set(id,{...record,dismissed_at:Math.max(1,Math.floor(Date.now()/1000))});publish();}}
 function release(){if(!owners&&!listeners.size&&stores.get(userId)===store)stores.delete(userId);}
 const store={
  snapshot:()=>snapshot,
  subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);release();};},
  dismiss,
  acquire(){
   owners++;if(owners===1){
    if(!stores.has(userId))stores.set(userId,store);seen=loadSeen(userId);publish();persistSeen(userId,seen);
    const stopGet=startVisiblePolling(async signal=>{try{const records=await api<unknown>('/transfers',{signal});if(!signal.aborted)merge(records);}catch(error){if(!signal.aborted&&error instanceof ApiError&&[401,403].includes(error.status))return false;}},{intervalMs:15000});
    // Independent job: a lost/stalled dismissal response cannot block status
    // polling. Replays are safe because the server acknowledgement is idempotent.
    const stopAck=startVisiblePolling(async signal=>{
     const waiting=snapshot.files.filter(record=>alertable(record)&&!record.dismissed_at&&seen.has(record.id));
     if(!waiting.length)return;
     const start=ackCursor%waiting.length,candidates=[...waiting.slice(start),...waiting.slice(0,start)].slice(0,10);ackCursor=start+candidates.length;
     let unauthorized=false;
     await Promise.allSettled(candidates.map(async record=>{try{await api('/transfers/'+record.id+'/dismiss',{method:'POST',body:'{}',signal});if(!signal.aborted)confirmed(record.id);}catch(error){if(signal.aborted)return;if(error instanceof ApiError&&[401,403].includes(error.status))unauthorized=true;else if(error instanceof ApiError&&error.status===404)confirmed(record.id);}}));
     if(unauthorized)return false;
    },{intervalMs:5000});
    refreshAck=stopAck.refresh;stop=()=>{stopGet();stopAck();};
   }
   return()=>{owners--;if(!owners){stop?.();stop=undefined;refreshAck=undefined;records.clear();seen.clear();snapshot={files:[],pending:[]};for(const listener of listeners)listener();}release();};
  },
 };
 return store;
}
function storeFor(userId:string){let store=stores.get(userId);if(!store){store=createStore(userId);stores.set(userId,store);}return store;}
export function useSenderDeliveries(userId:string){
 const store=useMemo(()=>storeFor(userId||''),[userId]);
 const snapshot=useSyncExternalStore(store.subscribe,store.snapshot,store.snapshot);
 return{...snapshot,dismiss:store.dismiss,store};
}
export function useSenderDeliveryPolling(userId:string){const {store,...snapshot}=useSenderDeliveries(userId);useEffect(()=>store.acquire(),[store]);return snapshot;}

export function resolveReceipt(receipt:UploadReceipt|undefined,record:Delivery|undefined):UploadReceipt|undefined{
 if(!receipt||!record||record.id!==receipt.id||receipt.status!=='queued'&&record.status==='queued')return receipt;
 return{...receipt,status:record.status,...(record.status==='rejected'&&record.rejection_reason?{rejectionReason:record.rejection_reason}:{rejectionReason:undefined})};
}
/** Only display copies change. Original upload receipts/intents stay immutable. */
export function useSenderReceipts(userId:string,receipts:(UploadReceipt|undefined)[]){
 const {files}=useSenderDeliveries(userId),retained=useRef({userId,values:new Map<string,UploadReceipt>()});
 if(retained.current.userId!==userId)retained.current={userId,values:new Map()};
 const ids=new Set(receipts.flatMap(receipt=>receipt?[receipt.id]:[])),records=new Map(files.map(record=>[record.id,record]));
 for(const id of retained.current.values.keys())if(!ids.has(id))retained.current.values.delete(id);
 return receipts.map(receipt=>{
  if(!receipt)return receipt;
  const next=resolveReceipt(receipt,records.get(receipt.id))!,previous=retained.current.values.get(receipt.id);
  const result=previous&&next.status==='queued'?previous:next;
  if(result.status!=='queued')retained.current.values.set(result.id,result);
  return result;
 });
}
