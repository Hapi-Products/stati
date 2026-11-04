import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,open,readFile,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

const directories=['desktop','src','public','scripts','tests','vendor','migrations'];
const topFiles=['AGENTS.md','package.json','package-lock.json','index.html','tsconfig.json','vite.config.ts','vite.desktop.config.ts','vitest.config.ts','wrangler.jsonc','worker-configuration.d.ts'];
const generated=/^desktop\/(?:build|public)(?:\/|$)/;
const privateName=/(^|\/)(?:\.[^/]+|node_modules|release|dist)(\/|$)|\.(?:jks|keystore|p12|statibackup)$/i;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function relativeName(name){
 if(typeof name!=='string'||!name||name.includes('\\')||/[\r\n\0]/.test(name)||path.posix.isAbsolute(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid release source path.');
 return name;
}
export function sourceDigest(files){
 const hash=createHash('sha256');
 for(const [name,bytes] of [...files].sort(([a],[b])=>a<b?-1:a>b?1:0))hash.update(relativeName(name)+'\0'+sha(bytes)+'\n');
 return hash.digest('hex');
}
const statKeys=['dev','ino','size','mtimeNs','ctimeNs'];
const statSignature=info=>Object.fromEntries(statKeys.map(key=>[key,info[key].toString()]));
const sameSignature=(a,b)=>!!a&&!!b&&statKeys.every(key=>a[key]===b[key]);
async function regularFile(filename,label){
 const info=await lstat(filename,{bigint:true});
 if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe '+label+'.');
 return info;
}
async function existingDirectory(directory,label){
 try{const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe '+label+'.');return true;}
 catch(error){if(error.code==='ENOENT')return false;throw error;}
}
async function inputCache(root,cacheRoot){
 if(!cacheRoot)return null;
 const destination=path.resolve(cacheRoot);
 if(!await existingDirectory(destination,'input cache workspace'))return null;
 if(await realpath(destination)!==destination)throw Error('Input cache workspace must not redirect through a symlink.');
 const marker=path.join(destination,'.stati-workspace.json');let owner;
 try{await regularFile(marker,'workspace ownership marker');owner=JSON.parse(await readFile(marker,'utf8'));}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(owner.schema!==1||owner.source!==root)throw Error('Input cache belongs to a different source.');
 const state=path.join(destination,'.stati-build'),directory=path.join(state,'input-cache');
 if(!await existingDirectory(state,'workspace state directory'))return{destination,state,directory,files:new Map()};
 if(!await existingDirectory(directory,'input cache directory'))return{destination,state,directory,files:new Map()};
 const metadata=path.join(state,'inputs.json');let document;
 try{await regularFile(metadata,'input cache metadata');const bytes=await readFile(metadata,'utf8');try{document=JSON.parse(bytes);}catch{return{destination,state,directory,files:new Map()};}}
 catch(error){if(error.code==='ENOENT')return{destination,state,directory,files:new Map()};throw error;}
 const files=new Map();
 if(document.schema===1&&document.source===root&&Array.isArray(document.files))for(const entry of document.files){
  if(typeof entry.path==='string'&&/^[a-f0-9]{64}$/.test(entry.sha256||'')&&entry.stat&&statKeys.every(key=>typeof entry.stat[key]==='string'&&/^-?\d+$/.test(entry.stat[key])))files.set(entry.path,entry);
 }
 return{destination,state,directory,files};
}
async function cachedSource(cache,name,signature){
 const entry=cache?.files.get(name);
 if(!entry||!sameSignature(entry.stat,signature))return null;
 const filename=path.join(cache.directory,entry.sha256);let info;
 try{info=await regularFile(filename,'input cache file');}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(info.size.toString()!==signature.size)return null;
 const bytes=await readFile(filename);
 return sha(bytes)===entry.sha256?bytes:null;
}
export async function snapshotSources(root,{preview,notesFile,cacheRoot,rehashSource=false,readSource=filename=>readFile(filename)}={}){
 root=await realpath(root);const candidates=[],rawFiles=new Map(),rawInputs=[];
 const cache=await inputCache(root,cacheRoot),cacheStats={hits:0,sourceReads:0};
 async function add(name){
  relativeName(name);if(generated.test(name)||privateName.test(name))return;
  const source=path.join(root,name),info=await lstat(source,{bigint:true});
  if(info.isSymbolicLink())throw Error('Release source must not be a symlink: '+name);
  if(info.isDirectory()){for(const entry of (await readdir(source)).sort())await add(name+'/'+entry);}
  else if(info.isFile())candidates.push({name,source,signature:statSignature(info)});
  else throw Error('Unsupported release source: '+name);
 }
 for(const name of [...topFiles,...directories])await add(name);
 if(notesFile){
  const name=relativeName(notesFile);
  if(!/^docs\/releases\/[^/]+\.md$/.test(name))throw Error('Release notes must be a Markdown file in docs/releases.');
  // Check each parent too: a notes directory must not redirect outside the source.
  for(const part of ['docs','docs/releases'])if((await lstat(path.join(root,part))).isSymbolicLink())throw Error('Release notes directory must not be a symlink.');
  await add(name);
 }
 // Files are independent. Limit hydration to eight reads so a slow iCloud input
 // does not block all other inputs or exhaust filesystem resources.
 let cursor=0;
 const results=await Promise.allSettled(Array.from({length:Math.min(8,candidates.length)},async()=>{
  for(;;){const index=cursor++;if(index>=candidates.length)return;const candidate=candidates[index];let {name,source,signature}=candidate;
   let bytes=rehashSource?null:await cachedSource(cache,name,signature);
   if(bytes&&!sameSignature(signature,statSignature(await regularFile(source,'release source: '+name))))bytes=null;
   if(bytes)cacheStats.hits++;
   else{
    let stable=false;
    for(let attempt=0;attempt<3;attempt++){
     signature=statSignature(await regularFile(source,'release source: '+name));
     cacheStats.sourceReads++;bytes=Buffer.from(await readSource(source));
     const after=statSignature(await regularFile(source,'release source: '+name));
     if(sameSignature(signature,after)&&BigInt(bytes.length)===BigInt(after.size)){stable=true;break;}
    }
    if(!stable)throw Error('Release source changed while reading: '+name);
   }
   rawFiles.set(name,bytes);rawInputs.push({path:name,sha256:sha(bytes),stat:signature});
  }
 }));
 const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
 // Cache the original bytes, never the staged preview-number override.
 const files=new Map([...rawFiles].sort(([a],[b])=>a<b?-1:a>b?1:0));
 if(preview!==undefined){
  if(!Number.isSafeInteger(preview)||preview<1||preview>9999)throw Error('Use a preview number from 1 to 9999.');
  const name='desktop/preview-build.json',prior=JSON.parse(files.get(name).toString());
  files.set(name,Buffer.from(JSON.stringify({...prior,number:preview},null,2)+'\n'));
 }
 return{root,files,digest:sourceDigest(files),rawFiles,rawInputs,cache:cacheStats};
}
export function defaultWorkspace(source){
 const base=process.platform==='darwin'?path.join(homedir(),'Library','Caches'):process.platform==='win32'?(process.env.LOCALAPPDATA||path.join(homedir(),'AppData','Local')):path.join(homedir(),'.cache');
 return path.join(base,'Hapi Products','stati-build',sha(path.resolve(source)).slice(0,16));
}
export async function ownWorkspace(source,destination){
 source=await realpath(source);destination=path.resolve(destination);
 if(destination===source||destination.startsWith(source+path.sep)||source.startsWith(destination+path.sep))throw Error('Build workspace must be separate from the source folder.');
 await mkdir(destination,{recursive:true,mode:0o700});
 if((await lstat(destination)).isSymbolicLink()||await realpath(destination)!==destination)throw Error('Build workspace must not redirect through a symlink.');
 const marker=path.join(destination,'.stati-workspace.json');
 let owner;try{const info=await lstat(marker);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe workspace ownership marker.');owner=JSON.parse(await readFile(marker,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(owner){if(owner.schema!==1||owner.source!==source)throw Error('Build workspace belongs to a different source.');}
 else{
  if((await readdir(destination)).length)throw Error('Refusing to use a nonempty, unowned build workspace.');
  await writeFile(marker,JSON.stringify({schema:1,source})+'\n',{mode:0o600,flag:'wx'});
 }
 return destination;
}
export async function lockWorkspace(destination){
 const filename=path.join(destination,'.stati-build.lock'),token=randomUUID();
 let handle;try{handle=await open(filename,'wx',0o600);}catch(error){
  if(error.code!=='EEXIST')throw error;
  let previous;try{previous=JSON.parse(await readFile(filename,'utf8'));}catch{throw Error('Build lock needs inspection: '+filename);}
  if(!Number.isSafeInteger(previous.pid)||previous.pid<1)throw Error('Invalid build lock: '+filename);
  try{process.kill(previous.pid,0);throw Error('Another release build is running (PID '+previous.pid+').');}catch(probe){if(probe.code!=='ESRCH')throw probe;}
  // Reclaim only a dead process's unchanged lock.
  if(await readFile(filename,'utf8')!==JSON.stringify(previous)+'\n')throw Error('Build lock changed; retry.');
  await rm(filename);handle=await open(filename,'wx',0o600);
 }
 await handle.writeFile(JSON.stringify({pid:process.pid,token})+'\n');
 return async()=>{await handle.close();const current=JSON.parse(await readFile(filename,'utf8'));if(current.token===token)await rm(filename);};
}
async function safeParent(root,name){
 let current=root;
 for(const part of path.posix.dirname(relativeName(name)).split('/').filter(p=>p!=='.')){
  current=path.join(current,part);try{const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe workspace directory.');}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(current,{mode:0o700});}
 }
}
async function atomicRecord(filename,bytes,label){
 try{await regularFile(filename,label);}catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=filename+'.'+randomUUID()+'.tmp';
 try{await writeFile(temporary,bytes,{mode:0o600,flag:'wx'});await rename(temporary,filename);}
 finally{await rm(temporary,{force:true});}
}
async function commitInputCache(destination,snapshot){
 if(!snapshot.rawFiles||!snapshot.rawInputs||!snapshot.root)return;
 // Only an owned workspace may hold reusable raw input bytes.
 const cache=await inputCache(snapshot.root,destination);
 if(!cache)throw Error('Input cache requires an owned workspace.');
 if(!await existingDirectory(cache.directory,'input cache directory'))await mkdir(cache.directory,{mode:0o700});
 const inputs=[];
 for(const entry of snapshot.rawInputs){
  const name=relativeName(entry.path),bytes=snapshot.rawFiles.get(name);
  if(!bytes||privateName.test(name)||generated.test(name)||sha(bytes)!==entry.sha256||BigInt(bytes.length)!==BigInt(entry.stat.size))throw Error('Raw input cache source differs: '+name);
  const filename=path.join(cache.directory,entry.sha256);let same=false;
  try{await regularFile(filename,'input cache file');same=sha(await readFile(filename))===entry.sha256;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!same)await atomicRecord(filename,bytes,'input cache file');
  inputs.push(entry);
 }
 inputs.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 await atomicRecord(path.join(cache.state,'inputs.json'),JSON.stringify({schema:1,source:snapshot.root,files:inputs},null,2)+'\n','input cache metadata');
}
export async function syncSources(destination,snapshot){
 const state=path.join(destination,'.stati-build');
 try{const info=await lstat(state);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe workspace state directory.');}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(state,{mode:0o700});}
 const next=new Set(snapshot.files.keys());let copied=0,unchanged=0,removed=0;
 async function reconcile(name){
  relativeName(name);if(generated.test(name))return;
  let info;try{info=await lstat(path.join(destination,name));}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(info.isSymbolicLink())throw Error('Unsafe workspace source: '+name);
  if(info.isDirectory()){for(const entry of await readdir(path.join(destination,name)))await reconcile(name+'/'+entry);}
  else if(!next.has(name)){await rm(path.join(destination,name));removed++;}
 }
 // Reconcile the actual source trees, including files copied before an interrupted
 // prior sync wrote its manifest. Never traverse dependencies or build outputs.
 for(const name of [...directories,...topFiles,'docs/releases']){await safeParent(destination,name);await reconcile(name);}
 const manifest=[];
 for(const [name,bytes] of snapshot.files){
  await safeParent(destination,name);const target=path.join(destination,name),digest=sha(bytes);let same=false;
  try{const info=await lstat(target);if(info.isSymbolicLink()||!info.isFile())throw Error('Unsafe workspace source.');same=sha(await readFile(target))===digest;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(same)unchanged++;
  else{const temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,bytes,{mode:0o600,flag:'wx'});await rename(temp,target);copied++;}
  manifest.push({path:name,bytes:bytes.length,sha256:digest});
 }
 const manifestPath=path.join(state,'sources.json');try{if((await lstat(manifestPath)).isSymbolicLink())throw Error('Unsafe source manifest.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await writeFile(manifestPath,JSON.stringify({digest:snapshot.digest,files:manifest},null,2)+'\n',{mode:0o600});
 await commitInputCache(destination,snapshot);
 return{copied,unchanged,removed,files:manifest.length,digest:snapshot.digest};
}
export function dependencyKey(files,runtime={node:process.versions.node.split('.')[0],platform:process.platform,arch:process.arch}){
 const pkg=JSON.parse(files.get('package.json').toString());
 return sha(files.get('package-lock.json')+'\n'+JSON.stringify({dependencies:pkg.dependencies,devDependencies:pkg.devDependencies,overrides:pkg.overrides,runtime}));
}
export async function ensureDependencies(destination,key,install){
 if(!/^[a-f0-9]{64}$/.test(key)||typeof install!=='function')throw Error('Invalid dependency cache request.');
 const stamp=path.join(destination,'.stati-build/dependencies.json');let previous;
 try{const info=await lstat(stamp);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe dependency stamp.');previous=JSON.parse(await readFile(stamp,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 let present=false;
 try{const info=await lstat(path.join(destination,'node_modules'));if(info.isSymbolicLink())throw Error('Dependency cache must not be a symlink.');present=info.isDirectory();}catch(error){if(error.code!=='ENOENT')throw error;}
 if(previous?.key===key&&present)return true;
 // A failed npm ci may leave partial node_modules. No old stamp may bless it.
 await rm(stamp,{force:true});await install();
 await writeFile(stamp,JSON.stringify({key})+'\n',{mode:0o600});return false;
}
