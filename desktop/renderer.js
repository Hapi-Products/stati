if(window.stati.platform==='darwin')document.documentElement.dataset.platform='darwin';
let linkedCheckAt=0,linkedCheckBusy=false;
let adminUnlocked=false,computerNameRevision=0,fileNamesRevision=0;
let selectedAdmin=null,unlockTimer=null;
const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
if(window.stati.platform==='darwin'){
 $('identity-mode').querySelector('[value="before-service"]').textContent='Outside service at startup';
 $('identity-mode-help').textContent='Ask who is using this computer when Stați opens or this Mac unlocks. The Mac identity screen uses an app window.';
}
let privacyAllowed=false,identityGeneration=0,identityPresentation='window',identityCanSkip=false,refreshAgain=false,identityChoicePending=false,identitySettingsMode='before-service',identitySettingsRevision=0;
let joinAdmin=false;function showJoin(visible){joinAdmin=visible;$('join-admin').hidden=!visible;if(!visible){enrollmentExpires=0;$('enrollment-status').textContent='';$('enrollment-countdown').textContent='';$('join-qr').removeAttribute('src');}}let operatorsSignature='';let paired=false,operatorChosen=false,receiver=null,pollBusy=false,pairTimer=null;
function error(e){const message=e.message||String(e);$('error').textContent=message;$('error').hidden=false;const identityError=$('identity-error');if(identityError&&document.body.classList.contains('identifying')){identityError.textContent=message;identityError.hidden=false;}}
async function run(fn){try{$('error').hidden=true;if($('identity-error'))$('identity-error').hidden=true;return await fn();}catch(e){error(e);}}
function bind(id,fn){$(id).addEventListener('click',()=>void run(fn));}
const workspaceSections=['prepare','library','services','powerpoint','audio'];
const teamSections=['tasks','groups'];
const teamWorkspace=typeof createTeamWorkspace==='function' ? createTeamWorkspace(window.stati) : null;
function tab(id){
 if(id==='settings'&&!adminUnlocked)return;
 if(teamSections.includes(id)&&!document.documentElement.dataset.workspaceOperator)return;
 const changing=new Event('stati-before-navigate',{cancelable:true});if(!window.dispatchEvent(changing))return;
 document.documentElement.dataset.workspaceTab=id;
 document.querySelectorAll('aside nav button').forEach(b=>{const selected=(b.dataset.tab||b.id)===id||(id==='audio'&&b.id==='prepare');b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 ['station','clocks','settings'].forEach(t=>$(t+'-panel').hidden=t!==id||(!paired&&t==='station'));
 $('workspace-panel').hidden=!workspaceSections.includes(id);
 if(teamWorkspace){
  $('team-panel').hidden=!teamSections.includes(id);
  teamWorkspace.show(teamSections.includes(id)?id:null);
 }
 $('pair-panel').hidden=paired||id!=='station';
 window.dispatchEvent(new Event('stati-workspace-change'));
 if(id==='clocks')void run(renderClocks);if(id==='settings')void run(loadIdentitySettings);
}
window.addEventListener('stati-workspace-selected',event=>{const id=event.detail;if(!workspaceSections.includes(document.documentElement.dataset.workspaceTab))return;document.documentElement.dataset.workspaceTab=id;document.querySelectorAll('aside nav button').forEach(b=>{const selected=(b.dataset.tab||b.id)===id;b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});});

function setTeamNavigation(unlocked) {
 if (!teamWorkspace) return;
 for (const page of teamSections) document.querySelector(`[data-tab="${page}"]`).hidden = !unlocked;
 if (!unlocked) {
  teamWorkspace.show(null);
  if (teamSections.includes(document.documentElement.dataset.workspaceTab)) tab('station');
 }
}

document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.tab)));
async function refresh(){
 if(!privacyAllowed)return;
 if(pollBusy){refreshAgain=true;return;}
 pollBusy=true;
 const generation=identityGeneration,nameRevision=computerNameRevision,fileRevision=fileNamesRevision;
 try{
  const state=await window.stati.state();
  if(generation!==identityGeneration)return;
  state.members=(state.members||[]).filter(member=>member.ministryRole!=='pastor');
  paired=state.paired;
  document.querySelectorAll('.organization').forEach(e=>e.textContent=state.organization||state.name||'');
  $('pair-panel').hidden=paired;
  if(!paired){document.body.classList.remove('identifying');document.documentElement.classList.remove('identity-fullscreen');$('operator-shade').hidden=true;connectionSignature='';$('connection').textContent='Not paired';if(state.pairing?.url&&$('pair-code').hidden)await showPairing(await window.stati.pair(state.pairing.name));return;}
  adminUnlocked=!!state.adminUnlocked;const currentProfile=state.members?.find(member=>member.id===state.device?.operator_id);$('prepare').hidden=!currentProfile?.capabilities?.readSongs;$('library').hidden=!currentProfile?.capabilities?.readSongs;$('services').hidden=!currentProfile?.capabilities?.readSongs;$('powerpoint-changes').hidden=!currentProfile?.capabilities?.editLyrics;
  $('downloads').hidden=!adminUnlocked;
  if(!adminUnlocked&&document.querySelector('[data-tab="settings"]').classList.contains('active'))tab('station');
  renderConnection(state);
  renderConnectedPeople(state);
  $('history-clear').hidden=!state.adminUnlocked;
  document.querySelector('[data-tab="settings"]').hidden=!state.adminUnlocked;
  if(nameRevision===computerNameRevision&&document.activeElement!==$('station-name'))$('station-name').value=state.device.name;
  document.querySelectorAll('.organization').forEach(e=>e.textContent=state.organization);
  if(document.querySelector('[data-tab="station"]').classList.contains('active'))$('station-panel').hidden=false;
  showJoin(operatorChosen&&state.adminUnlocked&&state.members.some(member=>member.id===state.device.operator_id&&member.role==='admin'));
  if(adminUnlocked&&document.documentElement.dataset.workspaceTab!=='powerpoint'&&Date.now()-linkedCheckAt>60000&&!linkedCheckBusy){const identity=identityGeneration;linkedCheckBusy=true;linkedCheckAt=Date.now();void window.stati.powerPointChanges().then(changes=>{if(identity!==identityGeneration||!adminUnlocked)return;const count=changes.repairable+changes.conflicts;$('linked-changes-alert').hidden=!count;$('linked-changes-summary').textContent=changes.conflicts?changes.conflicts+' linked songs need review. Existing edits are kept.':count+' linked songs have saved changes ready to review.';}).catch(()=>{}).finally(()=>{linkedCheckBusy=false;});}
  receiver=state.receiver;
  $('receiver-status').textContent=receiver?'Ready to receive':'Receiving paused';
  $('open-receiver').hidden=!!receiver;
  $('close-receiver').hidden=!receiver;
  if(fileRevision===fileNamesRevision)renderFiles(state.transfers);
  renderRequests([...(state.accessApprover==='operator'?(state.accessRequests||[]).map(r=>({...r,access:true,message:'Wants access to this computer.'})):[]),...state.requests]);
  if(!operatorChosen){
   document.body.classList.add('identifying');
   applyIdentityPresentation({presentation:identityPresentation});
   $('operator-shade').hidden=false;
   const memberSignature=JSON.stringify(state.members);
   if(memberSignature!==operatorsSignature){
    operatorsSignature=memberSignature;
    $('operators').replaceChildren(...state.members.map(member=>{
     const b=el('button',undefined,'operator'),avatar=el('span',member.first_name[0]+member.last_initial,'avatar');
     b.append(avatar,el('span',member.first_name+' '+member.last_initial+'.'));
     if(member.has_photo)setAvatarPhoto(avatar,member.id);
     b.addEventListener('click',()=>void run(async()=>{
      if(generation!==identityGeneration||identityChoicePending)return;
      if(member.role==='admin'||member.requiresUnlock){selectedAdmin=member;$('admin-unlock').hidden=false;$('operators').hidden=true;$('admin-name').textContent='Unlock '+member.first_name+' '+member.last_initial+'.';$('admin-pin').closest('label').hidden=member.role!=='admin';$('admin-pin').required=member.role==='admin';$('admin-unlock').querySelector('[type=submit]').hidden=member.role!=='admin';(member.role==='admin'?$('admin-pin'):$('admin-phone')).focus();return;}
      identityChoicePending=true;b.disabled=true;
      try{
       await window.stati.operator(member.id);
       if(generation!==identityGeneration)return;
       await finishOperatorChoice(generation);
       await refresh();
      }catch(e){if(generation===identityGeneration)throw e;}
      finally{if(generation===identityGeneration)identityChoicePending=false;b.disabled=false;}
     }));
     return b;
    }));
   }
  }
  refreshAvatarPhotos();
 }catch(e){if(generation===identityGeneration){connectionSignature='';$('connection').textContent='Disconnected';error(e);}}
 finally{pollBusy=false;if(refreshAgain){refreshAgain=false;void refresh();}}
}
let filesSignature='',rejectTarget=null,lastFiles=[],renameTarget=null,renameWorking=false,mediaTarget=null,mediaRequest=0,mediaRelease=null,mediaErrorCleanup=null;const thumbnailPromises=new Map(),previewObservers=new Set();
const avatarPhotoStates=new WeakMap();let avatarPhotoEpoch=0;
function clearAvatarPhotos(){avatarPhotoEpoch++;}
function setAvatarPhoto(avatar,id){
 avatar.dataset.senderPhotoId=id;
 let state=avatarPhotoStates.get(avatar);if(!state){state={pending:false,next:0,initials:avatar.textContent};avatarPhotoStates.set(avatar,state);}
 if(state.pending||state.next>Date.now())return;
 state.pending=true;const epoch=avatarPhotoEpoch;
 Promise.resolve().then(()=>window.stati.senderPhoto(id)).then(async url=>{if(!url?.startsWith('data:image/webp;base64,'))return url;await whenPreviewToolsReady();if(epoch!==avatarPhotoEpoch)return null;if(!window.statiPhotoThumbnail)throw Error('Profile photo decoder unavailable.');return window.statiPhotoThumbnail(url);}).catch(()=>null).then(url=>{
  state.pending=false;if(epoch!==avatarPhotoEpoch||!avatar.isConnected)return;
  state.next=Date.now()+(url?60000:5000);
  if(url){const image=el('img');image.alt='';image.addEventListener('error',()=>{if(epoch!==avatarPhotoEpoch||!avatar.isConnected||avatar.firstChild!==image)return;avatar.textContent=state.initials;state.next=Date.now()+5000;},{once:true});image.src=url;avatar.replaceChildren(image);}
 });
}
function refreshAvatarPhotos(){for(const avatar of document.querySelectorAll('[data-sender-photo-id]'))setAvatarPhoto(avatar,avatar.dataset.senderPhotoId);}
function mediaKind(file){const name=(file.filename||'').toLowerCase();if(/\.(mp3|m4a|wav|ogg|opus|flac|aac)$/.test(name)||file.content_type?.startsWith('audio/'))return'audio';if(/\.(mp4|m4v|mov|webm|ogv)$/.test(name)||file.content_type?.startsWith('video/'))return'video';return null;}
let previewToolsPending=null;
function whenPreviewToolsReady(){
 if(window.statiThumbnail&&window.statiPlayPreview)return Promise.resolve();
 if(!previewToolsPending)previewToolsPending=new Promise((resolve,reject)=>{const ready=()=>{clearTimeout(timer);window.removeEventListener('stati-preview-ready',ready);resolve();},timer=setTimeout(()=>{window.removeEventListener('stati-preview-ready',ready);reject(Error('Preview tools are not ready. Reopen Stați and try again.'));},10000);window.addEventListener('stati-preview-ready',ready,{once:true});}).finally(()=>{previewToolsPending=null;});
 return previewToolsPending;
}
function closeMediaPreview(){
 mediaRequest++;mediaTarget=null;mediaErrorCleanup?.();mediaErrorCleanup=null;mediaRelease?.();mediaRelease=null;
 for(const player of [$('media-preview-video'),$('media-preview-audio')])if(player){player.pause?.();player.removeAttribute('src');player.load?.();player.hidden=true;}
 const dialog=$('media-preview-dialog');if(dialog?.open)dialog.close();
}
async function openMediaPreview(file){
 closeMediaPreview();const request=++mediaRequest,generation=identityGeneration,dialog=$('media-preview-dialog');mediaTarget=file.id;
 $('media-preview-title').textContent=file.filename;$('media-preview-status').textContent='Loading preview…';dialog.showModal();
 try{
  await whenPreviewToolsReady();if(request!==mediaRequest||generation!==identityGeneration)return;
  const preview=await window.statiPlayPreview(file.id);if(request!==mediaRequest||generation!==identityGeneration){preview.release();return;}
  mediaRelease=preview.release;const player=$(preview.mediaType==='audio'?'media-preview-audio':'media-preview-video');player.hidden=false;player.muted=true;
  const loaded=()=>{if(request===mediaRequest)$('media-preview-status').textContent=(preview.changedSinceDelivery?'Local copy changed since delivery. ':'')+'Use Play to start. Sound starts muted.';},failed=()=>{if(request===mediaRequest)$('media-preview-status').textContent='This media format cannot be played here. Save it and use Open to view it in another app.';};
  player.addEventListener('loadedmetadata',loaded);player.addEventListener('error',failed);mediaErrorCleanup=()=>{player.removeEventListener('loadedmetadata',loaded);player.removeEventListener('error',failed);};player.src=preview.url;player.load();
 }catch(error){if(request===mediaRequest&&generation===identityGeneration)$('media-preview-status').textContent=error.message||'Preview unavailable.';}
}
function appendMediaButton(preview,file){if(!mediaKind(file))return;const button=fileActionButton('Preview','media-play');button.title='Preview '+mediaKind(file);button.setAttribute('aria-label','Preview '+mediaKind(file)+': '+file.filename);button.addEventListener('click',()=>void openMediaPreview(file));preview.append(button);}
function paintThumbnail(preview,file,value){
 if(!preview.isConnected)return;preview.replaceChildren();
 if(value.image){const image=el('img');image.src=value.image;image.alt='Preview of '+file.filename;if(value.label)image.title=value.label;preview.append(image);}
 else if(value.text)preview.append(el('p',value.text,'preview-text'));
 else{preview.append(el('span',file.filename.split('.').pop().toUpperCase(),'preview-extension'));const status=el('small','Preview unavailable','preview-unavailable');status.title=value.reason||'Open the saved file to view it.';preview.append(status);}
 if(value.changedSinceDelivery)preview.append(el('small','Local copy changed','preview-local-change'));
 appendMediaButton(preview,file);
}
function observeFilePreview(file,preview){
 appendMediaButton(preview,file);if(mediaKind(file)==='audio')return;
 const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){
  if(!thumbnailPromises.has(file.id)){const promise=whenPreviewToolsReady().then(()=>window.statiThumbnail(file.id)).catch(error=>({reason:error.message||'Preview unavailable.'}));thumbnailPromises.set(file.id,promise);if(thumbnailPromises.size>100)thumbnailPromises.delete(thumbnailPromises.keys().next().value);}
  thumbnailPromises.get(file.id).then(value=>{if(!preview.isConnected)return;paintThumbnail(preview,file,value);if(value.reason)thumbnailPromises.delete(file.id);observer.disconnect();previewObservers.delete(observer);});
 }},{rootMargin:'50px'});previewObservers.add(observer);observer.observe(preview);
}

