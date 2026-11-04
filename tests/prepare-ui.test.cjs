const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {transformSync}=require('esbuild');
const {parseHTML}=require('linkedom');

// Exercise the real UI and local helpers. Only the standalone entry mount and
// stylesheet imports are omitted; no accounts, native station, or network exist.
function prepareComponent(){
 const cache=new Map(),entry=path.resolve(__dirname,'../src/desktop/prepare.tsx');
 function load(filename){
  if(cache.has(filename))return cache.get(filename).exports;
  const loaded=new Module(filename,module);cache.set(filename,loaded);
  loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
  const originalRequire=loaded.require.bind(loaded);
  loaded.require=name=>{
   if(name.endsWith('.css'))return {};
   if(name.startsWith('.')){
    const base=path.resolve(path.dirname(filename),name);
    const resolved=[base,base+'.ts',base+'.tsx',base+'.js'].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
    if(resolved&&/\.(tsx?|js)$/.test(resolved))return load(resolved);
   }
   return originalRequire(name);
  };
  let source=fs.readFileSync(filename,'utf8');
  loaded._compile(transformSync(source,{loader:filename.endsWith('.tsx')?'tsx':filename.endsWith('.ts')?'ts':'js',format:'cjs',jsx:'automatic',logLevel:'silent'}).code,filename);
  return loaded.exports;
 }
 return load(entry).Prepare;
}

async function withPrepare({draft=null,bridge={}}={},check){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
 const previous={window:global.window,document:global.document,navigator:global.navigator,act:global.IS_REACT_ACT_ENVIRONMENT,confirm:global.confirm};
 global.window=window;global.document=window.document;
 Object.defineProperty(global,'navigator',{configurable:true,value:window.navigator});
 global.IS_REACT_ACT_ENVIRONMENT=true;global.confirm=()=>true;
 window.location=new URL('http://127.0.0.1/');window.document.oninput=null;
 let onNavigate;const calls={drafts:[],insert:[],revision:[],exports:[],serviceLists:0};
 window.stati={
  onNavigate:callback=>{onNavigate=callback;return()=>{if(onNavigate===callback)onNavigate=null;};},onPowerPointProgress:()=>()=>{},onPrepareFile:()=>()=>{},prepareInput:async()=>null,
  loadPrepareDraft:async()=>draft?{draft:structuredClone(draft)}:null,
  savePrepareDraft:async value=>{calls.drafts.push(structuredClone(value));},
  listServicePlans:async()=>{calls.serviceLists++;return[];},listServiceTemplates:async()=>[],
  searchSongLibrary:async()=>({items:[],total:0,scanned:0,unreadable:0,warnings:[],categories:[],offset:0}),
  insertPresentation:async data=>{calls.insert.push(structuredClone(data));return{path:'/isolated-fixture/Lyrics/song.pro'};},
  exportLyrics:async data=>{calls.exports.push(['lyrics',data]);return{path:'/isolated-fixture/song.txt'};},
  exportPresentation:async data=>{calls.exports.push(['presentation',data]);return{path:'/isolated-fixture/song.pro'};},
  exportPowerPoint:async data=>{calls.exports.push(['powerpoint',structuredClone(data)]);return{path:'/isolated-fixture/song.pptx'};},
  librarySongInfo:async id=>({id,title:'Original library title',contentHash:'a'.repeat(64),filename:'song.pro'}),saveLibrarySong:async(id,contentHash,data)=>{calls.revision.push([id,contentHash,structuredClone(data)]);return{path:'/isolated-fixture/Lyrics/song.pro',title:'Original library title',contentHash:'b'.repeat(64)};},
  ...bridge,
 };
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
 const root=createRoot(window.document.getElementById('root'));
 const button=name=>[...window.document.querySelectorAll('button')].find(element=>(element.getAttribute('aria-label')||element.textContent)===name);
 const click=async element=>{assert.ok(element,'Expected UI control');assert.equal(element.disabled,false,'Expected enabled UI control');await act(async()=>element.dispatchEvent(new window.Event('click',{bubbles:true})));};
 const edit=async(element,value)=>{
  assert.ok(element,'Expected editable control');
  const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),'value');
  if(descriptor?.set)descriptor.set.call(element,value);else element.value=value;
  await act(async()=>element.dispatchEvent(new window.Event(element.tagName==='SELECT'?'change':'input',{bubbles:true})));
 };
 const select=async(element,value)=>{
  Object.defineProperty(element,'value',{configurable:true,value,writable:true});
  await act(async()=>element.dispatchEvent(new window.Event('change',{bubbles:true})));
 };
 try{
  await act(async()=>root.render(React.createElement(prepareComponent())));
  await check({window,document:window.document,act,calls,button,click,edit,select,navigate:async section=>{assert.equal(typeof onNavigate,'function');await act(async()=>onNavigate(section));}});
 }finally{
  await act(async()=>root.unmount());
  global.window=previous.window;global.document=previous.document;
  Object.defineProperty(global,'navigator',{configurable:true,value:previous.navigator});
  global.IS_REACT_ACT_ENVIRONMENT=previous.act;global.confirm=previous.confirm;
 }
}
function savedDraft(overrides={}){return{text:'One lyric line\nAnother lyric line',title:'Fixture song',source:'original.txt',url:'',songLang:'auto',language:'both',lines:4,fontSizeInput:'96',libraryId:null,...overrides};}

