const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const {stripTypeScriptTypes}=require('node:module');
// Execute the real browser adapter with Web Crypto and injected XHR; no cloud data is used.
const api=stripTypeScriptTypes(fs.readFileSync('src/web/api.ts','utf8'),{mode:'transform'}).replace(/\bexport /g,'');
const source=stripTypeScriptTypes(fs.readFileSync('src/web/upload.ts','utf8').replace("import {ApiError} from './api';",'')).replace('export function','function');
function browser(crypto=webcrypto){const scope={DOMException,crypto,XMLHttpRequest:undefined};vm.createContext(scope);vm.runInContext(api+'\n'+source+'\nthis.uploadFile=uploadFile;',scope);return scope;}
function setup({file=new File(['lyrics'],'Cântare.txt'),crypto=webcrypto,controller=new AbortController()}={}){
 let sent,created=0;
 const ready=new Promise(resolve=>{sent=resolve;});
 const request={upload:{onprogress:null},onload:null,onabort:null,onerror:null,ontimeout:null,status:201,responseText:JSON.stringify({id:'11111111-1111-4111-8111-111111111111',status:'queued'}),method:'',url:'',sent:0,aborted:0,headers:{},open(method,url){this.method=method;this.url=url;},setRequestHeader(key,value){this.headers[key]=value;},send(body){this.body=body;this.sent++;sent();},abort(){this.aborted++;this.onabort?.();}};
 const bytes=[];
 const result=browser(crypto).uploadFile('/receive/device:test',file,{signal:controller.signal,progress:value=>bytes.push(value),createRequest:()=>{created++;return request;}});
 return {request,controller,bytes,result,ready,file,created:()=>created};
}
const expected=createHash('sha256').update('lyrics').digest('hex');
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}

