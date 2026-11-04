const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),sync=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {buildPresentation,decode}=require('../desktop/presentation.cjs'),{searchCatalog,openCatalogSong}=require('../desktop/song-catalog.cjs'),{saveLibrarySong,listSongVersions,previewSongVersion,restoreSongVersion}=require('../desktop/song-save.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const data=text=>({title:'Keep the original song title',slides:[{section:'Verse',text}],fontSize:96});
async function fixture(check,{text=false}={}){const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'stati-history-')),directory=await fs.realpath(temporary),file=path.join(directory,text?'original.txt':'original.pro'),original=text?Buffer.from('Original lyrics\nÎmpreună cântăm'):buildPresentation(data('Original lyrics\nÎmpreună cântăm'));try{await fs.writeFile(file,original);const song=(await searchCatalog(directory)).items[0];await check({directory,file,original,song,history:path.join(directory,'.stati-history',song.id)});}finally{await fs.rm(directory,{recursive:true,force:true});}}
test('history starts empty, then previews and restores exact original bytes while preserving current recovery and one catalog song',()=>fixture(async({directory,file,original,song,history})=>{
 const empty=await listSongVersions(directory,song.id);assert.equal(empty.currentHash,song.contentHash);assert.equal(empty.versions.length,0);assert.match(empty.currentText,/Original lyrics/);
 const first=await saveLibrarySong(directory,song.id,song.contentHash,data('Changed words\nA second verse')),changed=await fs.readFile(file),list=await listSongVersions(directory,song.id);
 assert.equal(list.versions.length,1);assert.equal(list.versions[0].hash,song.contentHash);assert.equal(list.currentHash,first.contentHash);
 const preview=await previewSongVersion(directory,song.id,first.contentHash,song.contentHash);assert.match(preview.version.text,/Original lyrics\nÎmpreună cântăm/);assert.match(preview.currentText,/Changed words/);assert.equal(preview.currentHash,first.contentHash);
 const restored=await restoreSongVersion(directory,song.id,first.contentHash,song.contentHash);assert.equal(restored.path,file);assert.equal(restored.contentHash,song.contentHash);assert.deepEqual(await fs.readFile(file),original);assert.deepEqual(await fs.readFile(path.join(history,first.contentHash+'.bin')),changed);
 assert.deepEqual(decode(await fs.readFile(file)).uuid,decode(changed).uuid);assert.equal(decode(await fs.readFile(file)).name,decode(changed).name);
 const catalog=await searchCatalog(directory);assert.equal(catalog.total,1);assert.equal(catalog.items[0].id,song.id);assert.equal(catalog.items[0].addedAt,song.addedAt);assert.equal((await listSongVersions(directory,song.id)).versions[0].hash,first.contentHash);
 await restoreSongVersion(directory,song.id,song.contentHash,first.contentHash);assert.deepEqual(await fs.readFile(file),changed);
}));
test('text-song history restores the same filename and exact Romanian lyric bytes',()=>fixture(async({directory,file,original,song})=>{
 const saved=await saveLibrarySong(directory,song.id,song.contentHash,data('Edited text\nNew second line'));
 assert.match((await previewSongVersion(directory,song.id,saved.contentHash,song.contentHash)).version.text,/Împreună cântăm/);
 await restoreSongVersion(directory,song.id,saved.contentHash,song.contentHash);assert.deepEqual(await fs.readFile(file),original);assert.equal((await searchCatalog(directory)).total,1);
},{text:true}));
test('stale current hashes block preview and restore without changing any bytes',()=>fixture(async({directory,file,song})=>{
 const saved=await saveLibrarySong(directory,song.id,song.contentHash,data('Updated lyrics')),current=await fs.readFile(file);
 await assert.rejects(previewSongVersion(directory,song.id,song.contentHash,song.contentHash),/changed/);await assert.rejects(restoreSongVersion(directory,song.id,song.contentHash,song.contentHash),/changed/);
 assert.deepEqual(await fs.readFile(file),current);assert.equal((await openCatalogSong(directory,song.id)).contentHash,saved.contentHash);
}));
test('corrupt or symbolic-link versions cannot be previewed or restored',()=>fixture(async({directory,file,song,history})=>{
 const saved=await saveLibrarySong(directory,song.id,song.contentHash,data('Updated lyrics')),current=await fs.readFile(file),backup=path.join(history,song.contentHash+'.bin');
 await fs.writeFile(backup,'corrupt recovery data');await assert.rejects(previewSongVersion(directory,song.id,saved.contentHash,song.contentHash),/verified/);await assert.rejects(restoreSongVersion(directory,song.id,saved.contentHash,song.contentHash),/verified/);
 await fs.unlink(backup);await fs.symlink(file,backup);assert.equal((await listSongVersions(directory,song.id)).versions.length,0);await assert.rejects(restoreSongVersion(directory,song.id,saved.contentHash,song.contentHash));assert.deepEqual(await fs.readFile(file),current);
}));
test('symbolic-link recovery directories fail closed and preserve their target',()=>fixture(async({directory,file,original,song})=>{
 const outside=await fs.mkdtemp(path.join(os.tmpdir(),'stati-history-outside-'));try{await fs.symlink(outside,path.join(directory,'.stati-history'));await assert.rejects(listSongVersions(directory,song.id),/recovery storage/);await assert.rejects(saveLibrarySong(directory,song.id,song.contentHash,data('Must not save')),/recovery storage/);assert.deepEqual(await fs.readFile(file),original);assert.deepEqual(await fs.readdir(outside),[]);}finally{await fs.rm(outside,{recursive:true,force:true});}
}));
test('a valid hashed native backup from a different presentation cannot replace the song identity',()=>fixture(async({directory,file,song,history})=>{
 const saved=await saveLibrarySong(directory,song.id,song.contentHash,data('Updated lyrics')),current=await fs.readFile(file),other=buildPresentation(data('Another presentation')),otherHash=hash(other);await fs.writeFile(path.join(history,otherHash+'.bin'),other);
 await assert.rejects(restoreSongVersion(directory,song.id,saved.contentHash,otherHash),/different presentation identity/);assert.deepEqual(await fs.readFile(file),current);
}));
test('operator cancellation before replacement preserves the current song and removes only its own temporary file',()=>fixture(async({directory,file,song})=>{
 const saved=await saveLibrarySong(directory,song.id,song.contentHash,data('Current lyrics')),current=await fs.readFile(file);let checks=0;
 await assert.rejects(restoreSongVersion(directory,song.id,saved.contentHash,song.contentHash,()=>{if(++checks===4)throw Error('Operator changed');}),/Operator changed/);
 assert.deepEqual(await fs.readFile(file),current);assert.equal((await fs.readdir(directory)).some(name=>name.endsWith('.tmp')),false);assert.ok((await listSongVersions(directory,song.id)).versions.length);
}));
test('a concurrent external edit is detected before restoration and a later retry remains available',()=>fixture(async({directory,file,song})=>{
 const saved=await saveLibrarySong(directory,song.id,song.contentHash,data('Current lyrics')),external=buildPresentation(data('Changed by another app'));let checks=0;
 await assert.rejects(restoreSongVersion(directory,song.id,saved.contentHash,song.contentHash,()=>{if(++checks===4)sync.writeFileSync(file,external);}),/changed while restoring/);assert.deepEqual(await fs.readFile(file),external);assert.equal((await fs.readdir(directory)).some(name=>name.endsWith('.tmp')),false);
}));
test('restoring reports a Windows sharing violation while preserving both versions',()=>fixture(async({directory,file,song})=>{
 const saved=await saveLibrarySong(directory,song.id,song.contentHash,data('Current lyrics')),current=await fs.readFile(file),rename=fs.rename;
 try{fs.rename=async()=>{throw Object.assign(Error('Shared file'),{code:'EBUSY'});};await assert.rejects(restoreSongVersion(directory,song.id,saved.contentHash,song.contentHash),/Another app/);}finally{fs.rename=rename;}
 assert.deepEqual(await fs.readFile(file),current);await restoreSongVersion(directory,song.id,saved.contentHash,song.contentHash);assert.equal((await openCatalogSong(directory,song.id)).contentHash,song.contentHash);
}));
