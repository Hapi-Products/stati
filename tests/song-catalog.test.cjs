const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {searchCatalog,openCatalogSong}=require('../desktop/song-catalog.cjs'),{buildPresentation}=require('../desktop/presentation.cjs');
async function fixture(fn){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stati-catalog-'));try{await fn(directory);}finally{await fs.rm(directory,{recursive:true,force:true});}}
test('catalog searches native Romanian lyrics with unrelated filenames and reopens slides without duplicating the Amen footer',()=>fixture(async directory=>{const original=buildPresentation({title:'Împreună cântăm (Laudă)',language:'ron',fontSize:120,slides:[{section:'Verse',text:'Împreună cântăm\nDoamne, slava Ta'},{section:'Chorus',text:'Iubire și har'}]});await fs.writeFile(path.join(directory,'042.pro'),original);const result=await searchCatalog(directory,{query:'impreuna cantam',language:'ron'});assert.equal(result.total,1);assert.equal(result.items[0].filename,'042.pro');assert.equal(result.items[0].category,'Uncategorized');const song=await openCatalogSong(directory,result.items[0].id);assert.equal(song.text,'Împreună cântăm\nDoamne, slava Ta\n\nIubire și har');assert.equal(song.songName,'Laudă');assert.equal(song.fontSize,120);assert.deepEqual(await fs.readFile(path.join(directory,'042.pro')),original);}));
test('lyric search previews the matching later slides in their original Romanian spelling',()=>fixture(async directory=>{
 const original=buildPresentation({title:'Catalog fixture',language:'ron',slides:[
  {section:'Verse',text:'Prima linie\nA doua linie\nA treia linie\nA patra linie'},
  {section:'Chorus',text:'Împreună cântăm\nSlavă pentru Tine\nIubire și har\nDomnul e bun'},
  {section:'Verse',text:'Ultima strofă'}
 ]});
 await fs.writeFile(path.join(directory,'042.pro'),original);
 const result=await searchCatalog(directory,{query:'impreuna cantam slava'}),song=result.items[0];
 assert.equal(result.total,1);assert.equal(song.title,'Catalog fixture');assert.equal(song.firstLine,'Prima linie');
 assert.equal(song.lyricPreview,'Împreună cântăm\nSlavă pentru Tine\nIubire și har\nDomnul e bun');
 assert.equal(Object.hasOwn(song,'text'),false);assert.doesNotMatch(song.lyricPreview,/Amin/);
 assert.deepEqual(await fs.readFile(path.join(directory,'042.pro')),original);
}));
test('lyric excerpts favor the window with the most query words and retain opening lyrics for metadata-only matches',()=>fixture(async directory=>{
 const opening='Hope will rise\nFirst verse line\nAnother opening line\nThe opening ends';
 await fs.writeFile(path.join(directory,'number-042.txt'),opening+'\n\nWe sing with hope\nYour mercy is new\nGrace fills our hearts\nLast chorus line\n\nA final line');
 const matching=(await searchCatalog(directory,{query:'hope mercy'})).items[0];
 assert.equal(matching.lyricPreview,'We sing with hope\nYour mercy is new\nGrace fills our hearts\nLast chorus line');
 for(const query of ['', 'number 042'])assert.equal((await searchCatalog(directory,{query})).items[0].lyricPreview,opening);
 assert.equal((await searchCatalog(directory,{query:'final'})).items[0].lyricPreview,'A final line');
}));
test('catalog reports unreadable files, filters folders and favorites, and rejects arbitrary paths',()=>fixture(async directory=>{await fs.mkdir(path.join(directory,'Choir'));await fs.writeFile(path.join(directory,'Choir','song.txt'),'We sing your glory, Lord');await fs.writeFile(path.join(directory,'broken.pro'),Buffer.from([255,255]));const result=await searchCatalog(directory,{query:'glory',category:'Choir'});assert.equal(result.total,1);assert.equal(result.unreadable,1);assert.deepEqual(result.warnings,['broken.pro']);assert.equal((await searchCatalog(directory,{favoritesOnly:true})).total,0);assert.equal((await searchCatalog(directory,{favoritesOnly:true},[result.items[0].id])).total,1);await assert.rejects(openCatalogSong(directory,'../../secret'),/Invalid song/);await fs.unlink(path.join(directory,'Choir','song.txt'));await assert.rejects(openCatalogSong(directory,result.items[0].id),/no longer/);}));
test('a library symlink cannot expose a file outside Lyrics',()=>fixture(async directory=>{const outside=await fs.mkdtemp(path.join(os.tmpdir(),'stati-outside-'));try{await fs.writeFile(path.join(outside,'private.txt'),'Unrelated private words');await fs.symlink(path.join(outside,'private.txt'),path.join(directory,'linked.txt'));assert.equal((await searchCatalog(directory)).scanned,0);}finally{await fs.rm(outside,{recursive:true,force:true});}}));
test('catalog bounds search input and does not invent editable text for image presentations',()=>fixture(async directory=>{await fs.writeFile(path.join(directory,'image.pro'),buildPresentation({title:'Images',slides:[{section:'Slide',text:'placeholder'}]},['/tmp/test-image.png']));const result=await searchCatalog(directory);assert.equal(result.items[0].editable,false);assert.equal(result.items[0].language,'unknown');assert.equal((await searchCatalog(directory,{language:'eng'})).total,0);await assert.rejects(openCatalogSong(directory,result.items[0].id),/no editable lyrics/);await assert.rejects(searchCatalog(directory,{query:'x'.repeat(201)}),/valid song search/);}));
test('song favorites survive restart, remain operator scoped and serialize simultaneous changes',()=>fixture(async directory=>{const {favoritesStore}=require('../desktop/song-favorites.cjs'),one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222',a='a'.repeat(64),b='b'.repeat(64);let store=favoritesStore(directory);await Promise.all([store.set(one,a,true),store.set(one,b,true)]);store=favoritesStore(directory);assert.deepEqual((await store.load(one)).sort(),[a,b]);assert.deepEqual(await store.load(two),[]);await fs.writeFile(path.join(directory,'song-favorites-'+one+'.json'),'damaged');await assert.rejects(store.set(one,a,false),/preserved/);assert.equal(await fs.readFile(path.join(directory,'song-favorites-'+one+'.json'),'utf8'),'damaged');}));
test('catalog paginates large libraries without dropping results or changing the source files',()=>fixture(async directory=>{for(let i=0;i<55;i++)await fs.writeFile(path.join(directory,'song-'+String(i).padStart(2,'0')+'.txt'),'We sing your glory, Lord\nSong '+i);const first=await searchCatalog(directory),next=await searchCatalog(directory,{offset:50});assert.equal(first.total,55);assert.equal(first.items.length,50);assert.equal(next.items.length,5);assert.equal(new Set([...first.items,...next.items].map(song=>song.id)).size,55);assert.equal((await fs.readdir(directory)).length,55);}));
test('favorite identifiers do not collide when two libraries contain the same filename',()=>fixture(async one=>{const two=await fs.mkdtemp(path.join(os.tmpdir(),'stati-other-library-'));try{for(const dir of [one,two])await fs.writeFile(path.join(dir,'song.txt'),'We sing your glory, Lord');const a=(await searchCatalog(one)).items[0],b=(await searchCatalog(two)).items[0];assert.notEqual(a.id,b.id);assert.equal((await searchCatalog(two,{favoritesOnly:true},[a.id])).total,0);}finally{await fs.rm(two,{recursive:true,force:true});}}));
test('background worker searches a 400-song library and returns editable lyrics through the actual worker bridge',()=>fixture(async directory=>{await Promise.all(Array.from({length:400},(_,i)=>fs.writeFile(path.join(directory,'song-'+String(i).padStart(3,'0')+'.txt'),'Lord, we sing your glory\nSong number '+i)));const work=require('../desktop/conversion-work.cjs');const result=await work('catalog-search',directory,{query:'number 399'},[]);assert.equal(result.scanned,400);assert.equal(result.total,1);assert.equal(result.items[0].filename,'song-399.txt');const song=await work('catalog-open',directory,result.items[0].id);assert.equal(song.text,'Lord, we sing your glory\nSong number 399');assert.equal(song.songName,'');}));

test('catalog returns the actual opening slide independently of later lyric search matches',()=>fixture(async directory=>{
 const first='Împreună cântăm\nDoamne, slava Ta',later='Iubire și har\nTotul pentru Tine';
 const bytes=buildPresentation({title:'Opening preview',language:'ron',slides:[{section:'Verse',text:first},{section:'Chorus',text:later}]});
 await fs.writeFile(path.join(directory,'preview.pro'),bytes);
 const result=await searchCatalog(directory,{query:'iubire har'});
 assert.equal(result.items[0].firstSlide,first);assert.equal(result.items[0].lyricPreview,later);assert.doesNotMatch(result.items[0].firstSlide,/Amin|Iubire/);
 assert.deepEqual(await fs.readFile(path.join(directory,'preview.pro')),bytes);
}));
test('opening slide payloads are bounded without splitting Unicode and image-only songs invent no lyrics',()=>fixture(async directory=>{
 await fs.writeFile(path.join(directory,'large.txt'),'A'.repeat(1999)+'🎶\n\nSecond stanza');
 await fs.writeFile(path.join(directory,'image.pro'),buildPresentation({title:'Image fixture',slides:[{section:'Slide',text:'placeholder'}]},['/tmp/local-preview.png']));
 const result=await searchCatalog(directory);const large=result.items.find(song=>song.filename==='large.txt'),image=result.items.find(song=>song.filename==='image.pro');
 assert.equal(large.firstSlide,'A'.repeat(1999));assert.ok(large.firstSlide.length<=2000);assert.equal(image.firstSlide,'');assert.equal(image.editable,false);
}));
