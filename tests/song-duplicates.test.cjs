const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const source=process.env.STATI_CORE32_SOURCE||path.join(__dirname,'..');
const {findSong,songText}=require(path.join(source,'desktop/library.cjs'));
const {convertFiles}=require(path.join(source,'desktop/powerpoint-batch.cjs'));
const {buildPresentation}=require(path.join(source,'desktop/presentation.cjs'));
const slides=text=>[{section:'Lyrics',text}];
const document=text=>({slides:[{number:1,shapes:[{text,fontSize:36,x:.2,y:.3,width:.6,height:.4}]}]});
async function fixture(check){const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-song-duplicates-'));try{const directory=path.join(root,'Lyrics');await fs.mkdir(directory);await check({root,directory});}finally{await fs.rm(root,{recursive:true,force:true});}}
async function withAdvanced(root,directory,check,{onDialog=async()=>{},onSearch=async()=>{}}={}){
 const userData=path.join(root,'userData');await fs.mkdir(userData);await fs.writeFile(path.join(userData,'lyrics-folder.json'),JSON.stringify({path:directory}));
 const entry=path.join(source,'desktop/advanced.cjs'),oldCache=require.cache[require.resolve(entry)],oldLoad=Module._load,dialogs=[];let exportIndex=0;
 const electron={app:{getPath:()=>userData},shell:{showItemInFolder:()=>{}},dialog:{
  showMessageBox:async(_parent,options)=>{dialogs.push(options);await onDialog(options);return {response:options.type==='question'?0:1};},
  showSaveDialog:async(_parent,options)=>({canceled:false,filePath:path.join(directory,'manual-'+(++exportIndex)+path.extname(options.defaultPath))})
 }};
 delete require.cache[require.resolve(entry)];Module._load=function(request,parent,isMain){if(request==='electron')return electron;if(request==='./conversion-work.cjs'&&parent?.filename===entry){const actual=oldLoad.call(this,request,parent,isMain),wrapped=async(task,...args)=>{const result=await actual(task,...args);if(task==='search')await onSearch(result);return result;};return Object.assign(wrapped,actual);}return oldLoad.call(this,request,parent,isMain);};
 try{await check(require(entry),dialogs);}
 finally{Module._load=oldLoad;delete require.cache[require.resolve(entry)];if(oldCache)require.cache[require.resolve(entry)]=oldCache;}
}
const legacyBytes=text=>Buffer.from('<RVPresentationDocument name="We worship You"><NSString rvXMLIvarName="RTFData">'+Buffer.from('{\\rtf1\\ansi '+text.replace(/\n/g,'\\par ')+'}').toString('base64')+'</NSString></RVPresentationDocument>');

test('broad search retains candidates but marks only complete ordered lyrics as equivalent',()=>fixture(async({directory})=>{
 const text='We worship You\nYour mercy is new\nWe worship You';
 await fs.writeFile(path.join(directory,'existing.pro'),buildPresentation({title:'Shared title',slides:slides(text)}));
 for(const [incoming,equivalent] of [
  ['we worship You  \nYour mercy is new\nWe worship You',true],
  ['We worship You\nA different second verse\nWe worship You',false],
  ['Your mercy is new\nWe worship You\nWe worship You',false],
  ['We worship You\nYour mercy is new',false],
  ['Completely different lyrics',false]
 ]){
  const result=await findSong(directory,slides(incoming),'Shared title');
  assert.equal(result.matches.length,1,'title/first-line candidates remain available');
  assert.equal(result.matches[0].equivalent,equivalent,incoming);
 }
 const saved=await fs.readFile(path.join(directory,'existing.pro'));
 assert.doesNotMatch(songText(saved,'.pro').text,/Amen/,'generated ending is not a lyric');
}));

test('Romanian identity keeps diacritics while accepting equivalent NFC text and wrapped lines',()=>fixture(async({directory})=>{
 const text='Slavă Domnului\nSă cântăm împreună';
 await fs.writeFile(path.join(directory,'existing.pro'),buildPresentation({title:'Slavă Domnului',language:'ron',slides:slides(text)}));
 for(const [incoming,equivalent] of [
  [text.normalize('NFD'),true],
  ['SLAVĂ DOMNULUI\nSă cântăm\nîmpreună',true],
  ['Slavă Domnului\nSa cântăm împreună',false],
  ['Slava Domnului\nSa cantam impreuna',false]
 ])assert.equal((await findSong(directory,slides(incoming))).matches[0].equivalent,equivalent,incoming);
}));

test('an edited Song ending element cannot hide additional meaningful lyrics from duplicate identity',()=>fixture(async({directory})=>{
 const text='We worship You\nThe original verse',protobuf=require(path.join(source,'node_modules/protobufjs/light'));
 const Presentation=protobuf.Root.fromJSON(require(path.join(source,'src/shared/propresenter-schema.json'))).lookupType('rv.data.Presentation');
 const doc=Presentation.decode(buildPresentation({title:'We worship You',slides:slides(text)}));
 doc.cues[0].actions[0].slide.presentation.baseSlide.elements[1].element.text.rtfData=Buffer.from('{\\rtf1\\ansi An extra meaningful verse}');
 const bytes=Buffer.from(Presentation.encode(doc).finish());await fs.writeFile(path.join(directory,'edited.pro'),bytes);
 assert.match(songText(bytes,'.pro').text,/An extra meaningful verse/);
 assert.equal((await findSong(directory,slides(text))).matches[0].equivalent,false);
 assert.equal((await findSong(directory,slides(text+'\nAn extra meaningful verse'))).matches[0].equivalent,true);
}));

test('actual batch preserves English and Romanian songs sharing a first line and resumes each output',()=>fixture(async({root,directory})=>{
 const lyrics=['We worship You\nYour mercy is new','We worship You\nWe sing a different verse','Slavă Domnului\nSă cântăm împreună','Slavă Domnului\nSa cântăm împreună'];
 const files=lyrics.map((_,i)=>path.join(root,'source-'+i+'.pptx'));
 for(const [i,file] of files.entries())await fs.writeFile(file,'source fixture '+i);
 let calls=0;const render=async file=>{calls++;return document(lyrics[files.findIndex(original=>path.basename(original)===path.basename(file))]);};
 const result=await convertFiles(files,directory,{render});
 assert.deepEqual(result.results.map(item=>item.status),['converted','converted','converted','converted']);
 assert.equal(new Set(result.results.map(item=>item.path)).size,4);
 const originalBytes=await Promise.all(result.results.map(item=>fs.readFile(item.path)));
 const resumed=await convertFiles(files,directory,{render});
 assert.deepEqual(resumed.results.map(item=>item.status),['skipped','skipped','skipped','skipped']);
 assert.equal(calls,8,'source layouts are re-extracted before verified output copies are reused');
 for(const [i,item] of resumed.results.entries())assert.deepEqual(await fs.readFile(item.path),originalBytes[i]);
 const equivalent=path.join(root,'equivalent.pptx');await fs.writeFile(equivalent,'different source bytes');
 const same=await convertFiles([equivalent],directory,{render:async()=>document('We worship You\nYour mercy is new')});
 assert.equal(same.results[0].status,'skipped');assert.equal(same.results[0].path,result.results[0].path);
 assert.equal((await fs.readdir(directory)).filter(name=>name.endsWith('.pro')).length,4);
}));

test('resume verifies destination bytes and does not trust legacy existence-only markers',()=>fixture(async({root,directory})=>{
 const input=path.join(root,'source.pptx'),text='We worship You\nThe original full lyrics';await fs.writeFile(input,'source fixture');
 let calls=0;const render=async()=>{calls++;return document(text);};
 const first=(await convertFiles([input],directory,{render})).results[0],edited=buildPresentation({title:'We worship You',slides:slides('We worship You\nA deliberate later edit')});
 await fs.writeFile(first.path,edited);
 const second=(await convertFiles([input],directory,{render})).results[0];
 assert.equal(second.status,'converted');assert.notEqual(second.path,first.path);assert.deepEqual(await fs.readFile(first.path),edited);
 const inputHash=crypto.createHash('sha256').update(await fs.readFile(input)).digest('hex'),marker=path.join(directory,'.stati-ppt-lyrics-v2-'+inputHash+'.json');
 await fs.writeFile(marker,JSON.stringify({file:path.basename(first.path),images:[]}));
 const legacy=(await convertFiles([input],directory,{render})).results[0];
 assert.equal(legacy.status,'skipped');assert.equal(legacy.path,second.path,'full lyrics are checked for old markers');
 const migrated=JSON.parse(await fs.readFile(marker,'utf8'));assert.equal(migrated.file,path.basename(second.path));assert.match(migrated.contentHash,/^[a-f0-9]{64}$/);
 const fast=(await convertFiles([input],directory,{render:async()=>{calls++;return document(text);}})).results[0];
 assert.equal(fast.status,'skipped');assert.equal(fast.path,second.path);
 assert.equal(calls,4,'re-extraction confirms the current source remains a lyric-only presentation');assert.deepEqual(await fs.readFile(first.path),edited);
}));

test('a cached match changed after comparison cannot be bound into a trusted resume marker',()=>fixture(async({root,directory})=>{
 const text='We worship You\nThe original full lyrics',file=path.join(directory,'existing.pro'),input=path.join(root,'source.pptx');
 await fs.writeFile(file,buildPresentation({title:'We worship You',slides:slides(text)}));await fs.writeFile(input,'source fixture');
 const changed=buildPresentation({title:'We worship You',slides:slides('We worship You\nAn outside edit during comparison')}),work=require(path.join(source,'desktop/conversion-work.cjs')),createSession=work.createSession;
 work.createSession=()=>{const session=createSession();return {...session,run:async(task,...args)=>{const result=await session.run(task,...args);if(task==='search')await fs.writeFile(file,changed);return result;}};};
 try{const result=(await convertFiles([input],directory,{render:async()=>document(text)})).results[0];assert.equal(result.status,'failed');assert.match(result.error,/changed while checking/);assert.deepEqual(await fs.readFile(file),changed);assert.equal((await fs.readdir(directory)).filter(name=>name.startsWith('.stati-ppt-')).length,0);}
 finally{work.createSession=createSession;}
}));

test('all manual save paths allow distinct lyrics with a shared title and still reuse equivalent lyrics',()=>fixture(async({root,directory})=>{
 const original=path.join(directory,'existing.pro'),originalBytes=buildPresentation({title:'We worship You',slides:slides('We worship You\nThe original verse')});await fs.writeFile(original,originalBytes);
 const textCopy=path.join(directory,'existing.txt');await fs.writeFile(textCopy,'We worship You\nThe original verse');
 await withAdvanced(root,directory,async(advanced,dialogs)=>{
  const methods=['insertPresentation','exportPresentation','exportLyrics'];
  for(const [i,method] of methods.entries()){
   const data={title:'We worship You',songName:'We worship You',slides:slides('We worship You\nA distinct manual verse '+i)};
   const saved=await advanced[method](data,null,root,root);assert.notEqual(saved.path,original,method);assert.equal(saved.existing,undefined,method);assert.ok((await fs.stat(saved.path)).isFile());
   const equivalent=await advanced[method]({...data,slides:slides('We worship You\nThe original verse')},null,root,root);assert.equal(equivalent.path,method==='exportLyrics'?textCopy:original,method);assert.equal(equivalent.existing,true,method);
  }
  assert.equal(dialogs.length,0,'Save and duplicate reuse have no second confirmation dialog');
  assert.deepEqual(await fs.readFile(original),originalBytes);
 });
}));

test('batch creates a native presentation when equivalent library lyrics exist only as text or pro6',async()=>{
 for(const extension of ['.txt','.pro6'])await fixture(async({root,directory})=>{
  const text='We worship You\nThe original full lyrics',candidate=path.join(directory,'existing'+extension),candidateBytes=extension==='.txt'?Buffer.from(text):legacyBytes(text);
  await fs.writeFile(candidate,candidateBytes);const input=path.join(root,'source.pptx');await fs.writeFile(input,'source fixture '+extension);
  const result=(await convertFiles([input],directory,{render:async()=>document(text)})).results[0];
  assert.equal(result.status,'converted',extension);assert.equal(path.extname(result.path),'.pro');assert.notEqual(result.path,candidate);assert.deepEqual(await fs.readFile(candidate),candidateBytes);
  assert.match(songText(await fs.readFile(result.path),'.pro').text,/The original full lyrics/);
  const resumed=(await convertFiles([input],directory,{render:async()=>document(text)})).results[0];assert.equal(resumed.status,'skipped');assert.equal(resumed.path,result.path);
 });
});

test('manual outputs reuse only the requested format while broad discovery keeps other formats',async()=>{
 const text='We worship You\nThe original full lyrics';
 for(const [method,extension,wanted] of [
  ['insertPresentation','.txt','.pro'],['insertPresentation','.pro6','.pro'],
  ['exportPresentation','.txt','.pro'],['exportPresentation','.pro6','.pro'],
  ['exportLyrics','.pro','.txt']
 ])await fixture(async({root,directory})=>{
  const candidate=path.join(directory,'existing'+extension),bytes=extension==='.txt'?Buffer.from(text):extension==='.pro6'?legacyBytes(text):buildPresentation({title:'We worship You',slides:slides(text)});
  await fs.writeFile(candidate,bytes);const found=await findSong(directory,slides(text));assert.equal(found.matches.length,1);assert.equal(found.matches[0].equivalent,true,'candidate remains discoverable');
  await withAdvanced(root,directory,async(advanced,dialogs)=>{
   const saved=await advanced[method]({title:'We worship You',slides:slides(text)},null,root,root);
   assert.equal(saved.existing,undefined,method+' with '+extension);assert.equal(path.extname(saved.path),wanted);assert.notEqual(saved.path,candidate);assert.equal(dialogs.filter(dialog=>dialog.title==='Song already in Lyrics').length,0);
   if(wanted==='.txt')assert.equal(await fs.readFile(saved.path,'utf8'),text);else assert.match(songText(await fs.readFile(saved.path),'.pro').text,/The original full lyrics/);
   assert.deepEqual(await fs.readFile(candidate),bytes);
  });
 });
});

test('manual reuse rechecks compared bytes without a second dialog and preserves an outside edit',async()=>{
 for(const method of ['insertPresentation','exportPresentation','exportLyrics'])await fixture(async({root,directory})=>{
  const text='We worship You\nThe original full lyrics',extension=method==='exportLyrics'?'.txt':'.pro',candidate=path.join(directory,'existing'+extension),bytes=extension==='.txt'?Buffer.from(text):buildPresentation({title:'We worship You',slides:slides(text)});
  const editedText='We worship You\nAn outside edit during the dialog',edited=extension==='.txt'?Buffer.from(editedText):buildPresentation({title:'We worship You',slides:slides(editedText)});await fs.writeFile(candidate,bytes);
  await withAdvanced(root,directory,async advanced=>{
   await assert.rejects(advanced[method]({title:'We worship You',slides:slides(text)},null,root,root),/matching song changed.*Retry/);
   assert.deepEqual(await fs.readFile(candidate),edited);assert.deepEqual(await fs.readdir(directory),['existing'+extension]);
  },{onSearch:async()=>{await fs.writeFile(candidate,edited);}});
 });
});

test('a named group arrangement remains discoverable but is never reused as the shared original',()=>fixture(async({root,directory})=>{
 const text='Amazing grace\nHow sweet the sound',original=path.join(directory,'original.pro');await fs.writeFile(original,buildPresentation({title:'Amazing grace',slides:slides(text)}));
 const sourceSong=(await require(path.join(source,'desktop/song-catalog.cjs')).searchCatalog(directory)).items[0],copy=await require(path.join(source,'desktop/song-save.cjs')).cloneLibrarySong(directory,sourceSong.id,sourceSong.contentHash,'Choir'),copyBytes=await fs.readFile(copy.path);
 await fs.unlink(original);const candidates=await findSong(directory,slides(text));assert.equal(candidates.matches[0].equivalent,true);assert.equal(candidates.matches[0].groupName,'Choir');
 await withAdvanced(root,directory,async advanced=>{
  const saved=await advanced.insertPresentation({title:'Amazing grace',slides:slides(text)},null,root,root);assert.notEqual(saved.path,copy.path);assert.equal(saved.existing,undefined);assert.deepEqual(await fs.readFile(copy.path),copyBytes);
  const again=await advanced.insertPresentation({title:'Amazing grace',slides:slides(text)},null,root,root);assert.equal(again.path,saved.path);assert.equal(again.existing,true);
 });
}));
test('PowerPoint lyric conversion creates a shared original instead of binding a group arrangement',()=>fixture(async({root,directory})=>{
 const text='Amazing grace\nHow sweet the sound',original=path.join(directory,'original.pro'),input=path.join(root,'source.pptx');await fs.writeFile(original,buildPresentation({title:'Amazing grace',slides:slides(text)}));await fs.writeFile(input,'isolated fixture');
 const sourceSong=(await require(path.join(source,'desktop/song-catalog.cjs')).searchCatalog(directory)).items[0],copy=await require(path.join(source,'desktop/song-save.cjs')).cloneLibrarySong(directory,sourceSong.id,sourceSong.contentHash,'Choir'),copyBytes=await fs.readFile(copy.path);await fs.unlink(original);
 const result=(await convertFiles([input],directory,{render:async()=>document(text)})).results[0];assert.equal(result.status,'converted');assert.notEqual(result.path,copy.path);assert.deepEqual(await fs.readFile(copy.path),copyBytes);
}));
