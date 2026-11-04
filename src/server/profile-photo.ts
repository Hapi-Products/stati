import {fileType,HttpError} from './core';
import {MAX_PROFILE_BYTES,profilePhotoInfo} from '../shared/profile-photo.js';
export {MAX_PROFILE_BYTES} from '../shared/profile-photo.js';

// Inspect dimensions before any client is asked to decode the original. This
// bounds decoded pixel memory; it is not a full image decoder or virus scan.
export function profilePhotoType(name:string,bytes:Uint8Array){
 let type:string;
 try{
  type=fileType(name,bytes.subarray(0,32));
  if(profilePhotoInfo(bytes).mime!==type)throw Error('Unsupported image.');
 }catch(error){if(error instanceof Error&&'code' in error&&error.code==='PHOTO_DIMENSIONS')throw new HttpError(413,error.message);throw new HttpError(415,'Choose a readable JPG, PNG or WebP photo.');}
 return type;
}

export async function readProfilePhoto(request:Request){
 const raw=request.headers.get('content-length'),length=raw&&/^\d+$/.test(raw)?Number(raw):NaN;
 if(!Number.isSafeInteger(length)||length<1||length>MAX_PROFILE_BYTES)throw new HttpError(413,'Profile photos must be 1 MB or smaller.');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Choose a photo.');
 const chunks:Uint8Array[]=[];let total=0;
 const abort=()=>void reader.cancel(request.signal.reason).catch(()=>{});
 request.signal.addEventListener('abort',abort,{once:true});
 try{
  request.signal.throwIfAborted();
  while(true){
   const {done,value}=await reader.read();request.signal.throwIfAborted();if(done)break;
   if(!(value instanceof Uint8Array))throw new HttpError(400,'The profile photo upload was interrupted. Try again.');
   if(value.byteLength>MAX_PROFILE_BYTES-total)throw new HttpError(413,'Profile photos must be 1 MB or smaller.');
   total+=value.byteLength;
   if(total>length)throw new HttpError(400,'The profile photo size changed. Try again.');
   if(value.byteLength)chunks.push(value.slice());
  }
  if(total!==length)throw new HttpError(400,'The profile photo upload was incomplete. Try again.');
 }catch(error){
  await reader.cancel().catch(()=>{});
  if(error instanceof HttpError)throw error;
  throw new HttpError(400,'The profile photo upload was interrupted. Try again.');
 }finally{request.signal.removeEventListener('abort',abort);reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return {bytes,type:profilePhotoType(request.headers.get('x-filename')||'',bytes)};
}

export function profilePhotoResponse(object:R2ObjectBody){
 return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'image/jpeg','Content-Length':String(object.size)}});
}