test('upload hashes the actual file bytes and confirms success only after server acceptance',async()=>{
 const {request,bytes,result,ready,file}=setup();await ready;
 assert.equal(request.sent,1);assert.equal(request.body,file);
 assert.equal(request.headers['X-Checksum-SHA256'],expected);
 assert.match(request.headers['X-Checksum-SHA256'],/^[a-f0-9]{64}$/);
 request.upload.onprogress({loaded:4});assert.deepEqual(bytes,[4]);
 request.responseText=JSON.stringify({id:'11111111-1111-4111-8111-111111111111',status:'queued',sha256:expected});
 request.onload();await result;assert.equal(bytes.at(-1),6);
 assert.equal(request.headers['X-Filename'],encodeURIComponent('Cântare.txt'));
 assert.equal(request.url,'/api/receive/device:test');assert.equal(request.timeout,120000);
});
test('legacy queued receipts remain compatible without claiming a verified checksum',async()=>{const {request,result,ready}=setup();await ready;request.onload();assert.equal(await result,undefined);});
test('stopping an active upload ignores late success and progress events',async()=>{const {request,controller,result,bytes,ready}=setup();await ready;const rejected=assert.rejects(result,{name:'AbortError'});controller.abort();request.onload();request.upload.onprogress({loaded:6});request.onerror();await rejected;assert.equal(request.aborted,1);assert.deepEqual(bytes,[]);});
test('server denial never reports successful delivery',async()=>{const {request,result,ready}=setup();await ready;request.status=403;request.responseText=JSON.stringify({error:'Service is closed.'});request.onload();await assert.rejects(result,{status:403,message:'Service is closed.'});});
test('network loss explains that delivery must be checked before retrying',async()=>{const {request,result,ready}=setup();await ready;request.onerror();await assert.rejects(result,/Check Your files before retrying/);});
test('request timeout retains guidance to check delivery before retrying',async()=>{const {request,result,ready}=setup();await ready;request.ontimeout();await assert.rejects(result,/took too long.*Check Your files before retrying/);});
for(const body of ['<html>Site unavailable</html>','{}'])test('a successful HTTP response without a receipt does not claim delivery: '+body,async()=>{const {request,result,ready}=setup();await ready;request.responseText=body;request.onload();await assert.rejects(result,/did not confirm this upload/);});
for(const checksum of ['0'.repeat(64),expected.toUpperCase(),'abc',null,42])test('a queued receipt with an invalid or mismatched checksum rejects: '+checksum,async()=>{
 const {request,result,ready,bytes}=setup();await ready;
 request.responseText=JSON.stringify({id:'11111111-1111-4111-8111-111111111111',status:'queued',sha256:checksum});
 request.onload();await assert.rejects(result,/checksum.*Check Your files before retrying/);
 request.onload();request.upload.onprogress({loaded:6});assert.deepEqual(bytes,[]);
});
test('an already cancelled upload reads no bytes and creates no request',async()=>{
 const controller=new AbortController();controller.abort();let reads=0;
 const file=new File(['lyrics'],'lyrics.txt');file.arrayBuffer=()=>{reads++;throw Error('must not read');};
 const {result,created}=setup({file,controller});await assert.rejects(result,{name:'AbortError'});
 assert.equal(reads,0);assert.equal(created(),0);
});
for(const size of [0,50*1024*1024+1])test('invalid file size is rejected before any byte buffering: '+size,async()=>{
 let reads=0;const file=new File(['lyrics'],'lyrics.txt');Object.defineProperty(file,'size',{value:size});file.arrayBuffer=()=>{reads++;throw Error('must not read');};
 const {result,created}=setup({file});await assert.rejects(result,/non-empty file up to 50 MB/);
 assert.equal(reads,0);assert.equal(created(),0);
});
test('cancellation while reading file bytes settles promptly and never sends later',async()=>{
 const read=deferred(),file=new File(['lyrics'],'lyrics.txt');file.arrayBuffer=()=>read.promise;
 const {result,controller,created,bytes}=setup({file});const rejected=assert.rejects(result,{name:'AbortError'});
 controller.abort();await rejected;read.resolve(new TextEncoder().encode('lyrics').buffer);await nextTurn();
 assert.equal(created(),0);assert.deepEqual(bytes,[]);
});
test('cancellation while hashing settles promptly and ignores the completed Web Crypto digest',async()=>{
 const gate=deferred(),entered=deferred(),completed=deferred();
 const crypto={subtle:{digest:async(...args)=>{entered.resolve();await gate.promise;const digest=await webcrypto.subtle.digest(...args);completed.resolve();return digest;}}};
 const {result,controller,created,bytes}=setup({crypto});const rejected=assert.rejects(result,{name:'AbortError'});
 await entered.promise;controller.abort();await rejected;gate.resolve();await completed.promise;await nextTurn();
 assert.equal(created(),0);assert.deepEqual(bytes,[]);
});
test('unreadable file bytes fail without sending',async()=>{
 const file=new File(['lyrics'],'lyrics.txt');file.arrayBuffer=async()=>{throw Error('read failed');};
 const {result,created,bytes}=setup({file});await assert.rejects(result,/could not be checked|read failed/);
 assert.equal(created(),0);assert.deepEqual(bytes,[]);
});
test('an incomplete byte read fails without sending',async()=>{
 const file=new File(['lyrics'],'lyrics.txt');file.arrayBuffer=async()=>new ArrayBuffer(2);
 const {result,created}=setup({file});await assert.rejects(result,/could not be read completely/);assert.equal(created(),0);
});
test('missing Web Crypto fails before reading or sending',async()=>{
 let reads=0;const file=new File(['lyrics'],'lyrics.txt');file.arrayBuffer=async()=>{reads++;return new ArrayBuffer(6);};
 const {result,created}=setup({file,crypto:{}});await assert.rejects(result,/verification is unavailable/);assert.equal(reads,0);assert.equal(created(),0);
});
test('a failed digest never sends unchecked bytes',async()=>{
 const {result,created}=setup({crypto:{subtle:{digest:async()=>{throw Error('digest failed');}}}});
 await assert.rejects(result,/could not be checked|digest failed/);assert.equal(created(),0);
});