function fileActionButton(label,cls=''){
 const paths={Preview:['m9 5 11 7-11 7z'],Rename:['m15 4 5 5','M4 20l5-1L21 7l-5-5L4 14z'],'Show in folder':['M3 6h7l2 3h9v12H3z'],Save:['M12 3v12m-5-5 5 5 5-5','M4 16v5h16v-5'],Reject:['m6 6 12 12','M18 6 6 18'],Open:['M14 3h7v7','m10 14 11-11','M21 14v7H3V3h7'],'Save a copy':['M9 9h12v12H9z','M15 9V3H3v12h6'],'Email…':['M3 5h18v14H3z','m3 5 9 7 9-7'],'Prepare slides':['M3 4h18v13H3z','M12 17v4m-4 0h8','m10 8 5 3-5 3z']};
 const b=el('button',undefined,('file-action '+cls).trim());b.title=label;b.setAttribute('aria-label',label);
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
 for(const d of paths[label]||[]){const path=document.createElementNS(ns,'path');path.setAttribute('d',d);svg.append(path);}b.append(svg);return b;
}
function beginFileRename(file){renameTarget=file;const dot=file.filename.lastIndexOf('.'),hasExtension=dot>0;const input=$('rename-file-stem');input.value=hasExtension?file.filename.slice(0,dot):file.filename;$('rename-file-extension').textContent=hasExtension?file.filename.slice(dot):'';$('rename-file-original').textContent=file.filename;$('rename-file-error').textContent='';$('rename-file-dialog').showModal();input.focus();input.select();}
function matchingFiles(files,query,status){const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();const words=normalize(query).trim().split(/\s+/).filter(Boolean);return files.filter(file=>(status==='all'||file.status===status)&&words.every(word=>normalize([file.filename,file.original_filename,file.first_name,file.last_initial,file.status,new Date(file.created_at*1000).toLocaleDateString(),(Number.isFinite(Number(file.created_at))?new Date(file.created_at*1000).toISOString().slice(0,10):'')].join(' ')).includes(word)));}
function renderFiles(files){if(mediaTarget&&!files.some(file=>file.id===mediaTarget&&file.status!=='rejected'))closeMediaPreview();lastFiles=files;const query=$('file-search')?.value||'',status=$('file-status')?.value||'all';const signature=JSON.stringify([files,query,status]);if(signature===filesSignature)return;filesSignature=signature;for(const observer of previewObservers)observer.disconnect();previewObservers.clear();const total=files.length;files=matchingFiles(files,query,status);if($('file-search-count'))$('file-search-count').textContent=query||status!=='all'?files.length+' of '+total+' files':'';$('files').replaceChildren();$('delivery-record').replaceChildren();if(!files.length){$('files').append(el('p',total?'No files match your search.':'Files appear here when members send them.'));return;}for(const file of files){const card=el('article',undefined,'delivery-card'),preview=el('div',undefined,'file-preview');preview.append(el('span',file.filename.split('.').pop().toUpperCase(),'preview-extension'));const sender=el('div',undefined,'sender'),avatar=el('span',(file.first_name||'?')[0]+(file.last_initial||''),'sender-avatar');sender.append(avatar,el('strong',file.first_name?file.first_name+' '+file.last_initial+'.':'Member'));if(file.has_photo&&file.sender_id)setAvatarPhoto(avatar,file.sender_id);card.append(preview,el('h2',file.filename),sender,el('small',(file.bytes/1024/1024).toFixed(1)+' MB · '+(file.saved&&file.status!=='delivered'?'Saved copy on computer · '+(file.status==='queued'?'confirmation pending':file.status):file.status==='delivered'?'Saved on computer':file.status==='queued'?(file.remoteAvailable===false?'Temporary file unavailable':'Waiting for computer'):file.status)));if(file.original_filename&&file.original_filename!==file.filename)card.append(el('p','Sent as: '+file.original_filename,'original-file-name'));if(file.rejection_reason)card.append(el('p',file.rejection_reason,'rejection-note'));const actions=el('div',undefined,'file-actions');actions.setAttribute('role','group');actions.setAttribute('aria-label','Actions for '+file.filename);const button=(label,fn,cls)=>{const b=fileActionButton(label,cls);b.addEventListener('click',()=>void run(async()=>{b.disabled=true;try{await fn();}finally{b.disabled=false;}}));actions.append(b);};if(file.status==='queued'&&file.remoteAvailable!==false){button('Save',async()=>{await window.stati.deliver(file.id);await refresh();},'primary');button('Reject',async()=>{rejectTarget=file;$('reject-filename').textContent=file.filename;$('reject-reason').value='';$('reject-dialog').showModal();},'danger');}if(file.saved){button('Open',()=>window.stati.openFile(file.id));button('Show in folder',()=>window.stati.revealFile(file.id));button('Rename',async()=>beginFileRename(file));button('Save a copy',()=>window.stati.copyFile(file.id));button('Email…',()=>window.stati.emailFile(file.id));}if((file.status==='queued'&&file.remoteAvailable!==false||file.saved)&&/\.(txt|pdf|pptx|docx|jpe?g|png|webp)$/i.test(file.filename))button('Prepare slides',async()=>{if(!file.saved)await window.stati.deliver(file.id);await window.stati.prepareFile(file.id);await refresh();});card.append(actions);if(file.status!=='rejected')$('files').append(card);const record=el('div',undefined,'record-row');record.append(el('strong',file.filename),el('span',(file.first_name||'Member')+' '+(file.last_initial||'')+' · '+new Date(file.created_at*1000).toLocaleString()),el('span',file.status+(file.rejection_reason?' · '+file.rejection_reason:'')));if(file.original_filename&&file.original_filename!==file.filename)record.append(el('small','Sent as: '+file.original_filename));$('delivery-record').append(record);if(file.status!=='rejected'&&(file.status==='queued'&&file.remoteAvailable!==false||file.saved)){observeFilePreview(file,preview);}}if(!$('files').children.length)$('files').append(el('p','No files to show.'));}
for(const id of ['file-search','file-status'])$(id)?.addEventListener('input',()=>renderFiles(lastFiles));
$('file-search')?.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();$('file-search').value='';renderFiles(lastFiles);}});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'&&!$('station-panel').hidden&&!document.body.classList.contains('identifying')){event.preventDefault();$('file-search').focus();}});
bind('request-bell',()=>{$('requests-panel').hidden=!$('requests-panel').hidden;$('request-bell').setAttribute('aria-expanded',String(!$('requests-panel').hidden));});
bind('media-preview-close',closeMediaPreview);
$('media-preview-dialog').addEventListener('close',()=>{if(!$('media-preview-dialog').open)closeMediaPreview();});
window.addEventListener('focus',()=>{if(mediaTarget||document.body.classList.contains('identifying'))return;thumbnailPromises.clear();filesSignature='';renderFiles(lastFiles);});
bind('rename-file-cancel',()=>{if(!renameWorking)$('rename-file-dialog').close();});
$('rename-file-dialog').addEventListener('cancel',event=>{if(renameWorking)event.preventDefault();});
$('rename-file-dialog').addEventListener('close',()=>{renameTarget=null;});
$('rename-file-form').addEventListener('submit',event=>{event.preventDefault();if(!renameTarget||renameWorking)return;const file=renameTarget;renameWorking=true;fileNamesRevision++;for(const id of ['rename-file-stem','rename-file-save','rename-file-cancel'])$(id).disabled=true;$('rename-file-error').textContent='';void(async()=>{try{const result=await window.stati.renameFile(file.id,$('rename-file-stem').value);fileNamesRevision++;thumbnailPromises.delete(file.id);renderFiles(lastFiles.map(item=>item.id===file.id?{...item,original_filename:item.original_filename||item.filename,filename:result.filename}:item));$('file-action-status').textContent=result.retainedOriginal?'File renamed. The old copy could not be removed; both names remain on this computer.':result.unchanged?'The file already has this name.':'File renamed.';$('rename-file-dialog').close();await refresh();}catch(e){$('rename-file-error').textContent=e.message||'Unable to rename this file.';}finally{renameWorking=false;for(const id of ['rename-file-stem','rename-file-save','rename-file-cancel'])$(id).disabled=false;}})();});
bind('requests-close',()=>{$('requests-panel').hidden=true;$('request-bell').setAttribute('aria-expanded','false');});bind('record-toggle',()=>{$('record-panel').hidden=!$('record-panel').hidden;});bind('reject-cancel',()=>$('reject-dialog').close());$('reject-form').addEventListener('submit',event=>{event.preventDefault();if(!rejectTarget)return;void run(async()=>{await window.stati.reject(rejectTarget.id,$('reject-reason').value);$('reject-dialog').close();await refresh();});});
function renderRequests(requests){$('request-count').textContent=requests.length;$('request-count').hidden=!requests.length;$('requests').replaceChildren();if(!requests.length){$('requests').append(el('p','No waiting requests.'));return;}for(const r of requests){const row=el('div',undefined,'request-row'),info=el('div');info.append(el('strong',r.first_name+' '+r.last_initial+'.'),el('small',r.message));if(r.access){for(const [label,status] of [['Approve','approved'],['Deny','denied']]){const b=el('button',label);b.addEventListener('click',()=>void run(async()=>{await window.stati.connectionDecision(r.id,status);await refresh();}));row.append(b);}row.prepend(info);$('requests').append(row);continue;}const ack=el('button','Dismiss');ack.addEventListener('click',()=>void run(async()=>{await window.stati.ack(r.id);await refresh();}));row.append(info,ack);$('requests').append(row);}}
async function showPairing(data){
 if(data.paired){clearInterval(pairTimer);await refresh();return;}
 if(!data.url)return;
 $('pair-code').hidden=false;$('pair-qr').src=data.qr;$('pair-url').textContent=data.url;
 clearInterval(pairTimer);pairTimer=setInterval(()=>void run(async()=>{try{const status=await window.stati.pairStatus();if(status.paired){clearInterval(pairTimer);await refresh();}}catch(e){if(e.message.includes('Pairing expired')){clearInterval(pairTimer);$('pair-code').hidden=true;$('pair').textContent='Create a new pairing QR code →';}throw e;}}),3000);
}
bind('pair',async()=>{const button=$('pair');button.disabled=true;try{await showPairing(await window.stati.pair($('computer-name').value));}finally{button.disabled=false;}});
function clearIdentityContent(){if($('connected-people')){$('connected-people').hidden=true;$('connected-people-list').replaceChildren();}
 $('linked-changes-alert').hidden=true;linkedCheckAt=0;
 delete document.documentElement.dataset.workspaceOperator;setTeamNavigation(false);window.dispatchEvent(new Event('stati-workspace-change'));
 identityChoicePending=false;
 closeMediaPreview();window.dispatchEvent(new Event('stati-previews-reset'));
 $('rename-file-dialog').close();$('reject-dialog').close();$('file-action-status').textContent='';
 resetAdminUnlock();adminUnlocked=false;operatorChosen=false;
 tab('station');showJoin(false);
 $('operator-shade').hidden=false;document.body.classList.add('identifying');
 applyIdentityPresentation({presentation:identityPresentation});
 $('identity-error').hidden=true;$('error').hidden=true;
 operatorsSignature='';$('operators').replaceChildren();
 filesSignature='';lastFiles=[];connectionSignature='';
 $('file-search').value='';$('file-status').value='all';$('file-search-count').textContent='';
 $('files').replaceChildren();$('delivery-record').replaceChildren();$('requests').replaceChildren();
 $('record-panel').hidden=true;$('requests-panel').hidden=true;$('request-bell').setAttribute('aria-expanded','false');
 $('request-count').textContent='0';$('request-count').hidden=true;
 $('downloads').hidden=true;$('history-clear').hidden=true;document.querySelector('[data-tab="settings"]').hidden=true;
 for(const observer of previewObservers)observer.disconnect();previewObservers.clear();thumbnailPromises.clear();clearAvatarPhotos();
}
async function requireIdentity(notifyMain=false){
 if(notifyMain){const previous=identityGeneration;await window.stati.operator(null);if(previous!==identityGeneration)return;}
 const generation=++identityGeneration;
 clearIdentityContent();
 if(generation!==identityGeneration)return;
 applyIdentityPresentation(await (notifyMain?window.stati.identityOpen():window.stati.identityStatus()));
 if(generation===identityGeneration)await refresh();
}
async function flushWorkspaceBeforeSwitch(){const checks=[];window.dispatchEvent(new CustomEvent('stati-before-profile-switch',{detail:checks}));for(const check of checks)if(!await check())return false;return true;}
bind('website',async()=>{if(await flushWorkspaceBeforeSwitch())await requireIdentity(true);});bind('downloads',()=>window.stati.showDownloads());
bind('open-receiver',async()=>{receiver=await window.stati.openReceiver();await refresh();});
bind('close-receiver',async()=>{await window.stati.closeReceiver();receiver=null;await refresh();});
bind('unpair',async()=>{const result=await window.stati.resetPairing();if(result.canceled)return;identityGeneration++;clearIdentityContent();paired=false;$('operator-shade').hidden=true;document.body.classList.remove('identifying');document.documentElement.classList.remove('identity-fullscreen');$('connection').textContent='Not paired';$('station-panel').hidden=true;tab('station');});
bind('add-clock',async()=>{await window.stati.addClock({});await renderClocks();});
async function renderClocks(){
 const status=await window.stati.clockContrastStatus();$('clock-contrast-status').textContent=status;$('clock-contrast-status').hidden=!status;
 const clocks=await window.stati.clocks();$('add-clock').disabled=clocks.length>=5;$('clock-list').replaceChildren();
 for(let i=0;i<clocks.length;i++){
  const c=clocks[i],values={...c},card=el('div',undefined,'card clock-editor'),heading=el('div',undefined,'clock-card-heading'),controls=el('div',undefined,'clock-typography'),colors=el('div',undefined,'clock-colors'),options=el('div',undefined,'clock-options');
  const save=()=>window.stati.updateClock(c.id,values);
  const remove=el('button','Delete','danger');remove.setAttribute('aria-label','Delete clock '+(i+1));remove.addEventListener('click',()=>void run(async()=>{await window.stati.deleteClock(c.id);await renderClocks();}));
  heading.append(el('h2','Clock '+(i+1)),remove);card.append(heading);
  for(const [key,title,type] of [['font','Font','select'],['fontSize','Size','number'],['color','Text','color'],['background','Background','color']]){
   const label=el('label',title,'clock-field clock-field-'+key),input=el(type==='select'?'select':'input');
   if(type==='select'){for(const f of ['Segoe UI','Arial','Aptos','Calibri','Cambria','Candara','Consolas','Courier New','Georgia','Helvetica Neue','Impact','Palatino','Tahoma','Times New Roman','Trebuchet MS','Verdana','Avenir Next','Menlo']){const option=el('option',f);option.value=f;input.append(option);}}else input.type=type;
   input.value=values[key];if(type==='number'){input.min=24;input.max=110;}
   input.addEventListener('change',()=>void run(async()=>{values[key]=type==='number'?Number(input.value):input.value;await save();}));label.append(input);(type==='color'?colors:controls).append(label);
  }
  const styles=el('div',undefined,'clock-styles');styles.setAttribute('role','group');styles.setAttribute('aria-label','Text style');
  for(const [key,title] of [['bold','Bold'],['italic','Italic']]){const button=el('button',key==='bold'?'B':'I','clock-style clock-style-'+key);button.setAttribute('aria-label',title);button.setAttribute('aria-pressed',String(!!values[key]));button.title=title;button.addEventListener('click',()=>void run(async()=>{values[key]=!values[key];await save();button.setAttribute('aria-pressed',String(values[key]));}));styles.append(button);}
  controls.append(styles);card.append(controls,colors);
  for(const [key,title] of [['showBackground','Background'],['showBorder','Border'],['blur','Blur'],['autoContrast','Auto contrast'],['showSeconds','Seconds'],['twentyFourHour','24-hour']]){
   const label=el('label',undefined,'clock-toggle'),input=el('input');input.type='checkbox';input.checked=!!values[key];input.addEventListener('change',()=>void run(async()=>{values[key]=input.checked;await save();}));label.append(input,el('span',title));options.append(label);
  }card.append(options);const dimensions=el('div',undefined,'clock-dimensions'),automatic=el('label',undefined,'clock-toggle'),autoInput=el('input');autoInput.type='checkbox';autoInput.checked=values.autoSize!==false;automatic.append(autoInput,el('span','Automatic size'));dimensions.append(automatic);const manual=[];for(const [key,title,min,max] of [['width','Width',100,1600],['height','Height',50,600]]){const label=el('label',title+' (px)','clock-field'),input=el('input');input.type='number';input.min=min;input.max=max;input.value=values[key]||(key==='width'?350:140);input.disabled=autoInput.checked;input.addEventListener('change',()=>void run(async()=>{values[key]=Number(input.value);await save();}));manual.push(input);label.append(input);dimensions.append(label);}autoInput.addEventListener('change',()=>void run(async()=>{values.autoSize=autoInput.checked;manual.forEach(input=>input.disabled=autoInput.checked);await save();}));card.append(dimensions);$('clock-list').append(card);
 }
}
void initializePrivacy();setInterval(()=>{if(document.visibilityState!=='hidden')void refresh();},20000);

