import {HttpError,MAX_FILE} from './core';
export const TRANSFER_CHECKSUM_HEADER='X-Checksum-SHA256';
export function expectedTransferChecksum(headers:Headers):string|undefined{
 const value=headers.get(TRANSFER_CHECKSUM_HEADER);
 if(value===null)return undefined; // Older clients are still accepted without a verified checksum.
 if(!/^[a-f0-9]{64}$/i.test(value))throw new HttpError(400,'Invalid file checksum. Choose the file again.');
 return value.toLowerCase();
}
export function storedTransferChecksum(object:Pick<R2Object,'checksums'>):string|undefined{
 const value=object.checksums.sha256;
 if(value===undefined)return undefined;
 if(value.byteLength!==32)throw new HttpError(503,'The stored file check is unavailable. Retry later.');
 return Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');
}
/** R2 validates the sender checksum while consuming the bounded stream, without buffering the file in the Worker. */
export async function storeTransfer(bucket:R2Bucket,key:string,stream:ReadableStream<Uint8Array>,bytes:number,contentType:string,sha256?:string):Promise<void>{
 if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>MAX_FILE)throw new HttpError(413,'Choose a non-empty file up to 50 MB.');
 const fixed=new FixedLengthStream(bytes),abort=new AbortController();
 const put=(async()=>bucket.put(key,fixed.readable,{httpMetadata:{contentType},...(sha256?{sha256}:{})}))().catch(error=>{abort.abort(error);throw error;});
 const pipe=stream.pipeTo(fixed.writable,{signal:abort.signal});
 const [stored,piped]=await Promise.allSettled([put,pipe]);
 if(stored.status==='fulfilled'&&piped.status==='fulfilled'&&stored.value){try{if(!sha256||storedTransferChecksum(stored.value)===sha256)return;}catch{/* Invalid stored checksum follows the same cleanup path. */}}
 // Both operations have settled, so a late object write cannot race this cleanup.
 await bucket.delete(key);
 throw new HttpError(400,'File check failed or upload interrupted. Nothing was queued. Try sending the file again.');
}
export async function transferResponse(object:R2ObjectBody,filename:string,bytes:number):Promise<Response>{
 if(object.size!==bytes){await object.body.cancel().catch(()=>{});throw new HttpError(503,'The stored file size changed. Try sending it again.');}
 const checksum=storedTransferChecksum(object);
 return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'private, no-store',...(checksum?{[TRANSFER_CHECKSUM_HEADER]:checksum}:{})}});
}
