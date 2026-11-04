const {execFile}=require('node:child_process');
const path=require('node:path');
function verifyExecutable(publishers,executable,{run=execFile,systemRoot=process.env.SystemRoot}={}){
 return new Promise(resolve=>{
  if(!Array.isArray(publishers)||!publishers.length||publishers.some(p=>typeof p!=='string'||!p.trim())||typeof executable!=='string'||!path.win32.isAbsolute(executable)||!systemRoot||!path.win32.isAbsolute(systemRoot)){resolve('Signature verification configuration is invalid.');return;}
  const powershell=path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'verify-signature.ps1').replace(/([\\/])app\.asar([\\/])/,'$1app.asar.unpacked$2'),'-ExecutablePath',executable],{windowsHide:true,timeout:30000,maxBuffer:16384},(error,stdout)=>{
   if(error){resolve('Windows could not verify the executable signature.');return;}
   try{const result=JSON.parse(stdout.replace(/^\uFEFF/,''));resolve(result.status==='Valid'&&publishers.some(p=>p===result.subject||p===result.name)?null:'Executable signer does not match the configured publisher.');}catch{resolve('Windows returned an invalid signature verification result.');}
  });
 });
}
module.exports={verifyExecutable};
