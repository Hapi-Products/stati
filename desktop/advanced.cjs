const {dialog,BrowserWindow,shell}=require('electron');const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');const {buildPresentation,validate}=require('./presentation.cjs');
const exec=promisify(execFile);const work=require('./conversion-work.cjs');
async function verifyDuplicate(match){try{const stat=await fs.lstat(match.path);if(!stat.isFile()||stat.size>50*1024*1024)throw Error('Changed song');const hash=require('node:crypto').createHash('sha256');let bytes=0;for await(const chunk of require('node:fs').createReadStream(match.path)){bytes+=chunk.length;if(bytes>50*1024*1024)throw Error('Changed song');hash.update(chunk);}if(hash.digest('hex')!==match.contentHash)throw Error('Changed song');}catch{throw Error('The matching song changed while checking it. Retry this file; existing songs and your lyrics were kept.');}}
async function writeNewFile(file,content,assertCurrent=()=>{}){
 let output,created;assertCurrent();
 try{output=await fs.open(file,'wx',0o600);created=await output.stat();assertCurrent();await output.writeFile(content);await output.sync();assertCurrent();return file;}
 catch(error){await output?.close().catch(()=>{});output=null;if(created)try{const current=await fs.lstat(file);if(!current.isSymbolicLink()&&current.dev===created.dev&&current.ino===created.ino)await fs.unlink(file);}catch{}throw error;}
 finally{await output?.close().catch(()=>{});}
}
async function uniqueWrite(directory,name,content,assertCurrent=()=>{}){const ext=path.extname(name),stem=name.slice(0,-ext.length);for(let i=0;i<10000;i++){assertCurrent();const p=path.join(directory,i?`${stem} (${i})${ext}`:name);try{return await writeNewFile(p,content,assertCurrent);}catch(e){if(e.code!=='EEXIST')throw e;}}throw new Error('Could not choose a new presentation filename.');}
function filename(raw){return raw.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,90)||'Presentation';}
async function songsFolder(parent,documents,assertCurrent=()=>{}){
 assertCurrent();const config=path.join(require('electron').app.getPath('userData'),'lyrics-folder.json');let existing;
 try{const saved=JSON.parse(await fs.readFile(config,'utf8'));if(typeof saved.path==='string'&&path.basename(saved.path)==='Lyrics'&&(await fs.stat(saved.path)).isDirectory())existing=saved.path;}catch{}
 assertCurrent();if(existing)return existing;
 const choice=await dialog.showOpenDialog(parent,{title:'Choose your ProPresenter Libraries folder — songs will go in Lyrics',defaultPath:path.join(documents,'ProPresenter','Libraries'),properties:['openDirectory']});assertCurrent();
 if(choice.canceled||!choice.filePaths[0])throw new Error('Choose a library folder to continue.');const selected=choice.filePaths[0],directory=path.basename(selected)==='Lyrics'?selected:path.join(selected,'Lyrics');
 await fs.mkdir(directory,{recursive:true});assertCurrent();await fs.writeFile(config,JSON.stringify({path:directory}),{mode:0o600});assertCurrent();return directory;
}
function outputCopyTitle(data,title){const labels={church:'Church projection','stream-lyrics':'Livestream lyrics','stream-translation':'Livestream translation'};return data.layoutCopy?title.slice(0,260).replace(/[\uD800-\uDBFF]$/,'')+' — '+labels[data.layoutCopy]:title;}
async function libraryFirst(data,parent,documents,extension,assertCurrent=()=>{},signal){
 validate(data);assertCurrent();const directory=await songsFolder(parent,documents,assertCurrent);assertCurrent();const {songTitle}=require('./library.cjs');const title=outputCopyTitle(data,songTitle(data.slides,data.songName||''));if(data.layoutCopy)return{directory,data:{...data,title},searched:0};
 const result=await(signal?work.withSignal('search',signal,directory,data.slides,data.songName||''):work('search',directory,data.slides,data.songName||''));assertCurrent();const duplicates=result.matches.filter(match=>match.equivalent&&!match.groupName&&path.extname(match.path).toLowerCase()===extension);
 if(duplicates.length){await verifyDuplicate(duplicates[0]);assertCurrent();return{existing:duplicates[0].path};}return{directory,data:{...data,title},searched:result.searched};
}
async function exportPresentation(data,parent,documents,downloads=documents,assertCurrent=()=>{},signal){
 const found=await libraryFirst(data,parent,documents,'.pro',assertCurrent,signal);if(found.existing)return{path:found.existing,existing:true};data=found.data;
 const result=await dialog.showSaveDialog(parent,{title:'Export ProPresenter presentation',defaultPath:path.join(found.directory,filename(data.title)+'.pro'),filters:[{name:'ProPresenter presentation',extensions:['pro']}]});assertCurrent();if(result.canceled||!result.filePath)throw new Error('Export canceled.');
 const bytes=await(signal?work.withSignal(data.layoutCopy?'output-layout-pro':'build',signal,data):work(data.layoutCopy?'output-layout-pro':'build',data));assertCurrent();
 try{await writeNewFile(result.filePath,bytes,assertCurrent);}catch(e){if(e.code==='EEXIST')throw new Error('A file already exists here. Choose a new filename to preserve it.');throw e;}return{path:result.filePath};
}
async function exportLyrics(data,parent,documents,downloads,assertCurrent=()=>{},signal){
 const found=await libraryFirst(data,parent,documents,'.txt',assertCurrent,signal);if(found.existing)return{path:found.existing,existing:true};
 const result=await dialog.showSaveDialog(parent,{title:'Export lyrics',defaultPath:path.join(downloads,filename(found.data.title)+'.txt'),filters:[{name:'Lyrics',extensions:['txt']}]});assertCurrent();if(result.canceled||!result.filePath)throw new Error('Export canceled.');
 try{await writeNewFile(result.filePath,data.slides.map(s=>s.text).join('\n\n'),assertCurrent);}catch(e){if(e.code==='EEXIST')throw new Error('Choose a new filename to preserve the existing file.');throw e;}return{path:result.filePath};
}
async function exportPowerPoint(input,parent,downloads,assertCurrent=()=>{},signal){
 validate(input);assertCurrent();
 const title=outputCopyTitle(input,require('./library.cjs').songTitle(input.slides,input.songName||'')),data={...input,title};
 const outputName=require('../src/shared/file-name.js').safeTransferFilename(filename(title)+'.pptx');
 const result=await dialog.showSaveDialog(parent,{title:'Export PowerPoint lyrics',defaultPath:path.join(downloads,outputName),filters:[{name:'PowerPoint lyrics',extensions:['pptx']}]});
 assertCurrent();if(result.canceled||!result.filePath)return{canceled:true};
 if(path.extname(result.filePath).toLowerCase()!=='.pptx')throw Error('Choose a .pptx filename for PowerPoint lyrics.');
 const bytes=await work.withSignal(input.layoutCopy?'output-layout-pptx':'pptx-build',signal,data);assertCurrent();
 let output,created;
 try{
  output=await fs.open(result.filePath,'wx',0o600);created=await output.stat();assertCurrent();
  await output.writeFile(bytes);await output.sync();assertCurrent();
  return{path:result.filePath};
 }catch(error){
  if(error.code==='EEXIST')throw Error('A file already exists here. Choose a new filename to preserve it.');
  await output?.close().catch(()=>{});output=null;
  if(created)try{const current=await fs.lstat(result.filePath);if(!current.isSymbolicLink()&&current.dev===created.dev&&current.ino===created.ino)await fs.unlink(result.filePath);}catch{}
  throw error;
 }finally{await output?.close().catch(()=>{});}
}
async function insertPresentation(data,parent,documents,downloads=documents,assertCurrent=()=>{},signal){
 const found=await libraryFirst(data,parent,documents,'.pro',assertCurrent,signal);if(found.existing)return{path:found.existing,existing:true};data=found.data;
 const bytes=await(signal?work.withSignal(data.layoutCopy?'output-layout-pro':'build',signal,data):work(data.layoutCopy?'output-layout-pro':'build',data));assertCurrent();
 return{path:await uniqueWrite(found.directory,filename(data.title)+'.pro',bytes,assertCurrent)};
}
async function lyrics(raw){return require('./lyrics.cjs').readPage(raw);}
async function renderPowerPoint(parent,downloads){if(process.platform!=='win32')throw new Error('PowerPoint conversion runs only on Windows with Microsoft PowerPoint installed.');const choice=await dialog.showOpenDialog(parent,{title:'Choose a PowerPoint presentation',properties:['openFile'],filters:[{name:'PowerPoint presentation',extensions:['pptx']}]});if(choice.canceled)throw new Error('PowerPoint selection canceled.');const source=choice.filePaths[0],stat=await fs.stat(source);if(stat.size>50*1024*1024)throw new Error('Choose a presentation up to 50 MB.');const directory=await fs.mkdtemp(path.join(downloads,'Stati-PowerPoint-'));try{await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'powerpoint.ps1').replace(/([\\/])app\.asar([\\/])/,'$1app.asar.unpacked$2'),'-InputPath',source,'-OutputDir',directory],{timeout:180000,windowsHide:true,maxBuffer:1024*1024});const files=(await fs.readdir(directory)).filter(f=>/^Slide-\d+\.png$/.test(f)).sort();if(!files.length)throw new Error('PowerPoint did not export any slides.');const presentation=await work('build',{title:path.basename(source,'.pptx'),slides:files.map((f,i)=>({section:'PowerPoint',text:'Slide '+(i+1)}))},files.map(f=>path.join(directory,f)));const proPath=await uniqueWrite(directory,filename(path.basename(source,'.pptx'))+'.pro',presentation);return{directory,files,proPath};}catch(e){throw new Error('PowerPoint conversion failed. Check that Microsoft PowerPoint is installed and can open this presentation. The original file was kept.');}}

module.exports={songsFolder,uniqueWrite,filename,exportLyrics,exportPowerPoint,exportPresentation,insertPresentation,lyrics,renderPowerPoint};
