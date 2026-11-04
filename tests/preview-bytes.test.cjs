const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {readRemotePreview,readLocalPreview}=require('../desktop/preview-bytes.cjs'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function response(bytes,headers={},cancel=()=>{}){const data=Buffer.from(bytes);return new Response(new ReadableStream({start(controller){controller.enqueue(data);controller.close();},cancel}),{headers:{'Content-Length':String(data.length),...headers}});}
async function fixture(check){const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-preview-read-'));try{await check(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
test('remote preview verifies the exact bytes against both metadata and response checksums',async()=>{
 const bytes=Buffer.from('Împreună cântăm'),result=await readRemotePreview(response(bytes,{'X-Checksum-SHA256':sha(bytes).toUpperCase()}),{expectedBytes:bytes.length,expectedChecksum:sha(bytes)});assert.deepEqual(result.bytes,bytes);assert.equal(result.sha256,sha(bytes));assert.equal(result.checksumVerified,true);
 const metadataOnly=await readRemotePreview(response(bytes),{expectedChecksum:sha(bytes)});assert.equal(metadataOnly.checksumVerified,true);
 const legacy=await readRemotePreview(response(bytes));assert.equal(legacy.checksumVerified,false);assert.deepEqual(legacy.bytes,bytes);
});
test('same-size corruption and conflicting or malformed checksums never produce a preview',async()=>{
 const original=Buffer.from('correct lyrics'),changed=Buffer.from('corrupt lyrics');assert.equal(original.length,changed.length);
 await assert.rejects(readRemotePreview(response(changed,{'X-Checksum-SHA256':sha(original)})),/could not be checked/);
 await assert.rejects(readRemotePreview(response(original,{'X-Checksum-SHA256':sha(original)}),{expectedChecksum:sha(changed)}),/could not be checked/);
 for(const bad of ['', 'g'.repeat(64),'a'.repeat(63),'sha256:'+'a'.repeat(64)])await assert.rejects(readRemotePreview(response(original,{'X-Checksum-SHA256':bad})),/could not be checked/);
});
test('remote previews reject unsafe lengths, truncation, extra bytes and invalid metadata before display',async()=>{
 for(const length of [null,'','0','-1','1.5','1e1','52428801','9007199254740992']){const res=response('a');if(length===null)res.headers.delete('Content-Length');else res.headers.set('Content-Length',length);await assert.rejects(readRemotePreview(res),/could not be checked/);}
 for(const length of ['2','9'])await assert.rejects(readRemotePreview(response('abcd',{'Content-Length':length})),/could not be checked/);
 for(const expectedBytes of [0,2,1.5])await assert.rejects(readRemotePreview(response('a'),{expectedBytes}),/could not be checked/);
 await assert.rejects(readRemotePreview(new Response(null,{status:500})),/could not be checked/);
});
test('a reused stream chunk cannot mutate bytes already checked for preview',async()=>{
 const shared=new Uint8Array(1);let index=0;
 const res=new Response(new ReadableStream({pull(controller){if(index===2){controller.close();return;}shared[0]='ab'.charCodeAt(index++);controller.enqueue(shared);}},{highWaterMark:0}),{headers:{'Content-Length':'2','X-Checksum-SHA256':sha('ab')}});
 assert.equal((await readRemotePreview(res)).bytes.toString(),'ab');
});
test('switching operator cancels a stalled remote body and releases its reader',async()=>{
 const controller=new AbortController();let canceled=false;
 const res=new Response(new ReadableStream({pull(){},cancel(){canceled=true;}}),{headers:{'Content-Length':'1'}}),pending=readRemotePreview(res,{signal:controller.signal});
 controller.abort(Error('Operator changed'));await assert.rejects(pending,/Operator changed/);assert.equal(canceled,true);assert.equal(res.body.locked,false);
});
test('generation checks after remote reads discard an old operator result',async()=>{
 let checks=0;await assert.rejects(readRemotePreview(response('a'),{checkActive:()=>{if(++checks>=3)throw Error('Old generation');}}),/could not be checked/);assert.ok(checks>=3);
});
test('local previews read one stable regular file and identify deliberate changes after delivery',()=>fixture(async root=>{
 const file=path.join(root,'song.txt');await fs.writeFile(file,'First lyrics');const first=await readLocalPreview(file,{expectedChecksum:sha('First lyrics')});assert.equal(first.checksumVerified,true);assert.equal(first.changedSinceDelivery,false);
 await fs.writeFile(file,'Edited locally');const second=await readLocalPreview(file,{expectedChecksum:sha('First lyrics')});assert.equal(second.bytes.toString(),'Edited locally');assert.equal(second.changedSinceDelivery,true);assert.equal(second.checksumVerified,false);assert.equal(await fs.readFile(file,'utf8'),'Edited locally');
 await fs.writeFile(file,'');assert.equal((await readLocalPreview(file)).bytes.length,0);
}));
test('symlinks and directories cannot become saved-file previews and remain untouched',()=>fixture(async root=>{
 const source=path.join(root,'outside.txt'),link=path.join(root,'link.txt');await fs.writeFile(source,'Keep original');await fs.symlink(source,link);
 await assert.rejects(readLocalPreview(link),/could not be checked/);await assert.rejects(readLocalPreview(root),/could not be checked/);assert.equal(await fs.readFile(source,'utf8'),'Keep original');assert.equal((await fs.lstat(link)).isSymbolicLink(),true);
}));
test('file replacement between checking and opening is refused without reading or removing the replacement',()=>fixture(async root=>{
 const file=path.join(root,'song.txt'),open=fs.open;await fs.writeFile(file,'Original');
 try{fs.open=async(...args)=>{await fs.rename(file,file+'.kept');await fs.writeFile(file,'Replaced');return open(...args);};await assert.rejects(readLocalPreview(file),/could not be checked/);}finally{fs.open=open;}
 assert.equal(await fs.readFile(file,'utf8'),'Replaced');assert.equal(await fs.readFile(file+'.kept','utf8'),'Original');
}));
test('an in-place modification or operator change during reading closes the file and refuses partial bytes',()=>fixture(async root=>{
 const file=path.join(root,'song.txt'),open=fs.open;await fs.writeFile(file,Buffer.alloc(100000,65));let handle;
 try{fs.open=async(...args)=>{handle=await open(...args);const read=handle.read.bind(handle);let changed=false;handle.read=async(...values)=>{const result=await read(...values);if(!changed){changed=true;await fs.appendFile(file,'Changed');}return result;};return handle;};await assert.rejects(readLocalPreview(file),/could not be checked/);}finally{fs.open=open;}
 await assert.rejects(handle.stat(),/closed|EBADF/);assert.equal((await fs.stat(file)).size,100007);
 const controller=new AbortController();controller.abort(Error('Operator switched'));await assert.rejects(readLocalPreview(file,{signal:controller.signal}),/Operator switched/);
}));
