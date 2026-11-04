const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),JSZip=require('jszip');
const {exportServicePackage,safeName}=require('../desktop/service-package.cjs'),{idFor}=require('../desktop/song-catalog.cjs'),{buildPresentation}=require('../desktop/presentation.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(check){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'stati-service-package-')),initialDirectory=path.join(temp,'Lyrics');await fs.mkdir(initialDirectory);const directory=await fs.realpath(initialDirectory),pro=await buildPresentation({title:'Împreună cântăm',language:'ron',fontSize:96,linesPerSlide:4,slides:[{section:'Verse',text:'Împreună cântăm\nÎnaintea Ta'}]}),lyrics=Buffer.from('Another song\nKept in order'),mp3=await fs.readFile(path.join(__dirname,'fixtures/service-package-silence.mp3'));await fs.writeFile(path.join(directory,'Romanian.pro'),pro);await fs.writeFile(path.join(directory,'Lyrics.txt'),lyrics);const audio=path.join(temp,'Track.mp3');await fs.writeFile(audio,mp3);
 const song=(name,bytes)=>({id:crypto.randomUUID(),songId:idFor(name,directory),contentHash:hash(bytes),title:path.basename(name,path.extname(name)),filename:name,reviewed:true}),one=song('Romanian.pro',pro),two=song('Lyrics.txt',lyrics),plan={id:crypto.randomUUID(),title:'Sunday worship',date:'2026-10-25',time:'09:25',notes:'Romanian notes: Rugăciune',tasks:[{id:crypto.randomUUID(),text:'Check screen',done:true}],songs:[one,two,{...one,id:crypto.randomUUID()}],credentials:'must-not-be-exported',computerSettings:{secret:'private-settings'}};
 try{await check({temp,directory,plan,pro,lyrics,mp3,audio,destination:path.join(temp,'Service.zip'),one,two});}finally{await fs.rm(temp,{recursive:true,force:true});}
}
test('portable ZIP preserves original presentations, audio, repeated service order and notes without private state',async()=>fixture(async f=>{
 await fs.mkdir(path.join(f.directory,'.stati-history'),{recursive:true});await fs.writeFile(path.join(f.directory,'.stati-history','private.bin'),'not portable');
 const result=await exportServicePackage({...f,audioPaths:[f.audio,f.audio]}),bytes=await fs.readFile(result.path),zip=await JSZip.loadAsync(bytes),manifest=JSON.parse(await zip.file('service.json').async('string'));
 assert.equal(result.complete,true);assert.equal(result.songCount,2);assert.equal(result.audioCount,1);assert.equal(result.sha256,hash(bytes));assert.equal(result.bytes,bytes.length);assert.equal(manifest.songs.length,3);assert.equal(manifest.songs[0].path,manifest.songs[2].path);assert.deepEqual(manifest.songs.map(song=>song.position),[1,2,3]);
 assert.deepEqual(await zip.file(manifest.songs[0].path).async('nodebuffer'),f.pro);assert.deepEqual(await zip.file(manifest.songs[1].path).async('nodebuffer'),f.lyrics);assert.deepEqual(await zip.file(manifest.audio[0].path).async('nodebuffer'),f.mp3);assert.equal(manifest.service.notes,f.plan.notes);assert.deepEqual(manifest.service.tasks,[{text:'Check screen',done:true}]);
 assert.doesNotMatch(JSON.stringify(manifest),/must-not-be-exported|private-settings|Lyrics\/|stati-history|songId|computerSettings/);assert.ok(!Object.keys(zip.files).some(name=>name.includes('..')||name.includes('history')));assert.match(await zip.file('README.txt').async('string'),/Import Audio MP3s manually/);assert.deepEqual(await fs.readFile(path.join(f.directory,'Romanian.pro')),f.pro);assert.deepEqual(await fs.readFile(f.audio),f.mp3);
}));
test('changed and unavailable songs are explicit missing entries and never substituted into the portable package',async()=>fixture(async f=>{
 await fs.writeFile(path.join(f.directory,'Romanian.pro'),'changed after service selection');await fs.unlink(path.join(f.directory,'Lyrics.txt'));
 const result=await exportServicePackage(f),zip=await JSZip.loadAsync(await fs.readFile(result.path)),manifest=JSON.parse(await zip.file('service.json').async('string'));
 assert.equal(result.complete,false);assert.equal(result.songCount,0);assert.equal(result.missing.length,3);assert.ok(manifest.songs.every(song=>song.path===null));assert.match(result.missing[0].reason,/changed/);assert.match(result.missing[1].reason,/unavailable/);assert.ok(!Object.keys(zip.files).some(name=>name.startsWith('Songs/')));
}));
test('an unavailable library still exports notes and an explicit missing list',async()=>fixture(async f=>{
 const result=await exportServicePackage({...f,directory:path.join(f.temp,'Missing')}),zip=await JSZip.loadAsync(await fs.readFile(result.path)),manifest=JSON.parse(await zip.file('service.json').async('string'));
 assert.equal(result.complete,false);assert.equal(result.warnings.length,1);assert.equal(manifest.service.notes,f.plan.notes);assert.equal(result.missing.length,3);
}));
test('existing ZIP files are never overwritten and no hidden temporary archive is left behind',async()=>fixture(async f=>{
 await fs.writeFile(f.destination,'original package');await assert.rejects(exportServicePackage(f),/already exists/);assert.equal(await fs.readFile(f.destination,'utf8'),'original package');assert.ok(!(await fs.readdir(f.temp)).some(name=>name.startsWith('.stati-service-package')));
}));
test('symbolic-link songs are missing, and selected symbolic-link or renamed non-MP3 audio rejects export',async()=>fixture(async f=>{
 await fs.unlink(path.join(f.directory,'Lyrics.txt'));await fs.symlink(f.audio,path.join(f.directory,'Lyrics.txt'));const first=await exportServicePackage(f);assert.equal(first.missing.length,1);assert.match(first.missing[0].reason,/unavailable/);
 const link=path.join(f.temp,'linked.mp3');await fs.symlink(f.audio,link);await assert.rejects(exportServicePackage({...f,destination:path.join(f.temp,'Other.zip'),audioPaths:[link]}),/regular file/);
 const invalid=path.join(f.temp,'renamed.mp3');await fs.writeFile(invalid,'not an MP3');await assert.rejects(exportServicePackage({...f,destination:path.join(f.temp,'Invalid.zip'),audioPaths:[invalid]}),/not a supported MP3/);
 assert.ok(!(await fs.readdir(f.temp)).some(name=>name.startsWith('.stati-service-package')));
}));
test('cancelled and changed-authority exports create no package and preserve source files',async()=>fixture(async f=>{
 const controller=new AbortController();controller.abort();await assert.rejects(exportServicePackage({...f,signal:controller.signal}),{code:'ABORTED'});
 let checks=0;await assert.rejects(exportServicePackage({...f,checkActive:()=>{if(++checks===5)throw Error('Profile changed');}}),{code:'ABORTED'});await assert.rejects(fs.stat(f.destination),{code:'ENOENT'});assert.ok(!(await fs.readdir(f.temp)).some(name=>name.startsWith('.stati-service-package')));assert.deepEqual(await fs.readFile(path.join(f.directory,'Romanian.pro')),f.pro);
}));
test('non-link volumes use exclusive verified copies and cancellation removes only the owned partial archive',async()=>fixture(async f=>{
 const link=fs.link;let copying=false,checks=0;fs.link=async()=>{copying=true;throw Object.assign(Error('No hard links'),{code:'ENOTSUP'});};
 try{const result=await exportServicePackage(f);assert.equal(result.sha256,hash(await fs.readFile(result.path)));const second=path.join(f.temp,'Canceled.zip');copying=false;await assert.rejects(exportServicePackage({...f,destination:second,checkActive:()=>{if(copying&&++checks===2)throw Error('Profile changed');}}),{code:'ABORTED'});await assert.rejects(fs.stat(second),{code:'ENOENT'});}
 finally{fs.link=link;}
}));
test('portable names handle Windows reserved names, punctuation and long extension-preserving names',async()=>fixture(async f=>{
 assert.equal(safeName('CON'),'_CON');assert.equal(safeName('  a:b?. '),'  a_b_');const name='a'.repeat(180)+'.txt';await fs.writeFile(path.join(f.directory,name),'long name lyrics');const bytes=Buffer.from('long name lyrics'),song={...f.two,songId:idFor(name,f.directory),contentHash:hash(bytes),filename:name};
 const result=await exportServicePackage({...f,plan:{...f.plan,songs:[song]}}),zip=await JSZip.loadAsync(await fs.readFile(result.path)),manifest=JSON.parse(await zip.file('service.json').async('string'));assert.match(manifest.songs[0].path,/\.txt$/);assert.ok(manifest.songs[0].path.length<160);assert.deepEqual(await zip.file(manifest.songs[0].path).async('nodebuffer'),bytes);
}));
test('linked-media presentations remain byte-identical but the package warns about unresolved resources',async()=>fixture(async f=>{
 const linked=buildPresentation({title:'Media slides',slides:[{section:'PowerPoint',text:'Slide 1'}]},[path.join(f.temp,'source-image.png')]),file='Media.pro';await fs.writeFile(path.join(f.directory,file),linked);
 const song={...f.one,songId:idFor(file,f.directory),contentHash:hash(linked),filename:file,title:'Media slides'},result=await exportServicePackage({...f,plan:{...f.plan,songs:[song]}}),zip=await JSZip.loadAsync(await fs.readFile(result.path)),manifest=JSON.parse(await zip.file('service.json').async('string'));
 assert.equal(result.complete,false);assert.equal(result.missing.length,0);assert.match(result.warnings[0],/linked media|resources/);assert.equal(manifest.complete,false);assert.equal(manifest.warnings.length,1);assert.deepEqual(await zip.file(manifest.songs[0].path).async('nodebuffer'),linked);
}));
