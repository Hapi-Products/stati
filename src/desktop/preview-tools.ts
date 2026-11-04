import {createPreviewQueue} from '../shared/preview-scheduler.js';
import {MAX_PROFILE_BYTES,profilePhotoInfo} from '../shared/profile-photo.js';
import {pdfAssetOptions} from '../shared/pdf-assets.js';
import type {MediaPreview,PreviewPayload,Thumbnail} from './preview-types';
declare global {interface Window {statiThumbnail:(id:string)=>Promise<Thumbnail>;statiPlayPreview:(id:string)=>Promise<MediaPreview>;statiPhotoThumbnail:(url:string)=>Promise<string>;}}
const maxBytes=50*1024*1024,maxPixels=25000000;
const photoPrefix='data:image/webp;base64,',maxPhotoInputs=8*1024*1024;
function interrupted(){return Error('The preview was closed or the selected user changed.');}
function checked(signal:AbortSignal){signal.throwIfAborted();}
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)return Promise.reject(signal.reason);
 return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});promise.then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(signal.reason);else resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});
}
function payloadBytes(payload:Extract<PreviewPayload,{bytes:Uint8Array}>){
 if(!(payload.bytes instanceof Uint8Array)||payload.bytes.byteLength>maxBytes)throw Error('This preview exceeds the supported size.');
 const bytes=new Uint8Array(payload.bytes.byteLength);bytes.set(payload.bytes);return bytes;
}
function canvasFor(width:number,height:number,edge=480){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width*height>maxPixels)throw Error('This image is too large to preview.');
 const scale=Math.min(1,edge/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.min(edge,Math.max(1,Math.ceil(width*scale)));canvas.height=Math.min(edge,Math.max(1,Math.ceil(height*scale)));return canvas;
}
async function imageThumbnail(payload:Extract<PreviewPayload,{kind:'image'}>,signal:AbortSignal,edge=480){
 const decoded=createImageBitmap(new Blob([payloadBytes(payload)],{type:payload.mime})).then(bitmap=>{if(signal.aborted){bitmap.close();throw signal.reason;}return bitmap;});
 const bitmap=await abortable(decoded,signal);let canvas:HTMLCanvasElement|undefined;
 try{checked(signal);canvas=canvasFor(bitmap.width,bitmap.height,edge);const context=canvas.getContext('2d');if(!context)throw Error('Image preview unavailable.');context.drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');}
 finally{bitmap.close();if(canvas)canvas.width=canvas.height=0;}
}
function mediaReady(video:HTMLVideoElement,event:'loadeddata'|'seeked',signal:AbortSignal){
 checked(signal);if(event==='loadeddata'&&video.readyState>=2)return Promise.resolve();
 return new Promise<void>((resolve,reject)=>{
  const cleanup=()=>{video.removeEventListener(event,ready);video.removeEventListener('error',error);signal.removeEventListener('abort',abort);};
  const ready=()=>{cleanup();resolve();},error=()=>{cleanup();reject(Error('This media format cannot be previewed here. Open its saved copy to view it.'));},abort=()=>{cleanup();reject(signal.reason);};
  video.addEventListener(event,ready,{once:true});video.addEventListener('error',error,{once:true});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });
}
async function videoThumbnail(payload:Extract<PreviewPayload,{kind:'media'}>,signal:AbortSignal){
 const video=document.createElement('video'),url=URL.createObjectURL(new Blob([payloadBytes(payload)],{type:payload.mime})),deadline=AbortSignal.any([signal,AbortSignal.timeout(8000)]);let canvas:HTMLCanvasElement|undefined;
 try{
  video.preload='auto';video.muted=true;video.playsInline=true;const ready=mediaReady(video,'loadeddata',deadline);video.src=url;video.load();await ready;checked(deadline);
  if(Number.isFinite(video.duration)&&video.duration>.2){const seek=mediaReady(video,'seeked',deadline);video.currentTime=.1;await seek;}checked(deadline);
  canvas=canvasFor(video.videoWidth,video.videoHeight);const context=canvas.getContext('2d');if(!context)throw Error('Video preview unavailable.');context.drawImage(video,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');
 }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);if(canvas)canvas.width=canvas.height=0;}
}
async function pdfThumbnail(payload:Extract<PreviewPayload,{kind:'pdf'}>,signal:AbortSignal){
 const pdfjs=await import('pdfjs-dist');checked(signal);pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();
 const task=pdfjs.getDocument({...pdfAssetOptions(import.meta.url),data:payloadBytes(payload)}),abort=()=>void task.destroy().catch(()=>{});signal.addEventListener('abort',abort,{once:true});let canvas:HTMLCanvasElement|undefined;
 try{
  const doc=await abortable(task.promise,signal),page=await abortable(doc.getPage(1),signal),original=page.getViewport({scale:1});checked(signal);
  if(!Number.isFinite(original.width)||!Number.isFinite(original.height)||original.width<=0||original.height<=0)throw Error('PDF page dimensions are unavailable.');
  const viewport=page.getViewport({scale:Math.min(1,480/Math.max(original.width,original.height))});canvas=canvasFor(viewport.width,viewport.height);const context=canvas.getContext('2d');if(!context)throw Error('PDF preview unavailable.');
  await abortable(page.render({canvas,canvasContext:context,viewport}).promise,signal);checked(signal);return canvas.toDataURL('image/png');
 }finally{signal.removeEventListener('abort',abort);await task.destroy();if(canvas)canvas.width=canvas.height=0;}
}
export function createPreviewTools(bridge:{filePreview:(id:string)=>Promise<PreviewPayload>}){
 const queue=createPreviewQueue(),controllers=new Set<AbortController>(),payloads=new Map<string,Promise<PreviewPayload>>(),releases=new Set<()=>void>(),photoInputs=new Map<string,{promise:Promise<string>;bytes:number}>();let epoch=0,photoInputBytes=0,photoSequence=0;
 function getPayload(id:string,signal:AbortSignal){
  checked(signal);let pending=payloads.get(id);if(!pending){pending=bridge.filePreview(id);payloads.set(id,pending);const current=pending;void pending.finally(()=>{if(payloads.get(id)===current)payloads.delete(id);}).catch(()=>{});}return abortable(pending,signal);
 }
 async function run<T>(task:(signal:AbortSignal)=>Promise<T>){const controller=new AbortController(),generation=epoch;controllers.add(controller);try{const result=await task(controller.signal);checked(controller.signal);if(generation!==epoch)throw interrupted();return result;}finally{controllers.delete(controller);}}
 return {
  photo(url:string):Promise<string>{
   if(typeof url!=='string'||!url.startsWith(photoPrefix)||url.length>photoPrefix.length+4*Math.ceil(MAX_PROFILE_BYTES/3))return Promise.reject(Error('Profile photo exceeds its supported size or format.'));
   const existing=photoInputs.get(url);if(existing)return existing.promise;
   if(url.length>maxPhotoInputs-photoInputBytes)return Promise.reject(Error('Other profile photos are still loading. Try again shortly.'));
   const generation=epoch,promise=queue.run(generation+':photo:'+ ++photoSequence,()=>{
    if(generation!==epoch)throw interrupted();
    return run(async signal=>{
     const deadline=AbortSignal.any([signal,AbortSignal.timeout(10000)]),encoded=url.slice(photoPrefix.length);
     if(!encoded||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error('Profile photo cannot be opened.');
     checked(deadline);const binary=atob(encoded);if(!binary.length||binary.length>MAX_PROFILE_BYTES)throw Error('Profile photo exceeds its supported size.');
     const bytes=Uint8Array.from(binary,character=>character.charCodeAt(0)),info=profilePhotoInfo(bytes);if(info.mime!=='image/webp')throw Error('Profile photo cannot be opened.');
     return imageThumbnail({kind:'image',bytes,mime:info.mime},deadline,64);
    });
   }),entry={promise,bytes:url.length};
   photoInputs.set(url,entry);photoInputBytes+=entry.bytes;
   void promise.finally(()=>{if(photoInputs.get(url)===entry){photoInputs.delete(url);photoInputBytes-=entry.bytes;}}).catch(()=>{});
   return promise;
  },
  thumbnail(id:string):Promise<Thumbnail>{const generation=epoch;return queue.run(generation+':'+id,()=>{
   if(generation!==epoch)throw interrupted();
   return run(async signal=>{
   const payload=await getPayload(id,signal);checked(signal);const base={changedSinceDelivery:payload.changedSinceDelivery};
   if(payload.kind==='text')return {...base,text:Array.from(payload.text).slice(0,600).join('')};
   if(payload.kind==='unsupported')return {...base,reason:payload.reason};
   if(payload.kind==='media'&&payload.mediaType==='audio')return {...base,text:'Audio file'};
   if(payload.kind==='image')return {...base,image:await imageThumbnail(payload,signal),label:payload.label};
   if(payload.kind==='pdf')return {...base,image:await pdfThumbnail(payload,signal),label:'First PDF page'};
   if(payload.kind==='media')return {...base,image:await videoThumbnail(payload,signal),label:'Video preview'};
   return {...base,reason:'Preview unavailable.'};
   });
  });},
  play(id:string):Promise<MediaPreview>{return run(async signal=>{
   const payload=await getPayload(id,signal);checked(signal);if(payload.kind!=='media')throw Error('This file has no audio or video preview.');
   const url=URL.createObjectURL(new Blob([payloadBytes(payload)],{type:payload.mime}));let released=false;const release=()=>{if(!released){released=true;URL.revokeObjectURL(url);releases.delete(release);}};releases.add(release);
   return {url,mediaType:payload.mediaType,changedSinceDelivery:payload.changedSinceDelivery,release};
  });},
  reset(){epoch++;for(const controller of controllers)controller.abort(interrupted());queue.clear();payloads.clear();photoInputs.clear();photoInputBytes=0;for(const release of [...releases])release();},
 };
}
if(typeof window!=='undefined'&&window.stati){const runtime=createPreviewTools(window.stati);window.statiThumbnail=id=>runtime.thumbnail(id);window.statiPlayPreview=id=>runtime.play(id);window.statiPhotoThumbnail=url=>runtime.photo(url);window.addEventListener('stati-previews-reset',()=>runtime.reset());window.addEventListener('beforeunload',()=>runtime.reset());window.dispatchEvent(new Event('stati-preview-ready'));}
