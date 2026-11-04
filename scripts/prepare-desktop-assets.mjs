import {copyFile,cp,mkdir,readFile,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

await mkdir('desktop/public',{recursive:true});
for(const file of ['brand-icon.png','icon-192.png','icon-512.png'])await copyFile('public/'+file,'desktop/public/'+file);

// Keep fresh/offline builds complete; generated public assets are not source backups.
const ocr='desktop/public/ocr',core='node_modules/tesseract.js-core';
await mkdir(ocr+'/core',{recursive:true});
await mkdir(ocr+'/lang',{recursive:true});
await copyFile('node_modules/tesseract.js/dist/worker.min.js',ocr+'/worker.min.js');
const coreFiles=(await readdir(core)).filter(file=>/^tesseract-core.*\.wasm(?:\.js)?$/.test(file));
for(const required of ['tesseract-core.wasm.js','tesseract-core.wasm','tesseract-core-simd-lstm.wasm.js','tesseract-core-simd-lstm.wasm']){
 if(!coreFiles.includes(required))throw Error('The locked OCR runtime is incomplete: '+required);
}
await Promise.all(coreFiles.map(file=>copyFile(core+'/'+file,ocr+'/core/'+file)));
const source=JSON.parse(await readFile('vendor/tesseract-data/SOURCE.json','utf8'));
for(const language of ['eng','ron']){
 const file=language+'.traineddata',record=source.files.find(item=>item.file===file);
 if(!record||!/^[a-f0-9]{64}$/.test(record.sha256))throw Error('Missing pinned OCR language metadata: '+language);
 const archive='vendor/tesseract-data/'+file+'.gz',bytes=await readFile(archive);
 const hash=createHash('sha256').update(gunzipSync(bytes,{maxOutputLength:32*1024*1024})).digest('hex');
 if(hash!==record.sha256)throw Error('Bundled OCR language integrity check failed: '+language);
 await copyFile(archive,ocr+'/lang/'+file+'.gz');
}

// Browser PDF workers cannot read the raw dependency tree. Keep their complete
// auxiliary resources at explicit local URLs, with each component's notices.
await rm('desktop/public/pdf',{recursive:true,force:true});
for(const directory of ['cmaps','standard_fonts','wasm','iccs'])await cp('node_modules/pdfjs-dist/'+directory,'desktop/public/pdf/'+directory,{recursive:true});
await mkdir('desktop/public/licenses',{recursive:true});
for(const [source,destination] of [
 ['node_modules/tesseract.js/LICENSE.md','licenses/tesseract.js-LICENSE.md'],
 ['node_modules/tesseract.js-core/LICENSE','licenses/tesseract.js-core-LICENSE'],
 ['node_modules/pdfjs-dist/LICENSE','licenses/pdfjs-dist-LICENSE'],
 ['node_modules/tesseract.js/dist/tesseract.min.js.LICENSE.txt','licenses/tesseract.min.js.LICENSE.txt'],
 ['node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt','ocr/worker.min.js.LICENSE.txt']
])await copyFile(source,'desktop/public/'+destination);
