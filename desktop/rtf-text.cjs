// Ignore formatting destinations as groups, rather than leaking their payload
// into lyrics. In particular {\*\...} is never visible document text.
const destinations=new Set(['fonttbl','colortbl','stylesheet','info','pict','object','filetbl','listtable','listoverridetable','listtext','pntext','fldinst','datastore','themedata','colorschememapping','xmlnstbl','generator']);
function rtfPlain(raw){
 const stack=[];let state={skip:false,uc:1,codepage:1252},fallback=0,output='';
 const decoders=new Map();
 function decode(bytes){let decoder=decoders.get(state.codepage);if(!decoder){try{decoder=new TextDecoder(state.codepage===65001?'utf-8':'windows-'+state.codepage);}catch{decoder=new TextDecoder('windows-1252');}decoders.set(state.codepage,decoder);}return decoder.decode(Uint8Array.from(bytes));}
 function emit(text){if(state.skip)return;if(fallback){fallback--;return;}output+=text;}
 for(let i=0;i<raw.length;){
  const c=raw[i++];
  if(c==='{'){if(stack.length>=512)throw Error('This song has excessively nested formatting.');stack.push(state);state={...state};continue;}
  if(c==='}'){state=stack.pop()||state;fallback=0;continue;}
  if(c==='\r'||c==='\n')continue;
  if(c!=='\\'){emit(c.charCodeAt(0)>127?decode([c.charCodeAt(0)]):c);continue;}
  const next=raw[i++];if(next===undefined)break;
  if(next==='*'){state.skip=true;continue;}
  if(next==='\''&&/^[\da-f]{2}$/i.test(raw.slice(i,i+2))){const bytes=[];do{bytes.push(parseInt(raw.slice(i,i+2),16));i+=2;if(raw.slice(i,i+2)!=="\\'"||!/^[\da-f]{2}$/i.test(raw.slice(i+2,i+4)))break;i+=2;}while(true);for(let n=0;n<bytes.length&&fallback;n++){bytes[n]=null;fallback--;}if(!state.skip)output+=decode(bytes.filter(n=>n!==null));continue;}
  if(!/[a-z]/i.test(next)){if(next==='\\'||next==='{'||next==='}')emit(next);else if(next==='~')emit('\u00a0');else if(next==='_')emit('\u2011');else if(next==='-')emit('');continue;}
  let word=next;while(i<raw.length&&/[a-z]/i.test(raw[i]))word+=raw[i++];
  const match=raw.slice(i).match(/^-?\d+/);let number;if(match){number=Number(match[0]);i+=match[0].length;}if(raw[i]===' ')i++;
  if(destinations.has(word)){state.skip=true;continue;}
  if(word==='bin'&&Number.isInteger(number)&&number>=0){i=Math.min(raw.length,i+number);continue;}
  if(word==='uc'&&Number.isInteger(number)&&number>=0&&number<=16){state.uc=number;continue;}
  if(word==='ansicpg'&&Number.isInteger(number)){state.codepage=number;continue;}
  if(state.skip)continue;
  if(word==='u'&&Number.isInteger(number)){output+=String.fromCharCode(number&0xffff);fallback=state.uc;}
  else if(word==='par'||word==='line')emit('\n');
  else if(word==='tab')emit('    ');
  else if(word==='emdash')emit('\u2014');else if(word==='endash')emit('\u2013');
  else if(word==='lquote')emit('\u2018');else if(word==='rquote')emit('\u2019');
  else if(word==='ldblquote')emit('\u201c');else if(word==='rdblquote')emit('\u201d');
 }
 return output.split('\n').map(line=>line.trim()).filter(Boolean).join('\n').trim();
}
module.exports={rtfPlain};
