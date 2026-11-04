import {lyricSection,cleanLyricLine} from './lyric-labels.js';
export type Slide={section:string;text:string};
export function splitLyrics(input:string,linesPerSlide=4):Slide[]{
 const max=Math.max(1,Math.min(8,Math.floor(linesPerSlide))),slides:Slide[]=[];let section='Verse',lines:string[]=[];
 const flush=()=>{for(let n=0;n<lines.length;n+=max)slides.push({section,text:lines.slice(n,n+max).join('\n')});lines=[];};
 for(const raw of input.replace(/\r\n?/g,'\n').split('\n')){if(!raw.trim()){flush();continue;}const label=lyricSection(raw);if(label){flush();section=label;continue;}const text=cleanLyricLine(raw);if(text)lines.push(text);}
 flush();return slides;
}
export function escapeXml(s:string){return s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));}
export function rtfText(s:string){return Array.from(s).map(c=>{if(c==='\n')return '\\par ';if('\\{}'.includes(c))return '\\'+c;if(c.charCodeAt(0)>127){return c.split('').map(u=>'\\u'+(u.charCodeAt(0)>32767?u.charCodeAt(0)-65536:u.charCodeAt(0))+'?').join('');}return c;}).join('');}
export function lyricsText(slides:Slide[]){return slides.map(s=>s.text).join('\n\n');}
