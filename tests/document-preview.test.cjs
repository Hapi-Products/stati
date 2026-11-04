const {test}=require('node:test'),assert=require('node:assert/strict'),JSZip=require('jszip');
const {documentPreview,imageInfo,zipBytes}=require('../desktop/document-preview.cjs'),{previewFormat}=require('../desktop/preview-formats.cjs');
const {buildPresentation}=require('../desktop/presentation.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfQoAAAAASUVORK5CYII=','base64');
async function packageBytes(entries){const zip=new JSZip();for(const [name,value] of Object.entries(entries))zip.file(name,value);return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
const relationships=(target,type='http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail',external=false)=>'<Relationships><Relationship Id="image" Type="'+type+'" Target="'+target+'"'+(external?' TargetMode="External"':'')+'/></Relationships>';
const powerpoint={
 'ppt/presentation.xml':'<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="first"/><p:sldId r:id="other"/></p:sldIdLst></p:presentation>',
 'ppt/_rels/presentation.xml.rels':'<Relationships><Relationship Id="first" Target="slides/slide7.xml"/><Relationship Id="other" Target="slides/slide1.xml"/></Relationships>',
 'ppt/slides/slide7.xml':'<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Și cântăm</a:t></a:r></a:p><a:p><a:r><a:t>First actual slide</a:t></a:r></a:p></p:sld>',
 'ppt/slides/slide1.xml':'<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Must not become the first preview</a:t></a:r></a:p></p:sld>',
};
test('editable PowerPoint and Word use their embedded raster thumbnail when present',async()=>{
 for(const name of ['song.pptx','document.docx']){const bytes=await packageBytes({'_rels/.rels':relationships('docProps/thumb.png'),'docProps/thumb.png':png}),result=await documentPreview({bytes,name});assert.equal(result.kind,'image');assert.equal(result.mime,'image/png');assert.deepEqual(Buffer.from(result.bytes),png);assert.equal(result.label,'Saved document thumbnail');}
});
test('PowerPoint text fallback uses relationship slide order and retains Romanian without formatting metadata',async()=>{
 const result=await documentPreview({bytes:await packageBytes(powerpoint),name:'song.pptx'});assert.deepEqual(result,{kind:'text',text:'Și cântăm\nFirst actual slide'});
});
test('Word paragraphs, literal markup and UTF16/UTF8 text are previewed as text',async()=>{
 const doc=await packageBytes({'word/document.xml':'<w:document xmlns:w="w"><w:p><w:r><w:t>Laudă și lumină</w:t></w:r></w:p><w:p><w:r><w:t>&lt;script&gt;literal text&lt;/script&gt;</w:t></w:r></w:p></w:document>'});
 assert.deepEqual(await documentPreview({bytes:doc,name:'notes.docx'}),{kind:'text',text:'Laudă și lumină\n<script>literal text</script>'});
 const words='Și țară';assert.equal((await documentPreview({name:'notes.txt',bytes:Buffer.from(words)})).text,words);assert.equal((await documentPreview({name:'notes.txt',bytes:Buffer.concat([Buffer.from([255,254]),Buffer.from(words,'utf16le')])})).text,words);
});
test('external thumbnails and oversized or invalid images fall back to real first-slide text without fetching anything',async()=>{
 const old=global.fetch;let requests=0;global.fetch=async()=>{requests++;throw Error('No external fetch is allowed');};
 try{for(const entries of [
  {'_rels/.rels':relationships('https://example.test/image.png',undefined,true)},
  {'_rels/.rels':relationships('file:///private/image.png')},
  {'_rels/.rels':relationships('docProps/thumb.png'),'docProps/thumb.png':Buffer.alloc(3*1024*1024+1)},
  {'_rels/.rels':relationships('docProps/thumb.png'),'docProps/thumb.png':Buffer.from('not an image')},
 ]){const result=await documentPreview({name:'song.pptx',bytes:await packageBytes({...powerpoint,...entries})});assert.equal(result.kind,'text');assert.match(result.text,/First actual slide/);}assert.equal(requests,0);}finally{global.fetch=old;}
});
test('ProPresenter first-cue text excludes metadata, section names and the final Amen element',async()=>{
 const bytes=buildPresentation({title:'Private title metadata',language:'ron',slides:[{section:'Verse',text:'Împreună cântăm\nSlavă Domnului'},{section:'Chorus',text:'The second slide'}]}),result=await documentPreview({bytes,name:'song.pro'});
 assert.deepEqual(result,{kind:'text',text:'Împreună cântăm\nSlavă Domnului'});
 const image=buildPresentation({title:'Images',slides:[{section:'Slide',text:'Not real editable content'}]},['/private/missing-first-slide.png']);assert.equal((await documentPreview({bytes:image,name:'images.pro'})).kind,'unsupported');
});
test('raster dimensions are checked before decoding, and media/PDF classification never invents a thumbnail',async()=>{
 assert.deepEqual(imageInfo(png),{width:1,height:1,mime:'image/png'});const big=Buffer.from(png);big.writeUInt32BE(100000,16);assert.throws(()=>imageInfo(big),/supported size/);assert.throws(()=>imageInfo(Buffer.from('<svg width="100" height="100"></svg>')),/supported size/);
 const image=await documentPreview({bytes:png,name:'photo.png'});assert.equal(image.kind,'image');assert.equal(image.original,true);assert.equal(image.bytes,undefined);
 assert.deepEqual(await documentPreview({bytes:Buffer.from('metadata-only'),name:'clip.mp4'}),{kind:'media',mediaType:'video',mime:'video/mp4'});
 assert.deepEqual(await documentPreview({bytes:Buffer.alloc(0),name:'music.m4a'}),{kind:'media',mediaType:'audio',mime:'audio/mp4'});assert.deepEqual(previewFormat('document.PDF'),{kind:'pdf'});
 assert.equal((await documentPreview({bytes:Buffer.from('binary'),name:'legacy.ppt'})).kind,'unsupported');
});
test('declared and actual ZIP expansion limits, external slide links and entity XML are refused',async()=>{
 await assert.rejects(documentPreview({name:'notes.docx',bytes:await packageBytes({'word/document.xml':'x'.repeat(4*1024*1024+1)})}),/size limit/);
 await assert.rejects(documentPreview({name:'notes.docx',bytes:await packageBytes({'word/document.xml':'<!DOCTYPE x [<!ENTITY word SYSTEM "file:///private/text">]><w:document/>'})}),/unsupported XML/);
 const bad={...powerpoint,'ppt/_rels/presentation.xml.rels':'<Relationships><Relationship Id="first" Target="https://example.test/slide.xml" TargetMode="External"/></Relationships>'};await assert.rejects(documentPreview({name:'song.pptx',bytes:await packageBytes(bad)}),/No slide preview/);
 const handlers={};let paused=false;const entry={_data:{uncompressedSize:1},internalStream:()=>({on(name,fn){handlers[name]=fn;return this;},resume(){handlers.data(Buffer.alloc(100));},pause(){paused=true;}})};await assert.rejects(zipBytes(entry,10),/exceeded its size limit/);assert.equal(paused,true);
});
