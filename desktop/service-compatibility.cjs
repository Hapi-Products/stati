'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile);
const {walk}=require('./library.cjs'),{idFor}=require('./song-catalog.cjs'),{decode}=require('./presentation.cjs');
const normalized=name=>name.normalize('NFKC').toLowerCase().replace(/[\s_-]/g,'');
const fence=({checkActive=()=>{},signal}={})=>async()=>{signal?.throwIfAborted();await checkActive();signal?.throwIfAborted();};
async function installedFonts({platform=process.platform,run=exec,checkActive,signal}={}){
 const fonts=new Set(),check=fence({checkActive,signal});await check();
 try{
  let raw;
  if(platform==='win32'){
   raw=(await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name | ConvertTo-Json -Compress"],{windowsHide:true,timeout:10000,maxBuffer:8*1024*1024,signal})).stdout;
   for(const value of [JSON.parse(raw)].flat())if(typeof value==='string')fonts.add(normalized(value));
  }else if(platform==='darwin'){
   raw=(await run('/usr/sbin/system_profiler',['SPFontsDataType','-json'],{timeout:15000,maxBuffer:16*1024*1024,signal})).stdout;
   const pending=[JSON.parse(raw)];let count=0;
   while(pending.length){if(++count>200000)throw Error('Font inventory is too large.');const value=pending.pop();if(!value||typeof value!=='object')continue;for(const [key,item]of Object.entries(value)){if(typeof item==='string'&&/name|family|typeface/i.test(key))fonts.add(normalized(item));else if(item&&typeof item==='object')pending.push(item);}}
  }
  await check();return{known:fonts.size>0,fonts};
 }catch{
  // A revoked profile or cancellation must reject the entire check instead of
  // being mistaken for an unavailable font inventory.
  await check();return{known:false,fonts:new Set()};
 }
}
function resourcesAndFonts(bytes){
 const doc=decode(bytes),pending=[doc],fonts=new Set(),resources=new Set();let count=0;
 while(pending.length){
  const value=pending.pop();if(++count>200000)throw Error('The presentation is too complex to inspect.');
  if(!value||typeof value!=='object'||Buffer.isBuffer(value)||value instanceof Uint8Array)continue;
  for(const [name,child]of Object.entries(value)){
   if(name==='rtfData'&&typeof child==='string'){
    const rtf=Buffer.from(child,'base64').toString('latin1');
    for(const match of rtf.matchAll(/\\f\d+(?:\\[a-z]+\d*\s*)*\s+([^{};\\]+);/g))fonts.add(match[1].trim().slice(0,300));
   }else if(['absoluteString','relativePath','path'].includes(name)&&typeof child==='string'&&child.trim())resources.add(child);
   else if(child&&typeof child==='object')pending.push(child);
  }
  if(fonts.size+resources.size>2100)throw Error('The presentation has too many compatibility details.');
 }
 return{fonts:[...fonts],resources:[...resources]};
}
function resourceName(value){let name=value.split(/[?#]/,1)[0].replace(/\\/g,'/').split('/').at(-1)||'a linked resource';try{name=decodeURIComponent(name);}catch{}return name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180);}
async function inspectServiceCompatibility(directory,plan,snapshot,{checkActive=()=>{},signal,fontInventory}={}){
 const check=fence({checkActive,signal}),checks=snapshot.songs.map(song=>({kind:'song',reference:song.id,title:song.title,status:song.status==='ready'?'passed':'failed',message:song.status==='ready'?'Exact saved song bytes are available.':song.message}));
 const add=value=>{checks.push(value);if(checks.length>2100)throw Error('This service has too many compatibility details to report.');};
 await check();const root=await fs.realpath(directory);await check();const files=await walk(root);await check();
 const locations=new Map(files.map(file=>[idFor(path.relative(root,file),root),file])),inventory=fontInventory||await installedFonts({checkActive,signal});await check();
 const checked=new Set(),requiredFonts=new Set();
 for(const reference of plan.songs){
  if(checked.has(reference.songId))continue;checked.add(reference.songId);await check();
  const file=locations.get(reference.songId);if(!file||path.extname(file).toLowerCase()!=='.pro')continue;
  try{
   const info=await require('./preview-bytes.cjs').readLocalPreview(file,{expectedChecksum:reference.contentHash,signal});await check();if(info.sha256!==reference.contentHash)throw Error('The approved song bytes changed.');const data=resourcesAndFonts(info.bytes);
   for(const font of data.fonts)requiredFonts.add(font);
   for(const resource of data.resources)add({kind:'resource',title:reference.title,status:'warning',message:'This song links to '+resourceName(resource)+'. Test its resource on this computer; it is not included in the lyric check.'});
  }catch(error){await check();add({kind:'resource',title:reference.title,status:'failed',message:'The saved presentation could not be inspected safely.'});}
 }
 for(const font of requiredFonts)add({kind:'font',title:font,status:inventory.known&&inventory.fonts.has(normalized(font))?'passed':'warning',message:inventory.known?(inventory.fonts.has(normalized(font))?'Font family is installed. Verify its appearance on the output screen.':'Font family was not found. Check for a substitution in ProPresenter.'):'Font inventory is unavailable. Check this font on the output screen.'});
 add({kind:'manual',title:'Projection and audio',status:'warning',message:'Projection appearance and Playback audio depend on this computer’s connected equipment.'});await check();return checks;
}
module.exports={installedFonts,resourcesAndFonts,inspectServiceCompatibility};
