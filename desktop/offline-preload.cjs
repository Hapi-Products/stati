const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('offline',{
 platform:typeof process==='object'?process.platform:'unknown',
 choose:()=>ipcRenderer.invoke('offline-copy-choose'),unlock:(id,passphrase)=>ipcRenderer.invoke('offline-copy-unlock',{id,passphrase}),audio:input=>ipcRenderer.invoke('offline-copy-audio',input),lock:()=>ipcRenderer.invoke('offline-copy-lock'),
 onLocked:callback=>{const listener=()=>callback();ipcRenderer.on('offline-locked',listener);return()=>ipcRenderer.removeListener('offline-locked',listener);},
});
