const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('esbuild'),{parseHTML}=require('linkedom');
const entry=(overrides={})=>({id:'a'.repeat(64),contentHash:'b'.repeat(64),title:'Împreună cântăm',filename:'private-original.pro',category:'Worship',addedAt:100000,modifiedAt:200000,fontSize:96,firstLine:'Opening lyric',firstSlide:'Opening lyric\nSecond opening line',lyricPreview:'Later matching verse',editable:true,favorite:false,...overrides});
const results=items=>({items,total:items.length,scanned:items.length,categories:['Worship'],unreadable:0,warnings:[],offset:0});
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};};
async function withLibrary({bridge={},props={}}={},check){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),old={window:global.window,document:global.document,navigator:global.navigator,act:global.IS_REACT_ACT_ENVIRONMENT};
 global.window=window;global.document=window.document;Object.defineProperty(global,'navigator',{configurable:true,value:window.navigator});global.IS_REACT_ACT_ENVIRONMENT=true;window.location=new URL('http://127.0.0.1/');window.document.oninput=null;
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),filename=path.resolve(__dirname,'../src/desktop/SongLibrary.tsx'),loaded=new Module(filename,module);
 loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));const localRequire=loaded.require.bind(loaded);loaded.require=name=>{if(name.endsWith('.css'))return{};if(name==='./SongHistory'){const childFile=path.resolve(path.dirname(filename),'SongHistory.tsx'),child=new Module(childFile,module);child.filename=childFile;child.paths=loaded.paths;const childRequire=child.require.bind(child);child.require=value=>value.endsWith('.css')?{}:childRequire(value);child._compile(transformSync(fs.readFileSync(childFile,'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code,childFile);return child.exports;}return localRequire(name);};
 loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code,filename);
 const calls={search:[],open:[],favorite:[]},api={searchSongLibrary:async filter=>{calls.search.push(filter);return results([entry()]);},favoriteSong:async(...args)=>{calls.favorite.push(args);},...bridge};window.stati=api;
 const root=createRoot(window.document.getElementById('root')),defaults={embedded:true,disabled:false,onOpen:async id=>{calls.open.push(id);},...props};
 const render=async extra=>act(async()=>root.render(React.createElement(loaded.exports.SongLibrary,{...defaults,...extra})));
 const button=name=>[...window.document.querySelectorAll('button')].find(element=>(element.getAttribute('aria-label')||element.textContent)===name);
 const click=async element=>{assert.ok(element,'Expected UI control');assert.equal(element.disabled,false);await act(async()=>element.dispatchEvent(new window.Event('click',{bubbles:true})));};
 const edit=async value=>{const input=window.document.querySelector('input[type="search"]'),descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value');if(descriptor?.set)descriptor.set.call(input,value);else input.value=value;await act(async()=>input.dispatchEvent(new window.Event('input',{bubbles:true})));};
 try{await render();await check({window,document:window.document,act,calls,render,button,click,edit});}
 finally{await act(async()=>root.unmount());global.window=old.window;global.document=old.document;Object.defineProperty(global,'navigator',{configurable:true,value:old.navigator});global.IS_REACT_ACT_ENVIRONMENT=old.act;}
}

test('library opens immediately with real first-slide lyrics, labeled actions and list/grid layouts',async()=>{
 await withLibrary({},async({document,calls,button,click})=>{
  assert.equal(calls.search.length,1);assert.equal(calls.search[0].query,'');assert.equal(button('Find songs'),undefined);assert.equal(button('Search / refresh'),undefined);
  const card=document.querySelector('.song-library-card');assert.ok(card);assert.equal(card.querySelector('.library-slide-preview p').textContent,entry().firstSlide);assert.equal(card.querySelector('.library-slide-preview svg'),null);assert.doesNotMatch(card.textContent,/Later matching|private-original/);
  assert.ok(card.querySelector('.library-slide-preview p').style.fontSize.endsWith('cqw'));assert.ok(document.querySelector('.song-library-list'));assert.equal(document.querySelector('[aria-label=Language]'),null);
  await click(button('List'));assert.ok(document.querySelector('.song-library-list'));assert.equal(button('List').getAttribute('aria-pressed'),'true');
  await click(button('Grid'));assert.ok(document.querySelector('.song-library-grid'));await click(button('Favorite: '+entry().title));assert.deepEqual(calls.favorite,[[entry().id,true]]);
  await click(button('Edit lyrics'));assert.deepEqual(calls.open,[entry().id]);
 });
});

test('live search debounces, keeps the input editable and ignores old results and errors',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});const pending=new Map(),queries=[];
 await withLibrary({bridge:{searchSongLibrary:filter=>{queries.push(filter.query);if(!filter.query)return Promise.resolve(results([entry()]));const held=deferred();pending.set(filter.query,held);return held.promise;}}},async({document,act,edit})=>{
  await edit('old');await act(async()=>context.mock.timers.tick(180));assert.ok(pending.has('old'));assert.equal(document.querySelector('input[type="search"]').disabled,false);
  await edit('new');await act(async()=>context.mock.timers.tick(179));assert.equal(pending.has('new'),false);await act(async()=>context.mock.timers.tick(1));assert.ok(pending.has('new'));
  await act(async()=>pending.get('new').resolve(results([entry({title:'New matching song'})])));assert.match(document.querySelector('.song-library-card').textContent,/New matching song/);
  await act(async()=>pending.get('old').reject(Error('Old failure must be ignored')));assert.equal(document.querySelector('[role="alert"]'),null);assert.match(document.querySelector('.song-library-card').textContent,/New matching song/);assert.deepEqual(queries,['','old','new']);
  await edit('old-success');await act(async()=>context.mock.timers.tick(180));await edit('fresh');await act(async()=>context.mock.timers.tick(180));
  await act(async()=>pending.get('fresh').resolve(results([entry({title:'Fresh result'})])));await act(async()=>pending.get('old-success').resolve(results([entry({title:'Stale successful result'})])));
  assert.match(document.querySelector('.song-library-card').textContent,/Fresh result/);assert.doesNotMatch(document.querySelector('.song-library-card').textContent,/Stale successful/);
 });
});

test('inactive or disabled library fences late searches, and read-only profiles use View lyrics',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});const held=deferred();
 await withLibrary({bridge:{searchSongLibrary:filter=>filter.query?held.promise:Promise.resolve(results([entry()]))},props:{readOnly:true}},async({document,act,button,click,edit,render,calls})=>{
  assert.equal(button('Edit lyrics'),undefined);await click(button('View lyrics'));assert.deepEqual(calls.open,[entry().id]);
  await edit('held');await act(async()=>context.mock.timers.tick(180));await render({active:false});await act(async()=>held.resolve(results([entry({title:'Late inactive song'})])));
  assert.doesNotMatch(document.querySelector('.song-library-card').textContent,/Late inactive/);
  await render({disabled:true});assert.equal(document.querySelector('input[type="search"]').disabled,true);
 });
});

