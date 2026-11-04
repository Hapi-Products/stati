const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createWorker}=require('tesseract.js');
test('bundled local OCR preserves Romanian diacritics and English lyrics',async()=>{
 const worker=await createWorker(['ron','eng'],1,{langPath:path.resolve(__dirname,'../desktop/public/ocr/lang'),corePath:path.resolve(__dirname,'../desktop/public/ocr/core'),cacheMethod:'none',gzip:true});
 try{const result=await worker.recognize(path.join(__dirname,'fixtures/ocr-romanian-english.png'));assert.ok(result.data.text.includes('Împreună cântăm'));assert.ok(result.data.text.includes('Together we prepare'));assert.ok(result.data.confidence>=80);}finally{await worker.terminate();}
});
