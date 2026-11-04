import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {createReadStream,constants} from 'node:fs';
import {readFile,writeFile,readdir,mkdir,mkdtemp,cp,copyFile,stat,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {assertPackagedPaths,assertPackageMetadata,requiredWindowsRuntimeFiles,assertDesktopBundleImports} from './verify-preview-artifacts.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// CloudDocs can suspend cold reads of thousands of tiny dependency files.
// Build from an independent local staging folder using the unchanged lockfile.
const inputs=['desktop','public','src/shared','vendor/propresenter-7.11/LICENSE','vendor/propresenter-7.11/SOURCE.md','vendor/tesseract-data/LICENSE','vendor/tesseract-data/SOURCE.json','scripts/build-mac-preview.mjs','scripts/verify-preview-artifacts.mjs','package.json','package-lock.json'];
const requiredRuntime=['desktop/main.cjs','desktop/preload.cjs','desktop/renderer.js','desktop/index.html','desktop/mac.css','desktop/build/prepare.html','desktop/build/offline.html','desktop/offline-preload.cjs','desktop/offline-service.cjs','desktop/offline-window.cjs','desktop/service-desk-ipc.cjs','desktop/service-output.cjs','desktop/audio-preparation.cjs','src/shared/service-arrangement.js','src/shared/song-ending-style.js','src/shared/file-name.js','node_modules/jszip/lib/index.js','node_modules/protobufjs/light.js','node_modules/file-type/package.json','node_modules/pptxgenjs/package.json'];
export async function sha256(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export function sourceInput(relative,runtimeFiles){
 if(relative==='desktop/public'||relative.startsWith('desktop/public/')||/(^|\/)(\.DS_Store|node_modules|\.dev\.vars[^/]*|\.env[^/]*|\.git|\.wrangler|builds|release)(\/|$)/.test(relative))return false;
 // Generated CloudDocs conflict copies are not build inputs. Use the exact OCR
 // and PDF inventory prepared from the locked dependency tree, never a suffix
 // match that also hydrates obsolete " 2"/" 3" copies.
 if(relative.startsWith('desktop/build/')){
  if(/\s/.test(relative))return false;
  if(runtimeFiles&&/^desktop\/build\/(ocr|pdf|licenses)(?:\/|$)/.test(relative))return runtimeFiles.has(relative)||[...runtimeFiles].some(file=>file.startsWith(relative+'/'));
 }
 return true;
}
async function canonicalRuntimeFiles(directory){
 const files=new Set(['desktop/build/ocr/worker.min.js','desktop/build/ocr/worker.min.js.LICENSE.txt','desktop/build/ocr/lang/eng.traineddata.gz','desktop/build/ocr/lang/ron.traineddata.gz','desktop/build/licenses/tesseract.js-LICENSE.md','desktop/build/licenses/tesseract.js-core-LICENSE','desktop/build/licenses/tesseract.min.js.LICENSE.txt','desktop/build/licenses/pdfjs-dist-LICENSE']);
 for(const file of await readdir(path.join(directory,'node_modules/tesseract.js-core')))if(/^tesseract-core.*\.wasm(?:\.js)?$/.test(file))files.add('desktop/build/ocr/core/'+file);
 for(const folder of ['cmaps','standard_fonts','wasm','iccs'])for(const file of await readdir(path.join(directory,'node_modules/pdfjs-dist',folder)))files.add('desktop/build/pdf/'+folder+'/'+file);
 return files;
}
async function sourceManifest(directory,runtimeFiles){const result={};async function walk(relative){if(!sourceInput(relative,runtimeFiles))return;const file=path.join(directory,relative),info=await stat(file);if(info.isDirectory()){for(const entry of (await readdir(file)).sort())await walk(relative+'/'+entry);}else if(info.isFile())result[relative]=await sha256(file);}for(const input of inputs)await walk(input);return result;}
const manifestHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function run(command,args,{cwd,quiet=false,env={}}={}){const result=spawnSync(command,args,{cwd,encoding:'utf8',maxBuffer:16*1024*1024,stdio:quiet?'pipe':'inherit',env:{...process.env,...env}});if(result.error)throw result.error;return result;}
function passed(command,args,options){const result=run(command,args,options);if(result.status!==0)throw Error(command+' failed'+(result.signal?' ('+result.signal+')':' with exit '+result.status));return result;}
async function dependencies(directory,lockHash){const receipt=path.join(directory,'.stati-mac-dependencies.json');let cached=null;try{cached=JSON.parse(await readFile(receipt,'utf8'));}catch{}
 if(cached?.lockSha256===lockHash){try{await stat(path.join(directory,'node_modules/electron-builder/cli.js'));return cached;}catch{}}
 const args=['ci','--offline','--ignore-scripts','--no-audit','--no-fund'],first=run('npm',args,{cwd:directory,quiet:true});if(first.stdout)process.stdout.write(first.stdout);if(first.stderr)process.stderr.write(first.stderr);let mode='offline cache';
 if(first.status!==0){if(!/ENOTCACHED|only-if-cached/.test((first.stdout||'')+(first.stderr||'')))throw Error('The locked dependency installation failed. The staging folder was preserved.');mode='locked registry fetch';passed('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:directory});}
 if(await sha256(path.join(directory,'package-lock.json'))!==lockHash)throw Error('The package lock changed during staging.');const value={lockSha256:lockHash,method:'npm ci --ignore-scripts',mode,installedAt:new Date().toISOString()};await writeFile(receipt,JSON.stringify(value,null,2)+'\n');return value;
}
async function validateApplication(directory,application){const require=createRequire(path.join(directory,'package.json')),asar=require('@electron/asar'),archive=path.join(application,'Contents/Resources/app.asar'),entries=asar.listPackage(archive).map(name=>name.replace(/^\//,''));assertPackagedPaths(entries);const names=new Set(entries),required=new Set([...requiredRuntime,...requiredWindowsRuntimeFiles]);for(const file of required)if(!names.has(file))throw Error('Required Mac runtime missing: '+file);
 if(entries.some(file=>/^desktop\/public(?:\/|$)/.test(file)||/^desktop\/build\/.*\s/.test(file)))throw Error('Duplicate generated assets in the Mac runtime.');
 const lexer=require('es-module-lexer');await lexer.init;const modules=new Map(entries.filter(file=>/^desktop\/build\/(?:assets\/[^/]+\.(?:m?js)|preview-tools\.js)$/.test(file)).map(file=>[file,asar.extractFile(archive,file).toString('utf8')]));const browserImports=assertDesktopBundleImports(modules,entries,lexer.parse);
 const plist=path.join(application,'Contents/Info.plist'),bundleName=passed('/usr/libexec/PlistBuddy',['-c','Print :CFBundleName',plist],{quiet:true}).stdout.trim(),frameworks=path.join(application,'Contents/Frameworks'),helperNames=new Set(await readdir(frameworks));
 for(const suffix of ['',' (GPU)',' (Renderer)',' (Plugin)']){const name=bundleName+' Helper'+suffix+'.app';if(!helperNames.has(name))throw Error('Mac helper does not exactly match CFBundleName: '+name);const helper=path.join(frameworks,name,'Contents'),executable=passed('/usr/libexec/PlistBuddy',['-c','Print :CFBundleExecutable',path.join(helper,'Info.plist')],{quiet:true}).stdout.trim();if(!(await readdir(path.join(helper,'MacOS'))).includes(executable))throw Error('Mac helper executable does not match its metadata: '+name);}
 const packaged=JSON.parse(asar.extractFile(archive,'package.json').toString()),source=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));assertPackageMetadata(packaged,source);passed('/usr/bin/codesign',['--verify','--deep','--strict',application],{quiet:true});const signing=passed('/usr/bin/codesign',['-d','--verbose=4',application],{quiet:true});if(!/Signature=adhoc/.test(signing.stderr||''))throw Error('The local preview must use the documented ad-hoc signature.');
 const executable=passed('/usr/libexec/PlistBuddy',['-c','Print :CFBundleExecutable',plist],{quiet:true}).stdout.trim(),architecture=passed('/usr/bin/file',['-b',path.join(application,'Contents/MacOS',executable)],{quiet:true}).stdout.trim();if(!/arm64/.test(architecture))throw Error('The Mac executable is not Apple Silicon.');return{runtimeFiles:entries.length,requiredRuntimeFiles:required.size,browserImports,helperNamesMatched:true,asarSha256:await sha256(archive),architecture,signatureVerified:true};
}
export async function buildMacPreview({directory:provided}={}){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Build this Apple Silicon preview on an arm64 Mac.');const directory=provided?path.resolve(provided):await mkdtemp(path.join(os.tmpdir(),'stati-mac-preview-'));
 if(directory===root||directory.startsWith(root+path.sep)||directory.includes('/Mobile Documents/'))throw Error('Use a local staging directory outside the CloudDocs workspace.');await mkdir(directory,{recursive:true});console.log('Mac preview staging:',directory);
 const lockHash=await sha256(path.join(root,'package-lock.json'));for(const input of ['package.json','package-lock.json'])await copyFile(path.join(root,input),path.join(directory,input));const installed=await dependencies(directory,lockHash);
 const runtimeFiles=await canonicalRuntimeFiles(directory);
 // Reusing dependencies must not merge an older desktop build into this one.
 // Preserve the previous staging inputs outside the package instead of deleting.
 const previous=path.join(directory,'.previous-inputs-'+randomUUID());
 for(const input of inputs.filter(name=>!['package.json','package-lock.json'].includes(name))){const target=path.join(directory,input);await mkdir(path.dirname(target),{recursive:true});try{await stat(target);const backup=path.join(previous,input);await mkdir(path.dirname(backup),{recursive:true});await rename(target,backup);}catch(error){if(error.code!=='ENOENT')throw error;}await cp(path.join(root,input),target,{recursive:true,force:false,errorOnExist:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true,filter:file=>sourceInput(path.relative(root,file).split(path.sep).join('/'),runtimeFiles)});}
 const manifest=await sourceManifest(directory,runtimeFiles),sourceSha256=manifestHash(manifest);for(const file of runtimeFiles)if(!Object.hasOwn(manifest,file))throw Error('Canonical runtime input missing: '+file);await writeFile(path.join(directory,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const existingOutput=path.join(directory,'builds/mac-preview');try{await stat(existingOutput);await rename(existingOutput,path.join(directory,'.previous-output-'+randomUUID()));}catch(error){if(error.code!=='ENOENT')throw error;}
 const builder=path.join(directory,'node_modules/electron-builder/cli.js'),builderOptions={cwd:directory,env:{CSC_IDENTITY_AUTO_DISCOVERY:'false'}};
 passed(process.execPath,[builder,'--config','desktop/builder.mac.cjs','--mac','dir','--arm64','--publish','never'],builderOptions);
 const output=path.join(directory,'builds/mac-preview'),apps=(await readdir(path.join(output,'mac-arm64'))).filter(name=>name.endsWith('.app'));if(apps.length!==1)throw Error('Expected one completed Mac application.');const application=path.join(output,'mac-arm64',apps[0]);
 // Sign only after all builder framework/digest/fuse patches have completed.
 // Prepackaged targets then archive this exact verified application.
 passed('/usr/bin/codesign',['--force','--deep','--sign','-','--timestamp=none',application],{quiet:true});const runtime=await validateApplication(directory,application);console.log('Verified local application:',application);
 passed(process.execPath,[builder,'--config','desktop/builder.mac.cjs','--mac','--arm64','--prepackaged',application,'--publish','never'],builderOptions);if((await validateApplication(directory,application)).asarSha256!==runtime.asarSha256)throw Error('Distributable assembly changed the verified application.');const files=[];
 for(const name of (await readdir(output)).sort()){if(!/\.(dmg|zip)$/.test(name))continue;const file=path.join(output,name);if(name.endsWith('.dmg'))passed('/usr/bin/hdiutil',['verify',file],{quiet:true});else passed('/usr/bin/unzip',['-tq',file],{quiet:true});files.push({name,bytes:(await stat(file)).size,sha256:await sha256(file)});}
 if(!files.some(file=>file.name.endsWith('.dmg'))||!files.some(file=>file.name.endsWith('.zip')))throw Error('Both DMG and ZIP previews must finish before copying outputs.');
 if(manifestHash(await sourceManifest(directory,runtimeFiles))!==sourceSha256)throw Error('The staged source changed during packaging. The completed outputs were preserved.');
 // Refuse to label a stale staging copy as the final current source.
 if(manifestHash(await sourceManifest(root,runtimeFiles))!==sourceSha256)throw Error('Mac source changed during the build. The completed staging outputs were preserved; rebuild the current source.');
 const parent=path.join(root,'builds/mac-preview');await mkdir(parent,{recursive:true});const destination=path.join(parent,new Date().toISOString().replace(/[-:.]/g,'').replace('Z','')+'-'+randomUUID().slice(0,8));await mkdir(destination);console.log('Saving local previews:',destination);
 await cp(application,path.join(destination,apps[0]),{recursive:true,force:false,errorOnExist:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true});
 for(const file of files){await copyFile(path.join(output,file.name),path.join(destination,file.name),constants.COPYFILE_EXCL);if(await sha256(path.join(destination,file.name))!==file.sha256)throw Error('A copied preview archive could not be verified.');}
 const copiedApplication=path.join(destination,apps[0]);for(const attribute of ['com.apple.FinderInfo','com.apple.ResourceFork'])passed('/usr/bin/xattr',['-dr',attribute,copiedApplication],{quiet:true});const copied=await validateApplication(directory,copiedApplication);if(copied.asarSha256!==runtime.asarSha256)throw Error('The copied application differs from its verified staging output.');
 const verification={platform:'darwin',architecture:'arm64',signing:'ad-hoc',notarized:false,published:false,createdAt:new Date().toISOString(),sourceSha256,lockSha256:lockHash,dependencyInstallation:installed,runtime,application:apps[0],files,stagingDirectory:directory,limitations:['No Developer ID signature or Apple notarization.','Physical church hardware and ProPresenter validation remain separate.']};await writeFile(path.join(destination,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');await writeFile(path.join(destination,'verification.json'),JSON.stringify(verification,null,2)+'\n');console.log(JSON.stringify({destination,...verification},null,2));return{directory:destination,verification};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const argument=process.argv.slice(2);if(argument.some(value=>!value.startsWith('--staging=')))throw Error('Use --staging=/absolute/local/directory to reuse a prepared staging folder.');await buildMacPreview({directory:argument.find(value=>value.startsWith('--staging='))?.slice('--staging='.length)});}
