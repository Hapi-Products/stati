import {spawn} from 'node:child_process';
import {chmod,mkdir,lstat,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {defaultWorkspace,dependencyKey,ensureDependencies,lockWorkspace,ownWorkspace,snapshotSources,syncSources} from './release-workspace.mjs';
import {verifyPreviewArtifacts} from './verify-preview-artifacts.mjs';
import {hashArtifact} from './publish-utils.mjs';

const argv=process.argv.slice(2),known=/^(?:--preview=\d+|--workspace=.+|--notes-file=.+|--publish|--checks-only|--rehash-source)$/;
if(argv.includes('--help')){
 console.log('Prepare a checked Windows preview outside iCloud:\n  npm run release:prepare -- --preview=23 --notes-file=docs/releases/preview23.md\nPublish after all checks:\n  npm run release:fast -- --preview=23 --notes-file=docs/releases/preview23.md\nOptional: --workspace=/absolute/local/cache, --checks-only (never publishes), --rehash-source (read every source file again).');process.exit(0);
}
if(argv.some(arg=>!known.test(arg)))throw Error('Unknown release option. Use --help.');
const option=name=>{const found=argv.filter(arg=>arg.startsWith(name+'='));if(found.length>1)throw Error('Duplicate option: '+name);return found[0]?.slice(name.length+1);};
const preview=Number(option('--preview')),notesFile=option('--notes-file'),publish=argv.includes('--publish'),checksOnly=argv.includes('--checks-only');
if(!Number.isSafeInteger(preview)||preview<1||preview>9999)throw Error('Choose --preview=1 through --preview=9999. Published numbers cannot be reused.');
if(publish&&(!notesFile||checksOnly))throw Error('Publishing requires release notes and a complete package build.');
const source=await realpath(process.cwd()),started=performance.now();
const workspace=await ownWorkspace(source,option('--workspace')||defaultWorkspace(source));
const unlock=await lockWorkspace(workspace),state=path.join(workspace,'.stati-build'),timings=[];
let snapshot;
const runId=new Date().toISOString().replaceAll(':','-'),runDirectory=path.join(state,'runs',runId),logs=path.join(runDirectory,'logs');
async function privateDirectory(directory){
 try{const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe build record directory.');}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(directory,{mode:0o700});}
}
const redact=value=>[process.env.CSC_KEY_PASSWORD,process.env.WIN_CSC_KEY_PASSWORD,process.env.AZURE_CLIENT_SECRET,process.env.GH_TOKEN,process.env.GITHUB_TOKEN].filter(Boolean).reduce((text,secret)=>text.replaceAll(secret,'[REDACTED]'),value);
async function run(name,command,args){
 const begin=performance.now();console.log(name+'…');
 let output='';
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:workspace,env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'},stdio:['ignore','pipe','pipe']});
  let exceeded=false;
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{if(!exceeded){output+=chunk;if(output.length>32*1024*1024){exceeded=true;child.kill();}}});
  child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,exceeded}));
 });
 const seconds=Number(((performance.now()-begin)/1000).toFixed(2)),log=path.join(logs,name+'.log');
 await writeFile(log,redact(output),{mode:0o600});timings.push({name,seconds,exit:result.code,log});
 if(result.code!==0||result.exceeded)throw Error(name+' failed; see '+log+'\n'+redact(output.slice(-1600)));
 console.log(name+': '+seconds+'s');
}
const node=(name,...args)=>run(name,process.execPath,args);
async function assertFrozen(verification){
 if((await snapshotSources(workspace,{notesFile})).digest!==snapshot.digest)throw Error('Frozen source changed. Inspect the build before continuing.');
 for(const artifact of verification?.artifacts||[]){
  const actual=await hashArtifact(path.join(workspace,'release',artifact.filename));
  if(actual.bytes!==artifact.bytes||actual.sha256!==artifact.sha256)throw Error('Verified release artifact changed: '+artifact.filename);
 }
}
try{
 for(const directory of [state,path.join(state,'runs'),runDirectory,logs])await privateDirectory(directory);
 const snapshotBegin=performance.now();
 snapshot=await snapshotSources(source,{preview,notesFile,cacheRoot:workspace,rehashSource:argv.includes('--rehash-source')});
 timings.push({name:'source-snapshot',seconds:Number(((performance.now()-snapshotBegin)/1000).toFixed(2))});
 console.log('Source capture: '+snapshot.cache.hits+' verified cache hits, '+snapshot.cache.sourceReads+' source reads.');
 const syncBegin=performance.now(),copied=await syncSources(workspace,snapshot);
 timings.push({name:'source-sync',seconds:Number(((performance.now()-syncBegin)/1000).toFixed(2))});
 console.log('Local workspace: '+workspace+'\nSource files: '+copied.copied+' copied, '+copied.unchanged+' unchanged, '+copied.removed+' removed.');
 const key=dependencyKey(snapshot.files);
 const dependenciesReused=await ensureDependencies(workspace,key,async()=>{
  // npm ci, never npm install: preserve the existing lock and normal npm/Electron caches.
  const npm=process.env.npm_execpath;
  if(!npm)throw Error('Run this workflow through npm run release:prepare or release:fast.');
  await node('dependencies',npm,'ci','--prefer-offline','--no-audit','--no-fund');
 });
 if(dependenciesReused)console.log('Dependencies: reusing the exact-lock local installation.');
 // Generated files cannot carry over from an earlier preview.
 for(const name of ['desktop/build','desktop/public','dist',...(!checksOnly?['release']:[])])await rm(path.join(workspace,name),{recursive:true,force:true});
 await node('desktop-assets','scripts/prepare-desktop-assets.mjs');
 // Miniflare reads the asset manifest at startup. Finish writing dist before
 // the Worker pool starts so a concurrent Vite cleanup cannot remove files.
 await node('website-ui','node_modules/vite/bin/vite.js','build');
 const cjs=(await readdir(path.join(workspace,'tests'))).filter(name=>name.endsWith('.test.cjs')).sort().map(name=>'tests/'+name);
 const checks=await Promise.allSettled([
  node('desktop-tests','--test',...cjs),
  node('worker-tests','node_modules/vitest/vitest.mjs','run','--reporter=dot'),
  node('typecheck','node_modules/typescript/bin/tsc','--noEmit'),
  node('desktop-ui','node_modules/vite/bin/vite.js','build','--config','vite.desktop.config.ts')
 ]);
 const failed=checks.filter(result=>result.status==='rejected');if(failed.length)throw new AggregateError(failed.map(result=>result.reason),'Release checks failed; nothing was published.');
 if((await snapshotSources(workspace,{notesFile})).digest!==snapshot.digest)throw Error('Frozen source changed during checks.');
 let verification;
 if(!checksOnly){
  await node('windows-package','node_modules/electron-builder/cli.js','--config','desktop/builder.json','--win','nsis','--x64','--publish','never');
  const begin=performance.now();verification=await verifyPreviewArtifacts({root:workspace,preview,secretSourceRoot:snapshot.root});
  timings.push({name:'artifact-verification',seconds:Number(((performance.now()-begin)/1000).toFixed(2))});
 }
 const archiveList=path.join(runDirectory,'archive-files.txt');
 await writeFile(archiveList,[...snapshot.files.keys()].sort().join('\n')+'\n',{mode:0o600});
 const sourceBackup=path.join(runDirectory,'source.tar.gz');
 await run('source-backup','tar',['-czf',sourceBackup,'-T',archiveList]);await chmod(sourceBackup,0o600);
 const backupHash=await hashArtifact(sourceBackup);
 const report={schema:1,preview,source:snapshot.root,workspace,sourceDigest:snapshot.digest,sourceFiles:snapshot.files.size,sourceCache:snapshot.cache,sourceBackup:{path:sourceBackup,bytes:backupHash.bytes,sha256:backupHash.sha256},dependencyKey:key,dependenciesReused,preparedAt:new Date().toISOString(),checksOnly,verification,timings,totalSeconds:Number(((performance.now()-started)/1000).toFixed(2)),published:false};
 const reportFile=path.join(runDirectory,'prepared.json');await writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 await writeFile(path.join(state,'latest-run.json'),JSON.stringify({report:reportFile})+'\n',{mode:0o600});
 console.log('Preparation complete: '+report.totalSeconds+'s. Report: '+reportFile);
 if(publish){
  await assertFrozen(verification);
  await node('github-publish','scripts/publish-preview.mjs','--preview='+preview,'--notes-file='+notesFile,'--platform=windows');
  report.publication={github:true,website:false};await writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  await assertFrozen(verification);
  await node('website-downloads','scripts/publish-test-builds.mjs','--platform=windows');
  await assertFrozen(verification);report.publication.website=true;
  report.published=true;report.publishedAt=new Date().toISOString();report.totalSeconds=Number(((performance.now()-started)/1000).toFixed(2));
  await writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log('Preview '+preview+' published. Total: '+report.totalSeconds+'s.');
 }
}finally{await unlock();}
