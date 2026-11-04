export function createPreviewQueue({concurrency=2,maxWaiting=24}={}){
 const jobs=new Map(),waiting=[];let running=0;
 function start(){while(running<concurrency&&waiting.length){const job=waiting.shift();if(job.canceled)continue;running++;Promise.resolve().then(job.task).then(job.resolve,job.reject).finally(()=>{running--;if(jobs.get(job.key)===job)jobs.delete(job.key);start();});}}
 return {
  run(key,task){if(jobs.has(key))return jobs.get(key).promise;if(waiting.length>=maxWaiting)return Promise.reject(Error('Other previews are still loading. Try this one again shortly.'));let resolve,reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;}),job={key,task,resolve,reject,promise};jobs.set(key,job);waiting.push(job);start();return promise;},
  clear(){for(const job of waiting.splice(0)){job.canceled=true;job.reject(Error('The selected user changed.'));if(jobs.get(job.key)===job)jobs.delete(job.key);}},
 };
}
