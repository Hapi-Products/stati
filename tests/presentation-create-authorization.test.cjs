const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const data={title:'New song',songName:'New song',slides:[{section:'Lyrics',text:'A new song to prepare'}]};
async function fixture(check,{atSave=()=>{},atBuild=()=>{},afterWrite=()=>{},folder=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-create-authority-')),directory=path.join(root,'Lyrics'),userData=path.join(root,'profile'),output=path.join(root,'new.pro');await fs.mkdir(directory);await fs.mkdir(userData);if(!folder)await fs.writeFile(path.join(userData,'lyrics-folder.json'),JSON.stringify({path:directory}));
 const original=Module._load,entry=require.resolve('../desktop/advanced.cjs'),cached=require.cache[entry];let allowed=true;const control={stop:()=>{allowed=false;},assertCurrent:()=>{if(!allowed)throw Error('Profile locked');},root,directory,userData,output};
 const work=async task=>{if(task==='search')return{matches:[],searched:0};await atBuild(control);return Buffer.from('explicit-local-build-fixture');};work.withSignal=async(task,signal,...args)=>{signal?.throwIfAborted();return work(task,...args);};
 const localFs=new Proxy(fs,{get(target,key){if(key==='open')return async(...args)=>{const file=await target.open(...args);return new Proxy(file,{get(handle,property){if(property==='writeFile')return async value=>{await handle.writeFile(value);await afterWrite(control);};const method=Reflect.get(handle,property);return typeof method==='function'?method.bind(handle):method;}});};return target[key];}});
 delete require.cache[entry];Module._load=function(name,parent,...rest){if(parent?.filename===entry){if(name==='electron')return{app:{getPath:()=>userData},dialog:{showSaveDialog:async()=>{await atSave(control);return{canceled:false,filePath:output};},showOpenDialog:async()=>{await atSave(control);return{canceled:false,filePaths:[directory]};}}};if(name==='node:fs/promises')return localFs;if(name==='./conversion-work.cjs')return work;}return original.call(this,name,parent,...rest);};
 try{await check(require(entry),control);}finally{Module._load=original;delete require.cache[entry];if(cached)require.cache[entry]=cached;await fs.rm(root,{recursive:true,force:true});}
}
test('new ProPresenter and text exports stop after profile lock in the save chooser',async()=>{
 for(const method of ['exportPresentation','exportLyrics'])await fixture(async(advanced,c)=>{await assert.rejects(advanced[method](data,null,c.root,c.root,c.assertCurrent),/Profile locked/);await assert.rejects(fs.stat(c.output),{code:'ENOENT'});},{atSave:c=>c.stop()});
});
test('new library insertion stops after profile lock while conversion was running',async()=>{
 await fixture(async(advanced,c)=>{await assert.rejects(advanced.insertPresentation(data,null,c.root,c.root,c.assertCurrent),/Profile locked/);assert.deepEqual(await fs.readdir(c.directory),[]);},{atBuild:c=>c.stop()});
});
test('newly created files are removed by identity if access changes during their write',async()=>{
 for(const method of ['exportPresentation','exportLyrics','insertPresentation'])await fixture(async(advanced,c)=>{await assert.rejects(advanced[method](data,null,c.root,c.root,c.assertCurrent),/Profile locked/);await assert.rejects(fs.stat(c.output),{code:'ENOENT'});assert.deepEqual(await fs.readdir(c.directory),[]);},{afterWrite:c=>c.stop()});
});
test('existing originals are preserved by exclusive creation',async()=>{
 await fixture(async(advanced,c)=>{await fs.writeFile(c.output,'original bytes');await assert.rejects(advanced.exportPresentation(data,null,c.root,c.root,c.assertCurrent),/already exists/);assert.equal(await fs.readFile(c.output,'utf8'),'original bytes');});
});
test('locking during first Lyrics-folder selection does not save a global folder preference',async()=>{
 await fixture(async(advanced,c)=>{await assert.rejects(advanced.insertPresentation(data,null,c.root,c.root,c.assertCurrent),/Profile locked/);await assert.rejects(fs.stat(path.join(c.userData,'lyrics-folder.json')),{code:'ENOENT'});assert.deepEqual(await fs.readdir(c.directory),[]);},{folder:true,atSave:c=>c.stop()});
});
