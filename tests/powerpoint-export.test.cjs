const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),Module=require('node:module'),JSZip=require('jszip');
const {DOMParser}=require('linkedom'),{buildPowerPointLyrics}=require('../desktop/powerpoint-export.cjs'),{readPptxLyrics}=require('../desktop/pptx-lyrics.cjs'),work=require('../desktop/conversion-work.cjs');
const data=(extra={})=>({title:'A title kept in document metadata',songName:'Rehearsal song',fontSize:96,language:'eng',slides:[{section:'Verse 1',text:'We sing your glory, Lord\nYour mercy is new each morning'},{section:'Chorus',text:'We lift our hearts together\nWe sing with joy and hope'}],...extra});
const parse=value=>new DOMParser().parseFromString(value,'text/xml'),all=(doc,name)=>[...doc.getElementsByTagName(name)],texts=doc=>all(doc,'a:t').map(node=>node.textContent);
async function deck(bytes){assert.ok(Buffer.isBuffer(bytes));const zip=await JSZip.loadAsync(bytes),presentation=parse(await zip.file('ppt/presentation.xml').async('string')),slides=[];for(let number=1;number<=all(presentation,'p:sldId').length;number++)slides.push(parse(await zip.file('ppt/slides/slide'+number+'.xml').async('string')));return{zip,presentation,slides};}
async function fixture(check){const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-pptx-export-'));try{await check(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
async function withAdvanced(dialog,check){const entry=require.resolve('../desktop/advanced.cjs'),previous=require.cache[entry],oldLoad=Module._load;delete require.cache[entry];Module._load=function(name,parent,main){return name==='electron'?{dialog,shell:{},BrowserWindow:class{}}:oldLoad.call(this,name,parent,main);};try{await check(require(entry));}finally{Module._load=oldLoad;delete require.cache[entry];if(previous)require.cache[entry]=previous;}}

test('editable PowerPoint lyrics preserve requested slide order and words without a cover, section labels or slide numbers',async()=>{
 const input=data(),{zip,slides,presentation}=await deck(await buildPowerPointLyrics(input));assert.equal(slides.length,2);
 assert.deepEqual(texts(slides[0]),input.slides[0].text.split('\n'));assert.deepEqual(texts(slides[1]),[...input.slides[1].text.split('\n'),'Amen']);
 for(const page of slides){assert.equal(all(page,'p:pic').length,0);assert.ok(all(page,'p:sp').length);const visible=texts(page).join('\n');assert.doesNotMatch(visible,/Verse 1|Chorus|A title kept|Rehearsal song|^1$|^2$/m);}
 assert.equal(Object.keys(zip.files).filter(name=>/^ppt\/media\//.test(name)&&!zip.files[name].dir).length,0);
 const size=all(presentation,'p:sldSz')[0];assert.equal(Number(size.getAttribute('cx'))/Number(size.getAttribute('cy')),16/9);assert.equal(Number(size.getAttribute('cx')),12192000);assert.equal(Number(size.getAttribute('cy')),6858000);
});

test('PowerPoint lyric geometry matches existing padding, center alignment, black canvas and white Arial bold text',async()=>{
 const {slides}=await deck(await buildPowerPointLyrics(data())),body=all(slides[0],'p:sp')[0],transform=all(body,'a:xfrm')[0],offset=all(transform,'a:off')[0],extent=all(transform,'a:ext')[0];
 assert.equal(offset.getAttribute('x'),'762000');assert.equal(offset.getAttribute('y'),'508000');assert.equal(extent.getAttribute('cx'),'10668000');assert.equal(extent.getAttribute('cy'),'5334000');
 assert.equal(all(slides[0],'p:bgPr')[0].querySelector('a\\:srgbClr').getAttribute('val'),'000000');
 assert.equal(all(body,'a:bodyPr')[0].getAttribute('anchor'),'ctr');assert.equal(all(body,'a:bodyPr')[0].getAttribute('wrap'),'none');
 for(const run of all(body,'a:rPr')){assert.equal(run.getAttribute('sz'),'4800');assert.equal(run.getAttribute('b'),'1');assert.equal(all(run,'a:srgbClr')[0].getAttribute('val'),'FFFFFF');assert.equal(all(run,'a:latin')[0].getAttribute('typeface'),'Arial');}
 assert.ok(all(body,'a:pPr').every(node=>node.getAttribute('algn')==='ctr'));
 const ending=all(slides[1],'p:sp').at(-1),endingRun=all(ending,'a:rPr')[0];assert.equal(endingRun.getAttribute('sz'),'1800');assert.equal(endingRun.getAttribute('i'),'1');assert.equal(endingRun.getAttribute('b'),null);assert.equal(all(ending,'a:pPr')[0].getAttribute('algn'),'r');
});

for(const [language,text,ending]of [['auto','Laudăm Domnul nostru\nÎmpreună cântăm cu bucurie','Amin'],['eng','Laudăm Domnul nostru\nÎmpreună cântăm cu bucurie','Amen'],['ron','We sing your glory, Lord\nYour mercy is new each morning','Amin']])test('Romanian bytes and '+language+' language ending survive editable PPTX export and real reader roundtrip',()=>fixture(async root=>{
 const bytes=await buildPowerPointLyrics(data({language,slides:[{section:'Verse',text}]})),file=path.join(root,'lyrics.pptx');await fs.writeFile(file,bytes);const {slides}=await deck(bytes);assert.deepEqual(texts(slides[0]),[...text.split('\n'),ending]);const extracted=await readPptxLyrics(file);assert.ok(extracted,'The generated package must be readable by the existing fast path');assert.equal(extracted.slides[0].text,text);assert.equal(extracted.language,ending==='Amin'?'ron':'eng');
}));

test('long lyrics wrap and paginate without losing words while font choices preserve their relative slide scale',async()=>{
 const long=Array.from({length:90},(_,index)=>'lyric'+index).join(' '),{slides}=await deck(await buildPowerPointLyrics(data({fontSize:120,linesPerSlide:2,slides:[{section:'Verse',text:long}]}))),words=slides.flatMap(texts).filter(value=>value!=='Amen').join(' ').split(/\s+/);
 assert.deepEqual(words,long.split(' '));assert.ok(slides.length>1);for(const [index,page]of slides.entries()){const shapes=all(page,'p:sp');assert.equal(shapes.length,index===slides.length-1?2:1);const lyric=shapes[0];assert.ok(all(lyric,'a:p').length<=2);for(const run of all(lyric,'a:rPr'))assert.ok(Number(run.getAttribute('sz'))>=1600&&Number(run.getAttribute('sz'))<=6000);}
 const small=await deck(await buildPowerPointLyrics(data({fontSize:64})));assert.equal(all(small.slides[0],'a:rPr')[0].getAttribute('sz'),'3200');
});

test('invalid slides and unreadable lyric text are rejected before a package is returned',async()=>{
 for(const input of [null,data({title:''}),data({slides:[]}),data({slides:Array.from({length:501},()=>({section:'Verse',text:'Valid lyric words'}))}),data({fontSize:161}),data({language:'unsupported'}),data({slides:[{section:'Verse',text:'   '}]}),data({slides:[{section:'Verse',text:'W'.repeat(200)}]}),data({slides:[{section:'Verse',text:'Invalid\u0000lyrics'}]})])await assert.rejects(buildPowerPointLyrics(input));
});

test('one-shot and reusable conversion workers return real PPTX Buffer bytes',async()=>{
 const first=await work('pptx-build',data());assert.equal((await deck(first)).slides.length,2);const session=work.createSession();try{const second=await session.run('pptx-build',data({language:'ron'}));assert.ok(Buffer.isBuffer(second));assert.equal(texts((await deck(second)).slides.at(-1)).at(-1),'Amin');}finally{await session.close();}
 const controller=new AbortController();controller.abort();await assert.rejects(work.withSignal('pptx-build',controller.signal,data()),{name:'AbortError'});
});

test('native export creates an editable .pptx with the reviewed title without asking for or changing the Lyrics library',()=>fixture(async root=>{
 const output=path.join(root,'song.pptx'),calls=[];
 await withAdvanced({showSaveDialog:async(parent,options)=>{calls.push(options);return{canceled:false,filePath:output};}},async advanced=>{
  let authorityChecks=0;const result=await advanced.exportPowerPoint(data(),null,root,()=>{authorityChecks++;});assert.equal(result.path,output);assert.ok(authorityChecks>=4);assert.equal(calls.length,1);assert.equal(calls[0].filters[0].extensions[0],'pptx');assert.ok(calls[0].defaultPath.endsWith('We sing your glory, Lord (Rehearsal song).pptx'));assert.equal((await deck(await fs.readFile(output))).slides.length,2);assert.deepEqual(await fs.readdir(root),['song.pptx']);
 });
}));

test('native export cancellation and invalid extensions create no output; existing destinations remain immutable',()=>fixture(async root=>{
 await withAdvanced({showSaveDialog:async()=>({canceled:true})},async advanced=>{assert.deepEqual(await advanced.exportPowerPoint(data(),null,root),{canceled:true});});assert.deepEqual(await fs.readdir(root),[]);
 const existing=path.join(root,'existing.pptx');await fs.writeFile(existing,'Original file bytes');await withAdvanced({showSaveDialog:async()=>({canceled:false,filePath:existing})},async advanced=>{await assert.rejects(advanced.exportPowerPoint(data(),null,root),/already exists/);});assert.equal(await fs.readFile(existing,'utf8'),'Original file bytes');
 await withAdvanced({showSaveDialog:async()=>({canceled:false,filePath:path.join(root,'wrong.txt')})},async advanced=>{await assert.rejects(advanced.exportPowerPoint(data(),null,root),/\.pptx filename/);});assert.deepEqual(await fs.readdir(root),['existing.pptx']);
}));

for(const canceledAt of [1,2,3,4,5])test('operator loss at export boundary '+canceledAt+' cannot leave a newly created PowerPoint file',()=>fixture(async root=>{
 const output=path.join(root,'song.pptx');let checks=0;
 await withAdvanced({showSaveDialog:async()=>({canceled:false,filePath:output})},async advanced=>{await assert.rejects(advanced.exportPowerPoint(data(),null,root,()=>{if(++checks===canceledAt)throw Error('Operator changed');}),/Operator changed/);});assert.deepEqual(await fs.readdir(root),[]);
}));
