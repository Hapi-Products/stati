import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';

export function assertPackagedPaths(entries){
 if(entries.some(name=>/(^|\/)(\.dev\.vars[^/]*|\.env[^/]*|\.git|\.wrangler|\.stati-build)(\/|$)|\.(jks|keystore|p12|statibackup)$/i.test(name)||/^tests(?:\/|$)/.test(name)))throw Error('Private/workspace-test path in app package.');
}
export function assertPackageMetadata(packaged,source){
 // electron-builder deliberately removes these development-only fields.
 const expected={...source};delete expected.scripts;delete expected.devDependencies;
 if(!isDeepStrictEqual(packaged,expected))throw Error('Packaged application metadata differs from source.');
}
const ocrVariants=['','-lstm','-simd','-simd-lstm','-relaxedsimd','-relaxedsimd-lstm'];
export const requiredWindowsRuntimeFiles=Object.freeze([
 'desktop/index.html','desktop/renderer.js','desktop/preload.cjs','desktop/station.css','desktop/build/station-workspace.js','desktop/build/style.css',
 'desktop/build/offline.html','desktop/offline-preload.cjs','desktop/offline-service.cjs','desktop/offline-window.cjs','desktop/service-desk-ipc.cjs','desktop/approved-service-store.cjs','desktop/service-output.cjs','desktop/service-compatibility.cjs','desktop/audio-preparation.cjs',
 'src/shared/output-layout.js','desktop/output-layouts.cjs','desktop/output-layout-drafts.cjs','desktop/presentation-text-sync.cjs','desktop/presentation-monitor.cjs','desktop/disk-reserve.cjs','desktop/song-variants.cjs',
 'src/shared/service-arrangement.js','src/shared/song-ending-style.js','src/shared/file-name.js',
 ...ocrVariants.flatMap(variant=>['.wasm','.wasm.js'].map(extension=>'desktop/build/ocr/core/tesseract-core'+variant+extension)),
 'desktop/build/ocr/worker.min.js','desktop/build/ocr/worker.min.js.LICENSE.txt',
 'desktop/build/ocr/lang/eng.traineddata.gz','desktop/build/ocr/lang/ron.traineddata.gz',
 'desktop/build/licenses/tesseract.js-LICENSE.md','desktop/build/licenses/tesseract.js-core-LICENSE','desktop/build/licenses/tesseract.min.js.LICENSE.txt','desktop/build/licenses/pdfjs-dist-LICENSE',
 'desktop/build/pdf/cmaps/LICENSE','desktop/build/pdf/cmaps/Adobe-Japan1-UCS2.bcmap',
 'desktop/build/pdf/standard_fonts/LICENSE_FOXIT','desktop/build/pdf/standard_fonts/LICENSE_LIBERATION','desktop/build/pdf/standard_fonts/FoxitSerif.pfb','desktop/build/pdf/standard_fonts/LiberationSans-Regular.ttf',
 'desktop/build/pdf/wasm/LICENSE_JBIG2','desktop/build/pdf/wasm/LICENSE_OPENJPEG','desktop/build/pdf/wasm/LICENSE_PDFJS_JBIG2','desktop/build/pdf/wasm/LICENSE_PDFJS_OPENJPEG','desktop/build/pdf/wasm/LICENSE_PDFJS_QCMS','desktop/build/pdf/wasm/LICENSE_QCMS',
 'desktop/build/pdf/wasm/jbig2.wasm','desktop/build/pdf/wasm/jbig2_nowasm_fallback.js','desktop/build/pdf/wasm/openjpeg.wasm','desktop/build/pdf/wasm/openjpeg_nowasm_fallback.js','desktop/build/pdf/wasm/qcms_bg.wasm','desktop/build/pdf/wasm/quickjs-eval.js','desktop/build/pdf/wasm/quickjs-eval.wasm',
 'node_modules/jszip/package.json','node_modules/jszip/lib/index.js',
 'node_modules/linkedom/package.json','node_modules/linkedom/cjs/index.js','node_modules/linkedom/esm/index.js',
 'node_modules/image-size/package.json','node_modules/image-size/dist/cjs/index.js',
 'node_modules/@mozilla/readability/package.json','node_modules/@mozilla/readability/index.js','node_modules/@mozilla/readability/Readability.js',
 'node_modules/qrcode/package.json','node_modules/qrcode/lib/index.js',
 'node_modules/protobufjs/package.json','node_modules/protobufjs/light.js','node_modules/protobufjs/src/index-light.js',
 'node_modules/js-yaml/package.json','node_modules/js-yaml/index.js',
 'node_modules/electron-updater/package.json','node_modules/electron-updater/out/main.js'
]);
const pdfChunk=/^desktop\/build\/assets\/pdf-[\w-]+\.js$/;
const pdfWorker=/^desktop\/build\/assets\/pdf\.worker\.min-[\w-]+\.mjs$/;
/** This is a Windows package policy. Source/build inputs stay installed locally;
 * their browser copies and notices, plus every native external, must survive. */