test('Prepare starts compact and tab navigation preserves edited lyrics',async()=>{
 await withPrepare({},async({navigate,document,calls,button,click,edit})=>{
  const panel=id=>document.getElementById('workspace-panel-'+id);
  assert.equal(panel('prepare').hidden,false);
  assert.equal(panel('library').hidden,true);assert.equal(panel('services').hidden,true);
  assert.equal(document.querySelector('.slide-options').hasAttribute('open'),false);
  assert.equal(document.querySelector('.export-options').hasAttribute('open'),false);
  assert.equal(document.getElementById('lyrics-import'),null);
  const words='Words edited before switching\nThe second lyric line';
  await edit(document.querySelector('textarea'),words);
  assert.equal(calls.drafts.at(-1).text,words,'Real input events should update the saved draft');
  await navigate('library');
  assert.equal(panel('library').hidden,false);assert.equal(panel('prepare').hidden,true);
  assert.equal(document.getElementById('workspace-tab-library'),null);assert.equal(document.querySelector('.prepare-header h1').textContent,'Library');
  await navigate('services');
  assert.equal(panel('services').hidden,false);assert.equal(calls.serviceLists,2);
  await click(button('Audio'));
  assert.equal(panel('audio').hidden,false);assert.equal(panel('services').hidden,true);
  assert.match(panel('audio').textContent,/MP3 files already work in ProPresenter/);
  await click(button('Prepare'));
  assert.equal(panel('prepare').hidden,false);assert.equal(document.querySelector('textarea').value,words);
  assert.equal(document.querySelectorAll('[role="tabpanel"]').length,5);
 });
});

test('slide settings preserve words, clamp the preview, and primary save writes Lyrics',async()=>{
 const words=Array.from({length:10},(_,i)=>'Lyric line '+(i+1)).join('\n');
 await withPrepare({draft:savedDraft({text:words,lines:2})},async({navigate,document,calls,button,click,edit,select})=>{
  await click(button('Next slide'));await click(button('Next slide'));await click(button('Next slide'));await click(button('Next slide'));
  assert.equal(document.querySelector('.preview-controls span').textContent,'5 / 5');
  const fields=document.querySelector('.slide-settings-fields');
  await select(fields.querySelectorAll('select')[0],'8');
  await select(fields.querySelectorAll('select')[1],'ron');
  await edit(fields.querySelector('input[type="number"]'),'112');
  assert.equal(document.querySelector('textarea').value,words);
  assert.equal(document.querySelector('.preview-controls span').textContent,'1 / 2');
  assert.match(document.querySelector('.slide-preview p').textContent,/Lyric line 1/);
  assert.match(document.querySelector('.slide-options').textContent,/Arial bold, fitted within padded edges/);
  await click(button('Save to Lyrics'));
  assert.equal(calls.insert.length,1);assert.equal(calls.exports.length,0);
  const data=calls.insert[0];
  assert.equal(data.fontSize,112);assert.equal(data.language,'ron');assert.equal(data.songName,'Fixture song');
  assert.equal(data.slides.length,2);assert.equal(data.slides[0].text.split('\n').length,8);
  assert.equal(data.slides.map(slide=>slide.text).join('\n'),words);
  assert.equal(document.querySelector('.save-notice').textContent,'Saved.');
  await click(button('Next slide'));
  assert.equal(document.querySelector('.song-ending').textContent,'Amin');
 });
});

