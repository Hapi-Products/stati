'use strict';
const path=require('node:path'),crypto=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HASH=/^[a-f0-9]{64}$/;
function installServiceDesk({handle,withWorkspaceFiles,request,libraryDirectory,window,dialog,scopeKey,onApproved,playlistStatus,offline}){
 let audioScope=null;
 const endpoint=(id,tool)=>{if(!UUID.test(id||''))throw Error('Choose a saved service.');return'/station/services/'+id+'/'+tool;};
 const remote=async(context,id,tool,method='GET',data)=>{context.checkActive();const result=await request(endpoint(id,tool),{method,data,signal:context.signal});context.checkActive();return result;};
 function clear(){const old=audioScope;audioScope=null;if(old)void old.client.clear().catch(()=>{});offline.lock();}
 async function audio(context){context.checkActive();const key=scopeKey(context.operator);let captured=audioScope;if(captured?.key!==key){const old=captured;captured={key,client:require('./audio-preparation.cjs').createAudioPreparation()};audioScope=captured;if(old)await old.client.clear();}const checkActive=()=>{context.checkActive();if(audioScope!==captured||scopeKey(context.operator)!==key)throw Error('Choose the audio files again after changing profiles.');};checkActive();return{client:captured.client,signal:context.signal,checkActive};}
 async function savedVersion(context,id,versionId){const versions=await remote(context,id,'versions?current=true');if(!versions.snapshot||versions.snapshot.id!==versions.latestApproved?.id||versions.snapshot.serviceRevision!==versions.current?.plan?.revision||versionId&&versions.snapshot.id!==versionId)throw Error('This saved service changed. Refresh it before continuing.');return versions.snapshot;}
 async function rehearsal(context,version){const directory=await libraryDirectory(context.operator);context.checkActive();const snapshot=await require('./service-rehearsal.cjs').readServiceRehearsal(directory,version.plan,context);context.checkActive();return{snapshot,directory};}
 handle('service-versions-list',input=>withWorkspaceFiles('readSongs',context=>{const suffix=input?.versionId?'versions?versionId='+encodeURIComponent(input.versionId):'versions';return remote(context,input?.id,suffix);}));
 handle('service-version-save',input=>withWorkspaceFiles('planServices',async context=>{await onApproved.before(context);context.checkActive();const value=await remote(context,input?.id,'versions','POST',{expectedRevision:input?.expectedRevision});onApproved.after();return value;}));
 handle('service-requests-list',id=>withWorkspaceFiles('readSongs',context=>remote(context,id,'requests')));
 handle('service-requests-change',input=>withWorkspaceFiles('readSongs',context=>remote(context,input?.id,'requests','POST',input?.action)));
 handle('service-desk-list',id=>withWorkspaceFiles('readSongs',context=>remote(context,id,'readiness')));
 handle('service-desk-check',id=>withWorkspaceFiles('readSongs',async context=>{
  const version=await savedVersion(context,id),{snapshot,directory}=await rehearsal(context,version),checks=await require('./service-compatibility.cjs').inspectServiceCompatibility(directory,version.plan,snapshot,context);context.checkActive();
  const playlist=await playlistStatus(context.operator,id);context.checkActive();checks.push({kind:'playlist',title:'ProPresenter service playlist',status:playlist?.phase==='synced'?'passed':'warning',message:playlist?.phase==='synced'?'Stați confirmed the playlist update. Test the actual output on this computer.':(playlist?.message||'Playlist has not been confirmed on this computer.').slice(0,600)});
  const inbox=await remote(context,id,'requests');if(inbox.items.some(item=>item.status!=='added'))checks.push({kind:'manual',title:'Service requests',status:'warning',message:'Requests remain in the inbox. Review their placement and completion before the service.'});
  return remote(context,id,'readiness','POST',{type:'check',versionId:version.id,contentHash:version.contentHash,checks});
 }));
 handle('service-arrangement-source',input=>withWorkspaceFiles('readSongs',async context=>{
  if(!HASH.test(input?.songId||'')||!HASH.test(input?.contentHash||''))throw Error('Choose a saved library song.');const directory=await libraryDirectory(context.operator);context.checkActive();
  const plan={id:crypto.randomUUID(),title:'Arrangement preview',date:'2000-01-01',time:'00:00',notes:'',songs:[{id:crypto.randomUUID(),songId:input.songId,contentHash:input.contentHash,title:'Saved song',reviewed:false}]};const result=await require('./service-rehearsal.cjs').readServiceRehearsal(directory,plan,context);context.checkActive();if(result.songs[0]?.status!=='ready')throw Error(result.songs[0]?.message||'The saved source is unavailable.');return{contentHash:input.contentHash,slides:result.songs[0].slides};
 }));
 handle('audio-check-choose',()=>withWorkspaceFiles('editLyrics',async context=>{const scope=await audio(context),choice=await dialog.showOpenDialog(window(),{title:'Choose audio or video to check',properties:['openFile','multiSelections'],filters:[{name:'Audio or video',extensions:['mp3','wav','m4a','aac','flac','ogg','mp4','mov','webm']}]});scope.checkActive();if(choice.canceled)return{canceled:true,files:[],failures:[]};return scope.client.prepare(choice.filePaths,scope);}));
 handle('audio-check-read',input=>withWorkspaceFiles('editLyrics',async context=>{const scope=await audio(context);return scope.client.read(input,scope);}));
 handle('audio-check-begin',input=>withWorkspaceFiles('editLyrics',async context=>{const scope=await audio(context),choice=await dialog.showOpenDialog(window(),{title:'Save adjusted audio copy in a folder',properties:['openDirectory','createDirectory']});scope.checkActive();if(choice.canceled||!choice.filePaths?.[0])return{canceled:true};return scope.client.begin(input,choice.filePaths[0],scope);}));
 handle('audio-check-write',input=>withWorkspaceFiles('editLyrics',async context=>{const scope=await audio(context);return scope.client.write(input,scope);}));
 handle('audio-check-finish',id=>withWorkspaceFiles('editLyrics',async context=>{const scope=await audio(context);return scope.client.finish(id,scope);}));
 handle('audio-check-cancel',id=>withWorkspaceFiles('editLyrics',async context=>{const scope=await audio(context);scope.checkActive();return scope.client.cancel(id);}));
 handle('offline-desk-open',()=>offline.open());
 handle('service-offline-prepare',input=>withWorkspaceFiles('readSongs',async context=>{
  if(!input||typeof input.includeAudio!=='boolean'||typeof input.passphrase!=='string'||input.passphrase.length<10||input.passphrase.length>200)throw Error('Choose protected-copy options and a passphrase from 10 to 200 characters.');const version=await savedVersion(context,input.id,input.versionId),{snapshot}=await rehearsal(context,version),audio=[];if(!snapshot.ready)throw Error('Resolve missing or changed saved songs before preparing this copy.');
  if(input.includeAudio){const choice=await dialog.showOpenDialog(window(),{title:'Choose MP3s for this protected copy',properties:['openFile','multiSelections'],filters:[{name:'MP3 audio',extensions:['mp3']}]});context.checkActive();if(choice.canceled)return{canceled:true};if(choice.filePaths.length>8)throw Error('Choose up to eight MP3s.');let bytes=0;for(const file of choice.filePaths){if(path.extname(file).toLowerCase()!=='.mp3')throw Error('Choose MP3 files.');const read=await require('./preview-bytes.cjs').readLocalPreview(file,context);bytes+=read.bytes.length;context.checkActive();const type=await(await import('file-type')).fileTypeFromBuffer(read.bytes.subarray(0,4100));context.checkActive();if(type?.ext!=='mp3'||bytes>50*1024*1024)throw Error('Choose verified MP3s totaling at most 50 MB.');audio.push({filename:path.basename(file),bytes:read.bytes});}}
  // Fence a newer approval arriving during native file selection.
  await savedVersion(context,input.id,version.id);context.checkActive();return offline.store().prepare({snapshot,approval:version,audio},input.passphrase,context);
 }));
 return{clear};
}
module.exports={installServiceDesk};
