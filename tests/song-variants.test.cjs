const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {buildPresentation,decode}=require('../desktop/presentation.cjs'),{cloneLibrarySong,saveLibrarySong}=require('../desktop/song-save.cjs'),{searchCatalog,openCatalogSong}=require('../desktop/song-catalog.cjs'),{catalogSnapshot}=require('../desktop/catalog-publisher.cjs');
async function fixture(check,extension='.pro'){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stati-variants-')),file=path.join(directory,'original'+extension),bytes=extension==='.pro'?buildPresentation({title:'Amazing grace',slides:[{section:'Verse',text:'Amazing grace\nHow sweet the sound'}]}):Buffer.from('Amazing grace\nHow sweet the sound');
 try{await fs.writeFile(file,bytes);const song=(await searchCatalog(directory)).items[0];await check({directory,file,bytes,song});}finally{await fs.rm(directory,{recursive:true,force:true});}
}
test('named group versions keep the original and preserve native content under new identities',()=>fixture(async({directory,file,bytes,song})=>{
 const saved=await cloneLibrarySong(directory,song.id,song.contentHash,"Jason's group"),before=decode(bytes),copy=decode(await fs.readFile(saved.path));
 assert.deepEqual(await fs.readFile(file),bytes);assert.notEqual(saved.id,song.id);assert.equal(copy.name,"Amazing grace — Jason's group");assert.notDeepEqual(copy.uuid,before.uuid);
 assert.equal(copy.notes,before.notes);assert.deepEqual(copy.cues.map(cue=>cue.actions.map(action=>action.slide.presentation.baseSlide.elements.map(item=>item.element.text?.rtfData))),before.cues.map(cue=>cue.actions.map(action=>action.slide.presentation.baseSlide.elements.map(item=>item.element.text?.rtfData))));
 assert.notDeepEqual(copy.cues[0].uuid,before.cues[0].uuid);assert.deepEqual(copy.cueGroups[0].cueIdentifiers[0],copy.cues[0].uuid);
 const generic=await searchCatalog(directory,{groupName:'__generic__'}),group=await searchCatalog(directory,{groupName:"Jason's group"});
 assert.equal(generic.total,1);assert.equal(generic.items[0].id,song.id);assert.equal(group.total,1);assert.equal(group.items[0].id,saved.id);assert.deepEqual(group.groups,["Jason's group"]);assert.equal(group.items[0].sourceSongId,song.id);
 const snapshot=await catalogSnapshot(directory),published=snapshot.songs.find(value=>value.id===saved.id);assert.equal(published.groupName,"Jason's group");assert.equal(published.sourceSongId,song.id);
 await saveLibrarySong(directory,saved.id,saved.contentHash,{title:'Ignored',slides:[{section:'Verse',text:'The group has different words'}]});
 assert.deepEqual(await fs.readFile(file),bytes);assert.match((await openCatalogSong(directory,saved.id)).text,/different words/);
}));
test('explicit repeated copies never overwrite earlier group files, and a copy of a copy keeps its base identity',()=>fixture(async({directory,file,bytes,song})=>{
 const first=await cloneLibrarySong(directory,song.id,song.contentHash,'Choir'),firstBytes=await fs.readFile(first.path),second=await cloneLibrarySong(directory,song.id,song.contentHash,'Choir'),third=await cloneLibrarySong(directory,first.id,first.contentHash,'Worship');
 assert.notEqual(first.path,second.path);assert.match(second.path,/\(1\)\.pro$/);assert.deepEqual(await fs.readFile(first.path),firstBytes);assert.deepEqual(await fs.readFile(file),bytes);
 assert.equal(third.title,'Amazing grace — Worship');assert.equal(third.sourceSongId,song.id);assert.equal((await searchCatalog(directory)).total,4);
}));
test('text versions keep their exact lyrics and expose group metadata',()=>fixture(async({directory,file,bytes,song})=>{
 const clone=await cloneLibrarySong(directory,song.id,song.contentHash,'Romanian choir');assert.deepEqual(await fs.readFile(clone.path),bytes);assert.deepEqual(await fs.readFile(file),bytes);
 const selected=(await searchCatalog(directory,{groupName:'Romanian choir'})).items[0];assert.equal(selected.groupName,'Romanian choir');assert.equal(selected.id,clone.id);
},'.txt'));
test('invalid names, stale versions and switched operators do not replace source songs',()=>fixture(async({directory,file,bytes,song})=>{
 for(const label of ['', '../Choir','Bad/name','Bad\\name','x'.repeat(81),'__generic__'])await assert.rejects(cloneLibrarySong(directory,song.id,song.contentHash,label));
 await assert.rejects(cloneLibrarySong(directory,song.id,'a'.repeat(64),'Choir'),/changed/);
 await assert.rejects(cloneLibrarySong(directory,song.id,undefined,'Choir'),/Open this song/);
 await assert.rejects(cloneLibrarySong(directory,song.id,song.contentHash,'Choir',()=>{throw Error('Operator switched');}),/Operator switched/);
 assert.deepEqual(await fs.readFile(file),bytes);assert.deepEqual(await fs.readdir(directory),['original.pro']);
}));
test('source changes during creation remove the incomplete copy and retain the outside edit',()=>fixture(async({directory,file,song})=>{
 const outside=buildPresentation({title:'Amazing grace',slides:[{section:'Verse',text:'An outside edit'}]});let calls=0;
 await assert.rejects(cloneLibrarySong(directory,song.id,song.contentHash,'Choir',()=>{if(++calls===4)require('node:fs').writeFileSync(file,outside);}),/source song changed/);
 assert.deepEqual(await fs.readFile(file),outside);assert.equal((await searchCatalog(directory)).total,1);assert.deepEqual(await fs.readdir(path.join(directory,'.stati-variants')),[]);
}));
test('a corrupt group sidecar is surfaced as unreadable instead of silently becoming a shared original',()=>fixture(async({directory,song})=>{
 const clone=await cloneLibrarySong(directory,song.id,song.contentHash,'Choir');await fs.writeFile(path.join(directory,'.stati-variants',clone.id+'.json'),'invalid');
 const result=await searchCatalog(directory,{groupName:'__generic__'});assert.equal(result.total,1);assert.equal(result.unreadable,1);assert.equal(result.items[0].id,song.id);
}));
