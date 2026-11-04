import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createExecutionContext,env,waitOnExecutionContext} from 'cloudflare:test';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';
import samples from './fixtures/profile-photos.json';

// Fixtures use isolated local D1/R2 directly; no public accounts or uploads.
const objects:string[]=[];
afterEach(async()=>{if(objects.length)await env.FILES.delete(objects.splice(0));});
const image=(extension:'png'|'jpg')=>Uint8Array.from(atob(samples.fixtures.find(sample=>sample.extension===extension)!.base64),character=>character.charCodeAt(0));
const versionedUrl=(id:string,key:string)=>'/api/members/'+id+'/photo?v='+createHash('sha256').update(key).digest('hex').slice(0,16);
type Me={user:{id:string;status:string;photoUrl:string|null;first_name:string};organization:string};

async function person(status:'active'|'pending'='active'){
 const id=crypto.randomUUID(),session=token();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,?,?,?,?,?)').bind(id,'Isolated','T',status,'member',now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+3600),
 ]);
 return {id,cookie:'stati_session='+session};
}
async function seedPhoto(id:string,extension:'png'|'jpg'='png'){
 const key='profiles/'+id+'/'+crypto.randomUUID(),bytes=image(extension);objects.push(key);
 await env.FILES.put(key,bytes,{httpMetadata:{contentType:extension==='jpg'?'image/jpeg':'image/png'}});
 await env.DB.prepare('UPDATE users SET photo_key=? WHERE id=?').bind(key,id).run();
 return {key,bytes};
}
async function get(path:string,cookie?:string){
 const context=createExecutionContext(),response=await worker.fetch(new Request('http://localhost:8787'+path,{headers:cookie?{Cookie:cookie}:{}}),env,context);
 await waitOnExecutionContext(context);expect(response.headers.get('Cache-Control')).toBe('no-store');return response;
}
async function me(cookie:string){
 const response=await get('/api/me',cookie);expect(response.status).toBe(200);
 const payload=await response.json() as Me;expect(payload.user).not.toHaveProperty('photo_key');return payload;
}

describe('Current-user profile photo versions',()=>{
 it('returns the exact key digest and keeps the URL stable across reads, time and unrelated profile edits',async()=>{
  const user=await person(),photo=await seedPhoto(user.id),first=await me(user.cookie);
  expect(first.user.photoUrl).toBe(versionedUrl(user.id,photo.key));expect(JSON.stringify(first)).not.toContain(photo.key);
  vi.setSystemTime(new Date(Date.now()+60000));
  await env.DB.prepare('UPDATE users SET first_name=? WHERE id=?').bind('Renamed',user.id).run();
  const second=await me(user.cookie);expect(second.user.first_name).toBe('Renamed');expect(second.user.photoUrl).toBe(first.user.photoUrl);
 });

 it('changes the URL when the stored photo key changes and serves the replacement through that URL',async()=>{
  const user=await person(),firstPhoto=await seedPhoto(user.id),before=await me(user.cookie),replacement=await seedPhoto(user.id,'jpg'),after=await me(user.cookie);
  expect(before.user.photoUrl).toBe(versionedUrl(user.id,firstPhoto.key));expect(after.user.photoUrl).toBe(versionedUrl(user.id,replacement.key));expect(after.user.photoUrl).not.toBe(before.user.photoUrl);
  expect(JSON.stringify(after)).not.toContain(replacement.key);
  const response=await get(after.user.photoUrl!,user.cookie);expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toBe('image/jpeg');expect(new Uint8Array(await response.arrayBuffer())).toEqual(replacement.bytes);
 });

 it('returns null without exposing the private storage field when no photo is set or a photo is cleared',async()=>{
  const user=await person();expect((await me(user.cookie)).user.photoUrl).toBeNull();
  await seedPhoto(user.id);expect((await me(user.cookie)).user.photoUrl).not.toBeNull();
  await env.DB.prepare('UPDATE users SET photo_key=NULL WHERE id=?').bind(user.id).run();
  expect((await me(user.cookie)).user.photoUrl).toBeNull();
 });

 it('lets a pending member discover and read their own versioned photo without making it visible to other members',async()=>{
  const user=await person('pending'),other=await person(),photo=await seedPhoto(user.id),payload=await me(user.cookie);
  expect(payload.user.status).toBe('pending');expect(payload.user.photoUrl).toBe(versionedUrl(user.id,photo.key));
  const own=await get(payload.user.photoUrl!,user.cookie);expect(own.status).toBe(200);expect(new Uint8Array(await own.arrayBuffer())).toEqual(photo.bytes);
  expect((await get(payload.user.photoUrl!,other.cookie)).status).toBe(404);
 });

 it('denies a removed member both current-user data and their previously issued photo URL',async()=>{
  const user=await person(),photo=await seedPhoto(user.id),payload=await me(user.cookie);
  expect(payload.user.photoUrl).toBe(versionedUrl(user.id,photo.key));
  await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(user.id).run();
  for(const path of ['/api/me',payload.user.photoUrl!]){
   const response=await get(path,user.cookie);expect(response.status).toBe(403);expect(await response.text()).not.toContain(photo.key);
  }
 });

 it('keeps versioned photo URLs private when requested without a session',async()=>{
  const user=await person(),photo=await seedPhoto(user.id);
  for(const path of ['/api/me',versionedUrl(user.id,photo.key)]){
   const response=await get(path);expect(response.status).toBe(403);expect(await response.text()).not.toContain(photo.key);
  }
 });
});
