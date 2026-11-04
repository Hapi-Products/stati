const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),JSZip=require('jszip'),{DOMParser}=require('linkedom');
const {songEndingSize,songEndingBounds}=require('../src/shared/song-ending-style.js'),{buildPresentation,decode}=require('../desktop/presentation.cjs'),{buildPowerPointLyrics}=require('../desktop/powerpoint-export.cjs'),{openCatalogSong,searchCatalog}=require('../desktop/song-catalog.cjs'),{readServiceRehearsal}=require('../desktop/service-rehearsal.cjs'),{createDraftStore,normalizeDraft}=require('../desktop/prepare-drafts.cjs');
const data=extra=>({title:'Independent lyric and ending sizes',fontSize:96,language:'ron',slides:[{section:'Verse',text:'Împreună cântăm\nSlavă Domnului'},{section:'Chorus',text:'Doamne, Tu ești bun'}],...extra});
const elements=doc=>doc.cues.map(cue=>cue.actions.flatMap(action=>action.slide?.presentation?.baseSlide?.elements||[]).map(item=>item.element));
const rtf=element=>Buffer.from(element.text.rtfData,'base64').toString('latin1');
const parse=value=>new DOMParser().parseFromString(value,'text/xml'),all=(node,name)=>[...node.getElementsByTagName(name)];
async function fixture(check){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stati-ending-size-'));try{await check(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
const protection={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).map(byte=>byte^0xaa),decryptString:bytes=>Buffer.from(bytes).map(byte=>byte^0xaa).toString()},owner='11111111-1111-4111-8111-111111111111';

test('ending size defaults and layout bounds keep a consistent right edge and bottom margin at supported sizes',()=>{
 assert.equal(songEndingSize(),36);assert.equal(songEndingSize(NaN),36);assert.equal(songEndingSize(Infinity),36);assert.equal(songEndingSize(-5),16);assert.equal(songEndingSize(500),96);
 for(const size of [16,24,36,48,64,80,96]){const bounds=songEndingBounds(size);assert.equal(bounds.x,1520);assert.equal(bounds.width,320);assert.equal(bounds.x+bounds.width,1840);assert.equal(bounds.y+bounds.height,1040);assert.ok(bounds.y>=0&&bounds.y+bounds.height<=1080);assert.ok(bounds.height>=size*1.2);}
 assert.deepEqual(songEndingBounds(),{x:1520,y:960,width:320,height:80});
});

test('native ProPresenter ending size changes only the last italic right-aligned ending and preserves independent lyrics',()=>{
 const baseline=elements(decode(buildPresentation(data()))),lyricRtf=baseline.map(page=>rtf(page[0]));
 for(const amenFontSize of [16,36,64,96]){
  const doc=decode(buildPresentation(data({amenFontSize}))),pages=elements(doc),footer=pages.at(-1).find(element=>element.name==='Song ending'),bounds=songEndingBounds(amenFontSize);
  assert.equal(doc.name,data().title);assert.equal(pages.length,2);assert.equal(pages[0].filter(element=>element.name==='Song ending').length,0);assert.equal(pages.at(-1).filter(element=>element.name==='Song ending').length,1);assert.deepEqual(pages.map(page=>rtf(page[0])),lyricRtf);
  assert.match(rtf(footer),new RegExp('\\\\fs'+amenFontSize*2+'\\\\b0\\\\i\\\\cf1 Amin'));assert.match(rtf(footer),/\\pard\\qr/);assert.match(rtf(footer),/\\red255\\green255\\blue255/);assert.deepEqual(footer.bounds,{origin:{x:bounds.x,y:bounds.y},size:{width:bounds.width,height:bounds.height}});
 }
 const english=elements(decode(buildPresentation(data({language:'eng',fontSize:64,amenFontSize:80}))));assert.match(rtf(english[0][0]),/\\fs128\\b/);assert.match(rtf(english.at(-1).at(-1)),/\\fs160\\b0\\i\\cf1 Amen/);
});

test('editable PowerPoint ending size uses the matching slide scale without changing lyric sizes, words or alignment',async()=>{
 for(const amenFontSize of [16,36,64,96]){
  const zip=await JSZip.loadAsync(await buildPowerPointLyrics(data({amenFontSize}))),first=parse(await zip.file('ppt/slides/slide1.xml').async('string')),last=parse(await zip.file('ppt/slides/slide2.xml').async('string')),firstShapes=all(first,'p:sp'),lastShapes=all(last,'p:sp'),footer=lastShapes.at(-1),bounds=songEndingBounds(amenFontSize);
  assert.equal(firstShapes.length,1);assert.equal(lastShapes.length,2);assert.deepEqual(all(lastShapes[0],'a:t').map(node=>node.textContent),[data().slides[1].text]);assert.deepEqual(all(footer,'a:t').map(node=>node.textContent),['Amin']);assert.equal(all(last,'p:pic').length,0);
  const run=all(footer,'a:rPr')[0];assert.equal(Number(run.getAttribute('sz')),amenFontSize*50);assert.equal(run.getAttribute('i'),'1');assert.notEqual(run.getAttribute('b'),'1');assert.equal(all(footer,'a:pPr')[0].getAttribute('algn'),'r');assert.equal(all(run,'a:srgbClr')[0].getAttribute('val'),'FFFFFF');
  for(const body of [firstShapes[0],lastShapes[0]])for(const textRun of all(body,'a:rPr')){assert.equal(textRun.getAttribute('sz'),'4800');assert.equal(textRun.getAttribute('b'),'1');}
  const offset=all(footer,'a:off')[0],extent=all(footer,'a:ext')[0];assert.equal(Number(offset.getAttribute('x')),bounds.x*6350);assert.ok(Math.abs(Number(offset.getAttribute('y'))-bounds.y*6350)<=1);assert.equal(Number(extent.getAttribute('cx')),bounds.width*6350);assert.ok(Math.abs(Number(extent.getAttribute('cy'))-bounds.height*6350)<=1);
 }
});

