const {Worker}=require('node:worker_threads');const path=require('node:path');
function taskError(message){const error=Error(message.error);if(typeof message.code==='string')error.code=message.code;return error;}
function run(task,args,signal){return new Promise((resolve,reject)=>{
 if(signal?.aborted){reject(signal.reason);return;}
 const worker=new Worker(path.join(__dirname,'conversion-worker.cjs'),{workerData:{task,args}});let settled=false;
 const finish=(fn,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);fn(value);};
 const abort=()=>{finish(reject,signal.reason);void worker.terminate().catch(()=>{});};
 worker.once('message',message=>message.error?finish(reject,taskError(message)):finish(resolve,['build','revise-build','pptx-build'].includes(task)?Buffer.from(message.result):message.result));
 worker.once('error',error=>finish(reject,error));worker.once('exit',code=>{if(!settled)finish(reject,Error('Conversion worker stopped ('+code+').'));});
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });}
module.exports=(task,...args)=>run(task,args);
module.exports.withSignal=(task,signal,...args)=>run(task,args,signal);

module.exports.createSession=()=>{
 const worker=new Worker(path.join(__dirname,'conversion-worker.cjs'),{workerData:{persistent:true}}),pending=new Map();let next=0,closed=false;
 function fail(error){closed=true;for(const item of pending.values())item.reject(error);pending.clear();}
 worker.on('message',message=>{const item=pending.get(message.id);if(!item)return;pending.delete(message.id);message.error?item.reject(taskError(message)):item.resolve(['build','revise-build','pptx-build'].includes(item.task)?Buffer.from(message.result):message.result);});
 worker.on('error',fail);worker.on('exit',code=>{if(!closed)fail(Error('Conversion worker stopped ('+code+').'));});
 return {run(task,...args){if(closed)return Promise.reject(Error('Conversion session closed.'));return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{task,resolve,reject});worker.postMessage({id,task,args});});},async close(){if(closed)return;fail(Error('Conversion session closed.'));await worker.terminate();}};
};