bind('prepare',()=>window.stati.prepare());
bind('library',()=>window.stati.prepare('library'));bind('services',()=>window.stati.prepare('services'));bind('powerpoint-changes',()=>window.stati.prepare('powerpoint'));bind('linked-changes-review',()=>window.stati.prepare('powerpoint'));

async function revealWorkspace(){privacyAllowed=true;document.body.classList.add('identifying');$('privacy-gate').hidden=true;$('workspace-shell').hidden=false;await refresh();renderUpdate(await window.stati.updateState());}
async function initializePrivacy(){try{applyIdentityPresentation(await window.stati.identityStatus());if((await window.stati.accessStatus()).allowed)await revealWorkspace();}catch(e){$('access-error').textContent=e.message;}}
bind('access-retry',initializePrivacy);



let enrollmentExpires=0,enrollmentOffset=0,enrollmentBusy=false;
async function updateEnrollmentCode(){if(!privacyAllowed||!paired||!joinAdmin||enrollmentBusy)return;enrollmentBusy=true;try{const value=await window.stati.enrollmentCode();if(!joinAdmin)return;$('join-qr').src=value.qr;$('join-qr').hidden=false;$('enrollment-status').textContent='';enrollmentExpires=value.expiresAt;enrollmentOffset=value.serverTime-Math.floor(Date.now()/1000);}catch{$('enrollment-status').textContent='Invitation unavailable';$('join-qr').hidden=true;$('join-qr').removeAttribute('src');enrollmentExpires=0;}finally{enrollmentBusy=false;}}
setInterval(()=>{if(!paired||!joinAdmin)return;const remaining=enrollmentExpires-(Math.floor(Date.now()/1000)+enrollmentOffset);$('enrollment-countdown').textContent=remaining>0?'Changes in '+remaining+'s':'';if(remaining<=0)void updateEnrollmentCode();},1000);

