const fs=require('node:fs/promises'),path=require('node:path');
const HASH=/^[a-f0-9]{64}$/;
function groupLabel(value){
 if(typeof value!=='string')throw Error('Enter a person or group name.');
 const label=value.normalize('NFC').trim().replace(/\s+/g,' ');
 if(!label||label.length>80||/[<>:"/\\|?*\x00-\x1f]/.test(label)||/[. ]$/.test(label)||label==='__generic__')throw Error('Use a person or group name up to 80 characters, without filename punctuation.');
 return label;
}
async function variantsDirectory(root,create=false){
 const directory=path.join(root,'.stati-variants');
 try{if(create)await fs.mkdir(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 try{const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Song group information is unavailable. Existing files have been kept.');return directory;}
 catch(error){if(!create&&error.code==='ENOENT')return null;throw error;}
}
async function readVariant(root,id){
 if(!HASH.test(id))throw Error('Invalid song selection.');
 const directory=await variantsDirectory(root);if(!directory)return null;
 let handle;
 try{
  const file=path.join(directory,id+'.json'),constants=require('node:fs').constants;
  handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  const stat=await handle.stat(),visible=await fs.lstat(file);
  if(!stat.isFile()||visible.isSymbolicLink()||stat.size>4096||stat.dev!==visible.dev||stat.ino!==visible.ino)throw Error('Invalid song group information.');
  const value=JSON.parse(await handle.readFile('utf8'));
  if(value.version!==1||value.songId!==id||!HASH.test(value.sourceSongId)||typeof value.baseTitle!=='string'||value.baseTitle.length>300||groupLabel(value.groupName)!==value.groupName)throw Error('Invalid song group information.');
  return value;
 }catch(error){if(error.code==='ENOENT')return null;throw Error('This song’s group information could not be read. Existing files have been kept.');}
 finally{await handle?.close();}
}
module.exports={groupLabel,variantsDirectory,readVariant};
