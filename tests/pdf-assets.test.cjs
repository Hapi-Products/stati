const {test}=require('node:test'),assert=require('node:assert/strict');
const {pdfAssetOptions}=require('../src/shared/pdf-assets.js');

test('both native PDF entry and shared chunk use the same served auxiliary assets',()=>{
 const expected={cMapUrl:'stati://app/pdf/cmaps/',cMapPacked:true,standardFontDataUrl:'stati://app/pdf/standard_fonts/',wasmUrl:'stati://app/pdf/wasm/',iccUrl:'stati://app/pdf/iccs/',useWorkerFetch:true};
 for(const moduleUrl of ['stati://app/preview-tools.js','stati://app/assets/conversion-abc.js','stati://app/assets/pdf-assets.js?old=1#anchor'])assert.deepEqual(pdfAssetOptions(moduleUrl),expected);
});

test('PDF assets follow the executing development module origin rather than the inbox file page',()=>{
 const previous=global.document;global.document={baseURI:'file:///Applications/Stati/resources/app.asar/desktop/index.html'};
 try{assert.deepEqual(pdfAssetOptions('http://127.0.0.1:5173/src/desktop/preview-tools.ts'),{cMapUrl:'http://127.0.0.1:5173/pdf/cmaps/',cMapPacked:true,standardFontDataUrl:'http://127.0.0.1:5173/pdf/standard_fonts/',wasmUrl:'http://127.0.0.1:5173/pdf/wasm/',iccUrl:'http://127.0.0.1:5173/pdf/iccs/',useWorkerFetch:true});}
 finally{if(previous===undefined)delete global.document;else global.document=previous;}
 assert.throws(()=>pdfAssetOptions('not-a-module-url'),/Invalid URL/);
});
