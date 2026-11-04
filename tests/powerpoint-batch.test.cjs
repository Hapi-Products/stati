const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {convertFiles}=require('../desktop/powerpoint-batch.cjs');
const {extractLyrics}=require('../desktop/powerpoint-lyrics.cjs');
const shape=(text,size=36,x=.2,y=.3,width=.6,height=.4)=>({text,fontSize:size,x,y,width,height});
const simpleDocument=text=>({slides:[{number:1,shapes:[shape(text)]},{number:2,shapes:[shape('Amin',28,.8,.9,.15,.06)]}]});
const document=text=>({slides:[{number:1,shapes:[shape('www.example.org',12),shape('1',10),shape(text)]},{number:2,shapes:[shape('Amin',28,.8,.9,.15,.06)]}]});
test('legacy decoration is excluded and newer slides use the same lyric-only output',()=>{
 const result=extractLyrics(document('Domnul este bun\nEl ne iubește'));
 assert.deepEqual(result,{slides:[{section:'Lyrics',text:'Domnul este bun\nEl ne iubește'}],language:'ron'});
 const english=extractLyrics({slides:[{number:1,shapes:[shape('Joy to the world\nThe Lord is come\nAmen')] }]});
 assert.equal(english.slides[0].text,'Joy to the world\nThe Lord is come');
 assert.throws(()=>extractLyrics({slides:[{number:1,shapes:[]}]}),/No clear song lyrics/);
 assert.throws(()=>extractLyrics({slides:[{number:1,shapes:[shape('Title')]}]}),/heading/);
});
test('batch preserves originals, continues on failure, creates lyric-only slides, and resumes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-batch-'));
 try{
  const songs=path.join(root,'Songs');await fs.mkdir(songs);
  const files=[];for(const [name,bytes] of [['One.pptx','one'],['Bad.pptx','bad'],['Three.ppt','three']]){const file=path.join(root,name);await fs.writeFile(file,bytes);files.push(file);}
  let calls=0;const render=async source=>{calls++;if(source.includes('Bad'))throw Error('Unreadable presentation');return simpleDocument(source.includes('One')?'Domnul este bun\nEl ne iubește':'Joy to the world\nThe Lord is come');};
  const first=await convertFiles(files,songs,{render});assert.deepEqual(first.results.map(r=>r.status),['converted','failed','converted']);
  const saved=await fs.readFile(first.results[0].path);
  const decoded=require('../desktop/presentation.cjs').decode(saved);
  assert.equal(decoded.name,'Domnul este bun');
  const slide=decoded.cues[0].actions[0].slide.presentation.baseSlide;
  assert.equal(slide.backgroundColor.red||0,0);assert.equal(slide.elements.length,2);
  assert.equal(slide.elements[0].element.name,'Lyrics');
  assert.equal(slide.elements[0].element.fill.media,undefined);
  const rtf=Buffer.from(slide.elements[1].element.text.rtfData,'base64').toString();assert.match(rtf,/Amin/);
  const second=await convertFiles(files,songs,{render});assert.deepEqual(second.results.map(r=>r.status),['skipped','failed','skipped']);assert.equal(calls,6);
  assert.deepEqual(await fs.readFile(first.results[0].path),saved);assert.equal(await fs.readFile(files[0],'utf8'),'one');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('stopping finishes current song; different inputs with the same lyrics reuse Songs',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-stop-'));
 try{const songs=path.join(root,'Songs');await fs.mkdir(songs);const files=[path.join(root,'One.pptx'),path.join(root,'Two.pptx')];for(const file of files)await fs.writeFile(file,file);
 let stopped=false;const render=async()=>{stopped=true;return simpleDocument('Joy to the world\nThe Lord is come');};
 const first=await convertFiles(files,songs,{render,shouldStop:()=>stopped});assert.equal(first.stopped,true);assert.equal(first.results.length,1);
 const second=await convertFiles(files,songs,{render});assert.deepEqual(second.results.map(r=>r.status),['skipped','skipped']);assert.equal((await fs.readdir(songs)).filter(n=>n.endsWith('.pro')).length,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('fast PPTX conversion uses the selected independent ending size and retries preserve that saved native file',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-batch-ending-'));
 try{const songs=path.join(root,'Lyrics');await fs.mkdir(songs);const source=path.join(root,'reviewed.pptx'),original=await require('../desktop/powerpoint-export.cjs').buildPowerPointLyrics({title:'Reviewed',language:'ron',fontSize:96,amenFontSize:36,slides:[{section:'Verse',text:'Împreună cântăm pentru Tine\nSlava Ta ne umple inima'}]});await fs.writeFile(source,original);
  const first=await convertFiles([source],songs,{fastPptx:true,fontSize:112,amenFontSize:64,render:()=>assert.fail('The real PPTX text extractor handles this file')});assert.equal(first.results[0].status,'converted');const bytes=await fs.readFile(first.results[0].path),doc=require('../desktop/presentation.cjs').decode(bytes),elements=doc.cues[0].actions[0].slide.presentation.baseSlide.elements.map(item=>item.element),rtf=element=>Buffer.from(element.text.rtfData,'base64').toString();assert.match(rtf(elements.find(e=>e.name==='Song ending')),/\\fs128\\b0\\i\\cf1 Amin/);assert.match(rtf(elements.find(e=>e.name==='Lyrics')),/\\fs224\\b/);
  const retry=await convertFiles([source],songs,{fastPptx:true,fontSize:96,amenFontSize:48});assert.equal(retry.results[0].status,'skipped');assert.equal(retry.results[0].path,first.results[0].path);assert.deepEqual(await fs.readFile(first.results[0].path),bytes);assert.deepEqual(await fs.readFile(source),original);assert.equal((await fs.readdir(songs)).filter(name=>name.endsWith('.pro')).length,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('Windows batch entry rejects invalid ending sizes before showing any native chooser',async()=>{
 for(const amenFontSize of [null,'64',15,97,NaN,Infinity])await assert.rejects(require('../desktop/powerpoint-batch.cjs').start(null,'/isolated',()=>{},{amenFontSize}),/Amen \/ Amin size/);
});

async function batchFixture(check){const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-batch-recovery-'));try{const directory=path.join(root,'Lyrics');await fs.mkdir(directory);const source=path.join(root,'source.pptx');await fs.writeFile(source,await require('../desktop/powerpoint-export.cjs').buildPowerPointLyrics({title:'Fixture',slides:[{section:'Verse',text:'Together we sing with hope\nEvery word is kept'}]}));await check({root,directory,source});}finally{await fs.rm(root,{recursive:true,force:true});}}
test('a stalled Office reader has a deadline and emits a visible phase instead of leaving the batch busy',()=>batchFixture(async({directory,source})=>{
 const phases=[];let aborted=false;const result=await convertFiles([source],directory,{progress:state=>phases.push(state),officeTimeoutMs:30,render:async(copy,media,{signal})=>new Promise(()=>{signal.addEventListener('abort',()=>{aborted=true;},{once:true});})});
 assert.equal(aborted,true);assert.equal(result.results[0].status,'failed');assert.match(result.results[0].error,/Microsoft PowerPoint.*timed out/);assert.ok(phases.some(state=>state.phase==='office'));assert.equal(phases.at(-1).completed,1);assert.deepEqual(await fs.readdir(directory),[]);
}));
test('an unresponsive conversion worker is closed and the following file uses a fresh worker',()=>batchFixture(async({directory,source,root})=>{
 const work=require('../desktop/conversion-work.cjs'),original=work.createSession;let created=0,closed=0;work.createSession=()=>++created===1?{run:()=>new Promise(()=>{}),close:async()=>{closed++;}}:original();const second=path.join(root,'second.pptx');await fs.copyFile(source,second);
 try{const result=await convertFiles([source,second],directory,{fastPptx:true,taskTimeoutMs:5000});assert.deepEqual(result.results.map(item=>item.status),['failed','converted']);assert.match(result.results[0].error,/PPTX lyrics timed out/);assert.equal(closed,1);assert.equal(created,2);assert.equal((await fs.readdir(directory)).filter(file=>file.endsWith('.pro')).length,1);}finally{work.createSession=original;}
}));
test('stopping a blocked reader aborts only that job and keeps completed files and source bytes',()=>batchFixture(async({directory,source})=>{
 const original=await fs.readFile(source),stopController=new AbortController();let copy,aborted=false;const result=await convertFiles([source],directory,{stopSignal:stopController.signal,render:async(file,media,{signal})=>{copy=file;setTimeout(()=>stopController.abort(new DOMException('Stopped','AbortError')),20);return new Promise(()=>{signal.addEventListener('abort',()=>{aborted=true;},{once:true});});}});
 assert.equal(aborted,true);assert.equal(result.stopped,true);assert.deepEqual(result.results,[]);assert.deepEqual(await fs.readFile(source),original);assert.deepEqual(await fs.readdir(directory),[]);await assert.rejects(fs.access(copy));
}));
test('a changed source during extraction cannot publish a presentation or retry marker',()=>batchFixture(async({directory,source})=>{
 const changed=Buffer.from('An operator changed this source');const result=await convertFiles([source],directory,{render:async copy=>{assert.notEqual(copy,source);await fs.writeFile(source,changed);return simpleDocument('Together we sing with hope\nEvery word is kept');}});
 assert.equal(result.results[0].status,'failed');assert.match(result.results[0].error,/source changed/);assert.deepEqual(await fs.readFile(source),changed);assert.deepEqual(await fs.readdir(directory),[]);
}));
test('identity loss after creating a new destination removes only the owned partial file and stops the batch',()=>batchFixture(async({directory,source})=>{
 const originalOpen=fs.open,actualDirectory=await fs.realpath(directory);let allowed=true;fs.open=async(file,...options)=>{const handle=await originalOpen(file,...options);if(path.dirname(file)===actualDirectory&&file.endsWith('.pro'))allowed=false;return handle;};
 try{await assert.rejects(convertFiles([source],directory,{fastPptx:true,checkActive:()=>{if(!allowed)throw Error('Operator changed');}}),/Operator changed/);assert.deepEqual(await fs.readdir(directory),[]);}finally{fs.open=originalOpen;}
}));
test('ordinary editable PPTX conversion is available on Mac without Office or another library chooser',()=>batchFixture(async({directory,source,root})=>{
 const Module=require('node:module'),originalLoad=Module._load,platform=Object.getOwnPropertyDescriptor(process,'platform'),advanced=require('../desktop/advanced.cjs');let choosers=0;
 Module._load=function(request,parent,...rest){if(request==='electron')return{dialog:{showOpenDialog:async()=>{choosers++;return{canceled:false,filePaths:[source]};}}};if(request==='./advanced.cjs'&&parent?.filename.endsWith('/desktop/powerpoint-batch.cjs'))return{...advanced,songsFolder:async()=>directory};return originalLoad.call(this,request,parent,...rest);};Object.defineProperty(process,'platform',{value:'darwin',configurable:true});
 try{const result=await require('../desktop/powerpoint-batch.cjs').start(null,root,()=>{});assert.equal(result.results[0].status,'converted');assert.equal(choosers,1);assert.equal(require('../desktop/powerpoint-batch.cjs').isRunning(),false);}finally{Module._load=originalLoad;Object.defineProperty(process,'platform',platform);}
}));

test('strict song layout checks every slide and permits only one final Amen box beyond the lyric box',()=>{
 const lyrics=shape('Together we sing with hope\nEvery word is kept'),ending=shape('Amen',28,.8,.9,.15,.06),strict=document=>extractLyrics(document,{simpleSongOnly:true});
 assert.equal(strict({slides:[{number:1,shapes:[lyrics,shape('')]},{number:2,shapes:[lyrics,ending]}]}).slides.length,2);
 for(const slides of [[{number:1,shapes:[lyrics,ending]},{number:2,shapes:[lyrics]}],[{number:1,shapes:[lyrics]},{number:2,shapes:[lyrics,shape('Footer'),ending]}],[{number:1,shapes:[lyrics]},{number:2,shapes:[lyrics,shape('2')]}]])assert.throws(()=>strict({slides}),error=>error.code==='SONG_LAYOUT_EXCLUDED'&&/Not converted: slide/.test(error.message));
});
test('an equivalent original with a white background is preserved while a new clean lyric presentation is created',()=>batchFixture(async({directory,source})=>{
 const presentation=require('../desktop/presentation.cjs'),type=require('protobufjs/light').Root.fromJSON(require('../src/shared/propresenter-schema.json')).lookupType('rv.data.Presentation'),data={title:'Old original',slides:[{section:'Lyrics',text:'Together we sing with hope\nEvery word is kept'}]},raw=type.decode(presentation.buildPresentation(data));raw.cues[0].actions[0].slide.presentation.baseSlide.backgroundColor={red:1,green:1,blue:1,alpha:1};const original=Buffer.from(type.encode(raw).finish()),oldPath=path.join(directory,'Old original.pro');await fs.writeFile(oldPath,original);
 const result=await convertFiles([source],directory,{fastPptx:true});assert.equal(result.results[0].status,'converted');assert.notEqual(result.results[0].path,oldPath);assert.deepEqual(await fs.readFile(oldPath),original);assert.equal((await fs.readdir(directory)).filter(name=>name.endsWith('.pro')).length,2);const clean=presentation.decode(await fs.readFile(result.results[0].path)).cues[0].actions[0].slide.presentation.baseSlide;assert.equal(clean.backgroundColor.red||0,0);
}));
test('trusted ledger output can preserve its native UUID and records its actual verified bytes for safe retry',()=>batchFixture(async({directory,source})=>{
 const presentation=require('../desktop/presentation.cjs'),crypto=require('node:crypto'),old=presentation.buildPresentation({title:'Preserved service title',slides:[{section:'Lyrics',text:'Earlier lyric words\nAre saved originally'}]}),destination=path.join(directory,'Owned conversion.pro');let calls=0,linked=0;
 const first=await convertFiles([source],directory,{fastPptx:true,reuseExisting:false,writeOutput:async({extracted,checkActive,signal})=>{calls++;await checkActive();signal.throwIfAborted();const revised=presentation.revisePresentation(old,{title:'New title',...extracted,fontSize:96});await fs.writeFile(destination,revised,{flag:'wx'});return{path:destination,contentHash:crypto.createHash('sha256').update(revised).digest('hex'),bytes:revised.length};}});
 assert.equal(first.results[0].status,'converted');assert.equal(presentation.decode(await fs.readFile(destination)).uuid.string,presentation.decode(old).uuid.string);const bytes=await fs.readFile(destination),second=await convertFiles([source],directory,{fastPptx:true,writeOutput:()=>assert.fail('A valid retry does not call the output writer'),onExisting:async({path:existing,contentHash,targetHash,checkActive,extracted})=>{await checkActive();linked++;assert.equal(existing,await fs.realpath(destination));assert.equal(contentHash,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(targetHash,contentHash);assert.ok(extracted.slides.length);}});
 assert.equal(second.results[0].status,'skipped',JSON.stringify(second.results));assert.equal(calls,1);assert.equal(linked,1);assert.deepEqual(await fs.readFile(destination),bytes);
}));

test('strict one-box songs keep short or off-center lyric words without the old heading heuristic',()=>{
 const result=extractLyrics({slides:[{number:1,shapes:[shape('Hallelujah',12,.95,.01,.03,.03)]},{number:2,shapes:[shape('Amen')]},{number:3,shapes:[shape('Glory to God'),shape('Amin',16,.8,.95,.15,.03)]}]},{simpleSongOnly:true});assert.deepEqual(result,{slides:[{section:'Lyrics',text:'Hallelujah'},{section:'Lyrics',text:'Amen'},{section:'Lyrics',text:'Glory to God'}],language:'ron'});
});
