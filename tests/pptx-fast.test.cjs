const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),JSZip=require('jszip');
const {readPptxLyrics}=require('../desktop/pptx-lyrics.cjs'),{convertFiles}=require('../desktop/powerpoint-batch.cjs');
const {decode}=require('../desktop/presentation.cjs');
const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;');
function shape(text,{size=3600,x=200,y=180,width=600,height=300,group=false}={}){return '<p:sp><p:spPr><a:xfrm><a:off x="'+x+'" y="'+y+'"/><a:ext cx="'+width+'" cy="'+height+'"/></a:xfrm></p:spPr><p:txBody>'+text.split('\n').map(line=>'<a:p><a:r><a:rPr'+(size?' sz="'+size+'"':'')+'/><a:t>'+escape(line)+'</a:t></a:r></a:p>').join('')+'</p:txBody></p:sp>';}
async function pptx(file,{lines=['Together we sing with joy\nWe sing with hope'],missingSize=false,grouped=false,decoration=true}={}){
 const zip=new JSZip();zip.file('ppt/presentation.xml','<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>'+lines.map((_,i)=>'<p:sldId r:id="rel'+i+'"/>').join('')+'</p:sldIdLst><p:sldSz cx="1000" cy="600"/></p:presentation>');
 zip.file('ppt/_rels/presentation.xml.rels','<Relationships>'+lines.map((_,i)=>'<Relationship Id="rel'+i+'" Target="slides/slide'+(lines.length-i)+'.xml"/>').join('')+'</Relationships>');
 for(const [i,line] of lines.entries()){const lyrics=shape(line,{size:missingSize?0:3600});zip.file('ppt/slides/slide'+(lines.length-i)+'.xml','<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'+(decoration?shape('www.example.org',{size:1000,y:0,height:30}):'')+(grouped?'<p:grpSp>'+lyrics+'</p:grpSp>':lyrics)+'</p:spTree></p:cSld></p:sld>');}
 await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
}
async function fixture(check){const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-fast-pptx-'));try{await check(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
test('PPTX fast path reads real package slide order, central lyrics and Romanian text without decoration',()=>fixture(async root=>{
 const file=path.join(root,'song.pptx'),lines=['Împreună cântăm Domnului\nPăstrăm fiecare cuvânt','Second verse is here\nEvery word remains'];await pptx(file,{lines});
 const extracted=await readPptxLyrics(file);assert.deepEqual(extracted.slides.map(slide=>slide.text),lines);assert.equal(extracted.language,'auto');
}));
test('ambiguous font inheritance, grouped content, legacy files and invalid packages retain the PowerPoint fallback',()=>fixture(async root=>{
 for(const [name,options] of [['inherited.pptx',{missingSize:true}],['grouped.pptx',{grouped:true}]]){const file=path.join(root,name);await pptx(file,options);assert.equal(await readPptxLyrics(file),null);}
 const broken=path.join(root,'broken.pptx');await fs.writeFile(broken,'not a zip');assert.equal(await readPptxLyrics(broken),null);assert.equal(await readPptxLyrics(path.join(root,'legacy.ppt')),null);
}));
test('batch converts supported PPTX files without starting PowerPoint and still resumes safely',()=>fixture(async root=>{
 const directory=path.join(root,'Lyrics');await fs.mkdir(directory);const files=[];
 for(let i=0;i<12;i++){const file=path.join(root,'song-'+i+'.pptx');await pptx(file,{lines:['Together we sing song '+i+'\nÎmpreună cântăm Domnului'],decoration:false});files.push(file);}
 let calls=0;const render=async()=>{calls++;throw Error('PowerPoint should not start for these supported files');};
 const started=performance.now(),result=await convertFiles(files,directory,{render,fastPptx:true});
 assert.ok(result.results.every(item=>item.status==='converted'),JSON.stringify(result.results));assert.equal(calls,0);
 assert.equal(decode(await fs.readFile(result.results[0].path)).cues.length,1);
 const resumed=await convertFiles(files,directory,{render,fastPptx:true});assert.ok(resumed.results.every(item=>item.status==='skipped'));assert.equal(calls,0);
 console.log('Local supported-PPTX fixture: 12 conversions plus resume in '+((performance.now()-started)/1000).toFixed(2)+'s; PowerPoint launches: '+calls+'. Not a church-PC timing.');
}));

async function inheritedPptx(file,{layoutFont=0,masterFont=3600,bodyFont=0,presentationFont=0,footer=false,ending=false}={}){
 const zip=new JSZip(),ph='<p:nvSpPr><p:cNvPr id="1" name="Lyrics"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>',defaults=size=>size?'<a:lstStyle><a:lvl1pPr><a:defRPr sz="'+size+'"/></a:lvl1pPr></a:lstStyle>':'<a:lstStyle/>',words='Together we sing with hope\nEvery lyric word remains',texts=words.split('\n').map(line=>'<a:p><a:r><a:t>'+escape(line)+'</a:t></a:r></a:p>').join('');
 zip.file('ppt/presentation.xml','<p:presentation xmlns:p="p" xmlns:r="r" xmlns:a="a"><p:sldIdLst><p:sldId r:id="slide"/></p:sldIdLst><p:sldSz cx="1000" cy="600"/>'+(presentationFont?'<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="'+presentationFont+'"/></a:lvl1pPr></p:defaultTextStyle>':'')+'</p:presentation>');
 zip.file('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="slide" Target="slides/slide1.xml"/></Relationships>');
 zip.file('ppt/slides/slide1.xml','<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="7" name="Legacy church logo"/></p:nvPicPr></p:pic><p:sp>'+ph+'<p:spPr/><p:txBody><a:bodyPr/>'+defaults(bodyFont)+texts+'</p:txBody></p:sp>'+(ending?shape('Amin',{size:2800,x:820,y:540,width:150,height:40}):'')+'</p:spTree></p:cSld></p:sld>');
 zip.file('ppt/slides/_rels/slide1.xml.rels','<Relationships><Relationship Id="layout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');
 zip.file('ppt/slideLayouts/slideLayout1.xml','<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp>'+ph+'<p:spPr><a:xfrm><a:off x="200" y="180"/><a:ext cx="600" cy="300"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>'+defaults(layoutFont)+'<a:p><a:r><a:t>Template prompt is never copied</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>');
 zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels','<Relationships><Relationship Id="master" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
 zip.file('ppt/slideMasters/slideMaster1.xml','<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'+(footer?shape('Legacy footer name',{size:1000,y:550,height:30}):'')+'</p:spTree></p:cSld><p:txStyles><p:bodyStyle><a:lvl1pPr>'+(masterFont?'<a:defRPr sz="'+masterFont+'"/>':'')+'</a:lvl1pPr></p:bodyStyle></p:txStyles></p:sldMaster>');
 await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));return words;
}
test('ordinary template font defaults and placeholder geometry resolve without launching Office',()=>fixture(async root=>{
 for(const [index,settings] of [{masterFont:3600},{layoutFont:4000,masterFont:0},{bodyFont:3600,masterFont:0},{presentationFont:3200,masterFont:0}].entries()){
  const file=path.join(root,'inherited-'+index+'.pptx'),words=await inheritedPptx(file,settings),extracted=await readPptxLyrics(file,{simpleSongOnly:true});assert.equal(extracted.slides[0].text,words);
 }
}));
test('strict batch copies one lyric box and final Amen onto clean black editable slides without old logos or background',()=>fixture(async root=>{
 const file=path.join(root,'old-white-template.pptx'),words=await inheritedPptx(file,{ending:true}),directory=path.join(root,'Lyrics');await fs.mkdir(directory);const original=await fs.readFile(file);
 const result=await convertFiles([file],directory,{fastPptx:true,render:()=>assert.fail('Supported template lyrics do not need Office')});assert.equal(result.results[0].status,'converted');const doc=decode(await fs.readFile(result.results[0].path)),slide=doc.cues[0].actions[0].slide.presentation.baseSlide;
 assert.equal(slide.backgroundColor.red||0,0);assert.equal(slide.backgroundColor.green||0,0);assert.equal(slide.backgroundColor.blue||0,0);assert.deepEqual(slide.elements.map(item=>item.element.name),['Lyrics','Song ending']);assert.ok(slide.elements.every(item=>!item.element.fill.media));
 const content=require('../desktop/library.cjs').songText(await fs.readFile(result.results[0].path),'.pro');assert.equal(content.text.trim(),words);assert.doesNotMatch(content.text,/Legacy|Template prompt/);assert.deepEqual(await fs.readFile(file),original);
}));
test('strict policy excludes extra text boxes and inherited footer text before accepting old retry markers',()=>fixture(async root=>{
 const directory=path.join(root,'Lyrics');await fs.mkdir(directory);const file=path.join(root,'cluttered.pptx');await pptx(file);const original=await fs.readFile(file),hash=require('node:crypto').createHash('sha256').update(original).digest('hex'),old=path.join(directory,'Existing original.pro');await fs.writeFile(old,'Preserve old output');await fs.writeFile(path.join(directory,'.stati-ppt-lyrics-v1-'+hash+'.json'),JSON.stringify({file:path.basename(old),contentHash:require('node:crypto').createHash('sha256').update('Preserve old output').digest('hex')}));
 const v2=path.join(directory,'.stati-ppt-lyrics-v2-'+hash+'.json');await fs.copyFile(path.join(directory,'.stati-ppt-lyrics-v1-'+hash+'.json'),v2);const beforeNames=(await fs.readdir(directory)).sort();
 let result=await convertFiles([file],directory,{fastPptx:true,render:()=>assert.fail('Known layout exclusions must not launch Office')});assert.equal(result.results[0].status,'excluded');assert.match(result.results[0].error,/one per slide/);assert.equal(await fs.readFile(old,'utf8'),'Preserve old output');assert.deepEqual((await fs.readdir(directory)).sort(),beforeNames);assert.deepEqual(await fs.readFile(file),original);
 const inherited=path.join(root,'master-footer.pptx');await inheritedPptx(inherited,{footer:true});result=await convertFiles([inherited],directory,{fastPptx:true,render:()=>assert.fail('A known inherited footer must not launch Office')});assert.equal(result.results[0].status,'excluded');assert.match(result.results[0].error,/2 non-empty text boxes/);
}));