test('a phone-supplied library bridge searches and favorites without using the native desktop bridge',async()=>{
 const calls={search:[],favorite:[]};let favorite=false;const bridge={searchSongLibrary:async filter=>{calls.search.push(filter);return results([entry({favorite})]);},favoriteSong:async(id,value)=>{calls.favorite.push([id,value]);favorite=value;}};
 await withLibrary({props:{bridge}},async({calls:native,button,click})=>{
  assert.equal(calls.search.length,1);assert.equal(native.search.length,0);await click(button('Favorite: '+entry().title));assert.deepEqual(calls.favorite,[[entry().id,true]]);assert.equal(native.favorite.length,0);assert.equal(button('Remove favorite: '+entry().title).getAttribute('aria-pressed'),'true');
 });
});

test('changing the supplied computer bridge discards a late response from the preceding computer',async()=>{
 const old=deferred(),oldBridge={searchSongLibrary:()=>old.promise,favoriteSong:async()=>{}},newBridge={searchSongLibrary:async()=>results([entry({title:'Current computer song'})]),favoriteSong:async()=>{}};
 await withLibrary({props:{bridge:oldBridge}},async({document,render,act})=>{
  await render({bridge:newBridge});assert.match(document.querySelector('.song-library-card').textContent,/Current computer song/);
  await act(async()=>old.resolve(results([entry({title:'Previous computer song'})])));assert.doesNotMatch(document.querySelector('.song-library-card').textContent,/Previous computer song/);
 });
});

