import {afterEach,describe,expect,it} from 'vitest';
import {createExecutionContext,env} from 'cloudflare:test';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';
import {MAX_PROFILE_BYTES,readProfilePhoto} from '../src/server/profile-photo';
import {profilePhotoInfo} from '../src/shared/profile-photo.js';
import samples from './fixtures/profile-photos.json';

// All accounts, objects and requests here use Vitest's isolated local D1/R2.
const objects:string[]=[];
afterEach(async()=>{if(objects.length)await env.FILES.delete(objects.splice(0));});
const bytesFor=(sample:typeof samples.fixtures[number])=>Uint8Array.from(atob(sample.base64),character=>character.charCodeAt(0));
const png=()=>bytesFor(samples.fixtures.find(sample=>sample.extension==='png')!);
async function person(status='active'){
 const id=crypto.randomUUID(),raw=token();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,?,?,?,?,?)').bind(id,'Isolated','T',status,'member',now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(raw),id,now()+1000),
 ]);
 return {id,cookie:'stati_session='+raw};
}
async function station(){
 const owner=await person(),id=crypto.randomUUID(),credential=token();
 await env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)').bind(id,await hash(credential),'Isolated photo fixture',owner.id,now(),now()+1000,now()).run();
 return {id,credential,owner};
}
async function call(path:string,{cookie,bearer,method='GET',body,filename,length}:{cookie?:string;bearer?:string;method?:string;body?:BodyInit;filename?:string;length?:string}={}){
 const puts:string[]=[];
 const files=new Proxy(env.FILES,{get(target,property){
  if(property==='put')return(...args:Parameters<R2Bucket['put']>)=>{const key=String(args[0]);puts.push(key);objects.push(key);return target.put(...args);};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 const request=new Request('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',...(cookie?{Cookie:cookie}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{}),...(filename?{'X-Filename':filename}:{}),...(length!==undefined?{'Content-Length':length}:{})},...(body!==undefined?{body}:{})});
 const response=await worker.fetch(request,{...env,FILES:files},createExecutionContext());
 return {response,puts};
}
const upload=(cookie:string,bytes:Uint8Array,filename='profile.png')=>call('/me/photo',{cookie,method:'PUT',body:bytes,filename,length:String(bytes.length)});
async function keyFor(id:string){return (await env.DB.prepare('SELECT photo_key FROM users WHERE id=?').bind(id).first<{photo_key:string|null}>())!.photo_key;}
async function seedPhoto(id:string){
 const key='profiles/'+id+'/isolated-'+crypto.randomUUID(),bytes=png();objects.push(key);
 await env.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'}});await env.DB.prepare('UPDATE users SET photo_key=? WHERE id=?').bind(key,id).run();
 return {key,bytes};
}
async function history(sender:string,device:string){await env.DB.prepare('INSERT INTO delivery_records(id,device_id,sender_id,filename,bytes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),device,sender,'isolated.txt',1,'delivered',now(),now()).run();}

describe('Profile photo upload validation in the Worker',()=>{
 it.each(samples.fixtures)('stores an actual $extension image and serves the exact bounded private bytes',async sample=>{
  const user=await person(),pc=await station(),bytes=bytesFor(sample);
  const sent=await upload(user.cookie,bytes,'profile.'+sample.extension);expect(sent.response.status).toBe(200);expect(sent.puts).toHaveLength(1);expect(await keyFor(user.id)).toBe(sent.puts[0]);
  const object=await env.FILES.get(sent.puts[0]);expect(new Uint8Array(await object!.arrayBuffer())).toEqual(bytes);
  for(const options of [{cookie:user.cookie},{bearer:pc.credential}]){
   const path='cookie' in options?'/members/'+user.id+'/photo':'/station/senders/'+user.id+'/photo';
   const {response}=await call(path,options);expect(response.status).toBe(200);expect(response.headers.get('Content-Length')).toBe(String(bytes.length));expect(response.headers.get('Cache-Control')).toBe('no-store');expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');expect(response.headers.get('Content-Type')).toBe('image/'+(sample.extension==='jpg'?'jpeg':sample.extension));expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  }
 });

 it.each(samples.fixtures)('rejects malformed $extension header bytes before storage and keeps the previous photo',async sample=>{
  const user=await person(),old=await seedPhoto(user.id),bytes=bytesFor(sample).subarray(0,sample.extension==='jpg'?4:16);
  const {response,puts}=await upload(user.cookie,bytes,'broken.'+sample.extension);expect(response.status).toBe(415);expect(puts).toEqual([]);expect(await keyFor(user.id)).toBe(old.key);expect(await env.FILES.head(old.key)).not.toBeNull();
 });

 it.each(samples.fixtures)('rejects a tiny compressed $extension with more than25 million declared pixels',async sample=>{
  const user=await person(),bytes=bytesFor(sample),view=new DataView(bytes.buffer),width=5001,height=5000;
  if(sample.extension==='png'){view.setUint32(16,width);view.setUint32(20,height);}
  else if(sample.extension==='webp'){view.setUint16(26,width,true);view.setUint16(28,height,true);}
  else {const marker=bytes.findIndex((value,index)=>value===0xff&&[0xc0,0xc1,0xc2].includes(bytes[index+1]));expect(marker).toBeGreaterThan(0);view.setUint16(marker+5,height);view.setUint16(marker+7,width);}
  const {response,puts}=await upload(user.cookie,bytes,'oversized.'+sample.extension);expect(response.status).toBe(413);expect(puts).toEqual([]);expect(await keyFor(user.id)).toBeNull();
 });

 it('rejects overlong sides, zero dimensions, filename/signature mismatches and unsupported content without storage',async()=>{
  const user=await person(),long=png(),zero=png();new DataView(long.buffer).setUint32(16,16385);new DataView(long.buffer).setUint32(20,1);new DataView(zero.buffer).setUint32(16,0);
  for(const [bytes,name,status] of [[long,'long.png',413],[zero,'zero.png',415],[png(),'wrong.jpg',415],[new TextEncoder().encode('<svg width="16" height="12"></svg>'),'vector.png',415]] as const){const {response,puts}=await upload(user.cookie,bytes,name);expect(response.status).toBe(status);expect(puts).toEqual([]);expect(await keyFor(user.id)).toBeNull();}
 });

 it('successfully replaces a valid photo and removes only its previous object',async()=>{
  const user=await person(),old=await seedPhoto(user.id),other=await person(),kept=await seedPhoto(other.id),sent=await upload(user.cookie,png());expect(sent.response.status).toBe(200);expect(await env.FILES.head(old.key)).toBeNull();expect(await env.FILES.head(kept.key)).not.toBeNull();expect(await keyFor(user.id)).toBe(sent.puts[0]);
 });

 it('counts streamed bytes, releases the reader and rejects truncation/overflow before storage',async()=>{
  const user=await person();
  for(const [chunks,length,status] of [[[png().subarray(0,8)],String(png().length),400],[[png(),new Uint8Array([1])],String(png().length),400],[[new Uint8Array(MAX_PROFILE_BYTES+1)],String(MAX_PROFILE_BYTES),413]] as [Uint8Array[],string,number][]){
   let index=0,cancelled=false;
   const stream=new ReadableStream<Uint8Array>({pull(controller){if(index<chunks.length)controller.enqueue(chunks[index++]);else controller.close();},cancel(){cancelled=true;}},{highWaterMark:0});
   const {response,puts}=await call('/me/photo',{cookie:user.cookie,method:'PUT',body:stream,filename:'profile.png',length});expect(response.status).toBe(status);expect(puts).toEqual([]);expect(stream.locked).toBe(false);if(status===413)expect(cancelled).toBe(true);
  }
 });

 it('handles fragmented valid bytes and missing or excessive declared lengths with no unbounded reads',async()=>{
  const bytes=png();let index=0;
  const stream=new ReadableStream<Uint8Array>({pull(controller){if(index<bytes.length)controller.enqueue(bytes.subarray(index,index++ +1));else controller.close();}},{highWaterMark:0});
  const result=await readProfilePhoto(new Request('http://localhost:8787/api/me/photo',{method:'PUT',headers:{'X-Filename':'profile.png','Content-Length':String(bytes.length)},body:stream}));expect(result.bytes).toEqual(bytes);expect(result.type).toBe('image/png');expect(stream.locked).toBe(false);
  for(const length of [undefined,'0','NaN','-1',String(MAX_PROFILE_BYTES+1)]){
   let reads=0;const body=new ReadableStream<Uint8Array>({pull(){reads++;}},{highWaterMark:0});
   await expect(readProfilePhoto(new Request('http://localhost:8787/api/me/photo',{method:'PUT',headers:{'X-Filename':'profile.png',...(length!==undefined?{'Content-Length':length}:{})},body}))).rejects.toMatchObject({status:413});expect(reads).toBe(0);expect(body.locked).toBe(false);
  }
 });

 it('rejects a full1MiB malformed JPEG before storage, without decoding pixels',async()=>{
  const user=await person(),bytes=new Uint8Array(MAX_PROFILE_BYTES);bytes[0]=0xff;bytes[1]=0xd8;
  const {response,puts}=await upload(user.cookie,bytes,'malformed.jpg');expect(response.status).toBe(415);expect(puts).toEqual([]);expect(await keyFor(user.id)).toBeNull();
 });

 it('walks length-prefixed JPEG markers linearly without copying each remaining buffer',()=>{
  for(const count of [1000,2000,4000]){
   const bytes=new Uint8Array(2+4*count+19);bytes.set([0xff,0xd8]);for(let offset=2;offset<2+4*count;offset+=4)bytes.set([0xff,0xe1,0,2],offset);
   bytes.set([0xff,0xc2,0,17,8,0,12,0,16,3,1,0x22,0,2,0x11,1,3,0x11,1],2+4*count);
   let accesses=0;
   const observed=new Proxy(bytes,{get(target,key){accesses++;if(key==='slice'||key==='subarray')throw Error('JPEG marker scanning must not copy remaining segments.');return Reflect.get(target,key,target);}});
   expect(profilePhotoInfo(observed)).toEqual({width:16,height:12,mime:'image/jpeg'});expect(accesses).toBeLessThan(bytes.length*4);
  }
 });

 it('rejects zero/tiny/truncated JPEG segment lengths and premature scan/end markers',()=>{
  for(const tail of [[0xff,0xe1,0,0],[0xff,0xe1,0,1],[0xff,0xe1,0,8,0],[0xff,0xda],[0xff,0xd9],[0xff,0xc0,0,2],[0xff,0xff],[0xff,0,0,2]])expect(()=>profilePhotoInfo(new Uint8Array([0xff,0xd8,...tail]))).toThrow();
 });
});

describe('Existing profile-photo authorization boundaries',()=>{
 it('permits pending users to set/read their own photo, prevents directory access, and denies removed sessions',async()=>{
  const pending=await person('pending'),active=await person();await seedPhoto(active.id);
  expect((await upload(pending.cookie,png())).response.status).toBe(200);expect((await call('/members/'+pending.id+'/photo',{cookie:pending.cookie})).response.status).toBe(200);expect((await call('/members/'+active.id+'/photo',{cookie:pending.cookie})).response.status).toBe(403);expect((await call('/members/'+pending.id+'/photo',{cookie:active.cookie})).response.status).toBe(404);
  // Removed sessions lose both the signed-in passcode bypass and user access;
  // this request has no separate access grant, so the outer gate denies it.
  await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(pending.id).run();expect((await upload(pending.cookie,png())).response.status).toBe(403);expect((await call('/members/'+pending.id+'/photo',{cookie:pending.cookie})).response.status).toBe(403);
 });

 it('keeps active Who-are-you photos available without operator proof, and scopes pending/removed historical sender photos to their station',async()=>{
  const pc=await station(),other=await station(),active=await person(),pending=await person('pending'),removed=await person('removed');
  for(const user of [active,pending,removed])await seedPhoto(user.id);
  expect((await call('/station/senders/'+active.id+'/photo',{bearer:pc.credential})).response.status).toBe(200);
  for(const user of [pending,removed]){
   expect((await call('/station/senders/'+user.id+'/photo',{bearer:pc.credential})).response.status).toBe(404);await history(user.id,pc.id);
   expect((await call('/station/senders/'+user.id+'/photo',{bearer:pc.credential})).response.status).toBe(200);expect((await call('/station/senders/'+user.id+'/photo',{bearer:other.credential})).response.status).toBe(404);
  }
 });

 it('rejects anonymous, unpaired, revoked and removed-owner station photo reads',async()=>{
  const pc=await station(),user=await person();await seedPhoto(user.id);const path='/station/senders/'+user.id+'/photo';
  expect((await call(path)).response.status).toBe(401);expect((await call(path,{bearer:token()})).response.status).toBe(401);
  await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),pc.id).run();expect((await call(path,{bearer:pc.credential})).response.status).toBe(401);
  const second=await station();await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(second.owner.id).run();expect((await call(path,{bearer:second.credential})).response.status).toBe(401);
 });
});