export function assertWindowsRuntimeLayout(entries){
 const excluded=entries.find(name=>/^desktop\/public(?:\/|$)/.test(name)||/(?:^|\/)node_modules\/(?:@napi-rs\/canvas-darwin-[^/]+|tesseract\.js(?:-core)?|pdfjs-dist)(?:\/|$)/.test(name));
 if(excluded)throw Error('Excluded Windows package payload present: '+excluded);
 const names=new Set(entries);
 for(const name of requiredWindowsRuntimeFiles)if(!names.has(name))throw Error('Required Windows runtime missing: '+name);
 if(!entries.some(name=>pdfChunk.test(name)))throw Error('Bundled PDF module missing.');
 if(!entries.some(name=>pdfWorker.test(name)))throw Error('Bundled PDF worker missing.');
 return{requiredFiles:requiredWindowsRuntimeFiles.length,duplicatePublicAbsent:true,rawBrowserPackagesAbsent:true,macNativeBinaryAbsent:true};
}

/** Inspect actual built ES modules. Literal imports must stay inside packaged
 * desktop/build. PDF.js has two reviewed computed imports: its explicitly set
 * worker URL and its local no-WASM fallback URL. Runtime exercises those paths
 * separately; this static gate does not claim OCR/PDF acceptance by itself. */
export function assertDesktopBundleImports(modules,entries,parse){
 const names=new Set(entries),computed=[];
 for(const [name,source] of modules){
  for(const item of parse(source)[0]){
   if(item.d===-2)continue; // import.meta does not load another module.
   if(typeof item.n==='string'){
    if(!item.n.startsWith('./')&&!item.n.startsWith('../'))throw Error('External browser module import in '+name+': '+item.n);
    const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),item.n));
    if(!target.startsWith('desktop/build/')||!names.has(target))throw Error('Bundled browser import missing or outside build: '+name+' -> '+item.n);
   }else{
    const expression=source.slice(item.s,item.e);
    const expected=pdfChunk.test(name)&&expression==='this.workerSrc'||pdfWorker.test(name)&&expression==='`${WasmImage.#R}${this._noWasmFilename}`';
    if(!expected)throw Error('Unreviewed computed browser import in '+name+': '+expression.slice(0,160));
    computed.push({file:name,expression});
   }
  }
 }
 return{modules:modules.size,literalExternalImports:0,reviewedComputedImports:computed};
}
async function packageAuxiliaryFiles(root,archive,asar,entries){
 const names=new Set(entries),checked=[];
 for(const directory of ['cmaps','standard_fonts','wasm']){
  const source=path.join(root,'node_modules/pdfjs-dist',directory);
  for(const file of await readdir(source,{withFileTypes:true})){
   if(!file.isFile())throw Error('Unexpected PDF auxiliary input: '+directory+'/'+file.name);
   const packaged='desktop/build/pdf/'+directory+'/'+file.name;
   if(!names.has(packaged))throw Error('PDF auxiliary file missing: '+packaged);
   if(!(await readFile(path.join(source,file.name))).equals(asar.extractFile(archive,packaged)))throw Error('Packaged PDF auxiliary input differs: '+packaged);
   checked.push(packaged);
  }
 }
 for(const name of requiredWindowsRuntimeFiles.filter(name=>name.startsWith('node_modules/')&&!name.endsWith('/package.json'))){
  if(!(await readFile(path.join(root,name))).equals(asar.extractFile(archive,name)))throw Error('Native runtime external differs: '+name);
  checked.push(name);
 }
 return checked;
}

