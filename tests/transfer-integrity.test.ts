import {afterEach,describe,expect,it} from 'vitest';
import {env} from 'cloudflare:test';
import {MAX_FILE} from '../src/server/core';
import {expectedTransferChecksum,storedTransferChecksum,storeTransfer,transferResponse,TRANSFER_CHECKSUM_HEADER} from '../src/server/transfer-integrity';

// This suite uses Miniflare's actual local R2 binding, with no production accounts or remote access.
const keys:string[]=[];
function objectKey(){const key=`isolated-integrity/${crypto.randomUUID()}`;keys.push(key);return key;}
function stream(...chunks:Uint8Array[]){return new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}});}
async function digest(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');}
const encode=(value:string)=>new TextEncoder().encode(value);
afterEach(async()=>{if(keys.length)await env.FILES.delete(keys.splice(0));});

describe('local R2 transfer integrity',()=>{
 it('validates a multi-chunk upload and returns the stored SHA-256 with the original download bytes',async()=>{
  const first=encode('Lyrics with Romanian diacritics: '),last=encode('Stați, amin.\n');
  const bytes=new Uint8Array(first.length+last.length);bytes.set(first);bytes.set(last,first.length);
  const sha=await digest(bytes),key=objectKey();
  await storeTransfer(env.FILES,key,stream(first,last),bytes.length,'text/plain',sha);
  const object=await env.FILES.get(key);expect(object).not.toBeNull();
  expect(object!.httpMetadata?.contentType).toBe('text/plain');
  expect(storedTransferChecksum(object!)).toBe(sha);
  const response=await transferResponse(object!,'Stați lyrics.txt',bytes.length);
  expect(response.headers.get(TRANSFER_CHECKSUM_HEADER)).toBe(sha);
  expect(response.headers.get('content-length')).toBe(String(bytes.length));
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-disposition')).toContain(encodeURIComponent('Stați lyrics.txt'));
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
 });

 it('rejects different bytes of the same length and leaves no R2 object',async()=>{
  const original=encode('first lyrics'),changed=encode('other lyrics'),key=objectKey();
  expect(original.length).toBe(changed.length);
  await expect(storeTransfer(env.FILES,key,stream(changed),changed.length,'text/plain',await digest(original))).rejects.toMatchObject({status:400});
  expect(await env.FILES.head(key)).toBeNull();
 });

 it.each(['short','long'] as const)('rejects a %s stream and cleans up the object',async(kind)=>{
  const bytes=encode('expected length'),key=objectKey();
  const actual=kind==='short'?bytes.slice(0,-1):new Uint8Array([...bytes,33]);
  await expect(storeTransfer(env.FILES,key,stream(actual),bytes.length,'text/plain',await digest(bytes))).rejects.toMatchObject({status:400});
  expect(await env.FILES.head(key)).toBeNull();
 });

 it('rejects an interrupted source stream and leaves no object',async()=>{
  const key=objectKey(),bytes=encode('interrupted lyrics');let sent=false;
  const interrupted=new ReadableStream<Uint8Array>({pull(controller){if(sent)controller.error(new Error('isolated connection interruption'));else{sent=true;controller.enqueue(bytes.slice(0,5));}}});
  await expect(storeTransfer(env.FILES,key,interrupted,bytes.length,'text/plain',await digest(bytes))).rejects.toMatchObject({status:400});
  expect(await env.FILES.head(key)).toBeNull();
 });

 it('supports legacy uploads without claiming a SHA-256 check',async()=>{
  const key=objectKey(),bytes=encode('legacy sender');
  await storeTransfer(env.FILES,key,stream(bytes),bytes.length,'text/plain');
  const object=await env.FILES.get(key);expect(object).not.toBeNull();
  expect(storedTransferChecksum(object!)).toBeUndefined();
  const response=await transferResponse(object!,'legacy.txt',bytes.length);
  expect(response.headers.has(TRANSFER_CHECKSUM_HEADER)).toBe(false);
  expect(await response.text()).toBe('legacy sender');
 });

 it('refuses a stored object whose length differs from the queued delivery',async()=>{
  const key=objectKey(),bytes=encode('real stored bytes');
  await env.FILES.put(key,bytes);
  const object=await env.FILES.get(key);expect(object).not.toBeNull();
  await expect(Promise.resolve().then(()=>transferResponse(object!,'file.txt',bytes.length+1))).rejects.toMatchObject({status:503});
  // Refusing the response must not delete a stored file or acknowledge a delivery.
  expect((await env.FILES.head(key))?.size).toBe(bytes.length);
 });

 it('refuses invalid declared sizes before storing any object',async()=>{
  for(const bytes of [0,-1,1.5,NaN,Infinity,MAX_FILE+1]){
   const key=objectKey();
   await expect(storeTransfer(env.FILES,key,stream(encode('a')),bytes,'text/plain')).rejects.toMatchObject({status:413});
   expect(await env.FILES.head(key)).toBeNull();
  }
 });
});

describe('transfer checksum parsing',()=>{
 it('normalizes hex while preserving absent-header compatibility',()=>{
  const checksum='a1'.repeat(32);
  expect(expectedTransferChecksum(new Headers())).toBeUndefined();
  expect(expectedTransferChecksum(new Headers({[TRANSFER_CHECKSUM_HEADER]:checksum.toUpperCase()}))).toBe(checksum);
 });

 it('rejects empty, incomplete, non-hex, prefixed, and duplicate checksum headers',()=>{
  for(const value of ['', 'a'.repeat(63), 'a'.repeat(65),'z'.repeat(64),'sha256='+('a'.repeat(64))]){
   expect(()=>expectedTransferChecksum(new Headers({[TRANSFER_CHECKSUM_HEADER]:value}))).toThrow(/Invalid file checksum/);
  }
  const duplicate=new Headers();duplicate.append(TRANSFER_CHECKSUM_HEADER,'a'.repeat(64));duplicate.append(TRANSFER_CHECKSUM_HEADER,'a'.repeat(64));
  expect(()=>expectedTransferChecksum(duplicate)).toThrow(/Invalid file checksum/);
 });

 it('refuses malformed stored SHA-256 metadata instead of inventing a verification value',()=>{
  expect(()=>storedTransferChecksum({checksums:{sha256:new ArrayBuffer(31),toJSON:()=>({})}})).toThrow(/stored file check is unavailable/);
 });

});