test('failed file import retains the current song and resets the file input',async()=>{
 const draft=savedDraft();
 await withPrepare({draft},async({navigate,window,document,act,button,click,calls})=>{
  await click(button('File'));
  const file=document.querySelector('input[type="file"]');
  Object.defineProperty(file,'files',{configurable:true,value:[{name:'broken.txt',size:12,text:async()=>{throw Error('Fixture text could not be read.');}}]});
  file.value='broken.txt';
  await act(async()=>file.dispatchEvent(new window.Event('change',{bubbles:true})));
  assert.equal(file.value,'');
  assert.equal(document.querySelector('textarea').value,draft.text);
  assert.equal(document.querySelector('.song-title-label input').value,draft.title);
  assert.equal(document.querySelector('.source-details small').textContent,draft.source);
  assert.match(document.querySelector('[role="alert"]').textContent,/Fixture text could not be read/);
  assert.equal(calls.drafts.at(-1).text,draft.text);
  assert.equal(calls.insert.length,0);
 });
});

test('restored library draft saves to the same song and migrates its version reference',async()=>{
 await withPrepare({draft:savedDraft({libraryId:'isolated-library-reference'})},async({navigate,document,calls,button,click})=>{
  assert.equal(button('Save to Lyrics'),undefined);
  await click(button('Save song'));
  assert.equal(calls.insert.length,0);assert.equal(calls.revision.length,1);
  assert.equal(calls.revision[0][0],'isolated-library-reference');
  assert.equal(document.querySelector('.save-notice').textContent,'Song saved.');
 });
});

test('successful file saves show a separate playlist warning and refresh service summaries',async()=>{
 const message='The file was saved. Choose the service again to add it to the playlist.';
 for(const kind of ['insert','export','library','batch']){
  const result={path:'/isolated-fixture/Lyrics/song.pro',contentHash:'b'.repeat(64),title:'Fixture song',playlistMessage:message};
  const bridge={insertPresentation:async()=>result,exportPresentation:async()=>result,saveLibrarySong:async()=>result,batchPowerPoint:async()=>({directory:'/isolated-fixture/Lyrics',playlistMessage:message})};
  await withPrepare({draft:savedDraft(kind==='library'?{libraryId:'a'.repeat(64),libraryHash:'b'.repeat(64)}:{}),bridge},async({navigate,window,document,button,click})=>{
   let changes=0;window.addEventListener('stati-services-changed',()=>changes++);
   if(kind==='batch'){await click(button('PowerPoint files'));await click(button('Choose PowerPoint files'));}
   else await click(button(kind==='library'?'Save song':kind==='export'?'Export ProPresenter':'Save to Lyrics'));
   assert.match(document.querySelector('.save-notice').textContent,kind==='library'?/Song saved/:kind==='batch'?/batch finished/:/Saved/);
   assert.equal(document.querySelector('.prepare-feedback .inline-error[role="status"]').textContent,message,kind);
   assert.equal(document.querySelector('.prepare-feedback [role="alert"]'),null,kind);
   assert.equal(changes,1,kind);assert.equal(document.querySelector('textarea').value,'One lyric line\nAnother lyric line');
  });
 }
});

test('Clear empties the editor, library selection and persisted restart draft',async()=>{
 await withPrepare({draft:savedDraft({libraryId:'a'.repeat(64),libraryHash:'c'.repeat(64)})},async({navigate,document,calls,button,click})=>{
  await click(button('Clear'));
  assert.equal(document.querySelector('textarea').value,'');assert.equal(document.querySelector('.song-title-label input').value,'');
  assert.equal(calls.drafts.at(-1).text,'');assert.equal(calls.drafts.at(-1).libraryId,null);assert.equal(calls.drafts.at(-1).libraryHash,null);
  assert.equal(button('Save song'),undefined);assert.equal(button('Save to Lyrics').disabled,true);
  assert.equal(document.querySelector('.preview-controls span').textContent,'0 / 0');
 });
});

