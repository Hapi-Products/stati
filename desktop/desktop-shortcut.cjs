const fs=require('node:fs/promises'),path=require('node:path');

// Migrate only once after a successful cleanup. Repeated launches must not
// touch Explorer or remove shortcuts a user deliberately creates afterwards.
async function removeLegacyDesktopShortcuts({executablePath,userData,scriptDirectory=__dirname,execFile=require('node:child_process').execFile}){
 const expected=path.win32.normalize(executablePath).toLowerCase();
 const marker=path.join(userData,'desktop-shortcut-migration.json');
 try{const saved=JSON.parse(await fs.readFile(marker,'utf8'));if(saved.version===1&&saved.executable===expected)return false;}catch{}
 const backupDirectory=path.join(userData,'legacy-desktop-shortcuts');
 const script=path.join(scriptDirectory,'desktop-shortcut.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
 await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-ExecutablePath',executablePath,'-BackupDirectory',backupDirectory],{windowsHide:true,timeout:10000},error=>error?reject(error):resolve()));
 await fs.mkdir(userData,{recursive:true,mode:0o700});
 const temporary=marker+'.'+require('node:crypto').randomUUID()+'.tmp';
 try{await fs.writeFile(temporary,JSON.stringify({version:1,executable:expected})+'\n',{flag:'wx',mode:0o600});await fs.rename(temporary,marker);}finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 return true;
}
module.exports={removeLegacyDesktopShortcuts};
