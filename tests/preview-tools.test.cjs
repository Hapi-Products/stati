const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{transformSync}=require('esbuild');
function runtimeFactory(){const filename=path.resolve('src/desktop/preview-tools.ts'),loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{loader:'ts',format:'cjs'}).code,filename);return loaded.exports.createPreviewTools;}
const createPreviewTools=runtimeFactory(),deferred=()=>{let resolve;return{promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)};},flush=()=>new Promise(resolve=>setImmediate(resolve));
test('the real preview runtime coalesces pending metadata and releases audio/video Blob URLs on close and identity reset',async()=>{
 const pending=deferred();let reads=0;const runtime=createPreviewTools({filePreview:()=>{reads++;return pending.promise;}});
 const thumbnail=runtime.thumbnail('song'),play=runtime.play('song');await flush();assert.equal(reads,1);
 const bytes=new TextEncoder().encode('Local media transport fixture');pending.resolve({kind:'media',mediaType:'audio',mime:'audio/mpeg',bytes});
 assert.equal((await thumbnail).text,'Audio file');const media=await play;assert.equal(media.mediaType,'audio');assert.deepEqual(new Uint8Array(await(await fetch(media.url)).arrayBuffer()),bytes);
 media.release();media.release();await assert.rejects(fetch(media.url));
 const next=await runtime.play('song');runtime.reset();await assert.rejects(fetch(next.url));next.release();
});
test('resetting identity rejects old work; a late old response cannot remove a new profile pending request',async()=>{
 const old=deferred(),fresh=deferred();let reads=0;const runtime=createPreviewTools({filePreview:()=>++reads===1?old.promise:fresh.promise});
 const first=runtime.thumbnail('same-id');await flush();runtime.reset();await assert.rejects(first,/selected user changed/);
 const next=runtime.thumbnail('same-id');await flush();old.resolve({kind:'text',text:'Old private words'});await flush();
 const duplicate=runtime.thumbnail('same-id');assert.equal(duplicate,next);fresh.resolve({kind:'text',text:'Current words'});assert.deepEqual(await next,{text:'Current words',changedSinceDelivery:undefined});assert.equal(reads,2);runtime.reset();
});
test('a thumbnail reset before its queued task starts never requests the previous identity file',async()=>{
 let reads=0;const runtime=createPreviewTools({filePreview:async()=>{reads++;return {kind:'text',text:'Old private words'};}});
 const pending=runtime.thumbnail('old-file');runtime.reset();await assert.rejects(pending,/selected user changed/);assert.equal(reads,0);
 assert.equal((await runtime.thumbnail('new-file')).text,'Old private words');assert.equal(reads,1);runtime.reset();
});
test('a bitmap that finishes after identity reset is closed without creating a canvas or exposing its image',async()=>{
 const previous=global.createImageBitmap,pending=deferred();let started=false,closed=0;
 global.createImageBitmap=()=>{started=true;return pending.promise;};
 const runtime=createPreviewTools({filePreview:async()=>({kind:'image',mime:'image/png',bytes:new Uint8Array([1])})});
 try{const first=runtime.thumbnail('image');await flush();assert.equal(started,true);runtime.reset();await assert.rejects(first,/selected user changed/);pending.resolve({close(){closed++;}});await flush();assert.equal(closed,1);}finally{runtime.reset();if(previous===undefined)delete global.createImageBitmap;else global.createImageBitmap=previous;}
});
test('unsupported files remain explicit and long Romanian/emoji text is bounded without splitting characters',async()=>{
 const words='Și 😀 '.repeat(200),runtime=createPreviewTools({filePreview:async id=>id==='unsupported'?{kind:'unsupported',reason:'Open the saved file.'}:{kind:'text',text:words,changedSinceDelivery:true}});
 assert.equal((await runtime.thumbnail('unsupported')).reason,'Open the saved file.');const text=await runtime.thumbnail('words');assert.ok(Array.from(text.text).length<=600);assert.equal(text.changedSinceDelivery,true);assert.equal(/\ud83d$/.test(text.text),false);await assert.rejects(runtime.play('words'),/no audio or video preview/);runtime.reset();
});

