const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createNativePreviewCache}=require('../desktop/native-preview-cache.cjs');
async function fixture(work){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'stati-private-preview-')));try{await work(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
test('startup sweep removes crashed owned previews and preserves unrelated files',()=>fixture(async root=>{
 const directory=path.join(root,'native-previews');await fs.mkdir(directory);const owned='00000000-0000-4000-8000-000000000001.pdf';await fs.writeFile(path.join(directory,owned),'private previous actor');await fs.writeFile(path.join(directory,'important-user-file.pdf'),'keep');
 await createNativePreviewCache({directory,assertCurrent(){}}).sweep();await assert.rejects(fs.stat(path.join(directory,owned)),{code:'ENOENT'});assert.equal(await fs.readFile(path.join(directory,'important-user-file.pdf'),'utf8'),'keep');
}));
test('sweep never follows a symlinked preview directory',()=>fixture(async root=>{
 const target=path.join(root,'documents');await fs.mkdir(target);const name='00000000-0000-4000-8000-000000000001.pdf';await fs.writeFile(path.join(target,name),'keep');const directory=path.join(root,'native-previews');await fs.symlink(target,directory);
 await assert.rejects(createNativePreviewCache({directory,assertCurrent(){}}).sweep(),/private preview/);assert.equal(await fs.readFile(path.join(target,name),'utf8'),'keep');
}));
test('a profile change during a write discards the new file; normal clear removes only current owned previews',()=>fixture(async root=>{
 const directory=path.join(root,'native-previews');let checks=0;const cache=createNativePreviewCache({directory,assertCurrent(){if(++checks>1)throw Error('Profile changed');}});
 await assert.rejects(cache.write(Buffer.from('private'),'../../../unsafe.pdf',1),/Profile changed/);assert.deepEqual(await fs.readdir(directory),[]);
 const next=createNativePreviewCache({directory,assertCurrent(){}}),file=await next.write(Buffer.from('pdf'),'song.pdf',2);assert.equal((await fs.stat(file)).mode&0o777,0o600);await next.clear();await assert.rejects(fs.stat(file),{code:'ENOENT'});
}));
