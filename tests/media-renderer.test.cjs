const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(play){
 const {window,document}=parseHTML(fs.readFileSync('desktop/index.html','utf8')),events=[];
 for(const dialog of document.querySelectorAll('dialog')){dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>{if(dialog.hasAttribute('open')){dialog.removeAttribute('open');dialog.dispatchEvent(new window.Event('close'));}};Object.defineProperty(dialog,'open',{get:()=>dialog.hasAttribute('open')});}
 for(const player of document.querySelectorAll('audio,video')){Object.defineProperty(player,'src',{get:()=>player.getAttribute('src')||'',set:value=>player.setAttribute('src',value)});player.pause=()=>events.push(['pause',player.id]);player.load=()=>events.push(['load',player.id]);player.play=()=>{events.push(['play',player.id]);throw Error('Playback must require a real user gesture.');};}
 window.stati={};window.statiThumbnail=async()=>({text:'Preview text'});window.statiPlayPreview=play;
 const source=fs.readFileSync('desktop/renderer.js','utf8'),fragment=source.slice(source.indexOf('let filesSignature='),source.indexOf("bind('request-bell'"))+source.slice(source.indexOf("bind('media-preview-close'"),source.indexOf("bind('rename-file-cancel'"));
 const context={window,document,console,setTimeout,clearTimeout,IntersectionObserver:class{observe(){}disconnect(){}},events};vm.createContext(context);
 vm.runInContext("let identityGeneration=0;const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};const run=fn=>fn();function bind(id,fn){$(id).addEventListener('click',fn);}"+fragment,context);
 return{document,window,events,run:script=>vm.runInContext(script,context)};
}
const file={id:'test-video',filename:'Service clip.mp4',content_type:'video/mp4',status:'queued',bytes:100,created_at:1792342800,first_name:'Local fixture',last_initial:'T'};
test('video Preview keeps its inbox card, starts muted without play and releases the URL when closed',async()=>{
 let releases=0;const f=fixture(async()=>({url:'blob:local-fixture',mediaType:'video',release(){releases++;}}));f.run('renderFiles('+JSON.stringify([file])+')');
 const button=f.document.querySelector('[aria-label="Preview video: Service clip.mp4"]');assert.equal(button.title,'Preview video');button.click();await flush();
 const player=f.document.getElementById('media-preview-video');assert.equal(f.document.getElementById('media-preview-dialog').open,true);assert.equal(player.muted,true);assert.equal(player.getAttribute('src'),'blob:local-fixture');assert.equal(f.events.some(event=>event[0]==='play'),false);assert.equal(f.document.querySelectorAll('.delivery-card').length,1);
 player.dispatchEvent(new f.window.Event('loadedmetadata'));assert.match(f.document.getElementById('media-preview-status').textContent,/Use Play.*muted/);
 f.document.getElementById('media-preview-close').click();assert.equal(releases,1);assert.equal(player.hasAttribute('src'),false);assert.equal(f.document.querySelectorAll('.delivery-card').length,1);assert.equal(f.document.getElementById('media-preview-dialog').open,false);
});
test('closing or switching identity during a pending media read discards its late URL',async()=>{
 for(const action of ['close','identity']){let resolve,releases=0;const f=fixture(()=>new Promise(done=>resolve=done));const pending=f.run('openMediaPreview('+JSON.stringify(file)+')');await flush();
  if(action==='identity')f.run('identityGeneration++;closeMediaPreview();');else f.document.getElementById('media-preview-close').click();resolve({url:'blob:stale',mediaType:'video',release(){releases++;}});await pending;
  assert.equal(releases,1,action);assert.equal(f.document.getElementById('media-preview-video').hasAttribute('src'),false);assert.equal(f.document.getElementById('media-preview-dialog').open,false);
 }
});
test('codec errors retain Save/Open guidance and rejecting or removing a file closes its player',async()=>{
 let releases=0;const f=fixture(async()=>({url:'blob:codec-fixture',mediaType:'video',release(){releases++;}}));f.run('renderFiles('+JSON.stringify([file])+')');await f.run('openMediaPreview('+JSON.stringify(file)+')');
 f.document.getElementById('media-preview-video').dispatchEvent(new f.window.Event('error'));assert.match(f.document.getElementById('media-preview-status').textContent,/Save it and use Open/);assert.equal(f.document.querySelectorAll('.delivery-card').length,1);
 f.run('renderFiles('+JSON.stringify([{...file,status:'rejected',rejection_reason:'Wrong version'}])+')');assert.equal(releases,1);assert.equal(f.document.querySelectorAll('.delivery-card').length,0);assert.equal(f.document.getElementById('media-preview-dialog').open,false);assert.match(f.document.getElementById('delivery-record').textContent,/Wrong version/);
});
