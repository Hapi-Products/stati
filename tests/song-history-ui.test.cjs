const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('esbuild'),{parseHTML}=require('linkedom');
const songId='a'.repeat(64),currentHash='b'.repeat(64),oldHash='c'.repeat(64),olderHash='d'.repeat(64);
const saved=(hash=oldHash)=>({hash,savedAt:1792778400000,bytes:200});
const history=()=>({songId,title:'Împreună cântăm',currentHash,currentText:'Current lyric\nA changed second line',versions:[saved(),saved(olderHash)],truncated:false});
const preview=hash=>({...history(),version:{...saved(hash),text:hash===oldHash?'Earlier lyric\nOriginal second line':'Another saved version'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function ui({bridge={},props={}}={},check){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),previous={window:global.window,document:global.document,navigator:global.navigator,act:global.IS_REACT_ACT_ENVIRONMENT};
 Object.assign(global,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});window.location=new URL('https://isolated.invalid/');Object.defineProperty(global,'navigator',{configurable:true,value:window.navigator});
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),filename=path.resolve('src/desktop/SongHistory.tsx'),loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));const original=loaded.require.bind(loaded);loaded.require=name=>name.endsWith('.css')?{}:original(name);loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code,filename);
 const calls={list:[],preview:[],restore:[],restored:[],closed:0},api={listSongVersions:async id=>{calls.list.push(id);return history();},previewSongVersion:async(...args)=>{calls.preview.push(args);return preview(args[2]);},restoreSongVersion:async(...args)=>{calls.restore.push(args);return{path:'/local/original.pro',title:history().title,contentHash:args[2]};},...bridge};
 const root=createRoot(document.getElementById('root')),defaults={songId,title:history().title,bridge:api,disabled:false,onClose:()=>calls.closed++,onRestored:(...args)=>calls.restored.push(args),...props};
 const render=async extra=>act(async()=>root.render(React.createElement(loaded.exports.SongHistory,{...defaults,...extra}))),button=name=>[...document.querySelectorAll('button')].find(element=>(element.getAttribute('aria-label')||element.textContent)===name),version=index=>document.querySelectorAll('.song-history-versions button')[index];
 const click=async element=>{assert.ok(element,'Expected control');assert.equal(element.disabled,false);await act(async()=>element.dispatchEvent(new window.Event('click',{bubbles:true})));};
 const unmount=()=>act(async()=>root.render(null));
 try{await render();await check({document,window,act,calls,render,button,version,click,unmount,text:()=>document.body.textContent});}
 finally{await act(async()=>root.unmount());Object.assign(global,{window:previous.window,document:previous.document,IS_REACT_ACT_ENVIRONMENT:previous.act});Object.defineProperty(global,'navigator',{configurable:true,value:previous.navigator});}
}
test('history compares current and earlier lyrics and restores only the previewed version with the captured current hash',async()=>{
 await ui({},async({document,calls,button,version,click,text})=>{
  assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-modal'),'true');assert.equal(button('Restore this version').disabled,true);assert.match(text(),/Your current version will also remain/);
  await click(version(0));assert.match(document.querySelector('[aria-label="Current lyrics"]').textContent,/Current lyric/);assert.match(document.querySelector('[aria-label="Earlier lyrics"]').textContent,/Earlier lyric/);assert.deepEqual(calls.preview,[[songId,currentHash,oldHash]]);
  await click(button('Restore this version'));assert.deepEqual(calls.restore,[[songId,currentHash,oldHash]]);assert.deepEqual(calls.restored,[[songId,oldHash]]);assert.match(text(),/Version restored/);assert.equal(calls.list.length,2);assert.equal(button('Restore this version').disabled,true);
 });
});
test('a pending restore rejects repeated presses and cannot close until it settles',async()=>{
 const held=deferred();let restores=0;
 await ui({bridge:{restoreSongVersion:async()=>{restores++;return held.promise;}}},async({click,button,version,act,window,calls})=>{
  await click(version(0));const target=button('Restore this version');await act(async()=>{target.dispatchEvent(new window.Event('click',{bubbles:true}));target.dispatchEvent(new window.Event('click',{bubbles:true}));});assert.equal(restores,1);assert.equal(button('Close song history').disabled,true);assert.equal(button('Restoring…').disabled,true);
  await act(async()=>held.resolve({path:'/local/song.pro',title:history().title,contentHash:oldHash}));assert.equal(calls.restored.length,1);assert.equal(button('Close song history').disabled,false);
 });
});
test('failed preview retains current lyrics and never enables restoration of unverified bytes',async()=>{
 await ui({bridge:{previewSongVersion:async()=>{throw Error('Saved version checksum changed.');}}},async({click,version,button,text,calls})=>{
  await click(version(0));assert.match(text(),/checksum changed/);assert.match(text(),/Current lyric/);assert.equal(button('Restore this version').disabled,true);assert.equal(calls.restore.length,0);
 });
});
test('a stale-current restore failure leaves both comparisons visible and supports explicit retry',async()=>{
 await ui({bridge:{restoreSongVersion:async()=>{throw Error('This song changed. Refresh its history.');}}},async({click,version,button,document,text,calls})=>{
  await click(version(0));await click(button('Restore this version'));assert.match(text(),/Refresh its history/);assert.match(document.querySelector('[aria-label="Earlier lyrics"]').textContent,/Earlier lyric/);assert.equal(calls.restored.length,0);assert.equal(button('Restore this version').disabled,false);
 });
});
test('switching bridge or disabling the view ignores old private history and preview responses',async()=>{
 const late=deferred(),heldPreview=deferred();
 await ui({bridge:{listSongVersions:()=>late.promise}},async({render,act,click,version,button,text})=>{
  const next={listSongVersions:async()=>({...history(),title:'Current account song'}),previewSongVersion:()=>heldPreview.promise,restoreSongVersion:async()=>{throw Error('Must not restore');}};await render({bridge:next});assert.match(text(),/Current account song/);await act(async()=>late.resolve({...history(),title:'Private old account title'}));assert.doesNotMatch(text(),/Private old account/);
  await click(version(0));await render({bridge:next,disabled:true});await act(async()=>heldPreview.resolve(preview(oldHash)));assert.doesNotMatch(text(),/Earlier lyric/);assert.equal(button('Restore this version'),undefined);
 });
});
test('empty history gives guidance and unmount ignores a late list without changing the page',async()=>{
 await ui({bridge:{listSongVersions:async()=>({...history(),versions:[]})}},async({text,button})=>{assert.match(text(),/No earlier saves yet/);assert.equal(button('Restore this version').disabled,true);});
 const held=deferred();await ui({bridge:{listSongVersions:()=>held.promise}},async({unmount,act,document})=>{await unmount();await act(async()=>held.resolve(history()));assert.equal(document.getElementById('root').textContent,'');});
});
