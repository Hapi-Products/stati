'use strict';
// Text-only synchronization. Slide count, text-box identity, geometry, media,
// backgrounds and existing font styles remain intact; unsupported edits stop.
const JSZip=require('jszip'),{DOMParser}=require('linkedom'),protobuf=require('protobufjs/light');
const Presentation=protobuf.Root.fromJSON(require('../src/shared/propresenter-schema.json')).lookupType('rv.data.Presentation');
const {rtfPlain}=require('./rtf-text.cjs');
const fail=()=>{throw Error('This layout cannot be updated without changing its appearance. Keep both files and review this song manually.');};
const lines=text=>{const value=String(text).replace(/\r\n?/g,'\n');if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||Array.from(value).some(character=>character.length===1&&character.charCodeAt(0)>=0xd800&&character.charCodeAt(0)<=0xdfff))fail();return value.split('\n').map(line=>line.trim()).filter(Boolean);};
const encode=text=>Array.from(text).map(c=>'\\{}'.includes(c)?'\\'+c:c.charCodeAt(0)>127?c.split('').map(u=>'\\u'+(u.charCodeAt(0)>32767?u.charCodeAt(0)-65536:u.charCodeAt(0))+'?').join(''):c).join('');
const destinations=new Set(['fonttbl','colortbl','stylesheet','info','pict','object','filetbl','listtable','listoverridetable','listtext','pntext','fldinst','datastore','themedata','colorschememapping','xmlnstbl','generator']);
function replaceRtfLyrics(raw,text){
 if(typeof raw!=='string'||/\\(?:field|bin)\b/.test(raw))fail();
 const stack=[],spans=[],paragraphs=[];let state={skip:false,uc:1,style:{}},fallback=0,line=0;
 function visible(start,end,value,rendered=true){if(state.skip)return;spans.push({start,end,line});if(!rendered)return;const item=paragraphs[line]||(paragraphs[line]={text:'',first:spans.length-1,style:null});item.text+=value;if(value.trim()){if(item.style===null)item.first=spans.length-1;const style=JSON.stringify(state.style);if(item.style!==null&&item.style!==style)fail();item.style=style;}}
 for(let i=0;i<raw.length;){const start=i,c=raw[i++];
  if(c==='{'){if(stack.length>512)fail();stack.push(state);state={...state,style:{...state.style}};continue;}
  if(c==='}'){state=stack.pop()||state;fallback=0;continue;}
  if(c==='\r'||c==='\n')continue;
  if(c!=='\\'){if(fallback&&!state.skip){visible(start,i,'',false);fallback--;}else visible(start,i,c);continue;}
  const next=raw[i++];if(next===undefined)fail();
  if(next==='*'){state.skip=true;continue;}
  if(next==='\''&&/^[\da-f]{2}$/i.test(raw.slice(i,i+2))){const byte=parseInt(raw.slice(i,i+2),16);i+=2;if(fallback&&!state.skip){visible(start,i,'',false);fallback--;}else visible(start,i,String.fromCharCode(byte));continue;}
  if(!/[a-z]/i.test(next)){if(['\\','{','}','~','_','-'].includes(next)){if(fallback&&!state.skip){visible(start,i,'',false);fallback--;}else visible(start,i,next==='~'?' ':next==='-'?'':next);}continue;}
  let word=next;while(/[a-z]/i.test(raw[i]||''))word+=raw[i++];const number=raw.slice(i).match(/^-?\d+/);if(number)i+=number[0].length;if(raw[i]===' ')i++;
  if(destinations.has(word)){state.skip=true;continue;}if(state.skip)continue;
  const value=number?Number(number[0]):1;
  if(word==='uc'){if(value<0||value>16)fail();state.uc=value;continue;}
  if(word==='u'){visible(start,i,String.fromCharCode(value&65535));fallback=state.uc;continue;}
  if(word==='par'||word==='line'){line++;fallback=0;continue;}
  if(word==='plain')state.style={};
  else if(['tab','emdash','endash','lquote','rquote','ldblquote','rdblquote'].includes(word))visible(start,i,word==='tab'?'    ':'x');
  else state.style[word]=value; // Unknown mid-lyric controls are conservatively formatting changes too.
 }
 const meaningful=paragraphs.map((item,index)=>({item,index})).filter(({item})=>item?.text.trim()),incoming=lines(text);if(meaningful.length!==incoming.length)fail();
 const inserts=new Map(meaningful.map(({item},index)=>[item.first,'{\\uc1 '+encode(incoming[index])+'}'])),parts=[];let offset=0;
 for(const [index,span]of spans.entries()){parts.push(raw.slice(offset,span.start),inserts.get(index)||'');offset=span.end;}parts.push(raw.slice(offset));
 const result=parts.join('');if(rtfPlain(result)!==incoming.join('\n'))fail();return result;
}
function proDocument(bytes){
 const doc=Presentation.decode(bytes),records=[];
 if(!doc.cues?.length||doc.cues.length>500)fail();
 for(const [index,cue]of doc.cues.entries()){
  const candidates=[];
  for(const action of cue.actions||[])for(const item of action.slide?.presentation?.baseSlide?.elements||[]){const element=item.element;if(!element?.text?.rtfData)continue;const rtf=Buffer.from(element.text.rtfData).toString('latin1'),text=rtfPlain(rtf);if(!text.trim())continue;if(element.name==='Song ending'&&/^(Amen|Amin)[.!]?$/i.test(text.trim()))continue;if(index===doc.cues.length-1&&/^(Amen|Amin)[.!]?$/i.test(text.trim())&&element.name!=='Lyrics')continue;candidates.push({element,rtf,text});}
  if(candidates.length!==1)fail();records.push(candidates[0]);
 }
 return{doc,records,slides:records.map(record=>({section:'Lyrics',text:record.text}))};
}
function patchProLyrics(original,slides){
 const parsed=proDocument(original);if(slides.length!==parsed.records.length)fail();const updates=new Map();
 for(const [index,record]of parsed.records.entries())updates.set(record.element.text,{before:Buffer.from(record.element.text.rtfData),after:Buffer.from(replaceRtfLyrics(record.rtf,slides[index].text),'latin1'),seen:0});
 // Patch only the known RTF byte fields in their original wire envelopes.
 // Unknown protobuf fields, including future-version metadata, remain exact.
 function patch(type,bytes,value,depth=0){
  if(depth>128)fail();const reader=protobuf.Reader.create(bytes),parts=[],indexes=new Map();
  while(reader.pos<reader.len){const start=reader.pos,tag=reader.uint32(),wire=tag&7,field=type.fieldsById[tag>>>3];
   if(wire!==2||!field){reader.skipType(wire);parts.push(bytes.subarray(start,reader.pos));continue;}
   const length=reader.uint32(),offset=reader.pos,end=offset+length;if(end>reader.len)fail();reader.pos=end;const payload=bytes.subarray(offset,end);let next=payload;
   if(field.name==='rtfData'&&updates.has(value)){
    const update=updates.get(value);if(update.seen++||!payload.equals(update.before))fail();next=update.after;
   }else if(field.resolvedType instanceof protobuf.Type){const index=indexes.get(field.id)||0;indexes.set(field.id,index+1);const child=field.repeated?value?.[field.name]?.[index]:value?.[field.name];if(!child)fail();next=patch(field.resolvedType,payload,child,depth+1);}
   if(next.equals(payload))parts.push(bytes.subarray(start,end));else parts.push(Buffer.from(protobuf.Writer.create().uint32(tag).bytes(next).finish()));
  }
  return Buffer.concat(parts);
 }
 const result=patch(Presentation,Buffer.from(original),parsed.doc);if([...updates.values()].some(update=>update.seen!==1))fail();const verified=proDocument(result);if(verified.slides.some((slide,index)=>slide.text!==lines(slides[index].text).join('\n')))fail();return result;
}
async function patchPowerPointLyrics(original,slides){
 const zip=await JSZip.loadAsync(original);let expanded=0;for(const entry of Object.values(zip.files)){if(entry.dir)continue;const size=entry._data?.uncompressedSize;if(!Number.isSafeInteger(size)||size<0||(expanded+=size)>100*1024*1024)fail();}
 async function xml(name){const entry=zip.file(name);if(!entry||entry._data.uncompressedSize>10*1024*1024)fail();const text=await entry.async('string');if(/<!DOCTYPE|<!ENTITY/.test(text))fail();return text;}
 const doc=new DOMParser().parseFromString(await xml('ppt/presentation.xml'),'text/xml'),rels=new DOMParser().parseFromString(await xml('ppt/_rels/presentation.xml.rels'),'text/xml'),targets=new Map([...rels.getElementsByTagName('Relationship')].filter(item=>item.getAttribute('TargetMode')!=='External').map(item=>[item.getAttribute('Id'),item.getAttribute('Target')])),ids=[...doc.getElementsByTagName('p:sldId')];if(ids.length!==slides.length||!ids.length)fail();const seenParts=new Set();
 for(const [index,id]of ids.entries()){
  const target=targets.get(id.getAttribute('r:id'));if(!target||target.includes('\\'))fail();const name=require('node:path').posix.normalize(target.startsWith('/')?target.slice(1):'ppt/'+target);if(!/^ppt\/slides\/[^/]+\.xml$/.test(name)||seenParts.has(name))fail();seenParts.add(name);
  const source=await xml(name),shapes=[...source.matchAll(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g)],candidates=[];
  for(const shape of shapes){const parsed=new DOMParser().parseFromString(shape[0],'text/xml'),nodes=[...parsed.getElementsByTagName('a:t')],text=nodes.map(node=>node.textContent).join('\n').trim();if(!text)continue;if(index===ids.length-1&&/^(Amen|Amin)[.!]?$/i.test(text))continue;candidates.push({shape,nodes});}
  if(candidates.length!==1)fail();const candidate=candidates[0],incoming=lines(slides[index].text),paragraphs=[...new DOMParser().parseFromString(candidate.shape[0],'text/xml').getElementsByTagName('a:p')];
  if(candidate.nodes.length!==incoming.length||paragraphs.some(paragraph=>paragraph.getElementsByTagName('a:t').length!==1)||/<a:(?:br|fld)\b/.test(candidate.shape[0]))fail();
  let count=0;const changed=candidate.shape[0].replace(/(<a:t(?:\s[^>]*)?>)[\s\S]*?(<\/a:t>)/g,(_whole,start,end)=>start+incoming[count++].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+end);
  zip.file(name,source.slice(0,candidate.shape.index)+changed+source.slice(candidate.shape.index+candidate.shape[0].length));
 }
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
module.exports={replaceRtfLyrics,proDocument,patchProLyrics,patchPowerPointLyrics};
