const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('desktop/main.cjs','utf8');

test('native Skip availability requires a confirmed paired, unlocked device with no chosen operator',()=>{
 let service=true;const context={identityScreen:{status:()=>({presentation:'window',backdrop:null})},process:{platform:'win32'},credential:'paired',identityPairedCredential:'paired',privacyUnlocked:true,sessionLocked:false,quitting:false,activeOperator:null,operatorAwaitingWorkspace:false,identitySkipped:false,identityPolicy:{canSkipIdentity:()=>service}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function identityStatus('),source.indexOf('function sendIdentityPresentation(')),context);
 assert.equal(context.identityStatus().canSkip,true);
 for(const [key,value] of [['credential',null],['identityPairedCredential','unclaimed'],['privacyUnlocked',false],['sessionLocked',true],['quitting',true],['activeOperator',{id:'selected'}],['identitySkipped',true]]){
  const prior=context[key];context[key]=value;assert.equal(context.identityStatus().canSkip,false,key);context[key]=prior;
 }
 service=false;assert.equal(context.identityStatus().canSkip,false);
});

test('availability ticks broadcast only changes and omit the large backdrop payload',()=>{
 const calls=[];let allowed=false,presentation='fullscreen';
 const context={main:{isDestroyed:()=>false,webContents:{send:(...args)=>calls.push(args)}},identityPresentationKey:null,identityStatus:()=>({presentation,windowControlsOverlay:true,canSkip:allowed,backdrop:'data:image/png;base64,'+'A'.repeat(1000000)})};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function sendIdentityPresentation('),source.indexOf('function operatorRequest(')),context);
 context.sendIdentityPresentation();assert.equal(calls.length,1);assert.ok(calls[0][1].backdrop.length>1000000);
 for(let index=0;index<20;index++)context.sendIdentityPresentation({lightweight:true});assert.equal(calls.length,1);
 allowed=true;context.sendIdentityPresentation({lightweight:true});assert.equal(calls.length,2);assert.equal(calls[1][1].canSkip,true);assert.equal(Object.hasOwn(calls[1][1],'backdrop'),false);
 presentation='window';context.sendIdentityPresentation({lightweight:true});assert.equal(calls.length,3);allowed=false;context.sendIdentityPresentation({lightweight:true});assert.equal(calls.length,4);assert.equal(calls[3][1].canSkip,false);
});

test('desktop shell bootstrap never depends on a mobile passcode or nested pairing response',async()=>{
 let handler,unlocks=0;const context={handle:(_name,fn)=>handler=fn,unlockPrivacy:async()=>{unlocks++;return{allowed:true};}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf("handle('access-status'"),source.indexOf("\nhandle('access-unlock'")),context);
 assert.equal((await handler()).allowed,true);assert.equal(unlocks,1);
});
