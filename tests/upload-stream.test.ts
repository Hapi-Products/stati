import {afterEach,describe,expect,it} from 'vitest';
import {createExecutionContext,env} from 'cloudflare:test';
import worker from '../src/server/index';
import {hash,MAX_FILE,now,token} from '../src/server/core';
import {prepareUploadStream} from '../src/server/upload-stream';
import {storedTransferChecksum} from '../src/server/transfer-integrity';
import mediaFixtures from './fixtures/media-formats.json';
import {MEDIA_SIGNATURE_BYTES} from '../src/server/media-upload';

const encode=(value:string)=>new TextEncoder().encode(value);
async function digest(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');}
function source(chunks:Uint8Array[],failAtEnd=false){
 let reads=0,cancelled=false,index=0;
 const body=new ReadableStream<Uint8Array>({
  pull(controller){reads++;if(index<chunks.length)controller.enqueue(chunks[index++]);else if(failAtEnd)controller.error(new Error('Isolated interrupted upload'));else controller.close();},
  cancel(){cancelled=true;},
 },{highWaterMark:0});
 return {body,get reads(){return reads;},get cancelled(){return cancelled;}};
}
function tinyChunks(bytes:Uint8Array){return [new Uint8Array(),...Array.from(bytes,byte=>new Uint8Array([byte]))];}

// These fixture identities and uploads exist only in Vitest's local D1/R2 bindings.
const objects:string[]=[];
afterEach(async()=>{if(objects.length)await env.FILES.delete(objects.splice(0));});
async function routeFixture(){
 const userId=crypto.randomUUID(),deviceId=crypto.randomUUID(),receiverId=crypto.randomUUID();
 const session=token(),credential=token(),receiver=token();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,?,?,'active','admin',?)").bind(userId,'Isolated','T',now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),userId,now()+1000),
  env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(deviceId,await hash(credential),'Isolated stream fixture',userId,now(),now()+1000,now()),
  env.DB.prepare('INSERT INTO receivers(id,device_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(receiverId,deviceId,await hash(receiver),now()+1000,now()),
 ]);
 const puts:string[]=[];
 const files=new Proxy(env.FILES,{get(target,property){
  if(property==='put')return(...args:Parameters<R2Bucket['put']>)=>{const key=String(args[0]);puts.push(key);objects.push(key);return target.put(...args);};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 async function send(body:ReadableStream<Uint8Array>,filename:string,length:number,checksum?:string,intentId?:string){
  return worker.fetch(new Request('http://localhost:8787/api/receive/'+receiver+(intentId?'/uploads/'+intentId:''),{
   method:'POST',headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access; stati_session='+session,'X-Filename':encodeURIComponent(filename),'Content-Length':String(length),...(checksum?{'X-Checksum-SHA256':checksum}:{})},body,
  }),{...env,FILES:files},createExecutionContext());
 }
 async function expectNothingQueued(){
  for(const table of ['transfers','delivery_records'])expect(await env.DB.prepare(`SELECT id FROM ${table} WHERE device_id=?`).bind(deviceId).first()).toBeNull();
  for(const key of puts)expect(await env.FILES.head(key)).toBeNull();
 }
 async function station(path:string,method='GET',body?:unknown){return worker.fetch(new Request('http://localhost:8787/api/station'+path,{method,headers:{Authorization:'Bearer '+credential,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),{...env,FILES:files},createExecutionContext());}
 return {send,station,puts,expectNothingQueued};
}

const binarySignatures:[string,Uint8Array,string][]=[
 ['pdf',encode('%PDF-1.7\n'),'application/pdf'],
 ['pptx',new Uint8Array([0x50,0x4b,3,4]),'application/octet-stream'],
 ['docx',new Uint8Array([0x50,0x4b,3,4]),'application/octet-stream'],
 ['jpg',new Uint8Array([0xff,0xd8,0xff,0xe0]),'image/jpeg'],
 ['jpeg',new Uint8Array([0xff,0xd8,0xff,0xe0]),'image/jpeg'],
 ['png',new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),'image/png'],
 ['webp',encode('RIFF0000WEBP'),'image/webp'],
];

describe('Worker upload route with fragmented signatures',()=>{
 it.each(binarySignatures)('accepts %s one byte at a time and stores exactly the checksum-verified bytes',async(ext,signature,contentType)=>{
  const fixture=await routeFixture(),bytes=new Uint8Array([...signature,...encode('isolated payload after the signature and its 32-byte inspection window')]);
  const checksum=await digest(bytes),input=source(tinyChunks(bytes));
  const response=await fixture.send(input.body,'fixture.'+ext,bytes.length,checksum.toUpperCase());
  expect(response.status).toBe(201);
  const receipt=await response.json() as {id:string;sha256:string};expect(receipt.sha256).toBe(checksum);
  expect(fixture.puts).toEqual(['transfers/'+receipt.id]);
  const object=await env.FILES.get(fixture.puts[0]);expect(object).not.toBeNull();
  expect(object!.httpMetadata?.contentType).toBe(contentType);expect(storedTransferChecksum(object!)).toBe(checksum);
  expect(new Uint8Array(await object!.arrayBuffer())).toEqual(bytes);
  expect(await env.DB.prepare('SELECT bytes,content_type,status FROM transfers WHERE id=?').bind(receipt.id).first()).toMatchObject({bytes:bytes.length,content_type:contentType,status:'queued'});
 });

 it.each(['x','Stați, amin.'])('accepts short TXT after empty leading chunks: %s',async(text)=>{
  const fixture=await routeFixture(),bytes=encode(text),checksum=await digest(bytes);
  const response=await fixture.send(source(tinyChunks(bytes)).body,'fixture.txt',bytes.length,checksum);
  expect(response.status).toBe(201);
  const object=await env.FILES.get(fixture.puts[0]);expect(new Uint8Array(await object!.arrayBuffer())).toEqual(bytes);
 });

 it('replays the signature and overflow from a large first chunk exactly once',async()=>{
  const fixture=await routeFixture(),bytes=encode('%PDF-'+('fixture bytes '.repeat(100)));
  const response=await fixture.send(source([bytes.subarray(0,900),bytes.subarray(900)]).body,'fixture.pdf',bytes.length,await digest(bytes));
  expect(response.status).toBe(201);
  const object=await env.FILES.get(fixture.puts[0]);expect(new Uint8Array(await object!.arrayBuffer())).toEqual(bytes);
 });

 it.each(['before signature','after signature'])('rejects truncation %s without queue rows or orphan objects',async(phase)=>{
  const fixture=await routeFixture(),bytes=encode(phase==='before signature'?'short':('complete prefix '.repeat(4)));
  const response=await fixture.send(source(tinyChunks(bytes)).body,'fixture.txt',bytes.length+1);
  expect(response.status).toBe(400);await fixture.expectNothingQueued();
  expect(fixture.puts).toHaveLength(phase==='before signature'?0:1);
 });

 it.each(['first chunk','after signature'])('rejects excess bytes in the %s and cancels the source',async(phase)=>{
  const fixture=await routeFixture(),prefix=encode('a'.repeat(40)),input=source(phase==='first chunk'?[prefix]:[prefix.subarray(0,32),prefix.subarray(32)]);
  const response=await fixture.send(input.body,'fixture.txt',39);
  expect(response.status).toBe(400);expect(input.cancelled).toBe(true);await fixture.expectNothingQueued();
  expect(fixture.puts).toHaveLength(phase==='first chunk'?0:1);
 });

 it.each(['before signature','after signature'])('rejects a source read failure %s without orphan storage',async(phase)=>{
  const fixture=await routeFixture(),bytes=encode(phase==='before signature'?'short':'a'.repeat(40)),input=source(tinyChunks(bytes),true);
  const response=await fixture.send(input.body,'fixture.txt',bytes.length+1);
  expect(response.status).toBe(400);await fixture.expectNothingQueued();
  expect(fixture.puts).toHaveLength(phase==='before signature'?0:1);
 });

 it('rejects an invalid split signature and cancels before calling storage',async()=>{
  const fixture=await routeFixture(),bytes=encode('invalid binary signature '.repeat(4)),input=source(tinyChunks(bytes));
  const response=await fixture.send(input.body,'fixture.pdf',bytes.length);
  expect(response.status).toBe(415);expect(input.cancelled).toBe(true);expect(input.reads).toBe(33);
  expect(fixture.puts).toHaveLength(0);await fixture.expectNothingQueued();
 });

 it('rejects a later NUL within the signature window despite a valid first TXT byte',async()=>{
  const fixture=await routeFixture(),bytes=new Uint8Array([65,0,66]),input=source(tinyChunks(bytes));
  const response=await fixture.send(input.body,'fixture.txt',bytes.length);
  expect(response.status).toBe(415);expect(input.cancelled).toBe(true);expect(fixture.puts).toHaveLength(0);await fixture.expectNothingQueued();
 });

 it('rejects a fragmented checksum mismatch without a queued transfer or orphan object',async()=>{
  const fixture=await routeFixture(),bytes=encode('a'.repeat(60));
  const response=await fixture.send(source(tinyChunks(bytes)).body,'fixture.txt',bytes.length,await digest(encode('b'.repeat(60))));
  expect(response.status).toBe(400);expect(fixture.puts).toHaveLength(1);await fixture.expectNothingQueued();
 });

 it('rejects an empty upload declared as nonempty without calling storage',async()=>{
  const fixture=await routeFixture(),response=await fixture.send(source([new Uint8Array()]).body,'fixture.txt',1);
  expect(response.status).toBe(400);expect(fixture.puts).toHaveLength(0);await fixture.expectNothingQueued();
 });

 it('enforces the declared maximum before storage',async()=>{
  const fixture=await routeFixture(),response=await fixture.send(source([encode('x')]).body,'fixture.txt',MAX_FILE+1);
  expect(response.status).toBe(413);expect(fixture.puts).toHaveLength(0);await fixture.expectNothingQueued();
 });
});

describe('bounded upload signature inspection',()=>{
 it('reads only the 32-byte signature until downstream pulls and propagates cancellation',async()=>{
  const input=source(tinyChunks(encode('a'.repeat(100))));
  const prepared=await prepareUploadStream(input.body,'fixture.txt',100);
  expect(input.reads).toBe(33);
  const reader=prepared.stream.getReader();expect((await reader.read()).value).toHaveLength(32);expect(input.reads).toBe(33);
  expect((await reader.read()).value).toEqual(encode('a'));expect(input.reads).toBe(34);
  await reader.cancel();expect(input.cancelled).toBe(true);expect(input.body.locked).toBe(false);
 });

 it('cancels and unlocks the source when type validation fails, even if cancellation rejects',async()=>{
  const body=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(encode('x'.repeat(40)));},cancel(){throw new Error('Isolated cancel failure');}},{highWaterMark:0});
  await expect(prepareUploadStream(body,'fixture.pdf',80)).rejects.toMatchObject({status:415});
  expect(body.locked).toBe(false);
 });
});

