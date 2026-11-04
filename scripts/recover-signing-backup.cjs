const {readFile,writeFile,mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {X509Certificate}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {decryptBackup}=require('./signing-backup.cjs');
const EXPECTED_FINGERPRINT='21:90:4A:A3:1E:1F:DD:BC:44:14:4B:34:BA:1D:81:0B:47:85:96:C1:0C:23:5F:A3:05:83:B4:5B:7C:B7:1C:C0';
async function recoverSigningBackup(encrypted,passphrase){
 const decoded=await decryptBackup(encrypted,passphrase);let payload;
 try{payload=JSON.parse(decoded.toString('utf8'));}finally{decoded.fill(0);}
 let directory;
 try{
  if(!payload||payload.version!==1||payload.alias!=='stati-release'||typeof payload.password!=='string'||payload.password.length>1024||typeof payload.keystore!=='string'||payload.keystore.length>100000)throw new Error('Unsupported signing backup payload.');
  if(payload.sha256!==EXPECTED_FINGERPRINT)throw new Error('This backup is not the expected Stați signing identity.');
  directory=await mkdtemp(join(tmpdir(),'stati-recovery-check-'));
  const key=join(directory,'recovered.p12'),certificate=join(directory,'recovered.pem'),csr=join(directory,'recovery-proof.csr');
  await writeFile(key,Buffer.from(payload.keystore,'base64'),{mode:0o600});
  const execute=args=>{const result=spawnSync('keytool',args,{env:{...process.env,STATI_RECOVERED_KEY_PASSWORD:payload.password},encoding:'utf8',timeout:30000,maxBuffer:65536,windowsHide:true});if(result.status!==0)throw new Error('The recovered key could not be verified. Check that a Java JDK with keytool is installed.');};
  execute(['-exportcert','-rfc','-alias',payload.alias,'-keystore',key,'-storepass:env','STATI_RECOVERED_KEY_PASSWORD','-file',certificate]);
  const fingerprint=new X509Certificate(await readFile(certificate)).fingerprint256;
  if(fingerprint!==EXPECTED_FINGERPRINT)throw new Error('The recovered certificate is not the expected Stați signing identity.');
  execute(['-certreq','-alias',payload.alias,'-keystore',key,'-storepass:env','STATI_RECOVERED_KEY_PASSWORD','-keypass:env','STATI_RECOVERED_KEY_PASSWORD','-file',csr]);
  return {fingerprint,privateKeySigningVerified:true};
 }finally{if(payload){payload.password='';payload.keystore='';}if(directory)await rm(directory,{recursive:true,force:true});}
}
module.exports={recoverSigningBackup,EXPECTED_FINGERPRINT};
