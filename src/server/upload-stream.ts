import {fileType,HttpError,MAX_FILE} from './core';
import {mediaUploadFormat} from '../shared/media-formats.js';
import {mediaUploadType,MEDIA_SIGNATURE_BYTES} from './media-upload';

const fileCheckError=()=>new HttpError(400,'File check failed or upload interrupted. Nothing was queued. Try sending the file again.');

/** Inspect a bounded signature, then replay every consumed byte under storage backpressure. */
export async function prepareUploadStream(source:ReadableStream<Uint8Array>,filename:string,bytes:number){
 const reader=source.getReader();
 let finished=false,total=0;
 async function cancelReader(reason?:unknown){
  if(finished)return;
  finished=true;
  try{await reader.cancel(reason);}catch{/* Preserve the validation or storage failure. */}
  finally{reader.releaseLock();}
 }
 async function readChunk(){
  const next=await reader.read();
  if(next.done){
   finished=true;reader.releaseLock();
   if(total!==bytes)throw fileCheckError();
   return;
  }
  total+=next.value.byteLength;
  if(total>bytes||total>MAX_FILE)throw fileCheckError();
  return next.value;
 }
 try{
  if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>MAX_FILE)throw new HttpError(413,'Choose a non-empty file up to 50 MB.');
  const media=mediaUploadFormat(filename),prefix=new Uint8Array(Math.min(media?MEDIA_SIGNATURE_BYTES:32,bytes));
  let offset=0,pending:Uint8Array|undefined;
  while(offset<prefix.length){
   const chunk=await readChunk();
   if(!chunk)throw fileCheckError();
   const take=Math.min(prefix.length-offset,chunk.byteLength);
   prefix.set(chunk.subarray(0,take),offset);offset+=take;
   if(take<chunk.byteLength)pending=chunk.subarray(take);
  }
  const contentType=media?await mediaUploadType(media,prefix):fileType(filename,prefix);
  let prefixSent=false;
  const stream=new ReadableStream<Uint8Array>({
   async pull(controller){
    try{
     if(!prefixSent){prefixSent=true;controller.enqueue(prefix);return;}
     if(pending){controller.enqueue(pending);pending=undefined;return;}
     let chunk;
     do{chunk=await readChunk();}while(chunk&&chunk.byteLength===0);
     if(chunk)controller.enqueue(chunk);else controller.close();
    }catch(error){await cancelReader(error);controller.error(error);}
   },
   cancel:cancelReader,
  },{highWaterMark:0});
  return {contentType,stream};
 }catch(error){
  await cancelReader(error);
  if(error instanceof HttpError)throw error;
  throw fileCheckError();
 }
}
