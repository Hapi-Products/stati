const {test}=require('node:test'),assert=require('node:assert/strict');
const {createProfilePhotos,photoBytes,photoInfo,nativeThumbnail,MAX_PHOTO_BYTES}=require('../desktop/profile-photos.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfQoAAAAASUVORK5CYII=','base64');
const url='data:image/png;base64,'+png.toString('base64');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function response(bytes=png,headers={}){return new Response(bytes,{headers});}
test('photo streams accept legacy missing lengths and copy reused chunks without exceeding the 1 MiB bound',async()=>{
 const bytes=await photoBytes(response(),new AbortController().signal);assert.deepEqual(bytes,png);
 const original=Uint8Array.from([1,2]);let reads=0;
 const streamed=new Response(new ReadableStream({pull(controller){if(reads===0){controller.enqueue(original);reads++;}else if(reads===1){original[0]=3;original[1]=4;controller.enqueue(original);reads++;}else controller.close();}},{highWaterMark:0}));
 assert.deepEqual(await photoBytes(streamed,new AbortController().signal),Buffer.from([1,2,3,4]));
});
test('oversized, invalid or dishonest lengths cancel the body before any image decoding',async()=>{
 for(const length of ['0','-1','not-a-size',String(MAX_PHOTO_BYTES+1)]){let canceled=false;const body=new ReadableStream({cancel(){canceled=true;}});await assert.rejects(photoBytes(new Response(body,{headers:{'Content-Length':length}}),new AbortController().signal));assert.equal(canceled,true);}
 let canceled=false;
 const overflow=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(MAX_PHOTO_BYTES));controller.enqueue(new Uint8Array(1));},cancel(){canceled=true;}});
 await assert.rejects(photoBytes(new Response(overflow),new AbortController().signal),/size limit/);assert.equal(canceled,true);
 await assert.rejects(photoBytes(response(png,{'Content-Length':String(png.length+1)}),new AbortController().signal),/incomplete/);
 await assert.rejects(photoBytes(response(png,{'Content-Length':'1'}),new AbortController().signal),/size limit/);
});
test('dimensions and real image type are checked before native decoding; thumbnail dimensions always fit 64 pixels',async()=>{
 assert.deepEqual(photoInfo(png),{width:1,height:1,mime:'image/png'});
 const enormous=Buffer.from(png);enormous.writeUInt32BE(100000,16);assert.throws(()=>photoInfo(enormous),{code:'PHOTO_DIMENSIONS'});
 const overPixels=Buffer.from(png);overPixels.writeUInt32BE(6000,16);overPixels.writeUInt32BE(6000,20);assert.throws(()=>photoInfo(overPixels),{code:'PHOTO_DIMENSIONS'});
 assert.throws(()=>photoInfo(Buffer.from('<svg width="1" height="1"/>')),{code:'PHOTO_INVALID'});
 let decoded=0;const photos=createProfilePhotos({fetchPhoto:async()=>response(enormous),thumbnail:()=>{decoded++;return url;}});await assert.rejects(photos.load('bad'));assert.equal(decoded,0);
 for(const [width,height,expected] of [[1,16000,{width:1,height:64}],[16000,1,{width:64,height:1}],[400,800,{width:32,height:64}],[1,1,{width:1,height:1}]]){
  let resized;const image={isEmpty:()=>false,getSize:()=>({width,height}),resize:options=>{resized=options;return {toDataURL:()=>url};}};
  assert.equal(nativeThumbnail({createFromBuffer:()=>image},png,{width,height}),url);assert.deepEqual(resized,{...expected,quality:'good'});
 }
});
test('concurrent photo requests coalesce, run two at a time, and retain only a bounded expiring success cache',async()=>{
 let now=0,started=[],decodeCount=0;const gates=new Map();
 const photos=createProfilePhotos({now:()=>now,ttl:60,maxEntries:2,fetchPhoto:async id=>{started.push(id);const gate=deferred();gates.set(id,gate);await gate.promise;return response();},thumbnail:()=>{decodeCount++;return url;}});
 const a=photos.load('a'),same=photos.load('a'),b=photos.load('b'),c=photos.load('c');await settle();assert.deepEqual(started,['a','b']);assert.strictEqual(a,same);
 gates.get('a').resolve();assert.equal(await a,url);await settle();assert.deepEqual(started,['a','b','c']);gates.get('b').resolve();gates.get('c').resolve();await Promise.all([b,c]);assert.equal(decodeCount,3);
 assert.equal(await photos.load('b'),url);assert.equal(started.length,3);
 const again=photos.load('a');await settle();assert.equal(started.length,4);gates.get('a').resolve();await again;await settle();
 now=61;const expired=photos.load('a');await settle();assert.equal(started.length,5);gates.get('a').resolve();await expired;
});
test('a failed request is retryable, and a user/computer change cancels pending reads and discards late results',async()=>{
 let calls=0;const photos=createProfilePhotos({fetchPhoto:async()=>{if(++calls===1)return new Response('Unavailable',{status:503});return response();},thumbnail:()=>url});
 await assert.rejects(photos.load('retry'));assert.equal(await photos.load('retry'),url);assert.equal(calls,2);
 let canceled=0,decodes=0;const signals=[];
 const changing=createProfilePhotos({fetchPhoto:async(id,signal)=>{signals.push(signal);return signals.length===1?new Response(new ReadableStream({cancel(){canceled++;}})):response();},thumbnail:()=>{decodes++;return url;}});
 const old=changing.load('person');await settle();changing.clear();const fresh=changing.load('person');await assert.rejects(old);assert.equal(await fresh,url);await changing.drain();assert.equal(canceled,1);assert.equal(signals[0].aborted,true);assert.equal(decodes,1);
 const gate=deferred();let returned=0;
 const late=createProfilePhotos({fetchPhoto:async()=>response(),thumbnail:async()=>{returned++;if(returned===1)await gate.promise;return url;}});
 const pending=late.load('person');await settle();late.clear();gate.resolve();await assert.rejects(pending);assert.equal(await late.load('person'),url);assert.equal(returned,2);
});
test('queues reject excess work without retaining it and reject non-image thumbnail data',async()=>{
 const gate=deferred();let count=0;
 const photos=createProfilePhotos({fetchPhoto:async()=>{count++;await gate.promise;return response();},thumbnail:()=>url});
 const jobs=Array.from({length:26},(_,i)=>photos.load('person-'+i));await assert.rejects(photos.load('excess'),/still loading/);await settle();assert.equal(count,2);gate.resolve();await Promise.all(jobs);await photos.drain();
 const unsafe=createProfilePhotos({fetchPhoto:async()=>response(),thumbnail:()=> 'https://example.test/tracker'});await assert.rejects(unsafe.load('person'),/unavailable/);
});


