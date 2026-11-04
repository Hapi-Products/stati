import {layoutLyricSlides,lyricFontSize} from './lyric-layout.js';

export const OUTPUT_LAYOUT_BOUNDS=Object.freeze({
 church:Object.freeze({x:120,y:80,width:1680,height:840}),
 'stream-lyrics':Object.freeze({x:120,y:90,width:1680,height:250}),
 'stream-translation':Object.freeze({x:120,y:760,width:1680,height:250}),
});
export function outputTextFontSize(text,requested=96,profile='church'){
 const bounds=OUTPUT_LAYOUT_BOUNDS[profile];if(!bounds)throw Error('Choose a church or online layout.');
 const lines=Math.max(1,String(text).replace(/\r\n?/g,'\n').split('\n').length);
 return Math.floor(Math.min(lyricFontSize(String(text),requested),bounds.height/(lines*1.2))*2)/2;
}
// Each online cue belongs to one church cue. Translation is supplied manually
// by exact section/text/occurrence key, so a lyric edit never silently reuses a
// translation assigned to different words. The source array is never changed.
export function buildOutputLayouts(source,{fontSize=96,translations={}}={}){
 if(!Array.isArray(source)||source.length>500)throw Error('Prepare up to 500 source slides.');
 const church=layoutLyricSlides(source.map(slide=>({section:slide.section,text:slide.text})),fontSize,6),stream=[],translation=[],occurrences=new Map();
 for(const [churchIndex,slide] of church.entries()){
  const lines=slide.text.replace(/\r\n?/g,'\n').split('\n');
  for(let offset=0;offset<lines.length;offset+=2){
   const text=lines.slice(offset,offset+2).join('\n'),identity=JSON.stringify([slide.section,text]),occurrence=occurrences.get(identity)||0;occurrences.set(identity,occurrence+1);
   const key=JSON.stringify([slide.section,text,occurrence]),translated=translations[key]||'';
   if(typeof translated!=='string'||translated.length>10000)throw Error('Use up to 10,000 characters per translated cue.');
   const cue={section:slide.section,text,key,churchIndex};stream.push(cue);translation.push({...cue,text:translated.replace(/\r\n?/g,'\n')});
  }
 }
 if(church.length>500||stream.length>500)throw Error('This layout needs more than 500 cues. Prepare a smaller part of the song.');
 return{church,stream,translation,missingTranslations:translation.filter(cue=>!cue.text.trim()).length};
}
export function outputLayoutIssues(slides,profile,fontSize=96){
 if(!OUTPUT_LAYOUT_BOUNDS[profile])return['Choose a church or online layout.'];
 const limit=profile==='church'?6:2,issues=[];
 for(const [index,slide] of slides.entries()){
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(slide.text))issues.push('Cue '+(index+1)+': remove the unreadable character before exporting.');
  if(slide.text.replace(/\r\n?/g,'\n').split('\n').length>limit)issues.push('Cue '+(index+1)+': use '+limit+' lines or fewer.');
  if(slide.text.trim()&&outputTextFontSize(slide.text,fontSize,profile)<32)issues.push('Cue '+(index+1)+': break the long line into shorter words or lines before exporting.');
 }
 return issues;
}