let identityUpdateAvailable=false;
function renderUpdate(state){const available=['available','ready'].includes(state.phase),busy=['disabled','checking','downloading','installing'].includes(state.phase);identityUpdateAvailable=available;$('update-status').textContent='Stați '+state.version+' · '+state.message;$('update-check').disabled=busy;$('update-install').hidden=!available;$('update-install').textContent=state.phase==='ready'?'Restart and update':'Update';$('update-shortcut').hidden=!available;$('update-progress').hidden=state.phase!=='downloading';$('update-progress').value=state.percent||0;$('identity-update').hidden=state.phase==='disabled';$('identity-update').disabled=busy;$('identity-update').textContent=available?(state.phase==='ready'?'Restart and update':'Update Stați'):'Check for updates';$('identity-update-status').textContent=['checking','downloading','installing','error','ready','available','current'].includes(state.phase)?state.message||'':'';}

window.stati.onUpdate(renderUpdate);
bind('update-check',async()=>renderUpdate(await window.stati.checkUpdates()));
async function installUpdate(){if(!confirm('Download the update and restart Stați to install it? The file receiver will close.'))return;renderUpdate(await window.stati.installUpdate());}
bind('update-install',installUpdate);bind('update-shortcut',installUpdate);
bind('identity-update',async()=>{if(identityUpdateAvailable)await installUpdate();else renderUpdate(await window.stati.checkUpdates());});

