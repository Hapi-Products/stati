'use strict';
const PptxGenJS=require('pptxgenjs');
const {validate}=require('./presentation.cjs');
const {layoutLyricSlides,lyricFontSize,lyricQualityIssues,LYRIC_BOUNDS}=require('../src/shared/lyric-layout.js');
const {songEnding,songLanguage}=require('../src/shared/song-language.js');
const {songEndingSize,songEndingBounds}=require('../src/shared/song-ending-style.js');

// A 13 1/3 × 7 1/2 inch slide has the same 16:9 canvas as the existing
// 1920 × 1080 lyric layout. Coordinates are inches; PPTX font sizes are points.
const unitsPerInch=144,pointsPerUnit=72/unitsPerInch;
async function buildPowerPointLyrics(input){
 const data=validate(input),slides=layoutLyricSlides(data.slides,data.fontSize,data.linesPerSlide),issues=lyricQualityIssues(slides,data.fontSize);
 if(issues.length)throw Error(issues[0].message);
 const deck=new PptxGenJS();
 deck.defineLayout({name:'STATI_LYRICS',width:1920/unitsPerInch,height:1080/unitsPerInch});deck.layout='STATI_LYRICS';
 deck.author='Stați';deck.company='Hapi Products';deck.subject='Editable lyric slides';deck.title=data.title;
 const language=songLanguage(slides.map(slide=>slide.text).join('\n'),data.language)==='ron'?'ro-RO':'en-US';
 deck.theme={headFontFace:'Arial',bodyFontFace:'Arial',lang:language};
 for(const [index,source] of slides.entries()){
  const slide=deck.addSlide();slide.background={color:'000000'};
  slide.addText(source.text,{
   x:LYRIC_BOUNDS.x/unitsPerInch,y:LYRIC_BOUNDS.y/unitsPerInch,w:LYRIC_BOUNDS.width/unitsPerInch,h:LYRIC_BOUNDS.height/unitsPerInch,
   fontFace:'Arial',fontSize:lyricFontSize(source.text,data.fontSize)*pointsPerUnit,color:'FFFFFF',bold:true,lang:language,
   align:'center',valign:'middle',margin:0,breakLine:false,lineSpacingMultiple:1.2,paraSpaceAfter:0,paraSpaceBefore:0,wrap:false,fit:'none',
  });
  if(index===slides.length-1){const size=songEndingSize(data.amenFontSize),bounds=songEndingBounds(size);slide.addText(songEnding(slides.map(slide=>slide.text).join('\n'),data.language),{
   x:bounds.x/unitsPerInch,y:bounds.y/unitsPerInch,w:bounds.width/unitsPerInch,h:bounds.height/unitsPerInch,
   fontFace:'Arial',fontSize:size*pointsPerUnit,color:'FFFFFF',bold:false,italic:true,align:'right',valign:'middle',margin:0,wrap:false,fit:'none',lang:language,
  });}
 }
 return Buffer.from(await deck.write({outputType:'nodebuffer',compression:true}));
}
module.exports={buildPowerPointLyrics};
