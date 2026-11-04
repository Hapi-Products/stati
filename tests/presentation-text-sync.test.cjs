const {test}=require('node:test'),assert=require('node:assert/strict'),protobuf=require('protobufjs/light'),JSZip=require('jszip'),PptxGenJS=require('pptxgenjs');
const {replaceRtfLyrics,patchProLyrics,patchPowerPointLyrics,proDocument}=require('../desktop/presentation-text-sync.cjs');
const {buildPresentation,decode}=require('../desktop/presentation.cjs');
const {rtfPlain}=require('../desktop/rtf-text.cjs');
const Presentation=protobuf.Root.fromJSON(require('../src/shared/propresenter-schema.json')).lookupType('rv.data.Presentation');Presentation.resolveAll();
const unknown=(field,text)=>Buffer.from(protobuf.Writer.create().uint32((field<<3)|2).string(text).finish());
function fieldPath(names){let type=Presentation;return names.map(name=>{const field=type.fields[name];assert.ok(field,'Known fixture field '+name);type=field.resolvedType;return field.id;});}
function appendAt(original,fields,addition){
 if(!fields.length)return Buffer.concat([original,addition]);const reader=protobuf.Reader.create(original),parts=[];let patched=false;
 while(reader.pos<reader.len){const start=reader.pos,tag=reader.uint32(),wire=tag&7;if(wire===2){const length=reader.uint32(),offset=reader.pos,end=offset+length;assert.ok(end<=reader.len);reader.pos=end;if(!patched&&(tag>>>3)===fields[0]){const payload=appendAt(original.subarray(offset,end),fields.slice(1),addition);parts.push(Buffer.from(protobuf.Writer.create().uint32(tag).bytes(payload).finish()));patched=true;}else parts.push(original.subarray(start,end));}else{reader.skipType(wire);parts.push(original.subarray(start,reader.pos));}}
 assert.ok(patched,'Fixture wire path exists');return Buffer.concat(parts);
}
function withoutText(document){const copy=structuredClone(document);for(const cue of copy.cues||[])for(const action of cue.actions||[])for(const item of action.slide?.presentation?.baseSlide?.elements||[])if(item.element?.text)delete item.element.text.rtfData;return copy;}

