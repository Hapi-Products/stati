const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
function normalizeDraft(input){
 if(!input||typeof input!=='object')throw Error('Invalid lyric draft.');
 const text=(key,max)=>{if(typeof input[key]!=='string'||input[key].length>max)throw Error('Invalid draft '+key+'.');return input[key];};
 if(!['auto','eng','ron'].includes(input.songLang)||!['eng','ron','both'].includes(input.language)||!Number.isInteger(input.lines)||input.lines<2||input.lines>8)throw Error('Invalid draft settings.');
 if(input.libraryId!==undefined&&input.libraryId!==null&&(typeof input.libraryId!=='string'||! /^[a-f0-9]{64}$/.test(input.libraryId)))throw Error('Invalid draft song reference.');
 if(input.libraryHash!==undefined&&input.libraryHash!==null&&(typeof input.libraryHash!=='string'||! /^[a-f0-9]{64}$/.test(input.libraryHash)))throw Error('Invalid draft song version.');
 const size=Number(input.fontSizeInput);if(!Number.isFinite(size)||size<32||size>160)throw Error('Choose a font size from 32 to 160.');
 const ending=input.amenFontSizeInput===undefined?undefined:Number(input.amenFontSizeInput);if(ending!==undefined&&(!Number.isFinite(ending)||ending<16||ending>96))throw Error('Choose an Amen / Amin size from 16 to 96.');
 return {text:text('text',100000),title:text('title',300),source:text('source',4000),url:text('url',4000),songLang:input.songLang,language:input.language,lines:input.lines,fontSizeInput:String(size),...(ending===undefined?{}:{amenFontSizeInput:String(ending)}),libraryId:input.libraryId||null,libraryHash:input.libraryHash||null};
}
function createDraftStore(directory,protection){
 const writes=new Map();
 const location=id=>{if(typeof id!=='string'||! /^[\w-]{20,60}$/.test(id))throw Error('Choose a registered operator first.');return path.join(directory,'lyric-draft-'+id+'.bin');};
 function protectedStorage(){if(!protection.isEncryptionAvailable()||protection.getSelectedStorageBackend?.()==='basic_text')throw Error('Protected storage is unavailable. Your draft has not been saved.');}
 async function read(id){protectedStorage();try{const raw=await fs.readFile(location(id));if(raw.length>512*1024)throw Error('Draft exceeds its size limit.');const envelope=JSON.parse(protection.decryptString(raw));if(envelope.version!==1)throw Error('Unsupported draft version.');return {draft:normalizeDraft(envelope.draft),savedAt:envelope.savedAt};}catch(error){if(error.code==='ENOENT')return null;throw Error('The saved draft could not be opened. It has been preserved.');}}
 return {async load(id){await writes.get(id);return read(id);},save(id,input){const target=location(id),draft=normalizeDraft(input);protectedStorage();const task=(writes.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{await read(id);const savedAt=Date.now();const bytes=protection.encryptString(JSON.stringify({version:1,draft,savedAt}));await fs.mkdir(directory,{recursive:true,mode:0o700});const temporary=target+'.'+crypto.randomUUID()+'.tmp';try{const output=await fs.open(temporary,'wx',0o600);try{await output.writeFile(bytes);await output.sync();}finally{await output.close();}await fs.rename(temporary,target);}finally{await fs.unlink(temporary).catch(()=>{});}return {savedAt};});writes.set(id,task);return task.finally(()=>{if(writes.get(id)===task)writes.delete(id);});},async flush(){await Promise.all([...writes.values()]);}};
}
module.exports={createDraftStore,normalizeDraft};