window.stati.onRequest(()=>{$('requests-panel').hidden=false;$('request-bell').setAttribute('aria-expanded','true');void run(refresh);});

window.stati.onClocksChanged(()=>void run(renderClocks));window.stati.onClockContrastStatus(message=>{$('clock-contrast-status').textContent=message;$('clock-contrast-status').hidden=!message;});

window.stati.onNavigate(section=>{if(privacyAllowed&&(section!=='settings'||adminUnlocked)&&['station','clocks','settings',...workspaceSections,...teamSections].includes(section))tab(section);});
$('rename-computer-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{const input=$('station-name'),button=$('computer-rename');const name=input.value.trim();if(!name){$('computer-saved').textContent='Enter a computer name.';input.focus();return;}computerNameRevision++;button.disabled=true;input.disabled=true;$('computer-saved').textContent='Saving…';try{const result=await window.stati.renameComputer(name);computerNameRevision++;input.value=result.name;$('computer-saved').textContent='Computer name saved.';await refresh();}catch(error){$('computer-saved').textContent=error.message||'Unable to rename this computer.';throw error;}finally{button.disabled=false;input.disabled=false;}});});
let connectionSignature='';function renderConnection(state){const member=operatorChosen?state.members.find(m=>m.id===state.device.operator_id):null;const signature=JSON.stringify(member||null);if(signature===connectionSignature)return;connectionSignature=signature;const target=$('connection');target.replaceChildren();if(!member){target.textContent='Connected';return;}const avatar=el('span',member.first_name[0]+member.last_initial,'avatar');const text=el('span');text.append(el('strong',member.first_name+' '+member.last_initial+'.'),el('small','Connected'));target.append(avatar,text);if(member.has_photo)setAvatarPhoto(avatar,member.id);}

bind('notification-test',async()=>{const result=await window.stati.testNotification();$('notification-status').textContent=result.supported?'Test sent. If no alert appears, enable Stați in notification settings and turn off Do not disturb.':'Notifications are unavailable on this computer.';});bind('notification-settings',()=>window.stati.notificationSettings());window.stati.onNotificationFailed(()=>{$('notification-status').textContent='This computer could not show the alert. Check notification settings and Do not disturb.';});

function resetAdminUnlock(){selectedAdmin=null;clearInterval(unlockTimer);unlockTimer=null;$('admin-unlock').hidden=true;$('operators').hidden=false;$('admin-pin').value='';$('admin-unlock-qr').hidden=true;$('admin-unlock-status').textContent='';}
function cancelAdminUnlock(){void window.stati.cancelOperatorUnlock().catch(()=>{});resetAdminUnlock();}
async function finishOperatorChoice(generation=identityGeneration){if(generation!==identityGeneration)return false;await window.stati.workspaceOpen();if(generation!==identityGeneration)return false;operatorChosen=true;document.documentElement.dataset.workspaceOperator=String(generation);setTeamNavigation(true);window.dispatchEvent(new Event('stati-workspace-change'));document.body.classList.remove('identifying');document.documentElement.classList.remove('identity-fullscreen');$('operator-shade').hidden=true;filesSignature='';return true;}
async function finishAdminUnlock(generation=identityGeneration){if(generation!==identityGeneration)return;resetAdminUnlock();await finishOperatorChoice(generation);await refresh();}
bind('admin-cancel',cancelAdminUnlock);
$('admin-unlock').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
 if(!selectedAdmin||selectedAdmin.role!=='admin'||identityChoicePending)return;
 const generation=identityGeneration,member=selectedAdmin,pin=$('admin-pin').value;
 $('admin-pin').value='';identityChoicePending=true;
 try{await window.stati.operator(member.id,pin);if(generation===identityGeneration&&selectedAdmin===member)await finishAdminUnlock(generation);}
 catch(e){if(generation===identityGeneration){$('admin-unlock-status').textContent=e.message;$('admin-pin').focus();}}
 finally{if(generation===identityGeneration)identityChoicePending=false;}
});});
bind('admin-phone',()=>run(async()=>{
 if(!selectedAdmin)return;
 const generation=identityGeneration,member=selectedAdmin,result=await window.stati.operatorUnlock(member.id);
 if(generation!==identityGeneration||selectedAdmin!==member)return;
 $('admin-unlock-qr').src=result.qr;$('admin-unlock-qr').hidden=false;
 $('admin-unlock-status').textContent='Scan with your phone, then approve with your passkey. This computer unlocks automatically.';
 clearInterval(unlockTimer);let pending=false;
 unlockTimer=setInterval(async()=>{
  if(pending||generation!==identityGeneration||selectedAdmin!==member)return;
  if(Date.now()/1000>result.expiresAt){clearInterval(unlockTimer);$('admin-unlock-status').textContent='Expired. Press Use phone passkey to try again.';return;}
  pending=true;
  try{const state=await window.stati.operatorUnlockStatus(result.token);if(state.approved&&generation===identityGeneration&&selectedAdmin===member)await finishAdminUnlock(generation);}
  catch(e){if(generation===identityGeneration)error(e);}finally{pending=false;}
 },2000);
}));

