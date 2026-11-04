const {test}=require('node:test'),assert=require('node:assert/strict');const {buildPresentation,decode}=require('../desktop/presentation.cjs');const {permittedUrl}=require('../desktop/lyrics.cjs');
test('creates a binary ProPresenter document with complete cue/group references and no named arrangement suffix and preserved multilingual lyrics',()=>{const buffer=buildPresentation({title:'Verification · Stați',slides:[{section:'Verse 1',text:'Together\nÎmpreună {all} \\ today'},{section:'Chorus',text:'A second section'}]});assert.notEqual(buffer[0],'{'.charCodeAt(0));const doc=decode(buffer);assert.equal(doc.name,'Verification · Stați');assert.equal(doc.cues.length,2);assert.equal(doc.applicationInfo.applicationVersion.minorVersion,11);assert.equal(doc.cueGroups.length,2);for(let i=0;i<2;i++){assert.equal(doc.cueGroups[i].cueIdentifiers[0].string,doc.cues[i].uuid.string);}assert.equal(doc.arrangements?.length||0,0);assert.equal(doc.selectedArrangement,undefined);const raw=Buffer.from(doc.cues[0].actions[0].slide.presentation.baseSlide.elements[0].element.text.rtfData,'base64').toString();assert.ok(raw.includes('\\u206?mpreun\\u259?'));assert.ok(raw.includes('\\{all\\}'));});
test('creates media-backed PowerPoint slide elements without invented editable text',()=>{const d=decode(buildPresentation({title:'PPTX verification',slides:[{section:'PowerPoint',text:'Slide 1'}]},['C:/Slide-001.png']));const e=d.cues[0].actions[0].slide.presentation.baseSlide.elements[0].element;assert.equal(e.text,undefined);assert.equal(e.fill.media.image.drawing.naturalSize.width,1920);assert.ok(e.fill.media.url.absoluteString.includes('Slide-001.png'));});
test('song slides contain only white lyrics on black, with a localized ending only on the last slide',()=>{
 for(const [language,ending] of [['eng','Amen'],['ron','Amin']]){
  const doc=decode(buildPresentation({title:'Song',language,slides:[{section:'Verse 1',text:'First lyric'},{section:'Chorus',text:'Last lyric'}]}));
  doc.cues.forEach((cue,index)=>{const slide=cue.actions[0].slide.presentation.baseSlide;assert.equal(slide.drawsBackgroundColor,true);assert.deepEqual([slide.backgroundColor.red||0,slide.backgroundColor.green||0,slide.backgroundColor.blue||0,slide.backgroundColor.alpha],[0,0,0,1]);assert.equal(slide.elements.length,index===1?2:1);const lyric=slide.elements[0].element;assert.equal(lyric.name,'Lyrics');const raw=Buffer.from(lyric.text.rtfData,'base64').toString('ascii');assert.ok(raw.includes('\\red255\\green255\\blue255'));assert.ok(!raw.includes('Verse 1')&&!raw.includes('Chorus'));if(index===1){const footer=slide.elements[1].element;const rtf=Buffer.from(footer.text.rtfData,'base64').toString('ascii');assert.ok(rtf.endsWith(' '+ending+'}'));assert.ok(rtf.includes('\\qr'));assert.equal(footer.bounds.origin.y,960);assert.equal(footer.bounds.origin.x+footer.bounds.size.width,1840);}});
 }
});
test('song ending language uses local word matching and an explicit override',()=>{const {songEnding}=require('../src/shared/song-language.js');assert.equal(songEnding('Doamne, noi cantam slava pentru Tine'),'Amin');assert.equal(songEnding('We sing your glory, Lord'),'Amen');assert.equal(songEnding('Short ambiguous lyric','ron'),'Amin');assert.throws(()=>buildPresentation({title:'Song',language:'other',slides:[{text:'Line',section:'Verse'}]}));});
test('rejects empty or excessive presentation exports',()=>{assert.throws(()=>buildPresentation({title:'Empty',slides:[]}));assert.throws(()=>buildPresentation({title:'Too big',slides:Array.from({length:501},()=>({section:'Verse',text:'x'}))}));});
test('PC lyrics URLs reject insecure, credentialed, local, and nonstandard-port targets',()=>{for(const u of ['http://localhost','https://127.0.0.1','https://a:b@hymnary.org','https://hymnary.org:8443'])assert.throws(()=>permittedUrl(u));});
const {findSong,songTitle}=require('../desktop/library.cjs');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
test('finds multilingual lyrics inside a native song with an unrelated filename',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stati-library-'));try{await fs.writeFile(path.join(dir,'number-042.pro'),buildPresentation({title:'Old title',slides:[{section:'Verse 1',text:'Împreună cântăm\nSecond line'}]}));const result=await findSong(dir,[{text:'Împreună cântăm\nSecond line'}]);assert.equal(result.matches.length,1);assert.equal(result.matches[0].path,path.join(dir,'number-042.pro'));assert.equal((await fs.readdir(dir)).length,1);}finally{await fs.rm(dir,{recursive:true,force:true});}});
test('names songs by first lyric line and optional parenthesized name',()=>{assert.equal(songTitle([{text:'Verse 1\nFirst lyric\nSecond lyric'}],'Song name'),'First lyric (Song name)');assert.equal(songTitle([{text:'First lyric\nSecond lyric'}]),'First lyric');});
test('searches nested text files by content instead of filename',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stati-library-'));try{await fs.mkdir(path.join(dir,'songs'));await fs.writeFile(path.join(dir,'songs','123.txt'),'Chorus\nExisting first line\nNext line');assert.equal((await findSong(dir,[{text:'Existing first line\nNext line'}])).matches.length,1);assert.equal((await findSong(dir,[{text:'Different song'}])).matches.length,0);}finally{await fs.rm(dir,{recursive:true,force:true});}});

test('public lyric URLs accept other sites while private addresses stay blocked',()=>{const {publicAddress}=require('../desktop/lyrics.cjs');assert.equal(permittedUrl('https://example.org/song').hostname,'example.org');for(const ip of ['10.0.0.1','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','127.0.0.1','::1'])assert.equal(publicAddress(ip),false);assert.equal(publicAddress('1.1.1.1'),true);});
test('lyrics extraction preserves verse lines and excludes navigation',async()=>{const {parseLyrics}=require('../desktop/lyrics.cjs');const result=await parseLyrics('<html><head><title>Song</title></head><body><nav>Sign up</nav><div class="lyrics">Împreună cântăm<br>Slavă Domnului<p>We sing together<br>Glory to God</p></div><footer>Contact</footer></body></html>','https://example.org/song');assert.equal(result.text,'Împreună cântăm\nSlavă Domnului\nWe sing together\nGlory to God');assert.ok(!result.text.includes('Sign up'));});

test('Resurse Creștine chooses the original lyrics once, preserves verse breaks and ignores duplicate display',async()=>{const {parseLyrics}=require('../desktop/lyrics.cjs');const result=await parseLyrics('<html><body><div class="lyrics">Duplicate display text should be ignored</div><div class="resized-text">1. Prima linie<br>\r\nA doua linie<br>\r<br>\r\n2. Următoarea strofă<br>\r\nUltima linie</div><footer>Statistici</footer></body></html>','https://www.resursecrestine.ro/cantece/123/test');assert.equal(result.text,'1. Prima linie\nA doua linie\n\n2. Următoarea strofă\nUltima linie');});

test('OCR cleanup drops isolated edge artwork fragments without changing lyric words or short lines',()=>{const {cleanOcrText}=require('../src/shared/ocr-text.js');assert.equal(cleanOcrText('J    We sing together today\noy          Let every heart prepare\nAnd wonders of His love,                  xt\nI am here\nAmen'),'We sing together today\nLet every heart prepare\nAnd wonders of His love,\nI am here\nAmen');});

test('Resurse Creștine separates explicit author notes from lyrics without dropping an ordinary lyric mentioning an author',async()=>{const {parseLyrics}=require('../desktop/lyrics.cjs');const result=await parseLyrics('<html><body><div class="resized-text">Cântăm împreună Domnului<br>Autor al vieții ești Tu<br><br>I: Autor text: Attribution Example<br>Compozitor: Example</div></body></html>','https://www.resursecrestine.ro/cantece/123/test');assert.equal(result.text,'Cântăm împreună Domnului\nAutor al vieții ești Tu');assert.ok(result.credits.includes('Attribution Example'));});
test('exports larger bold Arial lyrics with native shrink-to-fit and a readable ending',()=>{
 const doc=decode(buildPresentation({title:'Readable lyrics',language:'eng',slides:[{section:'Verse',text:'Joy to the world\nThe Lord is come'}]}));
 const elements=doc.cues[0].actions[0].slide.presentation.baseSlide.elements;
 for(const [index,size] of [[0,192],[1,72]]){
  const text=elements[index].element.text;
  const rtf=Buffer.from(text.rtfData,'base64').toString('ascii');
  assert.ok(rtf.includes('Arial;'));
  assert.ok(rtf.includes('\\fs'+size+(index===0?'\\b':'\\b0\\i')+'\\cf1'));
  assert.equal(text.scaleBehavior,2);
 }
});

test('fits the widest lyric line with padded edges and respects the selected maximum',()=>{
 const {lyricFontSize,LYRIC_BOUNDS}=require('../src/shared/lyric-layout.js');
 assert.equal(lyricFontSize('Short line',72),72);
 assert.ok(lyricFontSize('W'.repeat(30),160)<lyricFontSize('i'.repeat(30),160));
 assert.equal(lyricFontSize('W'.repeat(30)+'\nShort',160),lyricFontSize('W'.repeat(30),160));
 const doc=decode(buildPresentation({title:'Fit',fontSize:72,slides:[{section:'Verse',text:'Short line'}]}));
 const e=doc.cues[0].actions[0].slide.presentation.baseSlide.elements[0].element;
 assert.equal(e.bounds.origin.x,120);assert.equal(e.bounds.size.width,1680);
 assert.ok(Buffer.from(e.text.rtfData,'base64').toString().includes('\\fs144\\b'));
 assert.ok(lyricFontSize(Array(8).fill('Short').join('\n'),160)*8*1.2<=LYRIC_BOUNDS.height);
 assert.throws(()=>buildPresentation({title:'Invalid',fontSize:NaN,slides:[{section:'Verse',text:'Hello'}]}));
});
