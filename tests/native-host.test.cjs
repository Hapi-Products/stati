const {test}=require('node:test'),assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {createNativeHost}=require('../desktop/native-host.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function host(methods={},options={}){
 const input=new PassThrough(),output=new PassThrough(),messages=[];
 output.on('data',bytes=>{for(const line of bytes.toString().trim().split('\n'))messages.push(JSON.parse(line.slice('STATI_NATIVE:'.length)));});
 const connection=createNativeHost({input,output,methods,...options});
 return{input,messages,connection,send:(method,args=[],id='one')=>input.write(JSON.stringify({id,method,args})+'\n')};
}
test('native pipe invokes only explicitly registered commands and frames results',async()=>{
 const f=host({'state':async()=>({ready:true})});f.send('state');await turn();assert.deepEqual(f.messages,[{id:'one',result:{ready:true}}]);f.send('constructor',[],'two');await turn();assert.match(f.messages[1].error.message,/unavailable/);f.connection.close();
});
test('native pipe rechecks its guard for every operation and reports errors without echoing payloads',async()=>{
 let locked=false,called=0;const f=host({state:()=>++called},{guard:()=>{if(locked)throw Error('Unlock this computer.');}});f.send('state');await turn();locked=true;f.send('state',[],'two');await turn();assert.equal(called,1);assert.equal(f.messages[1].error.message,'Unlock this computer.');f.connection.close();
});
test('malformed, unknown-key, oversized and deeply nested messages do not execute commands',async()=>{
 let called=0;const f=host({state:()=>++called},{maxRequestBytes:200});f.input.write('not json\n');f.input.write(JSON.stringify({id:'bad',method:'state',args:[],extra:'secret'})+'\n');f.input.write('x'.repeat(201)+'\n');f.input.write(JSON.stringify({id:'deep',method:'state',args:[JSON.parse('['.repeat(45)+'0'+']'.repeat(45))]})+'\n');await turn();assert.equal(called,0);f.send('state',[],'valid');await turn();assert.equal(called,1);f.connection.close();
});
test('duplicate in-flight identifiers and excessive concurrency cannot replay actions',async()=>{
 let finish,called=0;const f=host({state:()=>{called++;return new Promise(resolve=>finish=resolve);}},{maxPending:1});f.send('state');f.send('state');f.send('state',[],'two');await turn();assert.equal(called,1);finish('done');await turn();assert.equal(f.messages.filter(row=>row.result==='done').length,1);f.connection.close();
});
test('closing input invokes cleanup once and suppresses late responses',async()=>{
 let finish,closed=0;const f=host({state:()=>new Promise(resolve=>finish=resolve)},{onClose:()=>closed++});f.send('state');await turn();f.input.end();await turn();finish('private late result');await turn();f.connection.close();assert.equal(closed,1);assert.equal(f.messages.length,0);
});
test('responses and notifications stay bounded',async()=>{
 const f=host({state:()=>({text:'x'.repeat(500)})},{maxResponseBytes:200});f.send('state');await turn();assert.match(f.messages[0].error.message,/too large/);f.connection.notify('workspace-reset');assert.deepEqual(f.messages[1],{event:'workspace-reset'});f.connection.close();
});