test('native sharing shows its real sync summary and a manual retry without hiding local songs',async()=>{
 let scans=0;await withLibrary({bridge:{librarySyncStatus:async()=>({state:'ready',updatedAt:100000,songCount:24,error:null}),rescanSongLibrary:async()=>{scans++;return{state:'ready',updatedAt:200000,songCount:25,error:null};}}},async({document,button,click})=>{
  assert.match(document.querySelector('.song-library-sync').textContent,/24 songs shared/);assert.ok(document.querySelector('.library-song'));
  await click(button('Share songs with phones'));assert.equal(scans,1);assert.match(document.querySelector('.song-library-sync').textContent,/25 songs shared/);assert.ok(document.querySelector('.library-song'));
 });
});
test('failed native sharing keeps local cards visible and allows another sync attempt',async()=>{
 let count=0;await withLibrary({bridge:{librarySyncStatus:async()=>({state:'ready',updatedAt:100000,songCount:3}),rescanSongLibrary:async()=>{if(!count++)throw Error('Computer connection unavailable; last shared songs kept.');return{state:'ready',updatedAt:300000,songCount:4};}}},async({document,button,click})=>{
  await click(button('Share songs with phones'));assert.match(document.querySelector('.song-library-sync [role=alert]').textContent,/last shared songs kept/);assert.ok(document.querySelector('.library-song'));
  await click(button('Share songs with phones'));assert.match(document.querySelector('.song-library-sync').textContent,/4 songs shared/);assert.equal(document.querySelector('.song-library-sync [role=alert]'),null);
 });
});
test('a late native sync cannot populate a different computer bridge',async()=>{
 const held=deferred();await withLibrary({bridge:{librarySyncStatus:async()=>({state:'ready',updatedAt:100000,songCount:3}),rescanSongLibrary:()=>held.promise}},async({document,button,click,render,act})=>{
  await click(button('Share songs with phones'));await render({bridge:{searchSongLibrary:async()=>results([entry({title:'Other computer song'})]),favoriteSong:async()=>{}}});
  await act(async()=>held.resolve({state:'ready',updatedAt:200000,songCount:999}));assert.equal(document.querySelector('.song-library-sync'),null);assert.match(document.querySelector('.library-song').textContent,/Other computer song/);
 });
});
test('native editable history flushes the editor first, restores through the real history panel and refreshes the library',async()=>{
 const version='c'.repeat(64),calls=[];let flushed=false;
 const history={songId:entry().id,title:entry().title,currentHash:entry().contentHash,currentText:'Current words',versions:[{hash:version,savedAt:100000,bytes:20}],truncated:false};
 await withLibrary({bridge:{listSongVersions:async()=>{assert.equal(flushed,true);calls.push('list');return history;},previewSongVersion:async(id,currentHash,hash)=>({...history,version:{hash,savedAt:100000,bytes:20,text:'Previous words'}}),restoreSongVersion:async(...args)=>{calls.push(args);return{path:'/local/song.pro',title:entry().title,contentHash:version};}},props:{beforeHistory:async()=>{flushed=true;return true;},onRestored:(...args)=>calls.push(['restored',...args])}},async({button,click,document,render})=>{
  await click(button('Version history: '+entry().title));assert.ok(document.querySelector('[role="dialog"]'));await click(document.querySelector('.song-history-versions button'));await click(button('Restore this version'));assert.deepEqual(calls.filter(Array.isArray),[[entry().id,entry().contentHash,version],['restored',entry().id,version]]);
  await render({active:false});assert.equal(document.querySelector('[role="dialog"]'),null);
 });
});
test('history stays hidden for read-only profiles and a refused editor flush opens no history',async()=>{
 let lists=0;const bridge={listSongVersions:async()=>{lists++;throw Error('Must not list');},previewSongVersion:async()=>{},restoreSongVersion:async()=>{}};
 await withLibrary({bridge,props:{readOnly:true}},async({button})=>{assert.equal(button('Version history: '+entry().title),undefined);});
 await withLibrary({bridge,props:{beforeHistory:async()=>false}},async({button,click,document})=>{await click(button('Version history: '+entry().title));assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(lists,0);});
});

