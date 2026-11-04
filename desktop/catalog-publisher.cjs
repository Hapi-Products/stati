const {createHash,randomUUID}=require('node:crypto');
function createCatalogPublisher({current,readCatalog,send,onError=()=>{},onState=()=>{},delay=500}){
 let timer=null,running=null,again=false,lastDigest=null,lastCredential=null,lastDeviceId=null,epoch=0,lastError=null;
 const empty=()=>({state:'idle',updatedAt:null,songCount:null,error:''});
 let progress=empty(),progressContext=null;
 const same=(a,b)=>!!a&&!!b&&a.credential===b.credential&&a.deviceId===b.deviceId;
 function update(context,patch){progress={...(same(context,progressContext)?progress:empty()),...patch};progressContext=context;try{onState({...progress},context);}catch{}}
 function status(){return same(current(),progressContext)?{...progress}:empty();}
 const matches=(context,version)=>{const active=current();return version===epoch&&!!active&&active.credential===context.credential&&active.deviceId===context.deviceId;};
 const assert=(context,version)=>{if(!matches(context,version))throw Error('The computer connection changed during the library update.');};
 function schedule(){again=true;if(timer||running)return;const context=current();if(context)update(context,{state:'scheduled',error:''});timer=setTimeout(()=>{timer=null;void run();},delay);timer.unref?.();}
 async function run(){
  clearTimeout(timer);timer=null;
  if(running){again=true;return running;}const context=current();if(!context){again=false;return;}const version=epoch;again=false;lastError=null;
  update(context,{state:'syncing',error:''});
  running=(async()=>{
   const catalog=await readCatalog();assert(context,version);if(!catalog){update(context,{state:'waiting',error:'Choose the Lyrics folder on this computer to share songs.'});return;}
   if(!catalog.songs.length&&catalog.unreadable>0)throw Error(catalog.unreadable+' song file'+(catalog.unreadable===1?' could':'s could')+' not be read. The previous shared library has been kept.');
   const serialized=JSON.stringify(catalog);if(Buffer.byteLength(serialized)>8*1024*1024)throw Error('The shared library is too large. The previous phone catalog has been kept.');
   const digest=createHash('sha256').update(serialized).digest('hex');if(lastCredential===context.credential&&lastDeviceId===context.deviceId&&digest===lastDigest){update(context,{state:'ready',songCount:catalog.songs.length,error:''});return;}
   const generation=randomUUID(),post=async data=>{assert(context,version);const value=await send(context,data);assert(context,version);return value;};
   await post({action:'begin',generation,count:catalog.songs.length,unreadable:catalog.unreadable});
   let chunk=[],bytes=0;
   for(const song of catalog.songs){
    const size=Buffer.byteLength(JSON.stringify(song));if(size>450*1024)throw Error('A song is too large to share. The previous phone catalog has been kept.');
    if(chunk.length&&(bytes+size>450*1024||chunk.length===40)){await post({action:'chunk',generation,songs:chunk});chunk=[];bytes=0;}
    chunk.push(song);bytes+=size+1;
   }
   if(chunk.length)await post({action:'chunk',generation,songs:chunk});
   await post({action:'finish',generation});lastCredential=context.credential;lastDeviceId=context.deviceId;lastDigest=digest;update(context,{state:'ready',updatedAt:Date.now(),songCount:catalog.songs.length,error:''});
  })().catch(error=>{if(matches(context,version)){lastError=error;update(context,{state:'error',error:error.message||'The song library could not be shared. The previous shared library has been kept.'});onError(error);}});
  try{await running;}finally{running=null;if(again)schedule();}
 }
 async function flush(){await run();while(again||running||timer)await run();if(lastError)throw lastError;}
 function cancel({forgetDigest=true}={}){epoch++;clearTimeout(timer);timer=null;again=false;if(forgetDigest){lastDigest=null;lastCredential=null;lastDeviceId=null;}lastError=null;}
 return{schedule,run,flush,cancel,status};
}
async function catalogSnapshot(directory){
 const {walk}=require('./library.cjs'),{readSong}=require('./song-catalog.cjs'),songs=[];let unreadable=0,bytes=0;
 for(const file of await walk(directory)){
  let song;try{song=await readSong(directory,file);}catch{unreadable++;continue;}
  const entry={id:song.id,groupName:song.groupName||null,sourceSongId:song.sourceSongId||null,contentHash:song.contentHash,title:song.title,filename:song.filename,category:song.category,language:song.language,fontSize:Math.round(song.fontSize),text:song.text,firstSlide:song.firstSlide||'',addedAt:Math.round(song.addedAt),modifiedAt:Math.round(song.modifiedAt)};
  bytes+=Buffer.byteLength(JSON.stringify(entry));if(bytes>8*1024*1024)throw Error('The shared library is too large. The previous phone catalog has been kept.');songs.push(entry);
 }
 return{songs,unreadable};
}
module.exports={createCatalogPublisher,catalogSnapshot};