test('JPEG preflight walks adversarial marker headers without copying the remaining buffer',()=>{
 class NoCopyBytes extends Uint8Array{slice(){throw Error('JPEG must not copy its remaining buffer');}subarray(){throw Error('JPEG must walk its original bytes');}}
 const chunks=200000,bytes=new NoCopyBytes(2+chunks*4+13);bytes.set([255,216]);for(let offset=2;offset<2+chunks*4;offset+=4)bytes.set([255,225,0,2],offset);bytes.set([255,192,0,11,8,0,1,0,1,1,1,17,0],2+chunks*4);assert.deepEqual(photoInfo(bytes),{width:1,height:1,mime:'image/jpeg'});
 for(const malformed of [Uint8Array.from([255,216,0]),Uint8Array.from([255,216,255,225,0,0]),Uint8Array.from([255,216,255,225,0,1]),Uint8Array.from([255,216,255,225,255,255]),Uint8Array.from([255,216,255,218]),Uint8Array.from([255,216,255,192,0,8,8,0,1,0,1,0])])assert.throws(()=>photoInfo(malformed),{code:'PHOTO_INVALID'});
 const zeros=new NoCopyBytes(MAX_PHOTO_BYTES);zeros.set([255,216]);assert.throws(()=>photoInfo(zeros),{code:'PHOTO_INVALID'});
});


test('WebP is passed as bounded checked input for Chromium decoding and the native cache has a byte budget',async()=>{
 const samples=require('./fixtures/profile-photos.json').fixtures,webp=Buffer.from(samples.find(sample=>sample.extension==='webp').base64,'base64'),info=photoInfo(webp);let decoded=0;
 assert.equal(nativeThumbnail({createFromBuffer(){decoded++;throw Error('WebP must use Chromium');}},webp,info),'data:image/webp;base64,'+webp.toString('base64'));assert.equal(decoded,0);
 let reads=0;const photos=createProfilePhotos({maxCacheBytes:url.length+1,fetchPhoto:async()=>{reads++;return response();},thumbnail:()=>url});await photos.load('a');await settle();await photos.load('b');await settle();await photos.load('a');assert.equal(reads,3);await photos.drain();
});
