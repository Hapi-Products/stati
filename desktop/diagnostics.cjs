// Reports contain operational checks only, never identities, tokens, filenames or local paths.
async function connectionDiagnostics({probe,version,platform,protectedStorage,clock=Date.now}){
 const start=clock();let connection='unavailable',explanation='Stați could not reach its service. Check your internet connection and try again.';
 try{await probe();connection='connected';explanation='Stați can reach its service.';}catch(error){if(error.status===401||error.status===403){connection='authorization-required';explanation='Reconnect this computer or unlock your account, then try again.';}else if(error.name==='TimeoutError'||error.name==='AbortError'){connection='timeout';explanation='The service took too long to respond. Check your connection and try again.';}}
 return {version:1,checkedAt:new Date(clock()).toISOString(),appVersion:version,platform,connection,explanation,latencyMs:Math.max(0,clock()-start),protectedStorage:!!protectedStorage};
}
module.exports={connectionDiagnostics};
