const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('signingRecovery',Object.freeze({verify:passphrase=>ipcRenderer.invoke('verify-signing-recovery',passphrase)}));
