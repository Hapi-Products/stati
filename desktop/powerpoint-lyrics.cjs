// Select large central text, rather than copying legacy slide decoration.
function extractLyrics(document,{simpleSongOnly=false}={}){
 if(simpleSongOnly){for(const [index,slide] of (document.slides||[]).entries()){const boxes=(slide.shapes||[]).filter(shape=>String(shape.text||'').trim()),last=index===document.slides.length-1,ending=box=>/^(amen|amin)[.!]?$/i.test(String(box.text).trim());if(boxes.length!==1&&!(last&&boxes.length===2&&boxes.filter(ending).length===1)||slide.additionalTextBoxes>0){const error=Error('Not converted: slide '+(slide.number||index+1)+' has '+(boxes.length+(slide.additionalTextBoxes||0))+' non-empty text boxes. Use one per slide; only the last slide may have an additional Amen / Amin box.');error.code='SONG_LAYOUT_EXCLUDED';throw error;}}}

 const {lyricSection,cleanLyricLine}=require('../src/shared/lyric-labels.js');const slides=[];let ending='';
 if(simpleSongOnly){for(const [index,slide] of (document.slides||[]).entries()){const last=index===document.slides.length-1,boxes=(slide.shapes||[]).map(shape=>String(shape.text||'').replace(/\r\n?|\v/g,'\n').trim()).filter(Boolean),footer=text=>/^(amen|amin)[.!]?$/i.test(text);let text=boxes.find(value=>!last||!footer(value))||'';if(last){const found=boxes.find(footer);if(found)ending=/amin/i.test(found)?'ron':'eng';}let lines=text.split('\n').map(line=>line.trim()).filter(line=>line&&!lyricSection(line)).map(cleanLyricLine).filter(Boolean);if(last&&lines.length&&footer(lines.at(-1))){ending=/amin/i.test(lines.at(-1))?'ron':'eng';lines.pop();}if(lines.length)slides.push({section:'Lyrics',text:lines.join('\n')});}if(!slides.length)throw Error('No song lyrics were found in the selected text boxes.');return{slides,language:ending||'auto'};}
 for(const slide of document.slides||[]){
  const candidates=(slide.shapes||[]).map(s=>({...s,text:String(s.text||'').replace(/\r\n?|\v/g,'\n').trim()}))
   .filter(s=>s.text&&!/https?:\/\/|www\.|\S+@\S+|©/i.test(s.text)&&!/^\d+$/.test(s.text));
  const endings=candidates.filter(s=>/^(amen|amin)[.!]?$/i.test(s.text));
  if(endings.length)ending=/amin/i.test(endings[0].text)?'ron':'eng';
  const central=candidates.filter(s=>!endings.includes(s)&&s.x+s.width/2>=.15&&s.x+s.width/2<=.85&&s.y+s.height/2>=.12&&s.y+s.height/2<=.88&&s.fontSize>0);
  if(!central.length){if(endings.length||!candidates.length)continue;throw Error('Slide '+slide.number+': no clear central lyrics. Review this presentation manually.');}
  const largest=Math.max(...central.map(s=>s.fontSize));
  const selected=central.filter(s=>s.fontSize>=largest*.8).sort((a,b)=>a.y-b.y||a.x-b.x);
  const lines=selected.flatMap(s=>s.text.split('\n')).map(s=>s.trim()).filter(s=>s&&!lyricSection(s)).map(cleanLyricLine).filter(Boolean);
  // Existing end labels and slide numbers are decoration, not lyric lines.
  const text=lines.filter(s=>!/^\d+$/.test(s)&&! /^(amen|amin)[.!]?$/i.test(s)).join('\n');
  const lastLine=lines.at(-1)||'';if(/^(amen|amin)[.!]?$/i.test(lastLine))ending=/amin/i.test(lastLine)?'ron':'eng';
  if(!text)continue;
  if(!text.includes('\n')&&text.split(/\s+/).length<3)throw Error('Slide '+slide.number+': central text may be a heading. Review this presentation manually.');
  slides.push({section:'Lyrics',text});
 }
 if(!slides.length)throw Error('No clear song lyrics found. Image-only slides need manual review.');
 return {slides,language:ending||'auto'};
}
module.exports={extractLyrics};
