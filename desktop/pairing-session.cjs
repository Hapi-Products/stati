const DEFAULT_ORIGIN='https://stati.ciani01.org';

// Pairing belongs to the installation, independently of the selected profile.
// A retry must never replace a working bearer or turn a network error into a new
// station. The storage callback also receives the expected previous credential
// so it can fence its own asynchronous disk commit.
function createPairingSession({current,request,storeSecret,qr,origin=DEFAULT_ORIGIN}){
 const expectedOrigin=new URL(origin).origin;
 let generation=0,inFlight=null,unsaved=null;
 const changed=()=>new Error('The computer connection changed. Try again.');
 function check(epoch,credential){if(epoch!==generation||current()!==credential)throw changed();}
 function publicPairing(data){
  if(typeof data?.url!=='string'||!Number.isFinite(data.expiresAt)||data.expiresAt<=0)throw Error('The pairing response was incomplete. Try again.');
  let url;try{url=new URL(data.url);}catch{throw Error('The pairing response was incomplete. Try again.');}
  if(url.origin!==expectedOrigin||!/^\/pair\/[A-Za-z0-9_-]{8,100}$/.test(url.pathname)||url.search||url.hash||url.username||url.password)throw Error('The pairing response was invalid. Try again.');
  return{paired:false,url:url.href,expiresAt:data.expiresAt};
 }
 function validateStatus(data){
  if(typeof data?.paired!=='boolean'||typeof data.id!=='string'||!data.id||typeof data.name!=='string')throw Error('The computer connection could not be checked. Try again.');
  return data;
 }
 async function readStatus(credential,epoch){
  const state=await request('/devices/pair/status',{deviceCredential:credential});
  check(epoch,credential);return validateStatus(state);
 }
 async function withQr(data,credential,epoch){
  const result=publicPairing(data),image=await qr(result.url);
  check(epoch,credential);return{...result,qr:image};
 }
 async function status(){
  const epoch=generation,credential=current();
  if(!credential)return{paired:false};
  return readStatus(credential,epoch);
 }
 async function start(name,epoch){
  if(typeof name!=='string'||!name.trim()||name.trim().length>60)throw Error('Enter a computer name.');
  const credential=current();
  if(credential){
   let state;
   try{state=await readStatus(credential,epoch);}
   catch(error){check(epoch,credential);if(error.status!==410)throw error;}
   if(state){
    if(state.paired)return{paired:true,id:state.id,name:state.name};
    return withQr(state,credential,epoch);
   }
  }
  check(epoch,credential);
  // Retain a successfully created, but not yet stored, pending connection in
  // memory. A protected-storage failure can then be retried without creating
  // another station or throwing away the only copy of its new credential.
  let created=unsaved?.epoch===epoch&&unsaved.previous===credential?unsaved.data:null;
  if(!created){
   created=await request('/devices/pair',{method:'POST',data:{name:name.trim()},auth:false,deviceCredential:credential});
   check(epoch,credential);publicPairing(created);
   if(typeof created.credential!=='string'||!created.credential)throw Error('The pairing response was incomplete. Try again.');
   unsaved={epoch,previous:credential,data:created};
  }
  check(epoch,credential);
  await storeSecret(created.credential,credential);
  check(epoch,created.credential);unsaved=null;
  return withQr(created,created.credential,epoch);
 }
 function pair(name){
  if(inFlight)return inFlight;
  const epoch=generation;
  const task=start(name,epoch).finally(()=>{if(inFlight===task)inFlight=null;});
  inFlight=task;return task;
 }
 function cancel(){generation++;inFlight=null;unsaved=null;}
 return{pair,status,cancel};
}
module.exports={createPairingSession};