test('RTF replacements keep the meaningful lyric font and emphasis after differently styled leading whitespace',()=>{
 const cases=[
  {rtf:String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\pard\fs20  \fs80 Old words}`,control:/\\fs(-?\d+)/g,expected:'80'},
  {rtf:String.raw`{\rtf1\ansi\pard\b0   \b1 Old words}`,control:/\\b(-?\d+)/g,expected:'1'},
 ];
 for(const item of cases){const changed=replaceRtfLyrics(item.rtf,'New words');assert.equal(rtfPlain(changed),'New words');const prefix=changed.slice(0,changed.indexOf('New words'));assert.equal([...prefix.matchAll(item.control)].at(-1)[1],item.expected);assert.doesNotMatch(changed,/\\fs20 New words|\\b0 New words/);}
});
test('mixed meaningful RTF styling is rejected instead of flattening the original lyric appearance',()=>{
 assert.throws(()=>replaceRtfLyrics(String.raw`{\rtf1\ansi\pard\fs80 Old \fs60 words}`,'New words'),/cannot be updated/);
});
test('unsupported mid-lyric spacing, outline and reset controls reject instead of silently flattening styled runs',()=>{
 const cases=[String.raw`{\rtf1\ansi\pard\fs80\expnd0 Old \expnd200 words}`,String.raw`{\rtf1\ansi\pard\fs80\outl0 Old \outl1 words}`,String.raw`{\rtf1\ansi\pard\fs80\shad0 Old \shad1 words}`,String.raw`{\rtf1\ansi\pard\fs80\ul1 Old \ulnone words}`,String.raw`{\rtf1\ansi\pard\fs80\super Old \nosupersub words}`];
 for(const original of cases)assert.throws(()=>replaceRtfLyrics(original,'New words'),/cannot be updated/);
});
test('ProPresenter text patching retains root and nested unknown wire metadata, identities, geometry and decoration',()=>{
 const built=buildPresentation({title:'Original song',fontSize:96,slides:[{section:'Verse',text:'Old first line\nOld second line'}]}),document=Presentation.decode(built),base=document.cues[0].actions[0].slide.presentation.baseSlide;
 base.backgroundColor={red:.15,green:.25,blue:.35,alpha:1};
 base.elements.push({element:{uuid:{string:'11111111-1111-4111-8111-111111111111'},name:'Preserved image',opacity:1,bounds:{origin:{x:30,y:40},size:{width:400,height:200}},fill:{enable:true,media:{uuid:{string:'22222222-2222-4222-8222-222222222222'},url:{platform:2,absoluteString:'file:///church/Background.png'},image:{drawing:{scaleBehavior:0,scaleAlignment:0,naturalSize:{width:400,height:200}}}}}}});
 const error=Presentation.verify(document);assert.equal(error,null);const known=Buffer.from(Presentation.encode(document).finish()),rootUnknown=unknown(9000,'ROOT_METADATA_MUST_STAY'),nestedUnknown=unknown(9001,'NESTED_METADATA_MUST_STAY'),nested=appendAt(known,fieldPath(['cues','actions','slide','presentation','baseSlide','elements','element','text']),nestedUnknown),original=Buffer.concat([nested,rootUnknown]),untouched=Buffer.from(original);
 const changed=patchProLyrics(original,[{section:'Verse',text:'Împreună cântăm\nNew second line'}]);
 assert.deepEqual(original,untouched);assert.ok(changed.includes(rootUnknown));assert.ok(changed.includes(nestedUnknown));assert.equal(changed.toString('latin1').split('ROOT_METADATA_MUST_STAY').length-1,1);assert.equal(changed.toString('latin1').split('NESTED_METADATA_MUST_STAY').length-1,1);
 assert.deepEqual(withoutText(decode(changed)),withoutText(decode(original)));assert.equal(proDocument(changed).slides[0].text,'Împreună cântăm\nNew second line');
});
async function pptxFixture(two=false){const deck=new PptxGenJS();deck.layout='LAYOUT_WIDE';for(let index=0;index<(two?2:1);index++){const slide=deck.addSlide();slide.background={color:'182A45'};slide.addText('Old first line\nOld second line',{x:1,y:1,w:10,h:3,fontFace:'Arial',fontSize:40,bold:true,color:'FAEBCD',margin:0});slide.addImage({data:'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z0AAAAAASUVORK5CYII=',x:.1,y:.1,w:.5,h:.5});}return Buffer.from(await deck.write({outputType:'nodebuffer',compression:true}));}
const strippedText=xml=>xml.replace(/(<a:t(?:\s[^>]*)?>)[\s\S]*?(<\/a:t>)/g,'$1__LYRIC_TEXT__$2');
test('PowerPoint text patching preserves backgrounds, media bytes, shape identities, geometry and every other package part',async()=>{
 const original=await pptxFixture(),untouched=Buffer.from(original),changed=await patchPowerPointLyrics(original,[{section:'Verse',text:'New & first line\nNew <second> line'}]),before=await JSZip.loadAsync(original),after=await JSZip.loadAsync(changed),slideName='ppt/slides/slide1.xml';
 assert.deepEqual(original,untouched);assert.deepEqual(Object.keys(after.files).sort(),Object.keys(before.files).sort());
 for(const [name,entry]of Object.entries(before.files)){if(entry.dir||name===slideName)continue;assert.deepEqual(await after.file(name).async('nodebuffer'),await entry.async('nodebuffer'),'Unchanged package part '+name);}
 const beforeXml=await before.file(slideName).async('string'),afterXml=await after.file(slideName).async('string');assert.equal(strippedText(afterXml),strippedText(beforeXml));assert.match(afterXml,/New &amp; first line/);assert.match(afterXml,/New &lt;second&gt; line/);assert.match(afterXml,/182A45/);assert.ok(Object.keys(after.files).some(name=>/^ppt\/media\/image/.test(name)));
});
test('PowerPoint duplicate slide-part references stop before returning an ambiguous updated deck',async()=>{
 const generated=await pptxFixture(true),zip=await JSZip.loadAsync(generated),part='ppt/_rels/presentation.xml.rels',rels=await zip.file(part).async('string');assert.match(rels,/slides\/slide2\.xml/);zip.file(part,rels.replace('slides/slide2.xml','slides/slide1.xml'));const original=await zip.generateAsync({type:'nodebuffer'}),before=Buffer.from(original);
 await assert.rejects(patchPowerPointLyrics(original,[{section:'Verse',text:'First cue new line\nFirst cue second line'},{section:'Verse',text:'Different cue new line\nDifferent cue second line'}]),/cannot be updated/);assert.deepEqual(original,before);
});
test('PowerPoint extraction uses the captured byte snapshot even when the original path is unavailable',async()=>{
 const bytes=await pptxFixture(),{readPptxLyrics}=require('../desktop/pptx-lyrics.cjs'),parsed=await readPptxLyrics('/missing-native-fixture/Snapshot.pptx',{simpleSongOnly:true,sourceBytes:bytes});
 assert.ok(parsed);assert.deepEqual(parsed.slides.map(slide=>slide.text),['Old first line\nOld second line']);
});