bind('history-close',()=>{$('record-panel').hidden=true;});bind('history-clear',()=>run(async()=>{await window.stati.clearHistory();filesSignature='';await refresh();}));

bind('diagnostics-check',()=>run(async()=>{$('diagnostics-status').textContent='Checking connection…';const report=await window.stati.connectionDiagnostics();$('diagnostics-status').textContent=report.explanation+' ('+report.latencyMs+' ms)'+(!report.protectedStorage?' Protected local storage is unavailable.':'');}));
bind('diagnostics-export',()=>run(async()=>{const result=await window.stati.exportDiagnostics();if(!result.canceled)$('diagnostics-status').textContent='Connection report saved.';}));

function applyIdentityPresentation(state){
 identityPresentation=state?.presentation==='fullscreen'?'fullscreen':'window';
 if(typeof state?.windowControlsOverlay==='boolean')document.body.classList.toggle('windows-overlay',state.windowControlsOverlay);
 const full=identityPresentation==='fullscreen';
 if(!full||Object.prototype.hasOwnProperty.call(state||{},'backdrop')){const image=full&&typeof state?.backdrop==='string'&&/^data:image\/png;base64,[a-z\d+/=]+$/i.test(state.backdrop)?state.backdrop:null;document.body.classList.toggle('identity-snapshot',!!image);if(image)document.body.style.setProperty('--identity-backdrop','url("'+image+'")');else document.body.style.removeProperty('--identity-backdrop');}
 document.body.classList.toggle('identity-fullscreen',full);
 document.documentElement.classList.toggle('identity-fullscreen',full&&document.body.classList.contains('identifying'));
 if(typeof state?.canSkip==='boolean')identityCanSkip=state.canSkip;
 $('identity-skip').hidden=!identityCanSkip||operatorChosen||!paired||!privacyAllowed;
}
function renderIdentitySettings(settings){
 identitySettingsMode=settings.mode;
 $('identity-mode').value=settings.mode;
 $('identity-schedule').textContent=settings.scheduleSummary||'';
 applyIdentityPresentation(settings);
}
async function loadIdentitySettings(){
 const generation=identityGeneration,revision=identitySettingsRevision,settings=await window.stati.identitySettings();
 if(generation===identityGeneration&&revision===identitySettingsRevision&&adminUnlocked)renderIdentitySettings(settings);
}
$('identity-mode').addEventListener('change',()=>void run(async()=>{
 const input=$('identity-mode'),generation=identityGeneration;
 identitySettingsRevision++;
 input.disabled=true;$('identity-settings-status').textContent='Saving…';
 try{const settings=await window.stati.saveIdentitySettings(input.value);if(generation===identityGeneration&&adminUnlocked){renderIdentitySettings(settings);$('identity-settings-status').textContent='Saved.';}}
 catch(e){input.value=identitySettingsMode;$('identity-settings-status').textContent='Could not save. Try again.';throw e;}
 finally{input.disabled=false;}
}));
async function useIdentityWindow(){applyIdentityPresentation(await window.stati.identityWindowed());}
bind('identity-skip',async()=>{const generation=identityGeneration,result=await window.stati.skipIdentity();if(result.skipped&&generation===identityGeneration){identityGeneration++;clearIdentityContent();applyIdentityPresentation(result);}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&identityPresentation==='fullscreen'&&document.body.classList.contains('identifying')&&!document.querySelector('dialog[open]')){event.preventDefault();void run(useIdentityWindow);}});
window.stati.onIdentityPresentation(applyIdentityPresentation);
window.stati.onWorkspaceReset?.(()=>{delete document.documentElement.dataset.workspaceOperator;setTeamNavigation(false);window.dispatchEvent(new Event('stati-workspace-change'));});
window.stati.onIdentityRequired(()=>void run(()=>requireIdentity()));

bind('changelog',()=>window.stati.openChangelog());

for(const id of ['offline-start','offline-identity']){const button=$(id);if(button)button.addEventListener('click',async()=>{button.disabled=true;try{await window.stati.openOfflineDesk();}catch(error){const target=$('offline-start-error');if(target)target.textContent=error.message;}finally{button.disabled=false;}});}

function renderConnectedPeople(state){const section=$('connected-people');if(!section)return;const visible=operatorChosen&&state.adminUnlocked;section.hidden=!visible;const list=$('connected-people-list');list.replaceChildren();if(!visible)return;for(const person of state.connectedPeople||[]){const row=el('div',undefined,'connected-person'),avatar=el('span',person.first_name[0]+person.last_initial,'avatar');row.append(avatar,el('span',person.first_name+' '+person.last_initial+'.'));if(person.has_photo)setAvatarPhoto(avatar,person.id);list.append(row);}if(!list.children.length)list.append(el('p','No phones or tablets are connected right now.'));}