test('long lines preview readable slides while saved source words and original title stay intact',async()=>{
 const text=Array(5).fill('Together we sing with joy and hope and remember every word prepared for this song today.').join('\n');
 await withPrepare({draft:savedDraft({text,lines:2})},async({navigate,document,calls,button,click})=>{
  assert.equal(document.querySelector('textarea').value,text);
  assert.ok(Number.parseFloat(document.querySelector('.slide-preview p').style.fontSize)*19.2>=64);
  await click(button('Save to Lyrics'));assert.equal(calls.insert[0].slides.map(slide=>slide.text).join('\n'),text);assert.equal(calls.insert[0].linesPerSlide,2);
  assert.equal(calls.insert[0].title,text.split('\n')[0]);
 });
});
test('a long first lyric line uses a bounded internal title and reaches native validation without losing words',async()=>{
 const text=Array(60).fill('Laudăm').join(' ');
 await withPrepare({draft:savedDraft({text,title:'A short song name',lines:4})},async({navigate,document,calls,button,click})=>{
  assert.equal(document.querySelector('textarea').value,text);assert.equal(button('Save to Lyrics').disabled,false);await click(button('Save to Lyrics'));
  const data=calls.insert[0];assert.ok(data.title.length<=180);assert.equal(data.songName,'A short song name');assert.equal(data.slides[0].text,text);
  const {buildPresentation,decode}=require('../desktop/presentation.cjs');const doc=decode(buildPresentation(data));assert.ok(doc.cues.length>1);assert.equal(require('../desktop/library.cjs').songText(buildPresentation(data),'.pro').text.includes('Laudăm'),true);
 });
});

test('an unreadable word blocks slide saves but allows plain lyrics recovery',async()=>{
 await withPrepare({draft:savedDraft({text:'W'.repeat(200)})},async({navigate,document,calls,button,click})=>{
  assert.equal(button('Save to Lyrics').disabled,true);assert.equal(button('Export ProPresenter').disabled,true);
  assert.match(document.querySelector('[role="alert"]').textContent,/word is too long/);
  await click(button('Export lyrics'));assert.equal(calls.exports[0][0],'lyrics');assert.equal(calls.exports[0][1].slides[0].text,'W'.repeat(200));
 });
});

test('compact library rows show title, version, lyrics and favorite/edit actions',async()=>{
 const entry={id:'a'.repeat(64),contentHash:'b'.repeat(64),title:'Original song title',filename:'private-path-copy.pro',category:'Uncategorized',addedAt:100000,modifiedAt:200000,firstLine:'First lyric',lyricPreview:'First lyric\nSecond lyric',editable:true,favorite:false};
 await withPrepare({bridge:{searchSongLibrary:async()=>({items:[entry],total:1,scanned:99,unreadable:0,warnings:[],categories:[],offset:0}),openLibrarySong:async()=>({...entry,text:'First lyric\nSecond lyric',fontSize:96,songName:'Do not duplicate this'})}},async({navigate,document,calls,button,click})=>{
  await navigate('library');const card=document.querySelector('.library-song');assert.ok(card);assert.match(card.textContent,/Original song title/);assert.match(card.textContent,/Original song/);assert.match(card.textContent,/First lyric\nSecond lyric/);assert.equal(card.textContent.includes(entry.filename),false);assert.equal(card.textContent.includes('service history'),false);
  await click(button('Edit lyrics'));assert.equal(document.querySelector('.song-title-label input').value,entry.title);assert.equal(document.querySelector('.song-title-label input').getAttributeNames().some(name=>name.toLowerCase()==='readonly'),true);
  await click(button('Save song'));assert.equal(calls.revision[0][0],entry.id);assert.equal(calls.revision[0][1],entry.contentHash);assert.equal(calls.revision[0][2].songName,entry.title);
 });
});

