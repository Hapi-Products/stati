const labels='verse|chorus|bridge|intro|outro|refrain|pre[ -]?chorus|tag|ending|strof[ăa]|refren|punte|introducere|încheiere|incheiere|R';
const heading=new RegExp('^[\\[(]?(?:'+labels+')(?:\\s*\\d+)?[\\])]?[.:]?$', 'i');
export function lyricSection(line){const value=String(line).trim();return heading.test(value)||/^\d{1,2}[.)]?$/.test(value)?value.replace(/[\[\]():.]/g,''):null;}
export function cleanLyricLine(line){return String(line).trim().replace(/^\d{1,2}[.)]\s*/,'').replace(new RegExp('^(?:'+labels+')(?:\\s*\\d+)?\\s*[:.]\\s+','i'),'').trim();}
