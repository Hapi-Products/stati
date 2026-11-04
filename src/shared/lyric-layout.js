import widths from './arial-bold-widths.json' with {type:'json'};
// Arial Bold advance widths, measured in em. Keep generous space inside 1920x1080.
export const LYRIC_BOUNDS={x:120,y:80,width:1680,height:840};
export const LYRIC_MIN_FONT_SIZE=32;
const readableSize=64;
const availableWidth=LYRIC_BOUNDS.width*.96;
const maximumSize=requested=>Number.isFinite(Number(requested))?Math.min(160,Math.max(LYRIC_MIN_FONT_SIZE,Number(requested))):96;
const lineWidth=line=>Array.from(line.normalize('NFC').replace(/[\u00a0\u202f]/g,' ')).reduce((sum,c)=>sum+(widths[c.codePointAt(0)]??1),0);
export function lyricFontSize(text,requested=96){
 const maximum=maximumSize(requested);
 const lines=String(text).replace(/\r/g,'').split('\n');
 const longest=Math.max(1,...lines.map(lineWidth));
 return Math.max(.5,Math.floor(Math.min(maximum,availableWidth/longest,LYRIC_BOUNDS.height/(Math.max(1,lines.length)*1.2))*2)/2);
}

// Keep existing lines until fitting would make them small. Break only between
// words; an unusually long unbroken word is left intact for the quality check.
export function layoutLyricSlides(slides,requested=96,linesPerSlide=8){
 const floor=Math.min(readableSize,maximumSize(requested));
 const capacity=availableWidth/floor;
 const limit=Number.isInteger(linesPerSlide)?Math.max(2,Math.min(8,linesPerSlide)):8;
 const result=[];
 for(const slide of slides){
  const lines=slide.text.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n').flatMap(line=>{
   if(lineWidth(line)<=capacity)return[line];
   const words=line.match(/\S+/gu)||[],wrapped=[];let current='',width=0;
   for(const word of words){
    const nextWidth=lineWidth(word)+(current?width+lineWidth(' '):0);
    if(current&&nextWidth>capacity){wrapped.push(current);current=word;width=lineWidth(word);}
    else{current+=(current?' ':'')+word;width=nextWidth;}
   }
   wrapped.push(current);return wrapped;
  });
  for(let n=0;n<lines.length;n+=limit)result.push({...slide,text:lines.slice(n,n+limit).join('\n')});
 }
 return result;
}

// Report only definite problems. Font coverage and ProPresenter rendering still
// need review on the target computer; this does not claim to detect spelling.
export function lyricQualityIssues(slides,requested=96){
 const issues=[];
 if(slides.length>500)issues.push({slide:0,code:'too-many-slides',message:'This song needs more than 500 slides. Prepare it in smaller parts.'});
 for(let i=0;i<slides.length;i++){
  const text=slides[i].text;
  const issue=(code,message)=>issues.push({slide:i+1,code,message:'Slide '+(i+1)+': '+message});
  if(!text.trim()){issue('empty-slide','add lyrics or remove this empty slide.');continue;}
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)||Array.from(text).some(c=>c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff))issue('invalid-text','remove the unreadable character, or paste that line again.');
  if(lyricFontSize(text,requested)<LYRIC_MIN_FONT_SIZE)issue('small-text','a word is too long to read. Add a space or line break inside it before saving slides.');
 }
 return issues;
}