test('editing existing lyrics automatically saves the same title and file reference after typing pauses',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});
 await withPrepare({draft:savedDraft({libraryId:'a'.repeat(64),libraryHash:'c'.repeat(64)})},async({navigate,document,calls,edit,act})=>{
  const text='Updated lyric line\nThe words are kept';await edit(document.querySelector('textarea'),text);
  assert.equal(calls.revision.length,0);await act(async()=>context.mock.timers.tick(850));assert.equal(calls.revision.length,1);
  assert.equal(calls.revision[0][0],'a'.repeat(64));assert.equal(calls.revision[0][1],'c'.repeat(64));assert.equal(calls.revision[0][2].songName,'Fixture song');assert.equal(calls.revision[0][2].slides[0].text,text);assert.equal(calls.insert.length,0);assert.match(document.querySelector('.prepare-save').textContent,/Song saved automatically/);
 });
});
test('deleting lyric lines, a section or every line in a saved song keeps the editor visible and the draft recoverable',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});
 for(const text of ['One lyric line','Another lyric line','One lyric line\n\nAnother lyric line','','\n','R','1.']){
  let persisted;
  await withPrepare({draft:savedDraft({libraryId:'a'.repeat(64),libraryHash:'c'.repeat(64)}),bridge:{savePrepareDraft:async value=>{persisted=structuredClone(value);}}},async({navigate,document,calls,edit,act,button})=>{
   await edit(document.querySelector('textarea'),text);await act(async()=>context.mock.timers.tick(850));
   assert.ok(document.querySelector('.editor-panel'),JSON.stringify(text));assert.equal(document.querySelector('textarea').value,text);assert.equal(document.getElementById('workspace-tab-library'),null);assert.equal(persisted.text,text);
   if(!text.trim()||text==='R'||text==='1.'){assert.equal(calls.revision.length,0);assert.equal(button('Save song').disabled,true);assert.equal(document.querySelector('.preview-controls span').textContent,'0 / 0');}
  });
  await withPrepare({draft:persisted},async({navigate,document})=>{assert.ok(document.querySelector('.editor-panel'));assert.equal(document.querySelector('textarea').value,text);});
 }
});
test('pastor workspace reads the whole song without loading or saving an editable draft',async()=>{
 let loads=0,writes=0;const entry={id:'a'.repeat(64),contentHash:'b'.repeat(64),title:'Read only song',filename:'song.pro',category:'Uncategorized',fontSize:96,firstLine:'First lyric',firstSlide:'First lyric',addedAt:1000,modifiedAt:1000,editable:true,favorite:false};
 await withPrepare({bridge:{workspaceContext:async()=>({capabilities:{readSongs:true,planServices:false,editLyrics:false}}),loadPrepareDraft:async()=>{loads++;return null;},savePrepareDraft:async()=>{writes++;},searchSongLibrary:async()=>({items:[entry],total:1,scanned:1,unreadable:0,warnings:[],categories:[],offset:0}),openLibrarySong:async()=>({...entry,text:'First lyric\n\nA later verse',songName:entry.title})}},async({navigate,document,button,click})=>{
  assert.equal(loads,0);assert.equal(writes,0);assert.equal(button('Edit lyrics'),undefined);await click(button('View lyrics'));assert.match(document.getElementById('workspace-panel-prepare').textContent,/A later verse/);assert.equal(document.querySelector('textarea'),null);assert.equal(button('Save song'),undefined);assert.equal(button('Save to Lyrics'),undefined);await navigate('services');assert.equal(button('Create service'),undefined);
 });
});

test('reviewed lyrics from every import source share editable PowerPoint export and keep the current draft',async()=>{
 for(const source of ['pasted text','lyrics.txt','word.docx','scan.pdf','photo.png','https://example.invalid/lyrics']){
  const text='Împreună cântăm pentru Tine\nSlava Ta ne umple inima';
  await withPrepare({draft:savedDraft({text,source,songLang:'ron'})},async({navigate,document,calls,button,click})=>{
   assert.equal(button('Export PowerPoint lyrics').disabled,false);await click(button('Export PowerPoint lyrics'));
   assert.equal(calls.exports.length,1);const [format,data]=calls.exports[0];assert.equal(format,'powerpoint');assert.equal(data.slides[0].text,text);assert.equal(data.language,'ron');assert.equal(data.songName,'Fixture song');assert.equal(data.fontSize,96);assert.equal(document.querySelector('textarea').value,text);assert.equal(calls.insert.length,0);assert.match(document.body.textContent,/Saved/);
  });
 }
});

test('a real text-file import can be reviewed and exported as PowerPoint lyrics',async()=>{
 await withPrepare({},async({navigate,window,document,act,button,click,calls})=>{
  await click(button('File'));const input=document.querySelector('input[type="file"]');Object.defineProperty(input,'files',{configurable:true,value:[new File(['We sing together in your love\nWe lift our voices to the Lord'],'test-lyrics.txt',{type:'text/plain'})]});
  await act(async()=>input.dispatchEvent(new window.Event('change',{bubbles:true})));assert.match(document.querySelector('textarea').value,/We sing together/);await click(button('Export PowerPoint lyrics'));assert.equal(calls.exports[0][0],'powerpoint');assert.match(calls.exports[0][1].slides[0].text,/We lift our voices/);
 });
});

test('canceled PowerPoint export keeps draft and source without reporting a save',async()=>{
 await withPrepare({draft:savedDraft(),bridge:{exportPowerPoint:async()=>({canceled:true})}},async({navigate,document,button,click})=>{await click(button('Export PowerPoint lyrics'));assert.equal(document.querySelector('textarea').value,savedDraft().text);assert.doesNotMatch(document.querySelector('.prepare-feedback').textContent,/Saved\./);assert.doesNotMatch(document.body.textContent,/undefined/);});
});

