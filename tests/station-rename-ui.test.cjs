const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
function harness(rename){
 const html=fs.readFileSync('desktop/index.html','utf8'),dialog=html.match(/<dialog id="rename-file-dialog"[\s\S]*?<\/dialog>/)[0];
 const {document,window}=parseHTML('<html><body><div id="station-panel"></div><div id="error" hidden></div><p id="file-action-status"></p><div id="files"></div><div id="delivery-record"></div>'+dialog+'</body></html>');
 const box=document.getElementById('rename-file-dialog');box.showModal=()=>box.setAttribute('open','');box.close=()=>{box.removeAttribute('open');box.dispatchEvent(new window.Event('close'));};document.getElementById('rename-file-stem').select=()=>{};
 const files=[{id:'fixture',filename:'original.txt',bytes:32,status:'delivered',created_at:1,first_name:'Fixture sender',last_initial:'F',saved:true}];
 const context={document,fileNamesRevision:0,window:{stati:{renameFile:rename}},IntersectionObserver:class{observe(){}disconnect(){}},refresh:async()=>{}};vm.createContext(context);
 const source=fs.readFileSync('desktop/renderer.js','utf8');
 vm.runInContext(source.slice(source.indexOf('const $='),source.indexOf('let privacyAllowed='))+source.slice(source.indexOf('function error('),source.indexOf('function tab('))+source.slice(source.indexOf("let filesSignature="),source.indexOf("bind('request-bell'"))+source.slice(source.indexOf("bind('rename-file-cancel'"),source.indexOf("bind('requests-close'")),context);
 context.renderFiles(files);return{document,window,box};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('renaming keeps the saved card, sender, original filename and icon tooltip; cancel does not call rename',async()=>{
 const calls=[],{document,window,box}=harness(async(id,stem)=>{calls.push([id,stem]);return{filename:stem+'.txt'};});const clickRename=()=>document.querySelector('[aria-label="Rename"]').click();
 assert.equal(document.querySelector('[aria-label="Rename"]').title,'Rename');assert.ok(document.querySelector('[aria-label="Rename"] svg'));
 clickRename();await settle();assert.equal(document.getElementById('rename-file-stem').value,'original');assert.equal(document.getElementById('rename-file-extension').textContent,'.txt');document.getElementById('rename-file-cancel').click();await settle();assert.equal(calls.length,0);assert.equal(box.hasAttribute('open'),false);
 clickRename();await settle();document.getElementById('rename-file-stem').value='Cântare';document.getElementById('rename-file-form').dispatchEvent(new window.Event('submit',{cancelable:true}));await settle();assert.deepEqual(calls,[['fixture','Cântare']]);assert.equal(document.querySelectorAll('.delivery-card').length,1);assert.equal(document.querySelector('.delivery-card h2').textContent,'Cântare.txt');assert.match(document.querySelector('.delivery-card .sender').textContent,/Fixture sender/);assert.equal(document.querySelector('.original-file-name').textContent,'Sent as: original.txt');assert.match(document.getElementById('delivery-record').textContent,/Sent as: original.txt/);assert.equal(box.hasAttribute('open'),false);assert.equal(document.getElementById('file-action-status').textContent,'File renamed.');
});
test('rename failure leaves the dialog retryable and saved file visible',async()=>{const {document,window,box}=harness(async()=>{throw Error('A file with that name already exists.');});document.querySelector('[aria-label="Rename"]').click();await settle();document.getElementById('rename-file-form').dispatchEvent(new window.Event('submit',{cancelable:true}));await settle();assert.equal(box.hasAttribute('open'),true);assert.match(document.getElementById('rename-file-error').textContent,/already exists/);assert.equal(document.getElementById('rename-file-save').disabled,false);assert.equal(document.querySelector('.delivery-card h2').textContent,'original.txt');});
