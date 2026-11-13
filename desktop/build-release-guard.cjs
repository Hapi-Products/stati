const BUILD_STATUS='https://stati.ciani01.org/api/build-status';

async function requireBuildsAllowed({fetchStatus=globalThis.fetch}={}){
 let status;
 try{
  const response=await fetchStatus(BUILD_STATUS,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000),headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('Status request failed.');
  status=await response.json();
 }catch{
  throw Error('Build status could not be checked. Wait and try again before publishing or installing.');
 }
 if(status?.version!==1||typeof status.allowed!=='boolean')throw Error('Build status could not be checked. Wait and try again before publishing or installing.');
 if(!status.allowed)throw Error('Builds are paused. Wait for service to end and for an administrator to resume any manual pause.');
}
module.exports={requireBuildsAllowed};
