// Decorative marks often become tiny fragments separated from a lyric by a wide gap.
// Only discard a short edge fragment when a substantial lyric remains on that line.
export function cleanOcrText(text){return text.split('\n').map(line=>{const parts=line.trim().split(/[ \t]{3,}/);while(parts.length>1&&parts[0].replace(/\s/g,'').length<=3&&parts.slice(1).join(' ').length>=15)parts.shift();while(parts.length>1&&parts.at(-1).replace(/\s/g,'').length<=3&&parts.slice(0,-1).join(' ').length>=15)parts.pop();return parts.join(' ');}).join('\n').trim();}
