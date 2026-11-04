const base=require('./builder.json');
const provider=process.env.STATI_WINDOWS_SIGNING_PROVIDER;
const config={...base,forceCodeSigning:true,directories:{output:'release/windows-production'},win:{...base.win}};
if(provider==='azure'){
 if(process.platform!=='win32')throw new Error('Azure signing with electron-builder 26 must run on a Windows signing host.');
 const required=['STATI_AZURE_SIGNING_ENDPOINT','STATI_AZURE_SIGNING_ACCOUNT','STATI_AZURE_CERTIFICATE_PROFILE','STATI_WINDOWS_PUBLISHER','AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET'];
 for(const name of required)if(!process.env[name])throw new Error('Missing signing configuration: '+name);
 config.win.azureSignOptions={endpoint:process.env.STATI_AZURE_SIGNING_ENDPOINT,codeSigningAccountName:process.env.STATI_AZURE_SIGNING_ACCOUNT,certificateProfileName:process.env.STATI_AZURE_CERTIFICATE_PROFILE,publisherName:process.env.STATI_WINDOWS_PUBLISHER,fileDigest:'SHA256',timestampDigest:'SHA256'};
}else if(provider==='certificate'){
 if(!(process.env.CSC_LINK||process.env.WIN_CSC_LINK)||!(process.env.CSC_KEY_PASSWORD||process.env.WIN_CSC_KEY_PASSWORD))throw new Error('Supply the validated Windows certificate and password through CSC_LINK/CSC_KEY_PASSWORD.');
}else throw new Error('Select an identity-validated Windows signing provider before a production build.');
module.exports=config;
