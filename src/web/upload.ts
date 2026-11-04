import {ApiError} from './api';
const maxBytes=50*1024*1024;
export function uploadFile(path:string,file:File,{signal,progress,createRequest=()=>new XMLHttpRequest()}:{signal:AbortSignal;progress:(bytes:number)=>void;createRequest?:()=>XMLHttpRequest}):Promise<void>{
 return new Promise((resolve,reject)=>{
  let request:XMLHttpRequest|undefined,finished=false;
  const finish=(error?:Error)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
  const abort=()=>{finish(new DOMException('Upload stopped.','AbortError'));request?.abort();};
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){abort();return;}
  if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>maxBytes){finish(new Error('Choose a non-empty file up to 50 MB.'));return;}

  // Hash the selected bytes before uploading. Cancellation cannot stop Web Crypto,
  // so every async boundary checks whether this upload has already been stopped.
  void (async()=>{
   try{
    if(typeof crypto==='undefined'||!crypto.subtle){finish(new Error('File verification is unavailable. Open the secure Stați website in an updated browser.'));return;}
    const bytes=await file.arrayBuffer();
    if(finished)return;
    if(bytes.byteLength!==file.size){finish(new Error('The selected file could not be read completely. Choose it again before sending.'));return;}
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    if(finished)return;
    const expected=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    const activeRequest=createRequest();request=activeRequest;
    activeRequest.open('POST','/api'+path);activeRequest.timeout=120000;
    activeRequest.setRequestHeader('X-Filename',encodeURIComponent(file.name));
    activeRequest.setRequestHeader('X-Checksum-SHA256',expected);
    activeRequest.upload.onprogress=event=>{if(!finished)progress(Math.min(file.size,event.loaded));};
    activeRequest.onload=()=>{
     if(finished)return;
     if(activeRequest.status>=200&&activeRequest.status<300){
      let receipt;
      try{receipt=JSON.parse(activeRequest.responseText);}catch{finish(new Error('The service did not confirm this upload. Check Your files before retrying.'));return;}
      if(receipt?.status!=='queued'||typeof receipt.id!=='string'||! /^[\w-]{20,60}$/.test(receipt.id)){finish(new Error('The service did not confirm this upload. Check Your files before retrying.'));return;}
      // Older servers acknowledge queueing without a checksum. A present digest
      // must match; a queued receipt alone is not proof of verified file integrity.
      if(Object.prototype.hasOwnProperty.call(receipt,'sha256')&&(typeof receipt.sha256!=='string'||! /^[a-f0-9]{64}$/.test(receipt.sha256)||receipt.sha256!==expected)){finish(new Error('The service returned an invalid or different file checksum. Check Your files before retrying.'));return;}
      progress(file.size);finish();
     }else{
      let message='Upload failed. Please try again.';
      try{message=JSON.parse(activeRequest.responseText).error||message;}catch{}
      finish(new ApiError(message,activeRequest.status));
     }
    };
    activeRequest.onerror=()=>finish(new Error('Connection lost. Check Your files before retrying.'));
    activeRequest.ontimeout=()=>finish(new Error('Upload took too long. Check Your files before retrying.'));
    activeRequest.onabort=()=>finish(new DOMException('Upload stopped.','AbortError'));
    if(finished||signal.aborted){abort();return;}
    activeRequest.send(file);
   }catch(error){finish(error instanceof Error?error:new Error('The selected file could not be checked. Choose it again before sending.'));}
  })();
 });
}
