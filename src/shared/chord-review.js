// Chords are proposals for human review, never an automatic OCR cleanup.
// A single bare A/Am/C/etc. may be a real lyric and is deliberately kept.
const chord=/^[A-G](?:#|b|♯|♭)?(?:(?:maj|min|dim|aug|sus|add|m|M)(?:\d{0,2})?|\d{1,2})?(?:\([^\s()]{1,8}\))?(?:\/[A-G](?:#|b|♯|♭)?)?$/;
const isChord=value=>chord.test(value);
export function chordRemovalSuggestions(text){
 if(typeof text!=='string'||text.length>100000)throw Error('Choose lyrics with 100,000 characters or fewer.');
 const lines=text.replace(/\r\n?/g,'\n').split('\n'),suggestions=[];
 for(let index=0;index<lines.length;index++){
  const original=lines[index];
  let count=0,replacement=original.replace(/\[([^\]\n]+)\]/g,(whole,value)=>{if(!isChord(value.trim()))return whole;count++;return '';});
  if(count){suggestions.push({line:index,original,replacement:replacement.replace(/[ \t]+$/g,''),kind:'inline',count});continue;}
  const tokens=original.trim().split(/[ \t]+/).filter(Boolean),notes=tokens.filter(value=>!['|','||','|:',':|','/','-'].includes(value));
  if(notes.length>=2&&notes.every(isChord))suggestions.push({line:index,original,replacement:'',kind:'line',count:notes.length});
 }
 return suggestions;
}
export function applyChordRemoval(text,suggestions,selected){
 const lines=text.replace(/\r\n?/g,'\n').split('\n'),chosen=new Set(selected);
 for(const edit of suggestions){if(!chosen.has(edit.line))continue;if(lines[edit.line]!==edit.original)throw Error('The lyrics changed. Review the chords again.');lines[edit.line]=edit.replacement;}
 return lines.join('\n');
}
