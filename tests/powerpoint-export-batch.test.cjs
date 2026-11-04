const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),syncFs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),JSZip=require('jszip');
const {exportPowerPointBatch}=require('../desktop/powerpoint-export-batch.cjs');
const item=(name='Song.txt',extra={})=>({id:crypto.randomUUID(),name,data:{title:'Metadata title',slides:[{section:'Verse',text:'Lord we sing Your glory\nWe lift our hearts to You'}],language:'eng',fontSize:96,linesPerSlide:4,...extra}});
async function fixture(check){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stati-batch-pptx-'));try{await check(directory);}finally{await fs.rm(directory,{recursive:true,force:true});}}
async function slideText(file){const zip=await JSZip.loadAsync(await fs.readFile(file));return zip.file('ppt/slides/slide1.xml').async('string');}
test('batch writes separate verified editable PPTX files, handles duplicate names and keeps original existing outputs',()=>fixture(async directory=>{
 const existing=path.join(directory,'Lord we sing Your glory.pptx');await fs.writeFile(existing,'Original file must stay');const progress=[];
 const a=item('Original A.txt'),b=item('Original B.docx'),result=await exportPowerPointBatch({items:[a,b],directory,onProgress:value=>progress.push(value)});
 assert.equal(result.stopped,false);assert.equal(result.total,2);assert.deepEqual(result.results.map(entry=>entry.status),['saved','saved']);assert.equal(result.results[0].filename,'Lord we sing Your glory (2).pptx');assert.equal(result.results[1].filename,'Lord we sing Your glory (3).pptx');assert.equal(await fs.readFile(existing,'utf8'),'Original file must stay');
 for(const entry of result.results){const bytes=await fs.readFile(entry.path);assert.equal(entry.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(entry.bytes,bytes.length);assert.match(await slideText(entry.path),/Lord we sing Your glory/);assert.match(await slideText(entry.path),/Amen/);const zip=await JSZip.loadAsync(bytes);assert.ok(!Object.keys(zip.files).some(name=>name.startsWith('ppt/media/')&&!zip.files[name].dir));}
 assert.deepEqual(progress.map(value=>value.completed),[1,2]);assert.equal(result.directoryName,path.basename(directory));
}));
test('one invalid reviewed song gives a per-song failure while valid Romanian and ending-size exports continue',()=>fixture(async directory=>{
 const a=item('Bad.txt',{language:'wrong'}),b=item('Romanian.txt',{language:'ron',amenFontSize:54,slides:[{section:'Verse',text:'Împreună cântăm pentru Tine\nSlava Ta ne umple inima'}]});
 const result=await exportPowerPointBatch({items:[a,b],directory});assert.deepEqual(result.results.map(entry=>entry.status),['failed','saved']);assert.match(result.results[0].error,/English or Romanian/);const xml=await slideText(result.results[1].path);assert.match(xml,/Împreună cântăm/);assert.match(xml,/Amin/);assert.match(xml,/sz="2700"/);assert.equal((await fs.readdir(directory)).length,1);
}));
test('a stopped batch preserves completed files and reports every unfinished operation as stopped',()=>fixture(async directory=>{
 const controller=new AbortController(),items=[item('One.txt'),item('Two.txt'),item('Three.txt')];const result=await exportPowerPointBatch({items,directory,signal:controller.signal,onProgress:value=>{if(value.completed===1)controller.abort();}});
 assert.equal(result.stopped,true);assert.deepEqual(result.results.map(entry=>entry.status),['saved','stopped','stopped']);assert.equal((await fs.readdir(directory)).length,1);assert.match(await slideText(result.results[0].path),/Lord we sing/);
}));
test('cancellation at new-file publication removes only the incomplete owned file',()=>fixture(async directory=>{
 const controller=new AbortController();const result=await exportPowerPointBatch({items:[item()],directory,signal:controller.signal,checkActive:()=>{if(syncFs.readdirSync(directory).some(name=>name.endsWith('.pptx')))controller.abort();}});
 assert.equal(result.stopped,true);assert.equal(result.results[0].status,'stopped');assert.deepEqual(await fs.readdir(directory),[]);
}));
test('identity loss is terminal rather than an ordinary per-file error and preserves existing files',()=>fixture(async directory=>{
 await fs.writeFile(path.join(directory,'keep.bin'),'keep');let checks=0;await assert.rejects(exportPowerPointBatch({items:[item('One.txt'),item('Two.txt')],directory,checkActive:()=>{if(++checks===4)throw Error('Profile changed');}}),/Profile changed/);assert.deepEqual(await fs.readdir(directory),['keep.bin']);assert.equal(await fs.readFile(path.join(directory,'keep.bin'),'utf8'),'keep');
}));
test('case-insensitive conflicts and Windows reserved names remain portable and never overwrite',()=>fixture(async directory=>{
 await fs.writeFile(path.join(directory,'LORD WE SING YOUR GLORY.PPTX'),'keep');const result=await exportPowerPointBatch({items:[item(),item('Reserved.txt',{slides:[{section:'Verse',text:'CON'}]})],directory});assert.equal(result.results[0].filename,'Lord we sing Your glory (2).pptx');assert.equal(result.results[1].filename,'presentation-CON.pptx');assert.equal(await fs.readFile(path.join(directory,'LORD WE SING YOUR GLORY.PPTX'),'utf8'),'keep');
}));
test('invalid batch shape, duplicate IDs and text limits fail before any output is created',()=>fixture(async directory=>{
 const a=item();for(const items of [[],Array.from({length:21},()=>item()),[a,a],[{...a,id:'invalid'}],[{...a,name:''}],[item('Huge.txt',{slides:[{section:'Verse',text:'x'.repeat(2*1024*1024+1)}]})]])await assert.rejects(exportPowerPointBatch({items,directory}));assert.deepEqual(await fs.readdir(directory),[]);await assert.rejects(exportPowerPointBatch({items:[a],directory:'relative'}),/output folder/);
}));
test('a progress observer failure cannot turn an already saved output into a duplicate retry',()=>fixture(async directory=>{
 const result=await exportPowerPointBatch({items:[item()],directory,onProgress:()=>{throw Error('Observer failed');}});assert.equal(result.results.length,1);assert.equal(result.results[0].status,'saved');assert.equal((await fs.readdir(directory)).length,1);
}));