test('group copies flush current edits, use the refreshed source hash and open the new identity',async()=>{
 const source=entry(),copy='c'.repeat(64),newHash='d'.repeat(64),clones=[];let flushed=false;
 await withLibrary({bridge:{cloneLibrarySong:async(...args)=>{clones.push(args);return{id:copy,title:'New group version',contentHash:'e'.repeat(64),groupName:'Choir'};},librarySongInfo:async()=>{assert.equal(flushed,true);return{...source,contentHash:newHash};}},props:{beforeHistory:async()=>{flushed=true;return true;}}},async({document,window,button,click,act,calls})=>{
  await click(button('Create group version: '+source.title));const form=document.querySelector('.song-version-dialog form'),input=form.querySelector('input'),descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value');
  descriptor.set.call(input,'Choir');await act(async()=>input.dispatchEvent(new window.Event('input',{bubbles:true})));
  await act(async()=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(clones,[[source.id,newHash,'Choir']]);assert.deepEqual(calls.open,[copy]);assert.equal(document.querySelector('.song-version-dialog'),null);assert.match(document.body.textContent,/original song was kept/);
 });
});
test('group filtering is explicit and read-only bridges cannot create copies',async()=>{
 await withLibrary({bridge:{searchSongLibrary:async filter=>results([entry({groupName:'Choir'})])},props:{readOnly:true}},async({document,button})=>{
  assert.equal(button('Create group version: '+entry().title),undefined);assert.match(document.querySelector('.song-library-info').textContent,/Choir version/);
  assert.ok([...document.querySelectorAll('option')].some(option=>option.value==='__generic__'));
 });
 const filters=[];await withLibrary({bridge:{searchSongLibrary:async filter=>{filters.push(filter);return{...results([entry()]),groups:['Choir']};}}},async({document,window,act})=>{
  const select=[...document.querySelectorAll('select')].find(value=>[...value.querySelectorAll('option')].some(option=>option.value==='__generic__'));
  Object.defineProperty(select,'value',{configurable:true,value:'Choir',writable:true});await act(async()=>select.dispatchEvent(new window.Event('change',{bubbles:true})));
  assert.equal(filters.at(-1).groupName,'Choir');assert.equal(filters.at(-1).offset,0);
 });
});

test('compact rows reveal a contextual preview without opening or changing a song',async()=>{
 await withLibrary({},async({document,button,click,calls})=>{
  assert.equal(document.querySelector('.library-context.has-selection'),null);
  await click(button('Preview: '+entry().title));
  assert.equal(document.querySelector('.library-context h3').textContent,entry().title);
  assert.equal(document.querySelector('.library-context .library-slide-preview p').textContent,entry().firstSlide);
  assert.deepEqual(calls.open,[]);
  await click(button('Open song'));assert.deepEqual(calls.open,[entry().id]);
  await click(button('Close preview'));assert.equal(document.querySelector('.library-context.has-selection'),null);
 });
});

test('create-only and read-only library profiles do not expose or poll administrator sharing controls',async()=>{
 let reads=0,rescans=0;
 await withLibrary({props:{readOnly:true},bridge:{librarySyncStatus:async()=>{reads++;return{state:'ready',songCount:2,updatedAt:100};},rescanSongLibrary:async()=>{rescans++;}}},async({document,button})=>{
  assert.equal(document.querySelector('.song-library-sync'),null);assert.equal(button('Share songs with phones'),undefined);assert.equal(reads,0);assert.equal(rescans,0);assert.ok(button('View lyrics'));
 });
});
