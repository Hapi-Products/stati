const {profilePhotoInfo:photoInfo,MAX_PROFILE_BYTES:MAX_PHOTO_BYTES,MAX_PROFILE_PIXELS:MAX_PHOTO_PIXELS,MAX_PROFILE_EDGE:MAX_PHOTO_EDGE}=require('../src/shared/profile-photo.js');
const {createPreviewQueue}=require('./preview-queue.cjs');
const PHOTO_EDGE=64;
async function photoBytes(response,signal){
 let reader,abort;const chunks=[];let total=0;
 try{
  signal.throwIfAborted();
  if(!response?.ok||!response.body?.getReader)throw Error('Profile photo unavailable.');
  const raw=response.headers.get('Content-Length');let declared;
  if(raw!==null){if(!/^\d+$/.test(raw))throw Error('Invalid photo length.');declared=Number(raw);if(!Number.isSafeInteger(declared)||declared<=0||declared>MAX_PHOTO_BYTES)throw Error('Invalid photo length.');}
  reader=response.body.getReader();abort=()=>void reader.cancel(signal.reason).catch(()=>{});signal.addEventListener('abort',abort,{once:true});signal.throwIfAborted();
  for(;;){const part=await reader.read();signal.throwIfAborted();if(part.done)break;if(!(part.value instanceof Uint8Array)||part.value.byteLength>Math.min(MAX_PHOTO_BYTES,declared??MAX_PHOTO_BYTES)-total)throw Error('Profile photo exceeded its size limit.');total+=part.value.length;chunks.push(Buffer.from(part.value));}
  if(!total||declared!==undefined&&declared!==total)throw Error('Profile photo is incomplete.');
  return Buffer.concat(chunks,total);
 }catch(error){if(reader)await reader.cancel().catch(()=>{});else await Promise.resolve(response?.body?.cancel?.()).catch(()=>{});throw error;}
 finally{if(abort)signal.removeEventListener('abort',abort);reader?.releaseLock();}
}
function nativeThumbnail(nativeImage,bytes,info){
 // Chromium can decode WebP even where nativeImage only handles PNG/JPEG.
 // The renderer converts this bounded, checked input to a 64px PNG.
 if(info.mime==='image/webp')return 'data:image/webp;base64,'+bytes.toString('base64');
 const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw Error('Profile photo cannot be opened.');
 const actual=image.getSize();if(!Number.isSafeInteger(actual.width)||!Number.isSafeInteger(actual.height)||actual.width<=0||actual.height<=0||actual.width>MAX_PHOTO_EDGE||actual.height>MAX_PHOTO_EDGE||actual.width*actual.height>MAX_PHOTO_PIXELS)throw Error('Profile photo cannot be opened.');
 const scale=Math.min(1,PHOTO_EDGE/actual.width,PHOTO_EDGE/actual.height);
 return image.resize({width:Math.max(1,Math.round(actual.width*scale)),height:Math.max(1,Math.round(actual.height*scale)),quality:'good'}).toDataURL();
}
function createProfilePhotos({fetchPhoto,thumbnail,now=()=>Date.now(),ttl=60000,maxEntries=64,maxCacheBytes=8*1024*1024,timeout=10000}={}){
 const queue=createPreviewQueue({concurrency:2,maxWaiting:24}),cache=new Map(),controllers=new Set(),tasks=new Set();let epoch=0,cacheBytes=0;
 function forget(id){const value=cache.get(id);if(value){cacheBytes-=value.url.length;cache.delete(id);}}
 function clear(){epoch++;for(const controller of controllers)controller.abort(Error('The selected user or computer changed.'));queue.clear();cache.clear();cacheBytes=0;}
 function load(id){
  const cached=cache.get(id);if(cached&&cached.expires>now()){cache.delete(id);cache.set(id,cached);return Promise.resolve(cached.url);}forget(id);
  const generation=epoch;
  const task=queue.run(generation+':'+id,async()=>{
   if(generation!==epoch)throw Error('The selected user changed.');
   const controller=new AbortController();controllers.add(controller);const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(timeout)]);
   try{
    const bytes=await photoBytes(await fetchPhoto(id,signal),signal);signal.throwIfAborted();
    const info=photoInfo(bytes),url=await thumbnail(bytes,info);signal.throwIfAborted();if(generation!==epoch)throw Error('The selected user changed.');
    if(typeof url!=='string'||!/^data:image\/(?:png|jpeg|webp);base64,/.test(url)||url.length>(url.startsWith('data:image/webp;base64,')?23+4*Math.ceil(MAX_PHOTO_BYTES/3):128*1024))throw Error('Profile thumbnail unavailable.');
    forget(id);cache.set(id,{url,expires:now()+ttl});cacheBytes+=url.length;while(cache.size>maxEntries||cacheBytes>maxCacheBytes)forget(cache.keys().next().value);return url;
   }finally{controllers.delete(controller);}
  });
  tasks.add(task);void task.finally(()=>tasks.delete(task)).catch(()=>{});
  return task;
 }
 return {load,clear,drain:()=>Promise.allSettled([...tasks])};
}
module.exports={createProfilePhotos,photoBytes,photoInfo,nativeThumbnail,MAX_PHOTO_BYTES,MAX_PHOTO_PIXELS,MAX_PHOTO_EDGE};