const webp=Buffer.from(JSON.parse(fs.readFileSync('tests/fixtures/profile-photos.json','utf8')).fixtures.find(sample=>sample.extension==='webp').base64,'base64');
const photoUrl=bytes=>'data:image/webp;base64,'+bytes.toString('base64');
function photoCanvas(){
 const previous={document:global.document,createImageBitmap:global.createImageBitmap},draws=[],canvases=[];
 global.document={createElement:tag=>{assert.equal(tag,'canvas');const canvas={width:0,height:0,getContext:()=>({drawImage(_bitmap,_x,_y,width,height){draws.push({width,height});}}),toDataURL:()=> 'data:image/png;base64,local-fixture'};canvases.push(canvas);return canvas;}};
 return {draws,canvases,restore(){if(previous.document===undefined)delete global.document;else global.document=previous.document;if(previous.createImageBitmap===undefined)delete global.createImageBitmap;else global.createImageBitmap=previous.createImageBitmap;}};
}
test('WebP profile decoding coalesces repeated inputs and uses the same two-job queue as file thumbnails',async()=>{
 const f=photoCanvas(),metadata=deferred(),bitmaps=[];let reads=0,closed=0;
 global.createImageBitmap=blob=>{assert.equal(blob.type,'image/webp');const pending=deferred();bitmaps.push(pending);return pending.promise;};
 const runtime=createPreviewTools({filePreview:()=>{reads++;return metadata.promise;}}),url=photoUrl(webp);
 try{
  const file=runtime.thumbnail('file'),first=runtime.photo(url),duplicate=runtime.photo(url),second=runtime.photo(photoUrl(Buffer.concat([webp,Buffer.from([1])])));
  assert.equal(first,duplicate);await flush();assert.equal(reads,1);assert.equal(bitmaps.length,1);
  metadata.resolve({kind:'text',text:'Queued file'});assert.equal((await file).text,'Queued file');await flush();assert.equal(bitmaps.length,2);
  for(const bitmap of bitmaps)bitmap.resolve({width:400,height:800,close(){closed++;}});
  assert.equal(await first,'data:image/png;base64,local-fixture');await second;assert.equal(closed,2);assert.deepEqual(f.draws,[{width:32,height:64},{width:32,height:64}]);assert.ok(f.canvases.every(canvas=>canvas.width===0&&canvas.height===0));
 }finally{runtime.reset();f.restore();}
});
test('a very tall profile image stays within a64-pixel edge and invalid photo data never reaches the decoder',async()=>{
 const f=photoCanvas();let decodes=0,closed=0;
 global.createImageBitmap=async()=>{decodes++;return{width:1,height:16000,close(){closed++;}};};
 const runtime=createPreviewTools({filePreview:async()=>{throw Error('Profiles do not fetch file metadata');}});
 try{
  await runtime.photo(photoUrl(webp));assert.deepEqual(f.draws,[{width:1,height:64}]);assert.equal(closed,1);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfQoAAAAASUVORK5CYII=','base64');
  for(const url of ['https://example.test/photo.webp','data:image/png;base64,'+png.toString('base64'),'data:image/webp;base64,!!!!',photoUrl(png),'data:image/webp;base64,'+'A'.repeat(4*Math.ceil(1024*1024/3)+4)])await assert.rejects(runtime.photo(url),/Profile photo/);
  assert.equal(decodes,1);
 }finally{runtime.reset();f.restore();}
});
test('reset rejects old WebP work and closes a late bitmap without removing a newer same-photo job',async()=>{
 const f=photoCanvas(),bitmaps=[];let closed=0;
 global.createImageBitmap=()=>{const pending=deferred();bitmaps.push(pending);return pending.promise;};
 const runtime=createPreviewTools({filePreview:async()=>{throw Error('No file request');}}),url=photoUrl(webp);
 try{
  const old=runtime.photo(url);await flush();runtime.reset();await assert.rejects(old,/selected user changed/);
  const current=runtime.photo(url);await flush();assert.equal(bitmaps.length,2);bitmaps[0].resolve({width:16,height:12,close(){closed++;}});await flush();assert.equal(closed,1);assert.equal(f.canvases.length,0);
  assert.equal(runtime.photo(url),current);bitmaps[1].resolve({width:16,height:12,close(){closed++;}});await current;assert.equal(closed,2);assert.equal(f.canvases.length,1);
  const immediate=runtime.photo(photoUrl(Buffer.concat([webp,Buffer.from([2])])));runtime.reset();await assert.rejects(immediate,/selected user changed/);assert.equal(bitmaps.length,2);
 }finally{runtime.reset();f.restore();}
});
test('pending profile input URLs are limited to8MiB and an old reset cleanup cannot free the current budget',async()=>{
 const f=photoCanvas(),bitmaps=[];
 global.createImageBitmap=()=>{const pending=deferred();bitmaps.push(pending);return pending.promise;};
 const runtime=createPreviewTools({filePreview:async()=>{throw Error('No file request');}});
 const url=index=>{const bytes=Buffer.alloc(1024*1024);webp.copy(bytes);bytes[bytes.length-1]=index;return photoUrl(bytes);};
 try{
  const old=Array.from({length:5},(_,index)=>runtime.photo(url(index)));for(const item of old)void item.catch(()=>{});await flush();assert.equal(bitmaps.length,2);runtime.reset();
  const current=Array.from({length:5},(_,index)=>runtime.photo(url(index+10)));for(const item of current)void item.catch(()=>{});await Promise.allSettled(old);await flush();
  for(const bitmap of bitmaps.slice(0,2))bitmap.resolve({width:16,height:12,close(){}});await flush();await assert.rejects(runtime.photo(url(30)),/still loading/);
  runtime.reset();await Promise.allSettled(current);for(const bitmap of bitmaps.slice(2))bitmap.resolve({width:16,height:12,close(){}});await flush();
 }finally{runtime.reset();f.restore();}
});
