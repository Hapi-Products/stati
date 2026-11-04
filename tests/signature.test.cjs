const {test}=require('node:test'),assert=require('node:assert/strict');
const {verifyExecutable}=require('../desktop/signature.cjs');
const options={systemRoot:'C:\\Windows'};
test('signature verification requires valid Windows trust and an exact approved publisher',async()=>{
 for(const result of [{status:'Valid',name:'Hapi Products',subject:'CN=Hapi Products'},{status:'NotTrusted',name:'Hapi Products'},{status:'Valid',name:'Hapi Products Other'},{status:'Valid',subject:'CN=Hapi Products, O=Other'}]){
 const answer=await verifyExecutable(['Hapi Products'],'C:\\Downloads\\Stati.exe',{...options,run:(file,args,opts,done)=>{assert.equal(file,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');assert.ok(args.includes('-File'));assert.equal(args.at(-1),'C:\\Downloads\\Stati.exe');assert.equal(opts.timeout,30000);done(null,JSON.stringify(result));}});
 assert.equal(answer===null,result.status==='Valid'&&result.name==='Hapi Products');
 }
});
test('missing PowerShell, timeouts, malformed output, and missing configuration fail closed',async()=>{
 for(const [error,output] of [[new Error('ENOENT'),''],[new Error('Timeout'),''],[null,'not JSON'],[null,'null'],[null,'{}']])assert.ok(await verifyExecutable(['Hapi Products'],'C:\\Stati.exe',{...options,run:(_f,_a,_o,done)=>done(error,output)}));
 let invoked=false;assert.ok(await verifyExecutable([],'C:\\Stati.exe',{...options,run:()=>{invoked=true;}}));assert.equal(invoked,false);
});
