const {test}=require('node:test'),assert=require('node:assert/strict');
const {layoutLyricSlides,lyricFontSize,lyricQualityIssues}=require('../src/shared/lyric-layout.js');
const {buildPresentation,decode}=require('../desktop/presentation.cjs');
const {rtfPlain,songTitle}=require('../desktop/library.cjs');
const words=value=>value.trim().split(/\s+/);
test('long English and Romanian lines wrap without changing words, sections or source drafts',()=>{
 for(const line of ['Together we sing, with joy and hope, and remember every word we have prepared today.','Împreună cântăm și Îi mulțumim Domnului pentru lumină, iubire și speranță în fiecare zi.']){
  const input=[{section:'Verse 1',text:Array(5).fill(line).join('\n')},{section:'Chorus',text:'A short chorus'}],before=structuredClone(input);
  for(const requested of [32,64,96,160])for(const count of [2,4,8]){
   const slides=layoutLyricSlides(input,requested,count);
   assert.deepEqual(input,before);assert.deepEqual(words(slides.map(s=>s.text).join('\n')),words(input.map(s=>s.text).join('\n')));
   assert.ok(slides.every(s=>s.text.split('\n').length<=count));assert.ok(slides.every(s=>lyricFontSize(s.text,requested)>=Math.min(64,requested)));
   assert.ok(slides.slice(0,-1).every(s=>s.section==='Verse 1'));assert.equal(slides.at(-1).section,'Chorus');
   assert.deepEqual(layoutLyricSlides(slides,requested,count),slides);assert.deepEqual(lyricQualityIssues(slides,requested),[]);
  }
 }
});
test('ordinary lyric lines keep their existing breaks and longest-line fitting',()=>{
 const input=[{section:'Verse',text:'A short line\n'+ 'W'.repeat(28)}];
 const out=layoutLyricSlides(input,160,4);assert.deepEqual(out,input);assert.ok(lyricFontSize(out[0].text,160)<160);
});
test('preview layout and decoded ProPresenter output use identical words, breaks, sizes and final ending',()=>{
 const text=Array(7).fill('Împreună cântăm și păstrăm fiecare cuvânt pregătit pentru această cântare a noastră.').join('\n');
 const slides=[{section:'Verse',text}],fontSize=112,linesPerSlide=3,expected=layoutLyricSlides(slides,fontSize,linesPerSlide);
 const doc=decode(buildPresentation({title:'Original song title',language:'ron',fontSize,linesPerSlide,slides}));assert.equal(doc.name,'Original song title');assert.equal(doc.cues.length,expected.length);
 doc.cues.forEach((cue,i)=>{const elems=cue.actions[0].slide.presentation.baseSlide.elements,rtf=Buffer.from(elems[0].element.text.rtfData,'base64').toString('latin1');assert.equal(rtfPlain(rtf),expected[i].text);assert.ok(rtf.includes('\\fs'+lyricFontSize(expected[i].text,fontSize)*2+'\\b'));assert.equal(elems.length,i===expected.length-1?2:1);});
});
test('unreadable tokens, empty slides, invalid characters and excess generated slides stop native export',()=>{
 for(const text of ['W'.repeat(200),'   ','Words\0hidden','Broken \ud800 text'])assert.throws(()=>buildPresentation({title:'Checked',slides:[{section:'Verse',text}]}),/Slide 1:/);
 const text=Array(10).fill('A very long lyric line with many words to place on readable slides.').join('\n');
 assert.throws(()=>buildPresentation({title:'Too many',linesPerSlide:2,slides:Array.from({length:200},()=>({section:'Verse',text}))}),/500 slides/);
 for(const linesPerSlide of [1,9,2.5,NaN])assert.throws(()=>buildPresentation({title:'Invalid',linesPerSlide,slides:[{section:'Verse',text:'Valid line'}]}),/2 and 8/);
 assert.deepEqual(lyricQualityIssues([{text:'Și țară, ă, î, â — together 😀'}]),[]);
});
test('repeat notation is omitted only from the generated title',()=>{
 const slides=[{text:'/: Când te zbați fără speranță :/\nSecond line',section:'Verse'}];
 assert.equal(songTitle(slides),'Când te zbați fără speranță');assert.equal(slides[0].text.startsWith('/:'),true);
 assert.equal(songTitle([{text:'|: Sing / praise :|'}]),'Sing / praise');
});
test('nonbreaking and typographic spaces in pasted lyrics wrap as words without modifying the draft',()=>{
 for(const space of ['\u00a0','\u202f','\u2002','\u2003','\u2009']){
  const text=Array(60).fill('Laudăm').join(space),input=[{section:'Verse',text}],output=layoutLyricSlides(input,96,4);
  assert.equal(input[0].text,text);assert.ok(output.length>1);assert.deepEqual(words(output.map(slide=>slide.text).join('\n')),words(text));assert.ok(output.every(slide=>lyricFontSize(slide.text,96)>=64));assert.deepEqual(lyricQualityIssues(output,96),[]);
  const decoded=decode(buildPresentation({title:'Pasted Romanian',slides:input,fontSize:96,linesPerSlide:4}));assert.equal(decoded.cues.length,output.length);decoded.cues.forEach((cue,index)=>assert.equal(rtfPlain(Buffer.from(cue.actions[0].slide.presentation.baseSlide.elements[0].element.text.rtfData,'base64').toString('latin1')),output[index].text));
 }
 const short=[{section:'Verse',text:'Laudăm\u00a0Domnul'}];assert.deepEqual(layoutLyricSlides(short,96,4),short);assert.equal(lyricFontSize(short[0].text,160),lyricFontSize('Laudăm Domnul',160));
});
test('bounded generated titles never end in half a Unicode character',()=>{
 const input=[{section:'Verse',text:'a'.repeat(179)+'😀 more words'}];assert.equal(songTitle(input),'a'.repeat(179));assert.equal(input[0].text.includes('😀'),true);
 const title=songTitle([{text:'First line'}],'b'.repeat(99)+'😀');assert.equal(title,'First line ('+'b'.repeat(99)+')');
});
test('a named song does not duplicate its first lyric and repeat marks stay out of both title parts',()=>{
 const slides=[{section:'Verse',text:'/: Our Father Everlasting :/\nThe all creating One'}],before=structuredClone(slides);
 assert.equal(songTitle(slides,'Our Father Everlasting (I Believe)'),'Our Father Everlasting (I Believe)');assert.deepEqual(slides,before);
 assert.equal(songTitle([{text:'Laudăm Domnul'}],'/: Cântare nouă :/'),'Laudăm Domnul (Cântare nouă)');
 assert.equal(songTitle([{text:'Laudăm Domnul'}],'|: laudam domnul :|'),'Laudăm Domnul');
});
