const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const helpers=import('../scripts/release-workspace.mjs'),verification=import('../scripts/verify-preview-artifacts.mjs');
async function fixture(fn){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'stati-build-fixture-')));try{await fn(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
async function put(root,name,value='source'){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),value);}
async function source(root){
 for(const name of ['AGENTS.md','index.html','tsconfig.json','vite.config.ts','vite.desktop.config.ts','vitest.config.ts','wrangler.jsonc','worker-configuration.d.ts'])await put(root,name);
 for(const dir of ['desktop','src','public','scripts','tests','vendor','migrations'])await fs.mkdir(path.join(root,dir),{recursive:true});
 await put(root,'package.json',JSON.stringify({version:'0.1.0',dependencies:{a:'1.0.0'}}));await put(root,'package-lock.json','locked dependencies');await put(root,'desktop/preview-build.json','{"number":22}');
}
test('release snapshot omits private/generated inputs, retains exact sources, and overrides only staged preview',()=>fixture(async root=>{
 const h=await helpers;await source(root);
 for(const name of ['.dev.vars','.env.production','release/old.exe','node_modules/cold/file.js','desktop/build/old.js','desktop/public/ocr/old.wasm','vendor/signing.jks'])await put(root,name,'private or generated');
 await put(root,'vendor/tesseract-data/ron.traineddata.gz','pinned language');await put(root,'docs/releases/preview23.md','Release notes');
 const snapshot=await h.snapshotSources(root,{preview:23,notesFile:'docs/releases/preview23.md'});
 assert.equal(JSON.parse(snapshot.files.get('desktop/preview-build.json')).number,23);assert.equal(JSON.parse(await fs.readFile(path.join(root,'desktop/preview-build.json'))).number,22);
 assert.equal(snapshot.files.get('vendor/tesseract-data/ron.traineddata.gz').toString(),'pinned language');assert.ok(snapshot.files.has('docs/releases/preview23.md'));
 for(const name of snapshot.files.keys())assert.ok(!/(\.dev\.vars|\.env|^release|node_modules|desktop\/(build|public)|\.jks$)/.test(name),name);
 assert.equal(snapshot.digest,h.sourceDigest(snapshot.files));
 const originalDigest=snapshot.digest;await put(root,'desktop/preview-build.json','{"number":99}');
 assert.notEqual((await h.snapshotSources(root,{notesFile:'docs/releases/preview23.md'})).digest,originalDigest);
}));
test('snapshot refuses symlinked source and notes paths',()=>fixture(async root=>{
 const h=await helpers;await source(root);await put(root,'outside.txt','private');await fs.symlink(path.join(root,'outside.txt'),path.join(root,'desktop/redirect.cjs'));
 await assert.rejects(()=>h.snapshotSources(root),/symlink/);await fs.unlink(path.join(root,'desktop/redirect.cjs'));
 await assert.rejects(()=>h.snapshotSources(root,{notesFile:'../outside.txt'}),/path/);
}));
test('workspace ownership refuses source overlap, unowned contents, different owner and symlink marker',()=>fixture(async root=>{
 const h=await helpers,src=path.join(root,'source'),stage=path.join(root,'stage');await fs.mkdir(src);await fs.mkdir(stage);await put(stage,'keep.txt','retain');
 await assert.rejects(()=>h.ownWorkspace(src,stage),/nonempty/);assert.equal(await fs.readFile(path.join(stage,'keep.txt'),'utf8'),'retain');
 await assert.rejects(()=>h.ownWorkspace(src,path.join(src,'cache')),/separate/);await fs.unlink(path.join(stage,'keep.txt'));await h.ownWorkspace(src,stage);
 const other=path.join(root,'other');await fs.mkdir(other);await assert.rejects(()=>h.ownWorkspace(other,stage),/different source/);
 await fs.rename(path.join(stage,'.stati-workspace.json'),path.join(root,'marker.json'));await fs.symlink(path.join(root,'marker.json'),path.join(stage,'.stati-workspace.json'));await assert.rejects(()=>h.ownWorkspace(src,stage),/marker/);
}));
test('source synchronization reuses bytes, removes deleted files and preserves dependencies',()=>fixture(async root=>{
 const h=await helpers,src=path.join(root,'source'),stage=path.join(root,'stage');await fs.mkdir(src);await h.ownWorkspace(src,stage);await put(stage,'node_modules/retained','cached');
 const files=new Map([['desktop/main.cjs',Buffer.from('first')],['src/shared/old.js',Buffer.from('obsolete')]]),snapshot={files,digest:h.sourceDigest(files)};
 assert.equal((await h.syncSources(stage,snapshot)).copied,2);assert.equal((await h.syncSources(stage,snapshot)).unchanged,2);
 files.delete('src/shared/old.js');files.set('desktop/main.cjs',Buffer.from('second'));
 const result=await h.syncSources(stage,{files,digest:h.sourceDigest(files)});assert.equal(result.removed,1);assert.equal(await fs.readFile(path.join(stage,'desktop/main.cjs'),'utf8'),'second');assert.equal(await fs.readFile(path.join(stage,'node_modules/retained'),'utf8'),'cached');
}));
test('a failed first sync cannot leave stale source in the next package',()=>fixture(async root=>{
 const h=await helpers,src=path.join(root,'source'),stage=path.join(root,'stage');await fs.mkdir(src);await h.ownWorkspace(src,stage);await put(stage,'desktop/external-target','unchanged');await fs.symlink(path.join(stage,'desktop/external-target'),path.join(stage,'desktop/bad.cjs'));
 const files=new Map([['desktop/new.cjs',Buffer.from('partial')],['desktop/bad.cjs',Buffer.from('blocked')]]);
 await assert.rejects(()=>h.syncSources(stage,{files,digest:h.sourceDigest(files)}),/Unsafe/);
 await fs.unlink(path.join(stage,'desktop/bad.cjs'));await put(stage,'desktop/new.cjs','copied before an interrupted manifest write');
 await h.syncSources(stage,{files:new Map(),digest:h.sourceDigest(new Map())});
 await assert.rejects(()=>fs.access(path.join(stage,'desktop/new.cjs')),/ENOENT/);
}));
test('state or notes parent symlinks cannot redirect writes or stale-file deletion',()=>fixture(async root=>{
 const h=await helpers,src=path.join(root,'source'),stage=path.join(root,'stage'),outside=path.join(root,'outside');await fs.mkdir(src);await h.ownWorkspace(src,stage);await put(outside,'releases/keep.md','preserve');
 await fs.symlink(outside,path.join(stage,'.stati-build'));await assert.rejects(()=>h.syncSources(stage,{files:new Map()}),/Unsafe/);await fs.unlink(path.join(stage,'.stati-build'));
 await fs.symlink(outside,path.join(stage,'docs'));await assert.rejects(()=>h.syncSources(stage,{files:new Map()}),/Unsafe/);assert.equal(await fs.readFile(path.join(outside,'releases/keep.md'),'utf8'),'preserve');
}));
test('dependency cache changes for lock or host runtime changes, not UI-only edits',async()=>{
 const h=await helpers,files=new Map([['package.json',Buffer.from('{"dependencies":{"a":"1"}}')],['package-lock.json',Buffer.from('lock')],['desktop/main.cjs',Buffer.from('one')]]),runtime={node:'24',platform:'darwin',arch:'arm64'},key=h.dependencyKey(files,runtime);
 files.set('desktop/main.cjs',Buffer.from('two'));assert.equal(h.dependencyKey(files,runtime),key);assert.notEqual(h.dependencyKey(files,{...runtime,node:'26'}),key);files.set('package-lock.json',Buffer.from('new lock'));assert.notEqual(h.dependencyKey(files,runtime),key);
});
test('one workspace cannot be built by two active processes',()=>fixture(async root=>{
 const h=await helpers,release=await h.lockWorkspace(root);try{await assert.rejects(()=>h.lockWorkspace(root),/Another release build/);}finally{await release();}
 const again=await h.lockWorkspace(root);await again();
}));
test('a failed dependency reinstall invalidates the old stamp before partial files appear',()=>fixture(async root=>{
 const h=await helpers,key='a'.repeat(64),other='b'.repeat(64);await fs.mkdir(path.join(root,'.stati-build'));await put(root,'.stati-build/dependencies.json',JSON.stringify({key}));
 let installs=0;const failed=async()=>{installs++;await fs.mkdir(path.join(root,'node_modules'),{recursive:true});throw Error('Install interrupted');};
 await assert.rejects(()=>h.ensureDependencies(root,other,failed),/interrupted/);
 await assert.rejects(()=>fs.access(path.join(root,'.stati-build/dependencies.json')),/ENOENT/);
 assert.equal(await h.ensureDependencies(root,key,async()=>{installs++;}),false);assert.equal(installs,2);
 assert.equal(await h.ensureDependencies(root,key,async()=>{throw Error('Should reuse');}),true);
}));
test('package path gate rejects private variants while allowing dependency source tests',async()=>{
 const v=await verification;
 for(const name of ['desktop/.env.production','desktop/.dev.vars.production','desktop/key.p12','tests/fixture.cjs','.stati-build/sources.json'])assert.throws(()=>v.assertPackagedPaths([name]),/Private/);
 assert.doesNotThrow(()=>v.assertPackagedPaths(['desktop/main.cjs','node_modules/zod/src/v4/tests/schema.test.ts']));
});
test('packaged metadata allows builder development-field removal and rejects other changes',async()=>{
 const v=await verification,source={name:'stati',version:'0.1.0',main:'desktop/main.cjs',dependencies:{a:'1'},scripts:{dev:'node script'},devDependencies:{test:'1'}};
 assert.doesNotThrow(()=>v.assertPackageMetadata({name:'stati',version:'0.1.0',main:'desktop/main.cjs',dependencies:{a:'1'}},source));
 assert.throws(()=>v.assertPackageMetadata({name:'stati',version:'0.1.0',main:'other.cjs',dependencies:{a:'1'}},source),/metadata/);
});
async function warmInputs(root){
 const h=await helpers,src=path.join(root,'source'),stage=path.join(root,'stage');await fs.mkdir(src);await source(src);await put(src,'desktop/song.cjs','lyrics');await h.ownWorkspace(src,stage);
 const first=await h.snapshotSources(src,{cacheRoot:stage});await h.syncSources(stage,first);return{h,src,stage,first};
}
test('unchanged raw inputs use rehashed local cache bytes without hydrating source again',()=>fixture(async root=>{
 const {h,src,stage,first}=await warmInputs(root);
 const next=await h.snapshotSources(src,{cacheRoot:stage,readSource:()=>{throw Error('Unchanged source must not be read');}});
 assert.equal(next.digest,first.digest);assert.equal(next.cache.sourceReads,0);assert.equal(next.cache.hits,first.files.size);
 const metadata=JSON.parse(await fs.readFile(path.join(stage,'.stati-build/inputs.json'),'utf8'));
 const record=metadata.files.find(file=>file.path==='desktop/song.cjs');assert.deepEqual(Object.keys(record.stat),['dev','ino','size','mtimeNs','ctimeNs']);
 assert.equal(await fs.readFile(path.join(stage,'.stati-build/input-cache',record.sha256),'utf8'),'lyrics');
}));
test('edited source invalidates only its cached stat signature',()=>fixture(async root=>{
 const {h,src,stage}=await warmInputs(root),reads=[];await put(src,'desktop/song.cjs','praise');
 const next=await h.snapshotSources(src,{cacheRoot:stage,readSource:async filename=>{reads.push(path.relative(src,filename));return fs.readFile(filename);}});
 assert.deepEqual(reads,['desktop/song.cjs']);assert.equal(next.files.get('desktop/song.cjs').toString(),'praise');assert.equal(next.cache.sourceReads,1);
}));
test('a source edited after enumeration cannot be accepted from the queued cache signature',()=>fixture(async root=>{
 const {h,src,stage}=await warmInputs(root);for(let n=0;n<20;n++)await put(src,'desktop/queued'+n+'.cjs','queued source '+n);await put(src,'desktop/zz-last.cjs','before');
 await h.syncSources(stage,await h.snapshotSources(src,{cacheRoot:stage}));await put(src,'AGENTS.md','changed to force actual read');
 const reads=[],next=await h.snapshotSources(src,{cacheRoot:stage,readSource:async filename=>{
  const name=path.relative(src,filename);reads.push(name);if(name==='AGENTS.md')await put(src,'desktop/zz-last.cjs','after queued enumeration');return fs.readFile(filename);
 }});
 assert.equal(next.files.get('desktop/zz-last.cjs').toString(),'after queued enumeration');
 // Concurrent hydration may observe the intentional edit during its first
 // read. The snapshot must retry that file, never reuse its stale cache bytes.
 assert.deepEqual([...new Set(reads)].sort(),['AGENTS.md','desktop/zz-last.cjs']);
 assert.ok(reads.filter(name=>name==='desktop/zz-last.cjs').length<=3);assert.equal(next.cache.sourceReads,reads.length);
}));
test('a same-size corrupted cache blob and a missing blob fall back to actual source',()=>fixture(async root=>{
 const {h,src,stage}=await warmInputs(root),metadata=JSON.parse(await fs.readFile(path.join(stage,'.stati-build/inputs.json'),'utf8'));
 const record=metadata.files.find(file=>file.path==='desktop/song.cjs'),blob=path.join(stage,'.stati-build/input-cache',record.sha256);
 for(const corrupt of [true,false]){
  if(corrupt)await fs.writeFile(blob,'broken');else await fs.unlink(blob);
  const reads=[],next=await h.snapshotSources(src,{cacheRoot:stage,readSource:async filename=>{reads.push(path.relative(src,filename));return fs.readFile(filename);}});
  assert.deepEqual(reads,['desktop/song.cjs']);assert.equal(next.files.get('desktop/song.cjs').toString(),'lyrics');await h.syncSources(stage,next);
 }
}));
test('rehash-source forces reading every actual source despite a valid cache',()=>fixture(async root=>{
 const {h,src,stage,first}=await warmInputs(root);let reads=0;
 const next=await h.snapshotSources(src,{cacheRoot:stage,rehashSource:true,readSource:async filename=>{reads++;return fs.readFile(filename);}});
 assert.equal(reads,first.files.size);assert.equal(next.cache.hits,0);assert.equal(next.digest,first.digest);
}));
test('staged preview overrides never replace original preview bytes or metadata in input cache',()=>fixture(async root=>{
 const {h,src,stage}=await warmInputs(root),first=await h.snapshotSources(src,{preview:23,cacheRoot:stage});await h.syncSources(stage,first);
 assert.equal(JSON.parse(await fs.readFile(path.join(stage,'desktop/preview-build.json'))).number,23);
 const next=await h.snapshotSources(src,{preview:24,cacheRoot:stage,readSource:()=>{throw Error('Raw preview should be cached');}});
 assert.equal(JSON.parse(next.files.get('desktop/preview-build.json')).number,24);assert.equal(JSON.parse(next.rawFiles.get('desktop/preview-build.json')).number,22);
 await h.syncSources(stage,next);assert.equal(JSON.parse(await fs.readFile(path.join(src,'desktop/preview-build.json'))).number,22);
 const metadata=JSON.parse(await fs.readFile(path.join(stage,'.stati-build/inputs.json'),'utf8')),record=metadata.files.find(file=>file.path==='desktop/preview-build.json');
 assert.equal(JSON.parse(await fs.readFile(path.join(stage,'.stati-build/input-cache',record.sha256))).number,22);
}));
test('source hydration runs concurrently with at most eight independent reads',()=>fixture(async root=>{
 const h=await helpers;await source(root);for(let n=0;n<20;n++)await put(root,'desktop/source'+n+'.cjs','unique source '+n);
 let active=0,peak=0;
 const snapshot=await h.snapshotSources(root,{readSource:async filename=>{active++;peak=Math.max(peak,active);try{await new Promise(resolve=>setTimeout(resolve,5));return await fs.readFile(filename);}finally{active--;}}});
 assert.equal(peak,8);assert.equal(active,0);assert.equal(snapshot.cache.sourceReads,snapshot.files.size);
}));
test('symlinked cache blobs and metadata cannot redirect source reuse or cache writes',()=>fixture(async root=>{
 const {h,src,stage,first}=await warmInputs(root),metadataPath=path.join(stage,'.stati-build/inputs.json'),metadata=JSON.parse(await fs.readFile(metadataPath,'utf8'));
 const record=metadata.files.find(file=>file.path==='desktop/song.cjs'),blob=path.join(stage,'.stati-build/input-cache',record.sha256),outside=path.join(root,'outside.txt');await fs.writeFile(outside,'preserve external fixture');
 await fs.unlink(blob);await fs.symlink(outside,blob);await assert.rejects(()=>h.snapshotSources(src,{cacheRoot:stage}),/Unsafe input cache file/);await assert.rejects(()=>h.syncSources(stage,first),/Unsafe input cache file/);
 assert.equal(await fs.readFile(outside,'utf8'),'preserve external fixture');await fs.unlink(blob);await fs.writeFile(blob,'lyrics');
 await fs.unlink(metadataPath);await fs.symlink(outside,metadataPath);await assert.rejects(()=>h.snapshotSources(src,{cacheRoot:stage}),/Unsafe input cache metadata/);assert.equal(await fs.readFile(outside,'utf8'),'preserve external fixture');
}));
test('input cache requires the same source owner and malformed metadata falls back to source',()=>fixture(async root=>{
 const {h,src,stage,first}=await warmInputs(root);await fs.writeFile(path.join(stage,'.stati-build/inputs.json'),'{not JSON');
 const next=await h.snapshotSources(src,{cacheRoot:stage});assert.equal(next.cache.hits,0);assert.equal(next.cache.sourceReads,first.files.size);
 await fs.writeFile(path.join(stage,'.stati-workspace.json'),JSON.stringify({schema:1,source:root}));await assert.rejects(()=>h.snapshotSources(src,{cacheRoot:stage}),/different source/);
}));