export async function verifyPreviewArtifacts({root,preview,secretSourceRoot=root}){
 const require=createRequire(path.join(root,'package.json')),asar=require('@electron/asar');
 const archive=path.join(root,'release/win-unpacked/resources/app.asar');
 const entries=asar.listPackage(archive).map(name=>name.replace(/^\//,''));
 assertPackagedPaths(entries);
 const windowsRuntime=assertWindowsRuntimeLayout(entries);
 const moduleEntries=entries.filter(name=>/^desktop\/build\/(?:assets\/[^/]+\.(?:m?js)|(?:preview-tools|station-workspace)\.js)$/.test(name));
 const lexer=require('es-module-lexer');await lexer.init;
 const browserImports=assertDesktopBundleImports(new Map(moduleEntries.map(name=>[name,asar.extractFile(archive,name).toString('utf8')])),entries,lexer.parse);
 const auxiliaryFiles=await packageAuxiliaryFiles(root,archive,asar,entries);
 const checked=[];
 for(const name of entries){
  if((name!=='package.json'&&!/^(desktop\/|src\/shared\/|public\/)/.test(name))||asar.statFile(archive,name).files)continue;
  const bytes=asar.extractFile(archive,name),source=await readFile(path.join(root,name));
  if(name==='package.json')assertPackageMetadata(JSON.parse(bytes),JSON.parse(source));
  else if(!source.equals(bytes))throw Error('Packaged source differs: '+name);
  checked.push(name);
 }
 for(const name of ['desktop/index.html','desktop/renderer.js','desktop/station.css','desktop/build/station-workspace.js','desktop/build/style.css','src/shared/output-layout.js','desktop/output-layouts.cjs','desktop/output-layout-drafts.cjs','desktop/presentation-text-sync.cjs','desktop/presentation-monitor.cjs','desktop/disk-reserve.cjs','desktop/song-variants.cjs','src/shared/profile-photo.js','desktop/profile-photos.cjs','desktop/operator-selection.cjs','desktop/station-files.cjs','desktop/song-save.cjs','desktop/catalog-publisher.cjs','desktop/shared-services.cjs','desktop/desktop-shortcut.cjs','desktop/windows-installer.nsh','desktop/nsis/uninstaller.nsh','desktop/nsis/multiUser.nsh','desktop/service-playlist-sync.cjs','desktop/service-playlist-jobs.cjs','desktop/propresenter-playlists.cjs','desktop/playlist-library.cjs','desktop/playlist-settings-renderer.js','desktop/rtf-text.cjs','desktop/pptx-lyrics.cjs','desktop/identity-backdrop.cjs','src/shared/lyric-layout.js','src/shared/arial-bold-widths.json','desktop/transfer-retry.cjs','desktop/delivery-recovery.cjs','desktop/main.cjs','desktop/preload.cjs','desktop/window-lifecycle.cjs','src/shared/service-schedule.json','desktop/preview-bytes.cjs','desktop/preview-queue.cjs','desktop/preview-formats.cjs','desktop/document-preview.cjs','desktop/conversion-work.cjs','desktop/conversion-worker.cjs','src/shared/preview-scheduler.js','desktop/build/preview-tools.js','desktop/build/ocr/lang/eng.traineddata.gz','desktop/build/ocr/lang/ron.traineddata.gz','desktop/build/ocr/worker.min.js','desktop/build/ocr/core/tesseract-core.wasm','desktop/build/ocr/core/tesseract-core-simd-lstm.wasm'])if(!checked.includes(name))throw Error('Required packaged source missing: '+name);
 if(JSON.parse(asar.extractFile(archive,'desktop/preview-build.json')).number!==preview)throw Error('Packaged preview number differs.');
 for(const name of ['powerpoint.ps1','verify-signature.ps1','desktop-shortcut.ps1']){
  const source=await readFile(path.join(root,'desktop',name)),unpacked=await readFile(path.join(root,'release/win-unpacked/resources/app.asar.unpacked/desktop',name));
  if(!source.equals(unpacked))throw Error('Unpacked helper differs: '+name);
 }
 // Read private input only for a negative leak scan. Never stage or log it.
 let privateConfig='';try{privateConfig=await readFile(path.join(secretSourceRoot,'.dev.vars'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 const secret=privateConfig.match(/^ENROLLMENT_SECRET="?([a-f0-9]{64})"?$/m)?.[1];
 if(secret&&(await readFile(archive)).includes(Buffer.from(secret)))throw Error('Private authenticator detected in app package.');
 const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version,artifacts=[];
 for(const filename of [`Stati-Setup-${version}-x64.exe`,`Stati-Setup-${version}-x64.exe.blockmap`]){
  const file=path.join(root,'release',filename),digest=createHash('sha256');
  for await(const chunk of createReadStream(file))digest.update(chunk);
  artifacts.push({filename,bytes:(await stat(file)).size,sha256:digest.digest('hex')});
 }
 return{preview,version,packagedFilesVerified:checked.length,windowsRuntime,browserImports,auxiliaryFilesVerified:auxiliaryFiles.length,privateAuthenticatorAbsent:true,artifacts,windowsSigned:false,targetDeviceVerified:false};
}