test('restoring the currently open song reloads its editor and subsequent saves use the restored hash',async()=>{
 const id='a'.repeat(64),hash='c'.repeat(64),restoredHash='d'.repeat(64),earlier='Earlier words are safely restored\nThe previous song remains recoverable';let restored=false;
 const entry={id,contentHash:hash,title:'Fixture song',filename:'song.pro',category:'Worship',fontSize:96,addedAt:1000,modifiedAt:1000,firstLine:'One lyric line',firstSlide:'One lyric line',editable:true,favorite:false};
 const history=()=>({songId:id,title:entry.title,currentHash:restored?restoredHash:hash,currentText:restored?earlier:savedDraft().text,versions:[{hash:restoredHash,savedAt:1000,bytes:300}],truncated:false});
 await withPrepare({draft:savedDraft({libraryId:id,libraryHash:hash}),bridge:{
  searchSongLibrary:async()=>({items:[entry],total:1,scanned:1,categories:[],unreadable:0,warnings:[],offset:0}),listSongVersions:async()=>history(),previewSongVersion:async()=>({...history(),version:{hash:restoredHash,savedAt:1000,bytes:300,text:earlier}}),restoreSongVersion:async()=>{restored=true;return{path:'/isolated/Lyrics/song.pro',title:entry.title,contentHash:restoredHash};},openLibrarySong:async()=>({...entry,text:earlier,songName:entry.title,contentHash:restoredHash}),
 }},async({navigate,document,calls,button,click})=>{
  await navigate('library');await click(button('Version history: Fixture song'));await click(document.querySelector('.song-history-versions button'));await click(button('Restore this version'));
  assert.equal(document.getElementById('workspace-panel-prepare').hidden,false);assert.equal(document.querySelector('textarea').value,earlier);assert.equal(calls.revision.length,0,'Restoring must not autosave the stale draft over the restored bytes');
  await click(button('Save song'));assert.equal(calls.revision[0][1],restoredHash);assert.equal(calls.revision[0][2].slides[0].text,earlier);
 });
});

test('Amen and Amin size changes independently and reaches both editable presentation exports',async()=>{
 await withPrepare({draft:savedDraft()},async({navigate,document,calls,button,click,edit,select})=>{
  const settings=document.querySelector('.slide-settings-fields'),[lyrics,ending]=settings.querySelectorAll('input[type="number"]');
  assert.equal(ending.value,'36');assert.equal(ending.getAttribute('min'),'16');assert.equal(ending.getAttribute('max'),'96');
  const lyricPreview=document.querySelector('.slide-preview p').style.fontSize;
  await edit(ending,'54');
  assert.equal(lyrics.value,'96');assert.equal(document.querySelector('.song-ending').textContent,'Amen');assert.equal(document.querySelector('.song-ending').style.fontSize,`${54/19.2}cqw`);assert.equal(document.querySelector('.slide-preview p').style.fontSize,lyricPreview);
  await select(settings.querySelectorAll('select')[1],'ron');
  assert.equal(document.querySelector('.song-ending').textContent,'Amin');
  await edit(lyrics,'112');assert.equal(ending.value,'54');assert.equal(document.querySelector('.song-ending').style.fontSize,`${54/19.2}cqw`);
  await click(button('Export PowerPoint lyrics'));await click(button('Export ProPresenter'));await click(button('Save to Lyrics'));
  assert.deepEqual(calls.exports.map(([format])=>format),['powerpoint','presentation']);
  for(const data of [...calls.exports.map(([,data])=>data),...calls.insert]){assert.equal(data.amenFontSize,54);assert.equal(data.fontSize,112);assert.equal(data.language,'ron');assert.equal(data.slides[0].text,savedDraft().text);}
 });
});

test('Amen size survives draft restart and legacy drafts retain the existing default',async()=>{
 let persisted;
 await withPrepare({draft:savedDraft({fontSizeInput:'128',amenFontSizeInput:'62'})},async({navigate,document,calls,edit})=>{
  const [lyrics,ending]=document.querySelectorAll('.slide-settings-fields input[type="number"]');assert.equal(lyrics.value,'128');assert.equal(ending.value,'62');
  await edit(ending,'48');persisted=structuredClone(calls.drafts.at(-1));assert.equal(persisted.amenFontSizeInput,'48');assert.equal(persisted.fontSizeInput,'128');
 });
 await withPrepare({draft:persisted},async({navigate,document})=>{assert.equal(document.querySelectorAll('.slide-settings-fields input[type="number"]')[1].value,'48');assert.equal(document.querySelector('.song-ending').style.fontSize,`${48/19.2}cqw`);assert.equal(document.querySelector('textarea').value,persisted.text);});
 await withPrepare({draft:savedDraft()},async({navigate,document})=>assert.equal(document.querySelectorAll('.slide-settings-fields input[type="number"]')[1].value,'36'));
});

