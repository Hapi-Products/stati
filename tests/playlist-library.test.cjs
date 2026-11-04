const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {buildPresentation,decode}=require('../desktop/presentation.cjs'),{readSong}=require('../desktop/song-catalog.cjs'),{playlistReferences,playlistAttachmentReferences}=require('../desktop/playlist-library.cjs');
async function fixture(check){const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-playlist-library-'));try{await check(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
test('service playlists use the native song UUID even when title and filename differ',()=>fixture(async root=>{
 const file=path.join(root,'001.pro'),bytes=buildPresentation({title:'Împreună cântăm',slides:[{section:'Lyrics',text:'Doamne, noi cântăm\nSlavă pentru Tine'}]});await fs.writeFile(file,bytes);const song=await readSong(root,file),ref={songId:song.id,contentHash:song.contentHash,title:'Display name'};
 const result=await require('../desktop/conversion-work.cjs')('playlist-references',root,[ref,ref]);assert.equal(result.length,2);assert.equal(result[0].uuid,decode(bytes).uuid.string);assert.equal(result[0].name,'Împreună cântăm');assert.deepEqual(result[0],result[1]);assert.deepEqual(await fs.readFile(file),bytes);
}));
test('a repeated song with a stale second hash is rejected instead of reusing the first cache entry',()=>fixture(async root=>{
 const file=path.join(root,'song.pro');await fs.writeFile(file,buildPresentation({title:'Song',slides:[{section:'Lyrics',text:'We sing with hope'}]}));const song=await readSong(root,file);await assert.rejects(playlistReferences(root,[{songId:song.id,contentHash:song.contentHash},{songId:song.id,contentHash:'a'.repeat(64)}]),/different saved version/);
}));
test('saved attachment references use only real .pro files in Lyrics and match catalog IDs and hashes',()=>fixture(async root=>{
 const lyrics=path.join(root,'Lyrics');await fs.mkdir(lyrics);const file=path.join(lyrics,'different-file-name.pro'),bytes=buildPresentation({title:'Native song title',slides:[{section:'Lyrics',text:'We sing with hope'}]});await fs.writeFile(file,bytes);const song=await readSong(lyrics,file);
 const result=await require('../desktop/conversion-work.cjs')('playlist-attachment-references',lyrics,[file,file]);assert.deepEqual(result,[{songId:song.id,contentHash:song.contentHash,title:'Native song title',filename:'different-file-name.pro'}]);assert.deepEqual(await fs.readFile(file),bytes);
}));
test('exports outside Lyrics, symlinks outside it, history and text files cannot become attachments',()=>fixture(async root=>{
 const lyrics=path.join(root,'Lyrics');await fs.mkdir(lyrics);const outside=path.join(root,'outside.pro'),bytes=buildPresentation({title:'Outside',slides:[{section:'Lyrics',text:'We sing with hope'}]});await fs.writeFile(outside,bytes);await fs.symlink(outside,path.join(lyrics,'alias.pro'));await fs.mkdir(path.join(lyrics,'.stati-history'));await fs.writeFile(path.join(lyrics,'.stati-history','old.pro'),bytes);await fs.writeFile(path.join(lyrics,'song.txt'),'We sing with hope');
 assert.deepEqual(await playlistAttachmentReferences(lyrics,[outside,path.join(lyrics,'alias.pro'),path.join(lyrics,'.stati-history','old.pro'),path.join(lyrics,'song.txt')]),[]);assert.deepEqual(await fs.readFile(outside),bytes);
 await assert.rejects(playlistAttachmentReferences(lyrics,['../outside.pro']),/saved ProPresenter/);await assert.rejects(playlistAttachmentReferences(lyrics,Array(1001).fill(outside)),/1,000/);
}));
test('changed, missing, text-only and invalid references never become guessed playlist entries',()=>fixture(async root=>{
 const file=path.join(root,'song.pro');await fs.writeFile(file,buildPresentation({title:'Song',slides:[{section:'Lyrics',text:'We sing with hope'}]}));const song=await readSong(root,file),ref={songId:song.id,contentHash:song.contentHash};await fs.appendFile(file,'changed');await assert.rejects(playlistReferences(root,[ref]),/changed/);await fs.unlink(file);await assert.rejects(playlistReferences(root,[ref]),/no longer/);
 await fs.writeFile(path.join(root,'song.txt'),'We sing with hope');const text=await readSong(root,path.join(root,'song.txt'));await assert.rejects(playlistReferences(root,[{songId:text.id,contentHash:text.contentHash}]),/ProPresenter files/);await assert.rejects(playlistReferences(root,[{songId:'../../private',contentHash:'a'.repeat(64)}]),/Invalid/);
}));

test('partial sync resolves only verified available files so one missing song cannot block unrelated service updates',()=>fixture(async root=>{
 const first=path.join(root,'first.pro'),second=path.join(root,'second.pro');
 await fs.writeFile(first,buildPresentation({title:'First',slides:[{section:'Lyrics',text:'We sing with hope'}]}));
 await fs.writeFile(second,buildPresentation({title:'Second',slides:[{section:'Lyrics',text:'We sing with joy'}]}));
 const a=await readSong(root,first),b=await readSong(root,second),refs=[a,b].map(song=>({songId:song.id,contentHash:song.contentHash}));
 await fs.unlink(first);const found=await playlistReferences(root,refs,{allowUnavailable:true});
 assert.deepEqual(found.map(item=>item.songId),[b.id]);
 await assert.rejects(playlistReferences(root,[{songId:'invalid',contentHash:b.contentHash}],{allowUnavailable:true}),/Invalid/);
 assert.equal(found[0].uuid,decode(await fs.readFile(second)).uuid.string);
}));

test('partial resolution rejects inconsistent repeated versions before skipping either stale appearance, in both orders',()=>fixture(async root=>{
 const file=path.join(root,'repeat.pro'),bytes=buildPresentation({title:'Repeated song',slides:[{section:'Lyrics',text:'We sing with hope'}]});await fs.writeFile(file,bytes);const song=await readSong(root,file);
 const current={id:'current-appearance-123456',songId:song.id,contentHash:song.contentHash},stale={id:'stale-appearance-12345678',songId:song.id,contentHash:'a'.repeat(64)};
 for(const refs of [[stale,current],[current,stale]])for(const allowUnavailable of [true,false])await assert.rejects(playlistReferences(root,refs,{allowUnavailable}),/different saved version/);
 const same=await playlistReferences(root,[current,{...current,id:stale.id}],{allowUnavailable:true});assert.equal(same.length,2);assert.equal(same[0].uuid,same[1].uuid);assert.deepEqual(await fs.readFile(file),bytes);
}));
