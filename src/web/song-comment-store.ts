import type {TaskImage} from '../shared/feedback-tasks-types';
export type CorrectionPayload={id:string;songId:string;contentHash:string;message:string;quote:string;replacement:string};
export type CorrectionPhoto={id:string;filename:string;bytes:number;sha256:string;confirmed:boolean};
export type CorrectionDraft={ownerId:string;computerId:string;songId:string;payload:CorrectionPayload;phase:'editing'|'unconfirmed'|'accepted'|'sent'|'rejected';photos:CorrectionPhoto[]};
export function correctionMatches(draft:CorrectionDraft,value:unknown):boolean{
 if(!value||typeof value!=='object'||!('correction'in value)||!value.correction||typeof value.correction!=='object')return false;
 const row=value.correction as Record<string,unknown>,p=draft.payload;
 return row.id===p.id&&row.computerId===draft.computerId&&row.songId===p.songId&&row.contentHash===p.contentHash&&row.message===p.message&&row.quote===p.quote&&row.replacement===p.replacement;
}
export function correctionImageMatches(photo:CorrectionPhoto,row:TaskImage){return row.id===photo.id&&(row.uploadFilename??row.filename)===photo.filename&&(row.uploadBytes??row.bytes)===photo.bytes&&(row.uploadSha256??row.sha256)===photo.sha256;}
function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('stati-song-comments-v1',1);request.onupgradeneeded=()=>{for(const name of ['drafts','photos'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Close other Stați tabs and try again.'));});}
async function read<T>(store:string,key:string):Promise<T|undefined>{const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(store),request=tx.objectStore(store).get(key);request.onsuccess=()=>resolve(request.result as T|undefined);request.onerror=()=>reject(request.error);});}finally{db.close();}}
async function write(store:string,key:string,value:unknown){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
export const correctionKey=(owner:string,computer:string,song:string)=>[owner,computer,song].join(':');
export async function readCorrection(owner:string,computer:string,song:string){const value=await read<CorrectionDraft>('drafts',correctionKey(owner,computer,song));if(value&&(value.ownerId!==owner||value.computerId!==computer||value.songId!==song||value.payload.songId!==song||!['editing','unconfirmed','accepted','sent','rejected'].includes(value.phase)||!Array.isArray(value.photos)||value.photos.length>6))throw Error('The saved comment could not be verified. Its bytes are kept.');return value;}
export const saveCorrection=(draft:CorrectionDraft)=>write('drafts',correctionKey(draft.ownerId,draft.computerId,draft.songId),draft);
export const archiveCorrection=(draft:CorrectionDraft)=>write('drafts',correctionKey(draft.ownerId,draft.computerId,draft.songId)+':'+draft.payload.id,draft);
export async function saveCorrectionPhoto(owner:string,id:string,file:Blob){await write('photos',owner+':'+id,{owner,id,file});}
export async function readCorrectionPhoto(owner:string,id:string){const value=await read<{owner:string;id:string;file:Blob}>('photos',owner+':'+id);if(!value||value.owner!==owner||value.id!==id||!(value.file instanceof Blob))throw Error('Your saved image could not be read. It has not been sent again.');return value.file;}
