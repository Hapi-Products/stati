const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {buildPresentation,decode}=require('../desktop/presentation.cjs'),{searchCatalog,openCatalogSong}=require('../desktop/song-catalog.cjs'),{saveLibrarySong}=require('../desktop/song-save.cjs');
const data={title:'A title that must not replace the original',songName:'Duplicate title',fontSize:96,slides:[{section:'Verse',text:'Updated words\nÎmpreună cântăm'}]};
async function fixture(check){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stati-save-')),file=path.join(directory,'original.pro'),original=buildPresentation({title:'Our Father everlasting (I Believe)',slides:[{section:'Verse',text:'Our Father everlasting\nThe all creating One'}]});try{await fs.writeFile(file,original);const song=(await searchCatalog(directory)).items[0];await check({directory,file,original,song});}finally{await fs.rm(directory,{recursive:true,force:true});}}
test('editing saves the same file and ProPresenter identity, preserves its title/date, and keeps a hidden recovery copy',()=>fixture(async({directory,file,original,song})=>{
 const saved=await saveLibrarySong(directory,song.id,song.contentHash,data);
 assert.equal(saved.path,file);assert.notEqual(saved.contentHash,song.contentHash);
 const doc=decode(await fs.readFile(file));assert.equal(doc.name,'Our Father everlasting (I Believe)');assert.deepEqual(doc.uuid,decode(original).uuid);assert.equal(doc.notes,decode(original).notes);
 const catalog=await searchCatalog(directory);assert.equal(catalog.total,1);assert.equal(catalog.items[0].id,song.id);assert.equal(catalog.items[0].addedAt,song.addedAt);assert.equal(catalog.items[0].filename,'original.pro');assert.match((await openCatalogSong(directory,song.id)).text,/Updated words/);
 assert.deepEqual(await fs.readFile(path.join(directory,'.stati-history',song.id,song.contentHash+'.bin')),original);
 const again=await saveLibrarySong(directory,song.id,saved.contentHash,{...data,slides:[{section:'Verse',text:'Third saved version'}]});assert.equal(again.path,file);assert.equal((await searchCatalog(directory)).total,1);assert.equal(decode(await fs.readFile(file)).name,doc.name);
}));
test('changed files, invalid lyric output and switched operators keep the original song intact',()=>fixture(async({directory,file,original,song})=>{
 await assert.rejects(saveLibrarySong(directory,song.id,'a'.repeat(64),data),/changed after/);
 await assert.rejects(saveLibrarySong(directory,song.id,song.contentHash,{...data,slides:[{section:'Verse',text:'W'.repeat(200)}]}),/too long/);
 await assert.rejects(saveLibrarySong(directory,song.id,song.contentHash,data,()=>{throw Error('Operator switched');}),/Operator switched/);
 assert.deepEqual(await fs.readFile(file),original);assert.deepEqual(await fs.readdir(directory),['original.pro']);
}));
test('a concurrent edit during the last identity check is detected before replacement',()=>fixture(async({directory,file,song})=>{
 let checks=0;const changed=buildPresentation({title:'External edit',slides:[{section:'Verse',text:'Changed outside Stați'}]});
 await assert.rejects(saveLibrarySong(directory,song.id,song.contentHash,data,()=>{if(++checks===2)require('node:fs').writeFileSync(file,changed);}),/changed while saving/);
 assert.deepEqual(await fs.readFile(file),changed);assert.equal((await fs.readdir(directory)).some(name=>name.endsWith('.tmp')),false);
}));

test('a Windows sharing violation explains how to retry and keeps the existing file',()=>fixture(async({directory,file,original,song})=>{
 const rename=fs.rename;try{fs.rename=async()=>{throw Object.assign(Error('Windows sharing violation'),{code:'EBUSY'});};await assert.rejects(saveLibrarySong(directory,song.id,song.contentHash,data),/Another app has this song open/);}finally{fs.rename=rename;}
 assert.deepEqual(await fs.readFile(file),original);assert.equal((await fs.readdir(directory)).some(name=>name.endsWith('.tmp')),false);
 assert.equal((await saveLibrarySong(directory,song.id,song.contentHash,data)).path,file);
}));
