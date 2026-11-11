const {StringDecoder}=require('node:string_decoder');
const PREFIX='STATI_NATIVE:';
function validTree(value){
 const pending=[[value,0]];let nodes=0;
 while(pending.length){const [item,depth]=pending.pop();if(depth>40||++nodes>100000)return false;if(item&&typeof item==='object')for(const child of Object.values(item))pending.push([child,depth+1]);}
 return true;
}
/** A private child-process pipe, never a listener or a public IPC endpoint.
 * The caller supplies only pre-authorized command wrappers and owns cleanup. */
function createNativeHost({input,output,methods,guard=()=>{},onClose=()=>{},maxRequestBytes=12*1024*1024,maxResponseBytes=2*1024*1024,maxPending=16}){
 const decoder=new StringDecoder('utf8'),pending=new Set(),seen=new Set();let buffer='',bytes=0,discard=false,closed=false;
 function emit(value){if(closed||output.destroyed)return;let line;try{line=JSON.stringify(value);}catch{return;}if(Buffer.byteLength(line)>maxResponseBytes){if(!value.id)return;line=JSON.stringify({id:value.id,error:{message:'The result is too large to preview. Open the saved file instead.'}});}output.write(PREFIX+line+'\n');}
 const error=(id,message)=>emit({id,error:{message:String(message||'This action failed. Please try again.').slice(0,500)}});
 async function accept(line){
  let request;try{request=JSON.parse(line);}catch{return;}
  if(!request||typeof request!=='object'||Array.isArray(request)||typeof request.id!=='string'||!/^[-\w]{1,80}$/.test(request.id))return;
  const {id,method,args}=request;
  if(Object.keys(request).some(key=>!['id','method','args'].includes(key))||!Array.isArray(args)||args.length>16||!validTree(args)){error(id,'The action request is invalid.');return;}
  if(pending.has(id)||seen.has(id)){error(id,'This action was already received.');return;}
  if(pending.size>=maxPending){error(id,'Wait for the current actions to finish.');return;}
  if(typeof method!=='string'||!/^[-a-z0-9]{1,80}$/.test(method)||!Object.hasOwn(methods,method)||typeof methods[method]!=='function'){error(id,'This action is unavailable in the native app.');return;}
  seen.add(id);if(seen.size>1024)seen.delete(seen.values().next().value);pending.add(id);
  try{await guard(method);if(closed)return;const result=await methods[method](...args);emit({id,result:result??null});}
  catch(reason){error(id,reason instanceof Error?reason.message:'This action failed. Please try again.');}
  finally{pending.delete(id);}
 }
 function data(chunk){
  const text=decoder.write(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
  for(const part of text.split(/(\n)/)){
   if(part==='\n'){if(!discard&&buffer.trim())void accept(buffer);buffer='';bytes=0;discard=false;continue;}
   if(discard)continue;bytes+=Buffer.byteLength(part);if(bytes>maxRequestBytes){buffer='';discard=true;continue;}buffer+=part;
  }
 }
 function close(){if(closed)return;closed=true;buffer='';input.removeListener('data',data);input.removeListener('end',close);input.removeListener('error',close);output.removeListener('error',close);try{Promise.resolve(onClose()).catch(()=>{});}catch{}}
 input.on('data',data);input.once('end',close);input.once('error',close);output.once('error',close);
 return{close,notify:event=>{if(['workspace-reset','team-changed'].includes(event))emit({event});}};
}
module.exports={createNativeHost,PREFIX};