test('custom ending size survives native library reopen, service rehearsal, same-song editing and version restoration',()=>fixture(async directory=>{
 const {saveLibrarySong,restoreSongVersion}=require('../desktop/song-save.cjs'),file=path.join(directory,'saved.pro'),original=buildPresentation(data({amenFontSize:64}));await fs.writeFile(file,original);const entry=(await searchCatalog(directory)).items[0],opened=await openCatalogSong(directory,entry.id);assert.equal(opened.fontSize,96);assert.equal(opened.amenFontSize,64);assert.doesNotMatch(opened.text,/Amin/);
 const service={id:crypto.randomUUID(),title:'Local check',date:'2026-10-25',time:'10:00',notes:'',revision:1,songs:[{id:crypto.randomUUID(),songId:opened.id,title:opened.title,contentHash:opened.contentHash,reviewed:true}]},rehearsal=await readServiceRehearsal(directory,service);assert.equal(rehearsal.songs[0].fontSize,96);assert.equal(rehearsal.songs[0].slides.at(-1).endingFontSize,64);assert.equal(rehearsal.songs[0].slides.at(-1).ending,'Amin');
 const saved=await saveLibrarySong(directory,opened.id,opened.contentHash,data({amenFontSize:80})),reopened=await openCatalogSong(directory,opened.id);assert.equal(reopened.fontSize,96);assert.equal(reopened.amenFontSize,80);assert.equal(reopened.contentHash,saved.contentHash);assert.deepEqual(decode(await fs.readFile(file)).uuid,decode(original).uuid);
 await restoreSongVersion(directory,opened.id,saved.contentHash,opened.contentHash);const restored=await openCatalogSong(directory,opened.id);assert.equal(restored.amenFontSize,64);assert.deepEqual(await fs.readFile(file),original);assert.equal((await searchCatalog(directory)).items.length,1);
}));

test('encrypted draft restart retains independent lyric and ending settings, with legacy defaults kept compatible',()=>fixture(async directory=>{
 const draft={text:'Împreună cântăm',title:'Local draft',source:'',url:'',songLang:'ron',language:'both',lines:4,fontSizeInput:'112',amenFontSizeInput:'64',libraryId:null,libraryHash:null};await createDraftStore(directory,protection).save(owner,draft);assert.deepEqual((await createDraftStore(directory,protection).load(owner)).draft,draft);const file=path.join(directory,'lyric-draft-'+owner+'.bin'),before=await fs.readFile(file);assert.equal(before.includes(Buffer.from(draft.text)),false);
 for(const amenFontSizeInput of ['15','97','Infinity','not-a-size'])assert.throws(()=>createDraftStore(directory,protection).save(owner,{...draft,amenFontSizeInput}),/Amen \/ Amin size/);assert.deepEqual(await fs.readFile(file),before);
 const {amenFontSizeInput:ignored,...legacy}=draft;assert.deepEqual(normalizeDraft(legacy),legacy);assert.equal(songEndingSize(normalizeDraft(legacy).amenFontSizeInput),36);
}));

test('invalid ending settings reject both native formats while boundary values and the default remain supported',async()=>{
 for(const amenFontSize of [null,'64',NaN,Infinity,-Infinity,15.9,96.1]){assert.throws(()=>buildPresentation(data({amenFontSize})),/Amen \/ Amin size/);await assert.rejects(buildPowerPointLyrics(data({amenFontSize})),/Amen \/ Amin size/);}
 const footer=elements(decode(buildPresentation(data()))).at(-1).at(-1);assert.match(rtf(footer),/\\fs72\\b0\\i/);for(const amenFontSize of [16,96]){assert.ok(buildPresentation(data({amenFontSize})).length);assert.ok((await buildPowerPointLyrics(data({amenFontSize}))).length);}
});

test('actual conversion workers preserve independent ending sizes in both native file formats',async()=>{
 const work=require('../desktop/conversion-work.cjs'),session=work.createSession();try{
  const pro=await work('build',data({amenFontSize:72,fontSize:64})),footer=elements(decode(pro)).at(-1).at(-1);assert.match(rtf(footer),/\\fs144\\b0\\i/);assert.match(rtf(elements(decode(pro))[0][0]),/\\fs128\\b/);
  const pptx=await session.run('pptx-build',data({amenFontSize:72,fontSize:64})),zip=await JSZip.loadAsync(pptx),page=parse(await zip.file('ppt/slides/slide2.xml').async('string')),shapes=all(page,'p:sp');assert.equal(all(shapes[0],'a:rPr')[0].getAttribute('sz'),'3200');assert.equal(all(shapes.at(-1),'a:rPr')[0].getAttribute('sz'),'3600');
 }finally{await session.close();}
});
