const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
test('file actions retain delivered cards with sender identity and accessible icons; rejected cards leave the grid',async()=>{
 const {document}=parseHTML('<html><body><div id="files"></div><div id="delivery-record"></div></body></html>');
 let disconnected=0;const calls=[];let files=[{id:'test-file',filename:'lyrics.txt',bytes:100,status:'queued',created_at:1,sender_id:'test-sender',first_name:'Sender',last_initial:'S',saved:false}];
 const context={document,window:{stati:{deliver:async()=>{files=files.map(f=>({...f,status:'delivered',saved:true}));},openFile:async()=>calls.push('open'),revealFile:async()=>calls.push('folder'),copyFile:async()=>calls.push('copy'),emailFile:async()=>calls.push('email'),prepareFile:async()=>calls.push('prepare')}},IntersectionObserver:class{observe(){}disconnect(){disconnected++;}},run:async fn=>fn(),refresh:async()=>context.renderFiles(files)};
 vm.createContext(context);
 const source=fs.readFileSync('desktop/renderer.js','utf8');
 vm.runInContext(source.slice(source.indexOf('const $='),source.indexOf('let privacyAllowed='))+source.slice(source.indexOf("let filesSignature="),source.indexOf("bind('request-bell'")),context);
 context.renderFiles(files);
 assert.match(document.querySelector('.sender').textContent,/Sender S\./);
 const save=document.querySelector('[aria-label="Save"]');assert.ok(save.querySelector('svg'));save.click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(document.querySelectorAll('.delivery-card').length,1);assert.ok(disconnected>0);
 assert.match(document.querySelector('.delivery-card').textContent,/Saved on computer/);
 for(const action of ['Open','Show in folder','Save a copy','Email…','Prepare slides']){const button=document.querySelector('[aria-label="'+action+'"]');assert.ok(button.querySelector('svg'));button.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(document.querySelectorAll('.delivery-card').length,1);}
 assert.deepEqual(calls,['open','folder','copy','email','prepare']);
 context.renderFiles(files.map(f=>({...f,status:'rejected'})));
 assert.equal(document.querySelectorAll('.delivery-card').length,0);assert.match(document.getElementById('delivery-record').textContent,/rejected/);
});

test('file search matches Romanian names, dates and status without changing the source history',()=>{const {document}=parseHTML('<html><body></body></html>');const source=fs.readFileSync('desktop/renderer.js','utf8');const context={document};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function matchingFiles('),source.indexOf('function renderFiles(')),context);const files=[{filename:'Cântare.txt',original_filename:'Sunday notes.txt',first_name:'Ștefan',last_initial:'M',status:'delivered',created_at:Date.parse('2026-10-18T12:00:00Z')/1000},{filename:'Other.pdf',first_name:'Jane',status:'queued',created_at:1}];assert.equal(context.matchingFiles(files,'cantare stefan','delivered').length,1);assert.equal(context.matchingFiles(files,'2026-10-18','all').length,1);assert.equal(context.matchingFiles(files,'cantare','queued').length,0);assert.equal(context.matchingFiles(files,'Sunday notes','all').length,1);assert.equal(files.length,2);});

test('expired or unavailable remote cards stay visible without failing Save/Reject buttons, while saved copies keep local actions',()=>{
 const {document}=parseHTML('<html><body><div id="files"></div><div id="delivery-record"></div></body></html>');let previews=0;
 const context={document,window:{stati:{}},IntersectionObserver:class{observe(){previews++;}disconnect(){}},run:async fn=>fn(),refresh:async()=>{}};vm.createContext(context);const source=fs.readFileSync('desktop/renderer.js','utf8');vm.runInContext(source.slice(source.indexOf('const $='),source.indexOf('let privacyAllowed='))+source.slice(source.indexOf('let filesSignature='),source.indexOf("bind('request-bell'")),context);
 const base={id:'isolated-file',filename:'song.txt',bytes:10,status:'queued',created_at:1,first_name:'Sender',last_initial:'T',remoteAvailable:false};
 for(const status of ['queued','expired','unavailable']){context.renderFiles([{...base,status}]);assert.equal(document.querySelectorAll('.delivery-card').length,1);assert.equal(document.querySelectorAll('.file-action').length,0);assert.match(document.querySelector('.sender').textContent,/Sender/);}
 assert.equal(previews,0);context.renderFiles([{...base,status:'expired',saved:true}]);assert.match(document.querySelector('.delivery-card').textContent,/Saved copy on computer · expired/);for(const action of ['Open','Show in folder','Rename','Save a copy','Email…','Prepare slides'])assert.ok(document.querySelector('[aria-label="'+action+'"]'));assert.equal(document.querySelector('[aria-label="Save"]'),null);assert.equal(document.querySelector('[aria-label="Reject"]'),null);assert.equal(previews,1);
});
