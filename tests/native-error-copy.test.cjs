const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('native errors retain their recovery message without exposing Electron IPC boilerplate',async()=>{
 let bridge;const source=fs.readFileSync('desktop/preload.cjs','utf8');
 vm.runInNewContext(source,{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value;}},ipcRenderer:{invoke:async channel=>{const error=Error(channel==='powerpoint-changes'?"Error invoking remote method 'powerpoint-changes': Error: The two files have different lyrics. Review both songs before linking.":'Unlock your profile before opening this song.');error.code='REVIEW_REQUIRED';throw error;}}}),process:{platform:'win32'}});
 await assert.rejects(bridge.powerPointChanges(),{message:'The two files have different lyrics. Review both songs before linking.',code:'REVIEW_REQUIRED'});
 await assert.rejects(bridge.librarySongInfo('fixture'),{message:'Unlock your profile before opening this song.'});
});
