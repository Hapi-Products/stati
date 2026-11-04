const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../desktop/main.cjs'),'utf8');
function windowOptions(platform,options={}){
 let created;
 class Window{constructor(value){created=value;this.webContents={setWindowOpenHandler(){},on(){}};}loadFile(){}}
 const start=source.indexOf('function localWindow('),end=source.indexOf('\nfunction validSender',start);
 const context={BrowserWindow:Window,process:{platform},nativeTheme:{shouldUseDarkColors:false},path,__dirname:path.resolve(__dirname,'../desktop')};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);context.localWindow('index.html',options);return created;
}
test('Mac windows use native inset controls without changing Windows frames or frameless clocks',()=>{
 const mac=windowOptions('darwin');assert.equal(mac.titleBarStyle,'hiddenInset');assert.deepEqual(JSON.parse(JSON.stringify(mac.trafficLightPosition)),{x:18,y:16});assert.equal(mac.vibrancy,'sidebar');
 assert.equal(mac.webPreferences.contextIsolation,true);assert.equal(mac.webPreferences.sandbox,true);assert.equal(mac.webPreferences.nodeIntegration,false);assert.equal(mac.webPreferences.webSecurity,true);
 const clock=windowOptions('darwin',{frame:false});assert.equal(clock.titleBarStyle,undefined);assert.equal(clock.vibrancy,undefined);
 const windows=windowOptions('win32');assert.equal(windows.titleBarStyle,undefined);assert.equal(windows.vibrancy,undefined);
});
test('Mac preview packaging is Apple Silicon, ad-hoc signed and cannot inherit release publishing',()=>{
 const config=require('../desktop/builder.mac.cjs');assert.equal(config.publish,null);assert.equal(config.mac.identity,null);assert.equal(typeof config.afterPack,'function');assert.equal(config.mac.notarize,false);assert.equal(config.mac.hardenedRuntime,false);
 assert.deepEqual(config.mac.target.map(t=>t.target),['dmg','zip']);for(const target of config.mac.target)assert.deepEqual(target.arch,['arm64']);
 const script=fs.readFileSync(path.resolve(__dirname,'../scripts/build-mac-preview.mjs'),'utf8');assert.match(script,/'--publish',\s*'never'/);assert.match(script,/CSC_IDENTITY_AUTO_DISCOVERY:\s*'false'/);
});
test('local preview staging excludes generated conflict copies, private paths and duplicate assets',async()=>{
 const {sourceInput}=await import('../scripts/build-mac-preview.mjs');
 for(const file of ['desktop/build/prepare 2.html','desktop/build/ocr/core/tesseract-core.wasm 3.js','desktop/build/pdf/wasm/openjpeg 2.wasm','desktop/public/ocr/worker.min.js','desktop/.env.production','desktop/.dev.vars.local'])assert.equal(sourceInput(file),false,file);
 const canonical=new Set(['desktop/build/ocr/core/tesseract-core.wasm.js','desktop/build/pdf/wasm/openjpeg.wasm']);
 assert.equal(sourceInput('desktop/build/ocr',canonical),true);assert.equal(sourceInput('desktop/build/ocr/core/tesseract-core.wasm.js',canonical),true);
 assert.equal(sourceInput('desktop/build/ocr/core/obsolete.wasm.js',canonical),false);assert.equal(sourceInput('desktop/build/pdf/wasm/openjpeg.wasm',canonical),true);
 assert.equal(sourceInput('desktop/mac.css',canonical),true);assert.equal(sourceInput('desktop/build/assets/prepare-ExampleHash.js',canonical),true);
});
test('Mac preview aligns helper discovery with Unicode directory names and keeps its display name',{skip:process.platform!=='darwin'},()=>{
 const os=require('node:os'),{execFileSync}=require('node:child_process'),config=require('../desktop/builder.mac.cjs');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'stati-helper-names-')),display='Stați',helperBase=display.normalize('NFD'),application=path.join(temporary,helperBase+'.app'),plist=path.join(application,'Contents/Info.plist');
 try{
  fs.mkdirSync(path.join(application,'Contents/Frameworks',helperBase+' Helper.app'),{recursive:true});
  fs.writeFileSync(plist,'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>'+display+'</string><key>CFBundleDisplayName</key><string>'+display+'</string></dict></plist>');
  config.afterPack({electronPlatformName:'darwin',appOutDir:temporary,packager:{appInfo:{productFilename:helperBase}}});
  const value=key=>execFileSync('/usr/libexec/PlistBuddy',['-c','Print :'+key,plist],{encoding:'utf8'}).trim();
  assert.equal(value('CFBundleName'),helperBase);assert.equal(value('CFBundleDisplayName'),display);assert.notEqual(helperBase,display);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
