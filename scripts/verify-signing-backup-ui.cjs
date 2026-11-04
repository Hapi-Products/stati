const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const {fileURLToPath}=require('node:url');
const {recoverSigningBackup}=require('./recover-signing-backup.cjs');
const file=process.argv[2];
app.setName('Stați Recovery Verification');
app.whenReady().then(async()=>{
 if(!file)throw new Error('Supply the encrypted backup path.');
 const metadata=await fs.stat(file);if(metadata.size>150000)throw new Error('Backup file is too large.');
 const page=path.join(__dirname,'verify-signing-backup.html');
 const window=new BrowserWindow({width:640,height:650,title:'Verify Stați recovery',webPreferences:{preload:path.join(__dirname,'verify-signing-backup-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());let busy=false;
 ipcMain.handle('verify-signing-recovery',async(event,passphrase)=>{
  const frame=event.senderFrame,main=window.webContents.mainFrame;
  if(event.sender!==window.webContents||!frame||frame.processId!==main.processId||frame.routingId!==main.routingId||!frame.url.startsWith('file:')||path.resolve(fileURLToPath(frame.url))!==path.resolve(page))throw new Error('Untrusted recovery window.');
  if(busy)throw new Error('Verification is already running.');busy=true;
  try{return await recoverSigningBackup(await fs.readFile(file),passphrase);}finally{passphrase='';busy=false;}
 });
 await window.loadFile(page);
});
app.on('window-all-closed',()=>app.quit());
process.on('unhandledRejection',()=>{console.error('Recovery verification could not start. Check the backup path and local tools.');app.exit(1);});