describe('media through the real local upload, download and delivery routes',()=>{
 const media=mediaFixtures.fixtures.map(file=>({...file,data:Uint8Array.from(atob(file.base64),char=>char.charCodeAt(0))}));
 it.each(media)('stores and serves the exact checked $extension fixture before acknowledgement',async file=>{
  const f=await routeFixture(),body=source([file.data.subarray(0,1),file.data.subarray(1,3),file.data.subarray(3,27),file.data.subarray(27)]);
  expect(await digest(file.data)).toBe(file.sha256);expect(file.data.length).toBe(file.bytes);
  const response=await f.send(body.body,'Synthetic.'+file.extension.toUpperCase(),file.bytes,file.sha256);expect(response.status).toBe(201);
  const receipt=await response.json() as {id:string};const stored=await env.FILES.get(f.puts[0]);expect(stored?.httpMetadata?.contentType).toBe(file.mime);
  for(let n=0;n<2;n++){const downloaded=await f.station('/transfers/'+receipt.id);expect(downloaded.status).toBe(200);expect(downloaded.headers.get('X-Checksum-SHA256')).toBe(file.sha256);expect(downloaded.headers.get('Content-Length')).toBe(String(file.bytes));expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(file.data);}
  expect(await env.FILES.head(f.puts[0])).not.toBeNull();
  expect((await f.station('/transfers/'+receipt.id+'/delivered','POST')).status).toBe(200);expect(await env.FILES.head(f.puts[0])).toBeNull();expect((await f.station('/transfers/'+receipt.id)).status).toBe(410);
 });
 it.each(['mp4','mp3'])('idempotent $s media retry creates one transfer and never changes its bytes',async extension=>{
  const f=await routeFixture(),file=media.find(file=>file.extension===extension)!,intent=crypto.randomUUID();
  const first=await f.send(source([file.data]).body,'Synthetic.'+extension,file.bytes,file.sha256,intent);expect(first.status).toBe(201);const accepted=await first.json() as {id:string};
  const second=await f.send(source([file.data]).body,'Synthetic.'+extension,file.bytes,file.sha256,intent);expect(second.status).toBe(200);expect(await second.json()).toMatchObject({id:accepted.id,replayed:true});expect(f.puts).toHaveLength(1);
 });
 it.each(media.map(file=>file.extension))('rejects an executable renamed as %s before temporary storage',async extension=>{
  const f=await routeFixture(),bytes=encode('MZ'+('not media '.repeat(500))),input=source([bytes]);
  expect((await f.send(input.body,'renamed.'+extension,bytes.length,await digest(bytes))).status).toBe(415);expect(f.puts).toHaveLength(0);expect(input.cancelled).toBe(true);await f.expectNothingQueued();
 });
 it('retains checksum rejection and orphan cleanup for a genuine video upload',async()=>{
  const f=await routeFixture(),file=media.find(file=>file.extension==='mp4')!;expect((await f.send(source([file.data]).body,'clip.mp4',file.bytes,'0'.repeat(64))).status).toBe(400);expect(f.puts).toHaveLength(1);await f.expectNothingQueued();
 });
 it('bounds media inspection to4100 bytes, preserves backpressure and releases on cancellation',async()=>{
  const file=media.find(file=>file.extension==='mp4')!,bytes=new Uint8Array(MEDIA_SIGNATURE_BYTES+500);bytes.set(file.data);const input=source(tinyChunks(bytes));
  const prepared=await prepareUploadStream(input.body,'clip.mp4',bytes.length);expect(input.reads).toBe(MEDIA_SIGNATURE_BYTES+1);
  const reader=prepared.stream.getReader();expect((await reader.read()).value).toEqual(bytes.subarray(0,MEDIA_SIGNATURE_BYTES));expect(input.reads).toBe(MEDIA_SIGNATURE_BYTES+1);await reader.cancel();expect(input.cancelled).toBe(true);expect(input.body.locked).toBe(false);
 });
 it('does not mistake audio Ogg for a video file or enable unrelated archive detection',async()=>{
  for(const [bytes,name] of [[media.find(file=>file.extension==='ogv')!.data,'song.ogg'],[encode('PK\x03\x04'+'x'.repeat(5000)),'archive.mp4'],[new Uint8Array([0x1a,0x45,0xdf,0xa3,...Array(64).fill(0xff)]),'bad.webm']] as const){
   const f=await routeFixture();expect((await f.send(source([bytes]).body,name,bytes.length,await digest(bytes))).status).toBe(415);expect(f.puts).toHaveLength(0);await f.expectNothingQueued();
  }
 });
});
