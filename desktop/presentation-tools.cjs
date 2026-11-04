'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const scanner=require('./presentation-scan.cjs'),{openPresentationLedger}=require('./presentation-ledger.cjs'),core=require('./powerpoint-batch.cjs');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function installPresentationTools({handle,withWorkspaceFiles,window,documents,home,userData,libraryDirectory,scopeKey,onChanged=()=>{},afterConvert=async result=>result,beforeConvert=async()=>null,backgroundDirectory=async()=>null}={}){
 let active=null,backgroundOffset=0;const sessionDisabled=new Set();
 async function job(work){if(active||core.isRunning())throw Error('Finish or stop the current presentation conversion first.');const controller=new AbortController(),state={controller,context:null,lastProgress:null};active=state;
  try{return await withWorkspaceFiles('editLyrics',async context=>{state.context=context;const signal=AbortSignal.any([context.signal,controller.signal]),checkActive=()=>{signal.throwIfAborted();context.checkActive();},progress=value=>{
   if(active!==state||controller.signal.aborted)return;try{context.signal.throwIfAborted();context.checkActive();}catch{return;}
   state.lastProgress={...value,results:(value.results||[]).map(result=>({...result}))};const win=window();if(win&&!win.isDestroyed())win.webContents.send('powerpoint-progress',state.lastProgress);
  };return work({...context,checkActive,signal,progress});});}
  catch(error){if(controller.signal.aborted&&state.context){state.context.signal.throwIfAborted();state.context.checkActive();const results=state.lastProgress?.results||[];if(results.some(item=>['converted','resynced'].includes(item.status)))onChanged();return{stopped:true,results,total:state.lastProgress?.total||0};}throw error;}
  finally{if(active===state)active=null;}
 }
 async function ledgerFor(context,directory,extraRoots=[]){
  const {checkActive,signal}=context,listed=await scanner.computerRoots({home:home(),checkActive,signal});checkActive();
  const roots=[...listed.roots];for(const supplied of extraRoots){const canonical=await fs.realpath(supplied);checkActive();if(!roots.some(root=>scanner.inside(root,canonical)))roots.push(canonical);}
  const parent=path.join(userData(),'.stati-presentation-sync');await fs.mkdir(parent,{recursive:true,mode:0o700});checkActive();
  const scoped=path.join(parent,digest(Buffer.from(scopeKey(context.operator))));
  const nativeDirectory=await fs.realpath(directory);if(!roots.some(root=>scanner.inside(root,nativeDirectory)))roots.push(nativeDirectory);const targetRoots=[...new Set([...roots,nativeDirectory])];
  const ledger=await openPresentationLedger({directory:scoped,sourceRoots:roots,outputRoots:targetRoots,checkActive,validateReplacement:({direction,oldBytes,newBytes})=>{if(direction!=='to-pro')return;const decode=require('./presentation.cjs').decode,old=decode(oldBytes),next=decode(newBytes);if(JSON.stringify(old.uuid)!==JSON.stringify(next.uuid)||old.name!==next.name)throw Error('The ProPresenter song identity changed. Its original was kept.');}});checkActive();return{ledger,roots,issues:listed.issues};
 }
 async function sourceObserved(ledger,source,sourceHash,context){const file=await scanner.fingerprint(source,context);context.checkActive();if(file.sha256!==sourceHash)throw Error('This PowerPoint changed during conversion. Try it again.');await ledger.observe({files:[file],completedRoots:[],signal:context.signal});return file;}
 function callbackContext(context,value){const signal=AbortSignal.any([context.signal,value.signal].filter(Boolean));return{...context,signal,checkActive:()=>{signal.throwIfAborted();context.checkActive();signal.throwIfAborted();}};}
 async function callbacks(context,directory,selected=[]){const {ledger}=await ledgerFor(context,directory,selected.map(file=>path.dirname(file))),recipeHash=digest(Buffer.from('simple-song-v2:'+context.fontSize+':'+context.amenFontSize));
  return{ledger,
   onExisting:async value=>{const current=callbackContext(context,value);await value.checkActive();const source=await sourceObserved(ledger,value.source,value.sourceHash,current);await ledger.linkExisting({sourceId:source.id,expectedSourceHash:source.sha256,targetPath:value.path,expectedTargetHash:value.targetHash,direction:'to-pro',recipeHash,signal:current.signal});await value.checkActive();},
   writeOutput:async value=>{const current=callbackContext(context,value);await value.checkActive();const source=await sourceObserved(ledger,value.source,value.sourceHash,current),links=await ledger.listLinks({signal:current.signal}),previous=links.items.find(link=>link.sourceId===source.id&&link.direction==='to-pro');let saved;
    if(previous){saved=await ledger.resync({id:previous.id,recipeHash,signal:current.signal,build:async({targetPath})=>{const original=await scanner.fingerprint(targetPath,{...current,includeBytes:true});await value.checkActive();return require('./conversion-work.cjs').withSignal('revise-build',current.signal,original.data,{title:value.title,...value.extracted,fontSize:context.fontSize,amenFontSize:context.amenFontSize});}});}
    else saved=await ledger.writeConversion({sourceId:source.id,expectedSourceHash:source.sha256,outputRoot:directory,filename:require('./advanced.cjs').filename(value.title)+'.pro',bytes:value.bytes,direction:'to-pro',recipeHash,signal:current.signal});
    await value.checkActive();if(!saved.path)throw Error(saved.error||'The linked file could not be updated. Its existing bytes were kept.');return{path:saved.path,contentHash:saved.sha256,bytes:(await fs.stat(saved.path)).size};
   }
  };
 }
 async function convert(context,options,files){
  const target=await beforeConvert(context.operator);context.checkActive();const directory=await libraryDirectory(context.operator);context.checkActive();
  // Choosing happens here so only trusted picker/scan paths enter the core.
  if(!files){const selected=await require('electron').dialog.showOpenDialog(window(),{title:'Choose PowerPoint songs for ProPresenter',properties:['openFile','multiSelections'],filters:[{name:'PowerPoint songs',extensions:['pptx','ppt']}]});context.checkActive();if(selected.canceled||!selected.filePaths?.length)return{canceled:true};files=selected.filePaths;}
  const settings={fontSize:options?.fontSize??96,amenFontSize:options?.amenFontSize??36};context={...context,...settings};const hooks=await callbacks(context,directory,files);context.checkActive();
  const result=await core.start(window(),documents(),context.progress,{...settings,files,directory,signal:context.signal,checkActive:context.checkActive,onExisting:hooks.onExisting,writeOutput:hooks.writeOutput});context.checkActive();
  if(!result.canceled){if(result.results?.some(item=>item.status==='converted'))onChanged();return afterConvert(result,context.operator,target);}return result;
 }
 handle('powerpoint-batch',options=>job(context=>convert(context,options)));
 handle('powerpoint-computer-all',options=>job(async context=>{
  context.progress({completed:0,total:0,phase:'scanning',message:'Finding accessible PowerPoint files…',results:[]});
  const listed=await scanner.computerRoots({home:home(),checkActive:context.checkActive,signal:context.signal}),found=await scanner.scanPresentations({roots:listed.roots,checkActive:context.checkActive,signal:context.signal,onProgress:counts=>context.progress({completed:counts.matched,total:0,phase:'scanning',message:'Searched '+counts.directories+' folders · '+counts.matched+' PowerPoints found',results:[]})});context.checkActive();
  if(!found.files.length)return{results:[],total:0,scan:{files:0,complete:found.complete&&!listed.issues.length,issues:found.counts.unreadable+listed.issues.length,reason:found.reason||undefined}};
  const directory=await libraryDirectory(context.operator);context.checkActive();const {ledger}=await ledgerFor(context,directory);await ledger.observe({...found,signal:context.signal});context.checkActive();
  const result=await convert(context,options,found.files.map(file=>file.path));return{...result,scan:{files:found.files.length,complete:found.complete&&!listed.issues.length,issues:found.counts.unreadable+listed.issues.length,reason:found.reason||undefined}};
 }));
 handle('propresenter-powerpoint-batch',()=>job(async context=>{
  const dialog=require('electron').dialog,selected=await dialog.showOpenDialog(window(),{title:'Choose ProPresenter songs for PowerPoint',properties:['openFile','multiSelections'],filters:[{name:'ProPresenter songs',extensions:['pro','pro6']}]});context.checkActive();if(selected.canceled||!selected.filePaths?.length)return{canceled:true};
  const folder=await dialog.showOpenDialog(window(),{title:'Choose a folder for PowerPoint lyrics',properties:['openDirectory','createDirectory']});context.checkActive();if(folder.canceled||!folder.filePaths?.[0])return{canceled:true};const directory=folder.filePaths[0],{ledger}=await ledgerFor(context,directory,selected.filePaths.map(file=>path.dirname(file)));
  const result=await require('./propresenter-powerpoint-batch.cjs').exportProPresenterFiles({files:selected.filePaths,directory,checkActive:context.checkActive,signal:context.signal,onProgress:context.progress,writeOutput:async value=>{const current=callbackContext(context,value),source=await sourceObserved(ledger,value.source,value.sourceHash,current);return ledger.writeConversion({sourceId:source.id,expectedSourceHash:source.sha256,outputRoot:await fs.realpath(directory),filename:require('./advanced.cjs').filename(value.data.title)+'.pptx',bytes:value.bytes,direction:'to-pptx',recipeHash:digest(Buffer.from('pro-pptx-text-v1')),signal:current.signal});}});if(result.results.some(item=>['converted','resynced'].includes(item.status)))onChanged();return result;
 }));
 async function current(context){const directory=await libraryDirectory(context.operator);context.checkActive();const {ledger}=await ledgerFor(context,directory);context.progress({completed:0,total:0,phase:'checking',message:'Checking linked PowerPoint changes…',results:[]});const refresh=await ledger.refreshSources({signal:context.signal,onProgress:value=>context.progress({completed:value.scanned,total:0,phase:'checking',name:value.name,message:'Checked '+value.scanned+' linked PowerPoints',results:[]})});await ledger.inspectOutputs({signal:context.signal});context.checkActive();return{ledger,directory,refresh,links:(await ledger.listLinks({signal:context.signal})).items};}
 handle('powerpoint-changes',()=>job(async context=>{const {ledger,links,refresh}=await current(context),history=await ledger.changes({limit:100,signal:context.signal});context.checkActive();return{...history,refresh,pairs:links,repairable:links.filter(link=>!link.sourceMissing&&!link.sourceUnreadable&&!link.sourceUnavailable&&!link.shared&&(link.twoWay?(link.sourceChanged&&link.outputStatus==='ready'||!link.sourceChanged&&link.outputStatus==='changed'):link.direction==='to-pro'&&link.owned&&link.sourceChanged&&link.outputStatus==='ready')).length,conflicts:links.filter(link=>link.sourceMissing||link.outputStatus==='missing'||link.sourceChanged&&link.outputStatus==='changed'||!link.twoWay&&(link.outputStatus==='changed'||link.sourceChanged&&(!link.owned||link.shared))).length};}));
 handle('powerpoint-repair',options=>job(async context=>{
  const {ledger,links}=await current(context),selected=links.filter(link=>!link.twoWay&&link.direction==='to-pro'&&link.owned&&link.sourceChanged&&!link.sourceMissing&&!link.sourceUnreadable&&!link.sourceUnavailable&&!link.shared&&link.outputStatus==='ready'),results=[];const fontSize=options?.fontSize??96,amenFontSize=options?.amenFontSize??36;
  for(const link of selected){context.checkActive();context.progress({completed:results.length,total:selected.length,name:link.name,phase:'extracting',message:'Updating linked ProPresenter lyrics',results:[...results]});let temporary;
   try{const saved=await ledger.resync({id:link.id,signal:context.signal,build:async({source,targetPath})=>{
    temporary=await fs.mkdtemp(path.join(os.tmpdir(),'Stati-Resync-'));context.checkActive();let bytes;
    const converted=await core.convertFiles([source.path],temporary,{fontSize,amenFontSize,fastPptx:true,reuseExisting:false,render:core.createOfficeReader(),checkActive:context.checkActive,signal:context.signal,progress:value=>context.progress({...value,completed:results.length,total:selected.length,name:link.name,results:[...results]}),writeOutput:async value=>{const current=callbackContext(context,value),old=await scanner.fingerprint(targetPath,{...current,includeBytes:true});await value.checkActive();bytes=await require('./conversion-work.cjs').withSignal('revise-build',current.signal,old.data,{title:value.title,...value.extracted,fontSize,amenFontSize});await value.checkActive();const file=path.join(temporary,'Converted.pro');await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});return{path:file,contentHash:digest(bytes),bytes:bytes.length};}});
    if(!bytes||converted.results[0]?.status!=='converted'){const failed=converted.results[0],error=Error(failed?.error||'This source could not be converted.');if(failed?.status==='excluded')error.code='SONG_LAYOUT_EXCLUDED';throw error;}return bytes;
   }});context.checkActive();results.push({name:link.name,status:saved.path?'resynced':'conflict',error:saved.error});context.progress({completed:results.length,total:selected.length,name:link.name,phase:'finished',message:'Linked lyrics checked',results:[...results]});}
   catch(error){context.checkActive();results.push({name:link.name,status:error.code==='SONG_LAYOUT_EXCLUDED'?'excluded':'failed',error:error.message});}
   finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
  }
  const twoWay=await synchronizePairs(context,ledger,links.filter(link=>link.twoWay&&(link.sourceChanged||link.outputStatus!=='ready')));results.push(...twoWay.results);if(results.some(item=>item.status==='resynced'))onChanged();return{results,total:selected.length+twoWay.results.length,stopped:false};
 }));
 async function textBuild({source,target,direction}){
  const helper=require('./presentation-text-sync.cjs');
  if(direction==='to-pptx')return helper.patchPowerPointLyrics(target.data,helper.proDocument(source.data).slides);
  const extracted=await require('./pptx-lyrics.cjs').readPptxLyrics(source.path,{simpleSongOnly:true,sourceBytes:source.data});if(!extracted)throw Error('This PowerPoint layout needs manual review. Both files were kept.');return helper.patchProLyrics(target.data,extracted.slides);
 }
 async function synchronizePairs(context,ledger,links){
  const results=[],warnings=[];let updated=0;
  for(const link of links.filter(item=>item.twoWay&&!sessionDisabled.has(scopeKey(context.operator)+':'+item.id)).slice(0,100)){
   context.checkActive();let saved;
   try{saved=await ledger.synchronize({id:link.id,signal:context.signal,build:textBuild});context.checkActive();}
   catch(error){context.checkActive();saved={status:'conflict',error:error.message};}
   if(saved.status==='unchanged')continue;
   results.push({id:link.id,name:link.name,status:saved.status,error:saved.error,path:saved.path});
   if(saved.status==='resynced')updated++;else warnings.push({id:link.id,name:link.name,kind:saved.status,message:saved.error||'This linked song needs operator review.'});
  }
  return{results,warnings,updated};
 }
 async function consentPair(context,ledger,id){
  const pair=await ledger.pairSnapshot({id,signal:context.signal});context.checkActive();
  // Confirm both directions can preserve the current slide/text-box structure.
  await textBuild({source:pair.source,target:pair.target,direction:pair.link.direction});await textBuild({source:pair.target,target:pair.source,direction:pair.link.direction==='to-pro'?'to-pptx':'to-pro'});context.checkActive();
  const choice=await require('electron').dialog.showMessageBox(window(),{type:'question',title:'Enable two-way lyric sync?',message:path.basename(pair.source.path)+' ↔ '+path.basename(pair.target.path),detail:'Stați will monitor this exact pair from saved files while your editing profile is unlocked. Updating either file can update the other file’s existing lyric text boxes. Verified backups are kept before changes. Both changed files, unsupported layouts and missing files are left for review; missing files are never recreated.',buttons:['Enable two-way sync','Cancel'],defaultId:1,cancelId:1});context.checkActive();
  if(choice.response!==0)return{canceled:true};await ledger.enableTwoWay({id,consent:true,signal:context.signal});sessionDisabled.delete(scopeKey(context.operator)+':'+id);return{enabled:true};
 }
 handle('presentation-enable-two-way',input=>job(async context=>{if(!input||typeof input.id!=='string')throw Error('Choose a linked song.');const directory=await libraryDirectory(context.operator),{ledger}=await ledgerFor(context,directory);return consentPair(context,ledger,input.id);}));
 handle('presentation-disable-two-way',input=>withWorkspaceFiles('editLyrics',async context=>{
  if(!input||typeof input.id!=='string'||!/^[a-f0-9-]{36}$/i.test(input.id))throw Error('Choose a linked pair.');context.checkActive();sessionDisabled.add(scopeKey(context.operator)+':'+input.id);active?.controller.abort(new Error('Two-way synchronization was disabled.'));
  try{const directory=await libraryDirectory(context.operator),{ledger}=await ledgerFor(context,directory);await ledger.disableTwoWay({id:input.id,signal:context.signal});context.checkActive();return{disabled:true};}
  catch(error){context.checkActive();return{disabled:true,persisted:false,message:'Synchronization stopped for this session, but the off setting could not be saved. Keep your editing profile locked before restarting and retry Disable sync after storage is available.'};}
 }));
 handle('presentation-link-existing',()=>job(async context=>{
  const dialog=require('electron').dialog,pptx=await dialog.showOpenDialog(window(),{title:'Choose the existing PowerPoint counterpart',properties:['openFile'],filters:[{name:'Editable PowerPoint song',extensions:['pptx']}]});context.checkActive();if(pptx.canceled||!pptx.filePaths?.[0])return{canceled:true};
  const pro=await dialog.showOpenDialog(window(),{title:'Choose the same existing song in the ProPresenter library',properties:['openFile'],filters:[{name:'ProPresenter song',extensions:['pro']}]});context.checkActive();if(pro.canceled||!pro.filePaths?.[0])return{canceled:true};
  const source=await scanner.fingerprint(pptx.filePaths[0],{...context,includeBytes:true}),target=await scanner.fingerprint(pro.filePaths[0],{...context,includeBytes:true}),lyrics=await require('./pptx-lyrics.cjs').readPptxLyrics(source.path,{simpleSongOnly:true,sourceBytes:source.data}),native=require('./presentation-text-sync.cjs').proDocument(target.data);
  if(!lyrics||require('./library.cjs').lyricIdentity(lyrics.slides.map(item=>item.text).join('\n'))!==require('./library.cjs').lyricIdentity(native.slides.map(item=>item.text).join('\n')))throw Error('These files contain different lyrics. Review them before linking; neither file was changed.');
  const {ledger}=await ledgerFor(context,path.dirname(target.path),[path.dirname(source.path)]);await ledger.observe({files:[source],extensions:['.pptx'],signal:context.signal});const linked=await ledger.linkExisting({sourceId:source.id,expectedSourceHash:source.sha256,targetPath:target.path,expectedTargetHash:target.sha256,direction:'to-pro',signal:context.signal});return consentPair(context,ledger,linked.id);
 }));
 async function backgroundSync(){
  if(active||core.isRunning())return{skipped:true};
  return job(async context=>{const directory=await backgroundDirectory();context.checkActive();if(!directory)return{skipped:true};const signal=AbortSignal.any([context.signal,AbortSignal.timeout(45000)]),bounded={...context,signal,checkActive:()=>{signal.throwIfAborted();context.checkActive();}}, {ledger}=await ledgerFor(bounded,directory);const links=(await ledger.listLinks({signal})).items.filter(link=>link.twoWay&&!sessionDisabled.has(scopeKey(context.operator)+':'+link.id));if(!links.length)return{skipped:true};const selected=Array.from({length:Math.min(20,links.length)},(_,index)=>links[(backgroundOffset+index)%links.length]);backgroundOffset=(backgroundOffset+selected.length)%links.length;const result=await synchronizePairs(bounded,ledger,selected);if(result.updated)onChanged();return{updated:result.updated,warnings:result.warnings};});
 }
 const cancel=()=>{active?.controller.abort(new DOMException('Conversion stopped. Completed files were kept.','AbortError'));return core.cancel();};
 handle('presentation-work-cancel',()=>{cancel();return{stopping:!!active||core.isRunning()};});
 return{clear:cancel,cancel,backgroundSync};
}
module.exports={installPresentationTools};