test('saved library songs reopen their own Amen size and keep that choice on the same song revision',async()=>{
 const id='e'.repeat(64),hash='f'.repeat(64),savedHash='9'.repeat(64);
 let song={id,contentHash:hash,title:'Saved ending size',filename:'saved.pro',category:'Worship',fontSize:128,amenFontSize:68,text:'The saved song has its own ending\nThe lyric size remains independent',addedAt:1000,modifiedAt:1000,firstLine:'The saved song has its own ending',firstSlide:'The saved song has its own ending',editable:true,favorite:false};
 const bridge={searchSongLibrary:async()=>({items:[song],total:1,scanned:1,categories:[],unreadable:0,warnings:[],offset:0}),openLibrarySong:async()=>structuredClone(song),saveLibrarySong:async(songId,contentHash,data)=>{assert.equal(songId,id);assert.equal(contentHash,hash);song={...song,contentHash:savedHash,fontSize:data.fontSize,amenFontSize:data.amenFontSize,text:data.slides.map(slide=>slide.text).join('\n\n')};return{path:'/isolated/Lyrics/saved.pro',title:song.title,contentHash:savedHash};}};
 await withPrepare({bridge},async({navigate,document,button,click,edit,calls})=>{
  await navigate('library');await click(button('Edit lyrics'));
  const [lyrics,ending]=document.querySelectorAll('.slide-settings-fields input[type="number"]');assert.equal(lyrics.value,'128');assert.equal(ending.value,'68');assert.equal(calls.revision.length,0);
  await edit(ending,'56');await click(button('Save song'));assert.equal(song.amenFontSize,56);assert.equal(song.fontSize,128);assert.equal(calls.insert.length,0);assert.equal(calls.drafts.at(-1).amenFontSizeInput,'56');
 });
 await withPrepare({bridge},async({navigate,document,button,click})=>{await navigate('library');await click(button('Edit lyrics'));const [lyrics,ending]=document.querySelectorAll('.slide-settings-fields input[type="number"]');assert.equal(lyrics.value,'128');assert.equal(ending.value,'56');assert.equal(document.querySelector('.song-ending').style.fontSize,`${56/19.2}cqw`);});
});

test('Prepare passes the selected ending size to the real batch review and native export payload',async()=>{
 const exports=[];
 await withPrepare({draft:savedDraft({fontSizeInput:'128',amenFontSizeInput:'64'}),bridge:{exportPowerPointBatch:async value=>{exports.push(structuredClone(value));return{results:value.items.map(item=>({id:item.id,name:item.name,status:'saved',filename:'Reviewed.pptx'}))};},cancelPowerPointBatch:async()=>({stopping:true})}},async({navigate,window,document,act,button,click,edit,calls})=>{
  const input=document.querySelector('.batch-pptx input[type="file"]');Object.defineProperty(input,'files',{configurable:true,value:[new File(['Împreună cântăm pentru Tine\nSlava Ta ne umple inima'],'reviewed.txt',{type:'text/plain'})]});
  await act(async()=>input.dispatchEvent(new window.Event('change',{bubbles:true})));
  assert.equal(document.querySelector('.batch-pptx-slide span').textContent,'Amin');assert.equal(document.querySelector('.batch-pptx-slide span').style.fontSize,`${64/19.2}cqw`);
  assert.equal(document.querySelector('.batch-pptx-reviewed input'),null);assert.equal(button('Export songs (1)').disabled,false);
  await edit(document.querySelectorAll('.slide-settings-fields input[type="number"]')[1],'48');assert.equal(button('Export songs (1)').disabled,false);assert.equal(document.querySelector('.batch-pptx-slide span').style.fontSize,`${48/19.2}cqw`);
  await click(button('Export songs (1)'));
  assert.equal(exports.length,1);assert.equal(exports[0].items.length,1);const data=exports[0].items[0].data;assert.equal(data.amenFontSize,48);assert.equal(data.fontSize,128);assert.match(data.slides[0].text,/Împreună cântăm/);assert.equal(document.querySelector('.lyrics-label textarea').value,savedDraft().text);assert.equal(calls.drafts.at(-1).amenFontSizeInput,'48');assert.equal(calls.insert.length,0);
 });
});

