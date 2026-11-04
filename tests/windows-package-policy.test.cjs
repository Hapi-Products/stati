const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),config=JSON.parse(fs.readFileSync(path.join(root,'desktop/builder.json'),'utf8'));
const verification=import('../scripts/verify-preview-artifacts.mjs');
const {FileMatcher,getFileMatchers,getNodeModuleFileMatcher}=require('app-builder-lib/out/fileMatcher');
const {validateConfiguration,doMergeConfigs}=require('app-builder-lib/out/util/config/config');
const lexer=require('es-module-lexer');
const stat=(moduleFullFilePath)=>({isDirectory:()=>false,...(moduleFullFilePath?{moduleFullFilePath}:{})});
const pdfModule='desktop/build/assets/pdf-fixture.js',pdfWorker='desktop/build/assets/pdf.worker.min-fixture.mjs';
const validEntries=async()=>[...(await verification).requiredWindowsRuntimeFiles,pdfModule,pdfWorker];

test('the normalized builder uses one explicit package allowlist and excludes source build inputs',async()=>{
 await validateConfiguration(config,{isEnabled:false});
 assert.ok(config.files.includes('desktop/**/*'));
 assert.equal(config.win.files,undefined);
 const normalized=doMergeConfigs([structuredClone(config)]),matchers=getFileMatchers(normalized,'files','/output',{macroExpander:value=>value,customBuildOptions:normalized.win,globalOutDir:'/application/release',defaultSrc:'/application'});
 assert.equal(matchers.length,1,'Separate negative-only platform matchers must never widen the package to the whole workspace.');
 const windows=matchers[0].createFilter();
 for(const name of ['desktop/public/ocr/core/tesseract-core.wasm','.stati-build/input-cache/private-source','tests/isolated.test.cjs','docs/private.md','.dev.vars'])assert.equal(windows('/application/'+name,stat()),false,name);
 for(const name of ['desktop/build/ocr/core/tesseract-core.wasm','desktop/build/ocr/lang/ron.traineddata.gz','desktop/build/assets/pdf-fixture.js','desktop/main.cjs','desktop/powerpoint.ps1','public/brand-icon.png'])assert.equal(windows('/application/'+name,stat()),true,name);
});
test('the installed dependency matcher excludes redundant browser packages while retaining native runtime imports',()=>{
 const info={config,debugLogger:{isEnabled:false}},windows=getNodeModuleFileMatcher('/application','/output',value=>value,config.win,info).createFilter(),other=getNodeModuleFileMatcher('/application','/output',value=>value,{},info).createFilter();
 const excluded=['node_modules/tesseract.js/dist/worker.min.js','node_modules/tesseract.js-core/tesseract-core.wasm','node_modules/pdfjs-dist/build/pdf.mjs','node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node','node_modules/@napi-rs/canvas-darwin-x64/skia.darwin-x64.node','node_modules/parent/node_modules/pdfjs-dist/build/pdf.mjs'];
 for(const name of excluded){assert.equal(windows('/external/'+name,stat(name)),false,name);assert.equal(other('/external/'+name,stat(name)),false,name);}
 for(const name of ['node_modules/jszip/lib/index.js','node_modules/linkedom/cjs/index.js','node_modules/image-size/dist/cjs/index.js','node_modules/@mozilla/readability/Readability.js','node_modules/qrcode/lib/index.js','node_modules/protobufjs/light.js','node_modules/js-yaml/index.js','node_modules/electron-updater/out/main.js'])assert.equal(windows('/external/'+name,stat(name)),true,name);
});
test('the final Windows inventory gate requires every OCR fallback, language, PDF auxiliary notice and native external',async()=>{
 const v=await verification,entries=await validEntries();assert.doesNotThrow(()=>v.assertWindowsRuntimeLayout(entries));
 for(const name of v.requiredWindowsRuntimeFiles)assert.throws(()=>v.assertWindowsRuntimeLayout(entries.filter(entry=>entry!==name)),/Required Windows runtime missing/,name);
 assert.throws(()=>v.assertWindowsRuntimeLayout(entries.filter(entry=>entry!==pdfModule)),/PDF module missing/);
 assert.throws(()=>v.assertWindowsRuntimeLayout(entries.filter(entry=>entry!==pdfWorker)),/PDF worker missing/);
});
test('the final Windows inventory gate rejects duplicate source assets and excluded raw payloads',async()=>{
 const v=await verification,entries=await validEntries();
 for(const name of ['desktop/public','desktop/public/ocr/lang/ron.traineddata.gz','node_modules/tesseract.js','node_modules/tesseract.js-core/tesseract-core.wasm','node_modules/pdfjs-dist/build/pdf.mjs','node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node','node_modules/parent/node_modules/tesseract.js/index.js'])assert.throws(()=>v.assertWindowsRuntimeLayout([...entries,name]),/Excluded Windows package payload/,name);
});
test('actual module parsing requires local literal imports and reviews only the two PDF computed imports',async()=>{
 const v=await verification;await lexer.init;
 const shared='desktop/build/assets/shared.js',entry='desktop/build/preview-tools.js';
 const modules=new Map([[entry,"import './assets/shared.js';import('./assets/pdf-fixture.js');"],[shared,'export const value=1;'],[pdfModule,'class PDF { read(){return import(this.workerSrc)} }'],[pdfWorker,'class WasmImage {static #R="";read(){return import(`${WasmImage.#R}${this._noWasmFilename}`)} }']]);
 const report=v.assertDesktopBundleImports(modules,[...modules.keys()],lexer.parse);assert.equal(report.modules,4);assert.equal(report.literalExternalImports,0);assert.equal(report.reviewedComputedImports.length,2);
 for(const source of ['import("pdfjs-dist")','import("tesseract.js")','import("node:fs")','import("https://example.invalid/lib.js")'])assert.throws(()=>v.assertDesktopBundleImports(new Map([[entry,source]]),[entry],lexer.parse),/External browser module/);
 assert.throws(()=>v.assertDesktopBundleImports(new Map([[entry,'import("./assets/missing.js")']]),[entry],lexer.parse),/missing or outside/);
 assert.throws(()=>v.assertDesktopBundleImports(new Map([[entry,'import("../../outside.js")']]),[entry,'outside.js'],lexer.parse),/missing or outside/);
 assert.throws(()=>v.assertDesktopBundleImports(new Map([[entry,'import(userSuppliedPath)']]),[entry],lexer.parse),/Unreviewed computed/);
});

test('every literal native shared dependency is covered by the builder package filter',()=>{
 const normalized=doMergeConfigs([structuredClone(config)]),matchers=getFileMatchers(normalized,'files','/output',{macroExpander:value=>value,customBuildOptions:normalized.win,globalOutDir:'/application/release',defaultSrc:'/application'}),included=matchers[0].createFilter();
 for(const name of fs.readdirSync(path.join(root,'desktop')).filter(name=>name.endsWith('.cjs'))){const source=fs.readFileSync(path.join(root,'desktop',name),'utf8');for(const match of source.matchAll(/require\(['"](\.\.\/src\/shared\/[^'"]+)['"]\)/g)){const target=path.posix.normalize('desktop/'+match[1]);assert.equal(included('/application/'+target,stat()),true,name+' requires '+target);}}
});
