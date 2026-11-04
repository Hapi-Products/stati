// Native Settings only; all authorization and validation also run in main.
(()=>{
 const panel=document.getElementById('settings-panel'),form=document.getElementById('playlist-settings-form');if(!panel||!form)return;
 const by=id=>document.getElementById(id),status=by('playlist-settings-status');let busy=false,revision=0,shared=false;
 function fill(value){shared=value.sharedServices===true;by('playlist-enabled').checked=value.enabled;by('playlist-port').value=String(value.port);by('service-retention').value=value.serviceRetention;by('playlist-clear-items').checked=value.clearPlaylistItems;by('service-retention').disabled=shared;by('playlist-clear-items').disabled=shared;if(shared)status.textContent='Automatic cleanup for shared services is still being prepared. Services and playlists are kept.';}
 function controls(value){for(const element of form.querySelectorAll('input,select,button'))element.disabled=value;if(!value&&shared){by('service-retention').disabled=true;by('playlist-clear-items').disabled=true;}}
 async function load(){if(busy||panel.hidden)return;const request=++revision;try{const value=await window.stati.playlistSettings();if(request===revision&&!panel.hidden)fill(value);}catch(error){if(!panel.hidden)status.textContent=error.message;}}
 form.addEventListener('submit',event=>{event.preventDefault();if(busy)return;busy=true;controls(true);status.textContent='Saving…';void(async()=>{
  try{const value=await window.stati.savePlaylistSettings({enabled:by('playlist-enabled').checked,port:Number(by('playlist-port').value),serviceRetention:by('service-retention').value,clearPlaylistItems:by('playlist-clear-items').checked});if(!value.canceled){fill(value);status.textContent='Saved.';}else status.textContent='Settings unchanged.';}catch(error){status.textContent=error.message;}finally{busy=false;controls(false);}
 })();});
 by('playlist-check').addEventListener('click',()=>{if(busy)return;busy=true;controls(true);status.textContent='Checking ProPresenter…';void window.stati.checkPlaylistConnection().then(result=>{status.textContent=result.message;}).catch(error=>{status.textContent=error.message;}).finally(()=>{busy=false;controls(false);});});
 new MutationObserver(()=>{if(panel.hidden)revision++;else void load();}).observe(panel,{attributes:true,attributeFilter:['hidden']});
})();
