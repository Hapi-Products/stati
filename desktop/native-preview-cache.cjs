const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const owned=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(pdf|png|jpe?g|webp|mp4|mov|m4a|mp3|wav|bin)$/;
function createNativePreviewCache({directory,assertCurrent}){
 directory=path.resolve(directory);if(path.basename(directory)!=='native-previews')throw Error('Choose the private preview folder.');
 const files=new Set();
 async function safeDirectory(){
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  if((await fs.lstat(directory)).isSymbolicLink()||await fs.realpath(directory)!==directory)throw Error('The private preview folder is unavailable.');
 }
 async function remove(file){await safeDirectory();if(!owned.test(path.basename(file))||path.dirname(file)!==directory)return;try{const info=await fs.lstat(file);if(info.isFile()&&!info.isSymbolicLink())await fs.unlink(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
 return{
  async sweep(){await safeDirectory();for(const name of await fs.readdir(directory))if(owned.test(name))await remove(path.join(directory,name));files.clear();},
  async clear(){const previous=[...files];files.clear();await Promise.all(previous.map(remove));},
  async write(bytes,name,generation){
   assertCurrent(generation);await safeDirectory();if(bytes.length>50*1024*1024)throw Error('Open the saved file to view this document.');
   const ext=path.extname(String(name||'')).toLowerCase(),suffix=/^\.(pdf|png|jpe?g|webp|mp4|mov|m4a|mp3|wav)$/.test(ext)?ext:'.bin';
   const file=path.join(directory,crypto.randomUUID()+suffix);await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});files.add(file);
   try{assertCurrent(generation);}catch(error){files.delete(file);await remove(file);throw error;}
   while(files.size>24){const first=files.values().next().value;files.delete(first);await remove(first);}return file;
  }
 };
}
module.exports={createNativePreviewCache};