test('PowerPoint to Lyrics conversion receives both independently selected font sizes',async()=>{
 const options=[];
 await withPrepare({draft:savedDraft({fontSizeInput:'112',amenFontSizeInput:'52'}),bridge:{batchPowerPoint:async value=>{options.push(structuredClone(value));return{canceled:true};}}},async({navigate,button,click})=>{await click(button('PowerPoint files'));await click(button('Choose PowerPoint files'));assert.deepEqual(options,[{fontSize:112,amenFontSize:52}]);});
});

test('chord review keeps imported words until explicit apply and offers an exact undo',async()=>{
 const words='[Verse]\nC  G  Am  F\n[C]Amazing [G]grace\nA mighty fortress';
 await withPrepare({draft:savedDraft({text:words})},async({document,button,click,calls})=>{
  await click(button('Review guitar chords'));
  assert.ok(document.querySelector('[aria-label="Review chord removal"]'));
  assert.equal(document.querySelector('textarea').value,words);
  assert.equal(calls.drafts.at(-1).text,words,'preview leaves the saved draft alone');
  await click(button('Remove selected chords'));
  assert.equal(document.querySelector('textarea').value,'[Verse]\n\nAmazing grace\nA mighty fortress');
  assert.equal(calls.drafts.at(-1).text,'[Verse]\n\nAmazing grace\nA mighty fortress');
  await click(button('Undo chord removal'));assert.equal(document.querySelector('textarea').value,words);assert.equal(calls.drafts.at(-1).text,words);
 });
});
test('editing lyrics after chord review requires another review before applying',async()=>{
 await withPrepare({draft:savedDraft({text:'[C]Original words'})},async({document,button,click,edit})=>{
  await click(button('Review guitar chords'));await edit(document.querySelector('textarea'),'[C]Different words');
  assert.equal(button('Remove selected chords'),undefined);assert.match(document.querySelector('.chord-review').textContent,/lyrics changed/);
  await click(button('Review guitar chords'));await click(button('Remove selected chords'));assert.equal(document.querySelector('textarea').value,'Different words');
 });
});

test('deferred fourth-screen controls stay out of Prepare while lyric editing remains available',async()=>{
 await withPrepare({draft:savedDraft({text:'Original church lyrics\nStay in their current layout'})},async({document,button})=>{
  assert.equal(document.querySelector('.output-layouts'),null);
  assert.doesNotMatch(document.body.textContent,/Church & online layouts|Export online lyrics copy|Translation for online cue/);
  assert.equal(document.querySelector('textarea').value,'Original church lyrics\nStay in their current layout');
  assert.ok(button('Review guitar chords'));
 });
});

test('a native create-only profile can prepare and export new slides without existing-song or synchronization controls',async()=>{
 await withPrepare({draft:savedDraft(),bridge:{workspaceContext:async()=>({capabilities:{readSongs:true,createSlides:true,planServices:false,editLyrics:false}})}},async({document,calls,button,click})=>{
  assert.equal(document.getElementById('workspace-panel-prepare').hidden,false);assert.ok(document.querySelector('textarea'));assert.equal(document.getElementById('workspace-tab-powerpoint'),null);assert.equal(document.getElementById('workspace-tab-audio'),null);assert.equal(button('PowerPoint files'),undefined);
  await click(button('Save to Lyrics'));assert.equal(calls.insert.length,1);assert.equal(calls.revision.length,0);
  await click(button('Export PowerPoint lyrics'));assert.equal(calls.exports.at(-1)[0],'powerpoint');
 });
});
test('a demoted native creator restores old text as a new draft without restoring an existing-song editing binding',async()=>{
 await withPrepare({draft:savedDraft({libraryId:'a'.repeat(64),libraryHash:'b'.repeat(64)}),bridge:{workspaceContext:async()=>({capabilities:{readSongs:true,createSlides:true,planServices:false,editLyrics:false}})}},async({calls,button,click})=>{
  assert.ok(button('Save to Lyrics'));assert.equal(button('Save song'),undefined);await click(button('Save to Lyrics'));assert.equal(calls.revision.length,0);assert.equal(calls.insert.length,1);assert.equal(calls.drafts.at(-1).libraryId,null);
 });
});
