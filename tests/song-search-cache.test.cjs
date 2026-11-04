const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {findSong}=require('../desktop/library.cjs');
test('batch search reuses unchanged lyric reads, refreshes changed files, discovers new files and drops deleted entries',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-song-cache-')),cache=new Map(),read=fs.readFile;let reads=0;
 try{
  const first=path.join(root,'one.txt'),second=path.join(root,'two.txt');await fs.writeFile(first,'First existing song\nAnother line');await fs.writeFile(second,'Second existing song');
  fs.readFile=async(...args)=>{if(args[0].endsWith('.txt'))reads++;return read(...args);};
  assert.equal((await findSong(root,[{text:'First existing song'}],'',cache)).matches.length,1);assert.equal(reads,2);
  assert.equal((await findSong(root,[{text:'Second existing song'}],'',cache)).matches.length,1);assert.equal(reads,2);
  await fs.writeFile(first,'Changed existing song');await fs.utimes(first,new Date(),new Date(Date.now()+2000));assert.equal((await findSong(root,[{text:'Changed existing song'}],'',cache)).matches.length,1);assert.equal(reads,3);
  const third=path.join(root,'three.txt');await fs.writeFile(third,'New song added during batch');assert.equal((await findSong(root,[{text:'New song added during batch'}],'',cache)).matches.length,1);assert.equal(reads,4);
  await fs.unlink(second);assert.equal((await findSong(root,[{text:'Second existing song'}],'',cache)).matches.length,0);assert.equal(cache.has(second),false);assert.equal(reads,4);
 }finally{fs.readFile=read;await fs.rm(root,{recursive:true,force:true});}
});
