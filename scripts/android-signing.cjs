const {app,safeStorage,BrowserWindow,ipcMain,dialog}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
app.setName('Stati Signing Tools');
const directory=path.join(os.homedir(),'.local/share/hapi-products/stati/signing/android');
const keyFile=path.join(directory,'stati-release.p12'),passwordFile=path.join(directory,'password.bin'),certificate=path.join(directory,'stati-release.pem');
const exists=async file=>fs.access(file).then(()=>true,()=>false);
function command(program,args,env={}){const result=spawnSync(program,args,{env:{...process.env,...env},encoding:'utf8'});if(result.status!==0)throw new Error(program+' failed. Signing files were preserved; inspect the local tool configuration before retrying.');return result;}
app.whenReady().then(async()=>{
 if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw new Error('Protected OS credential storage is required.');
 await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.chmod(directory,0o700);
 const hasKey=await exists(keyFile),hasPassword=await exists(passwordFile);
 if(hasKey!==hasPassword)throw new Error('Partial signing setup found. Preserve these files and recover the missing component; no key was replaced.');
 let password;
 if(!hasKey){
  password=crypto.randomBytes(32).toString('base64url');
  const pendingPassword=path.join(directory,'password.pending.bin'),pendingKey=path.join(directory,'stati-release.pending.p12');
  if(await exists(pendingPassword)||await exists(pendingKey))throw new Error('An interrupted signing setup exists. Recover the pending files before retrying.');
  await fs.writeFile(pendingPassword,safeStorage.encryptString(password),{mode:0o600,flag:'wx'});
  command('keytool',['-genkeypair','-alias','stati-release','-keyalg','RSA','-keysize','4096','-validity','10000','-dname','CN=Hapi Products, OU=Stati, O=Hapi Products','-storetype','PKCS12','-keystore',pendingKey,'-storepass:env','STATI_TEMP_KEY_PASSWORD','-keypass:env','STATI_TEMP_KEY_PASSWORD'],{STATI_TEMP_KEY_PASSWORD:password});
  await fs.chmod(pendingKey,0o600);await fs.rename(pendingKey,keyFile);await fs.rename(pendingPassword,passwordFile);
 }else password=safeStorage.decryptString(await fs.readFile(passwordFile));
 if(process.argv.includes('--rotate-password')){
  const next=crypto.randomBytes(32).toString('base64url'),pendingKey=path.join(directory,'stati-release.rotation.p12'),pendingPassword=path.join(directory,'password.rotation.bin');
  if(await exists(pendingKey)||await exists(pendingPassword))throw new Error('Pending password rotation found. Recover it before retrying.');
  await fs.copyFile(keyFile,pendingKey,require('node:fs').constants.COPYFILE_EXCL);await fs.chmod(pendingKey,0o600);
  await fs.writeFile(pendingPassword,safeStorage.encryptString(next),{mode:0o600,flag:'wx'});
  command('keytool',['-storepasswd','-keystore',pendingKey,'-storepass:env','STATI_OLD_KEY_PASSWORD','-new:env','STATI_NEW_KEY_PASSWORD'],{STATI_OLD_KEY_PASSWORD:password,STATI_NEW_KEY_PASSWORD:next});
  const exported=command('keytool',['-exportcert','-rfc','-alias','stati-release','-keystore',pendingKey,'-storepass:env','STATI_NEW_KEY_PASSWORD'],{STATI_NEW_KEY_PASSWORD:next});
  const fingerprint=new crypto.X509Certificate(exported.stdout).fingerprint256;
  if(fingerprint!==new crypto.X509Certificate(await fs.readFile(certificate)).fingerprint256)throw new Error('Signing identity changed unexpectedly; original files were preserved.');
  await fs.rename(pendingKey,keyFile);await fs.rename(pendingPassword,passwordFile);password=next;
  console.log('Keystore password replaced; signing identity preserved.');
 }
 if(!await exists(certificate))command('keytool',['-exportcert','-rfc','-alias','stati-release','-keystore',keyFile,'-storepass:env','STATI_TEMP_KEY_PASSWORD','-file',certificate],{STATI_TEMP_KEY_PASSWORD:password});
 const fingerprint=new crypto.X509Certificate(await fs.readFile(certificate)).fingerprint256;
 console.log(JSON.stringify({keystore:keyFile,certificate,sha256:fingerprint,passwordStorage:'OS-protected encrypted file',backupRequired:true},null,2));
 if(process.argv.includes('--build')){
  const executable=process.env.STATI_NODE_BINARY;if(!executable)throw new Error('Run this through scripts/local-android-release.mjs.');
  const result=spawnSync(executable,[path.resolve('scripts/build-android.mjs'),'--release'],{stdio:'inherit',env:{...process.env,STATI_ANDROID_KEYSTORE:keyFile,STATI_ANDROID_STORE_PASSWORD:password,STATI_ANDROID_KEY_ALIAS:'stati-release',STATI_ANDROID_KEY_PASSWORD:password}});
  if(result.status!==0)throw new Error('Signed Android build failed; signing identity was preserved.');
 }
 if(process.argv.includes('--backup')){
  const {encryptBackup,decryptBackup}=require('./signing-backup.cjs');const {fileURLToPath}=require('node:url');const page=path.join(__dirname,'signing-backup.html');
  const window=new BrowserWindow({width:600,height:680,title:'Stați signing recovery',webPreferences:{preload:path.join(__dirname,'signing-backup-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());let busy=false;
  ipcMain.handle('save-signing-recovery',async(event,passphrase,confirmation)=>{
   if(event.sender!==window.webContents||!event.senderFrame||event.senderFrame.processId!==window.webContents.mainFrame.processId||event.senderFrame.routingId!==window.webContents.mainFrame.routingId||!event.senderFrame.url.startsWith('file:')||path.resolve(fileURLToPath(event.senderFrame.url))!==path.resolve(page))throw new Error('Untrusted recovery window.');
   if(busy)throw new Error('A backup is already being saved.');if(typeof passphrase!=='string'||passphrase!==confirmation)throw new Error('The passphrases do not match.');busy=true;
   try{const selected=await dialog.showSaveDialog(window,{title:'Save encrypted signing recovery',defaultPath:path.join(app.getPath('documents'),'Stati-Android-Signing-Recovery.statibackup'),filters:[{name:'Encrypted Stați signing backup',extensions:['statibackup']}]});if(selected.canceled)return{canceled:true};const original=await fs.readFile(keyFile);const payload=Buffer.from(JSON.stringify({version:1,alias:'stati-release',keystore:original.toString('base64'),password,certificate:(await fs.readFile(certificate,'utf8')),sha256:fingerprint}));const encrypted=await encryptBackup(payload,passphrase);payload.fill(0);const checked=JSON.parse((await decryptBackup(encrypted,passphrase)).toString('utf8'));if(!Buffer.from(checked.keystore,'base64').equals(original)||checked.sha256!==fingerprint)throw new Error('Backup verification failed.');await fs.writeFile(selected.filePath,encrypted,{flag:'wx',mode:0o600});return{path:selected.filePath};}finally{busy=false;}
  });await window.loadFile(page);return;
 }
 app.quit();
}).catch(error=>{console.error(error.message);app.exit(1);});

app.on('window-all-closed',()=>app.quit());
