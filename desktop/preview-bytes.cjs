const fs=require('node:fs/promises'),constants=require('node:fs').constants,crypto=require('node:crypto');
const MAX_PREVIEW_BYTES=50*1024*1024;
const message='This file could not be checked for preview. Try again; the saved file has been kept.';
const signature=stat=>['dev','ino','size','mtimeNs','ctimeNs'].map(key=>String(stat[key])).join(':');
function active({signal,checkActive}){signal?.throwIfAborted();checkActive?.();}
function checksum(value){if(value===undefined||value===null)return null;if(typeof value!=='string'||! /^[a-f\d]{64}$/i.test(value))throw Error('Invalid preview checksum.');return value.toLowerCase();}
function limit(value){if(!Number.isSafeInteger(value)||value<1||value>MAX_PREVIEW_BYTES)throw Error('Invalid preview limit.');return value;}
async function readRemotePreview(response,{maxBytes=MAX_PREVIEW_BYTES,expectedBytes,expectedChecksum,signal,checkActive}={}){
 let reader,abort;const context={signal,checkActive};
 try{
  active(context);limit(maxBytes);
  if(!response?.ok||!response.body?.getReader)throw Error('Preview download unavailable.');
  const raw=response.headers.get('Content-Length');if(typeof raw!=='string'||! /^\d+$/.test(raw))throw Error('Invalid preview size.');
  const length=Number(raw);if(!Number.isSafeInteger(length)||length<=0||length>maxBytes)throw Error('Invalid preview size.');
  if(expectedBytes!==undefined&&(!Number.isSafeInteger(expectedBytes)||expectedBytes!==length))throw Error('Preview metadata size changed.');
  const metadataHash=checksum(expectedChecksum),headerHash=checksum(response.headers.get('X-Checksum-SHA256'));
  if(metadataHash&&headerHash&&metadataHash!==headerHash)throw Error('Preview checksum metadata changed.');
  const expected=metadataHash||headerHash,hash=crypto.createHash('sha256'),chunks=[];let bytes=0;
  reader=response.body.getReader();abort=()=>void reader.cancel(signal.reason).catch(()=>{});signal?.addEventListener('abort',abort,{once:true});active(context);
  for(;;){
   const {done,value}=await reader.read();active(context);if(done)break;
   if(!(value instanceof Uint8Array)||value.byteLength>length-bytes)throw Error('Preview exceeded its size.');
   const chunk=Buffer.from(value);hash.update(chunk);chunks.push(chunk);bytes+=chunk.length;
  }
  if(bytes!==length)throw Error('Preview ended early.');const sha256=hash.digest('hex');
  if(expected&&sha256!==expected)throw Error('Preview checksum mismatch.');active(context);
  return {bytes:Buffer.concat(chunks,bytes),sha256,checksumVerified:!!expected};
 }catch(cause){
  if(reader)await reader.cancel().catch(()=>{});else await Promise.resolve(response?.body?.cancel?.()).catch(()=>{});
  if(signal?.aborted)throw signal.reason;throw Error(message,{cause});
 }finally{if(abort)signal?.removeEventListener('abort',abort);reader?.releaseLock();}
}
async function readLocalPreview(file,{maxBytes=MAX_PREVIEW_BYTES,expectedChecksum,signal,checkActive}={}){
 let handle;const context={signal,checkActive};
 try{
  active(context);limit(maxBytes);const before=await fs.lstat(file,{bigint:true});active(context);
  if(!before.isFile()||before.isSymbolicLink()||before.size>BigInt(maxBytes))throw Error('Invalid saved preview file.');
  handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const opened=await handle.stat({bigint:true});active(context);
  if(!opened.isFile()||signature(before)!==signature(opened))throw Error('Saved file changed before preview.');
  const bytes=Buffer.alloc(Number(opened.size)),hash=crypto.createHash('sha256');let offset=0;
  while(offset<bytes.length){const count=Math.min(65536,bytes.length-offset),{bytesRead}=await handle.read(bytes,offset,count,offset);active(context);if(!Number.isInteger(bytesRead)||bytesRead<1||bytesRead>count)throw Error('Saved file ended early.');hash.update(bytes.subarray(offset,offset+bytesRead));offset+=bytesRead;}
  const after=await handle.stat({bigint:true}),current=await fs.lstat(file,{bigint:true});active(context);
  if(current.isSymbolicLink()||signature(opened)!==signature(after)||signature(after)!==signature(current))throw Error('Saved file changed during preview.');
  const sha256=hash.digest('hex'),original=checksum(expectedChecksum);
  // Operators may edit their local copy after delivery. Show that stable copy;
  // its hash is not a new receipt for the original upload.
  return {bytes,sha256,checksumVerified:!!original&&original===sha256,changedSinceDelivery:!!original&&original!==sha256,signature:signature(current)};
 }catch(cause){if(signal?.aborted)throw signal.reason;throw Error(message,{cause});}
 finally{await handle?.close().catch(()=>{});}
}
module.exports={readRemotePreview,readLocalPreview,MAX_PREVIEW_BYTES};
