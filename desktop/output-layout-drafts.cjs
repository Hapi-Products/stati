'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
function checked(source,translations){
 if(typeof source!=='string'||source.length>100000||!translations||typeof translations!=='object'||Array.isArray(translations))throw Error('This translation draft is too large or invalid. The previous draft was kept.');
 const entries=Object.entries(translations);if(entries.length>500||entries.some(([key,value])=>key.length>20000||typeof value!=='string'||value.length>10000))throw Error('Use up to 500 translated cues with 10,000 characters per cue.');
 const plain=JSON.stringify({source,translations});if(Buffer.byteLength(plain)>1024*1024)throw Error('Translation drafts for one song can use up to 1 MB. Export this copy before adding more.');return plain;
}
function createOutputTranslationStore(directory,protection){
 const pending=new Map();
 function folder(user){if(typeof user!=='string'||! /^[\w-]{20,60}$/.test(user))throw Error('Choose your profile first.');return path.join(directory,user);}
 function location(user,source){checked(source,{});return path.join(folder(user),crypto.createHash('sha256').update(source).digest('hex')+'.bin');}
 function secure(){if(!protection.isEncryptionAvailable()||protection.getSelectedStorageBackend?.()==='basic_text')throw Error('Protected translation drafts are unavailable. Export your copy before closing.');}
 async function load(user,source,assertCurrent=()=>{}){
  secure();const file=location(user,source);await pending.get(folder(user));assertCurrent();
  try{const info=await fs.lstat(file);if(info.isSymbolicLink()||!info.isFile()||info.size>2*1024*1024)throw Error('Invalid translation draft');const data=JSON.parse(protection.decryptString(await fs.readFile(file)));checked(data.source,data.translations);if(data.source!==source)throw Error('Translation source changed');assertCurrent();return data.translations;}
  catch(error){if(error.code==='ENOENT')return{};throw Error('This translation draft could not be opened. Its saved file has been kept.');}
 }
 function save(user,source,translations,assertCurrent=()=>{}){
  secure();const plain=checked(source,translations),file=location(user,source),parent=folder(user),bytes=protection.encryptString(plain);
  if(bytes.length>2*1024*1024)throw Error('This protected translation draft is too large. The previous draft was kept.');
  const operation=(pending.get(parent)||Promise.resolve()).catch(()=>{}).then(async()=>{
   assertCurrent();await fs.mkdir(parent,{recursive:true,mode:0o700});const info=await fs.lstat(parent);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Protected translation storage is unavailable.');
   const existing=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(existing?.isSymbolicLink()||existing&&!existing.isFile())throw Error('The previous translation draft has been kept.');
   if(!existing&&(await fs.readdir(parent)).filter(name=>/^[a-f0-9]{64}\.bin$/.test(name)).length>=100)throw Error('This profile has 100 saved translation drafts. Export the current copy before adding another.');
   const temporary=file+'.'+crypto.randomUUID()+'.tmp';try{assertCurrent();const handle=await fs.open(temporary,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}assertCurrent();await fs.rename(temporary,file);return{saved:true};}finally{await fs.unlink(temporary).catch(()=>{});}
  });pending.set(parent,operation);return operation.finally(()=>{if(pending.get(parent)===operation)pending.delete(parent);});
 }
 return{load,save,flush:async()=>{await Promise.allSettled([...pending.values()]);}};
}
module.exports={createOutputTranslationStore};
