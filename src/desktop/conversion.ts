import JSZip from 'jszip';
import {cleanOcrText} from '../shared/ocr-text.js';
import {pdfAssetOptions} from '../shared/pdf-assets.js';
type TextLanguage='eng'|'ron'|'both';
async function ocrWorker(onProgress:(s:string)=>void,language:TextLanguage){const {createWorker}=await import('tesseract.js');return createWorker(language==='both'?['ron','eng']:[language],1,{workerPath:new URL('ocr/worker.min.js',document.baseURI).href,corePath:new URL('ocr/core',document.baseURI).href,langPath:new URL('ocr/lang',document.baseURI).href,workerBlobURL:false,logger:m=>{if(m.status==='recognizing text')onProgress('Recognizing text '+Math.round(m.progress*100)+'%…');}});}
async function recognizeImage(worker:Awaited<ReturnType<typeof ocrWorker>>,image:HTMLCanvasElement,onProgress:(s:string)=>void,onWarning:(s:string)=>void){
 await worker.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300'});
 const original=(await worker.recognize(image)).data;
 let best=original;
 {
  onProgress('Improving image contrast and reading again…');
  const scale=Math.min(2,3200/Math.max(image.width,image.height));const enhanced=document.createElement('canvas');enhanced.width=Math.max(1,Math.round(image.width*scale))+40;enhanced.height=Math.max(1,Math.round(image.height*scale))+40;
  const ctx=enhanced.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Could not prepare this image.');ctx.fillStyle='#fff';ctx.fillRect(0,0,enhanced.width,enhanced.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,20,20,enhanced.width-40,enhanced.height-40);
  const pixels=ctx.getImageData(20,20,enhanced.width-40,enhanced.height-40);const histogram=new Uint32Array(256);for(let i=0;i<pixels.data.length;i+=4){const gray=Math.round(.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2]);histogram[gray]++;}
  const total=pixels.width*pixels.height;let sum=0,low=0,high=255;for(let i=0;i<256;i++){sum+=histogram[i];if(sum>=total*.01){low=i;break;}}sum=0;for(let i=255;i>=0;i--){sum+=histogram[i];if(sum>=total*.01){high=i;break;}}
  let light=0;for(let i=128;i<256;i++)light+=histogram[i];for(let i=0;i<pixels.data.length;i+=4){let gray=.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2];gray=Math.max(0,Math.min(255,(gray-low)*255/Math.max(1,high-low)));if(light<total/2)gray=255-gray;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=gray;pixels.data[i+3]=255;}ctx.putImageData(pixels,20,20);
  try{const retry=(await worker.recognize(enhanced)).data;if(retry.text.trim()&&retry.confidence>best.confidence)best=retry;}finally{enhanced.width=enhanced.height=0;}
 }
 if(best.confidence<85)onWarning('Some words may be incorrect (OCR confidence '+Math.round(best.confidence)+'%). Review every line, try the specific song language, or import a lyrics link instead.');
 else onWarning('Image text needs review: decorative artwork, titles, and small print may be read as lyrics. Check the words before exporting.');
 return cleanOcrText(best.text);
}
export async function extractFile(file:File,onProgress:(s:string)=>void,language:TextLanguage='both',onWarning:(s:string)=>void=()=>{}):Promise<string>{
 if(file.size>50*1024*1024)throw new Error('Choose a file up to 50 MB.');const ext=file.name.split('.').pop()?.toLowerCase();
 if(ext==='txt')return file.text();
 if(ext==='pptx'||ext==='docx'){
  onProgress('Reading document text…');const zip=await JSZip.loadAsync(file);const paths=Object.keys(zip.files).filter(p=>ext==='pptx'?/^ppt\/slides\/slide\d+\.xml$/.test(p):p==='word/document.xml').sort((a,b)=>Number(a.match(/\d+/)?.[0]||0)-Number(b.match(/\d+/)?.[0]||0));let total=0;const pages:string[]=[];
  if(paths.length>500)throw new Error('Choose a document with 500 slides or fewer.');for(const path of paths){const entry=zip.file(path)! as JSZip.JSZipObject & {_data?:{uncompressedSize?:number}};const expanded=entry._data?.uncompressedSize;if(typeof expanded!=='number'||expanded<0||expanded+total>10*1024*1024)throw new Error('The document expands beyond the text processing limit.');const raw=await zip.file(path)!.async('string');total+=raw.length;if(total>10*1024*1024)throw new Error('The document contains too much text to process.');const xml=new DOMParser().parseFromString(raw,'application/xml');const ns=ext==='pptx'?'http://schemas.openxmlformats.org/drawingml/2006/main':'http://schemas.openxmlformats.org/wordprocessingml/2006/main';const paragraphs=Array.from(xml.getElementsByTagNameNS(ns,'p'));pages.push(paragraphs.map(p=>Array.from(p.getElementsByTagNameNS(ns,'t')).map(t=>t.textContent).join('')).filter(Boolean).join('\n'));}return pages.join('\n\n');
 }
 if(ext==='pdf'){
  onProgress('Reading PDF text…');const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();const task=pdfjs.getDocument({...pdfAssetOptions(import.meta.url),data:await file.arrayBuffer()});const doc=await task.promise;if(doc.numPages>100){await task.destroy();throw new Error('Choose a PDF with 100 pages or fewer.');}let worker:Awaited<ReturnType<typeof ocrWorker>>|undefined;const pages:string[]=[];try{for(let n=1;n<=doc.numPages;n++){onProgress(`Reading page ${n} of ${doc.numPages}…`);const page=await doc.getPage(n);const text=await page.getTextContent();let output='';for(const item of text.items){if('str' in item)output+=item.str+(item.hasEOL?'\n':' ');}if(!output.trim()){onProgress(`Recognizing scanned page ${n} of ${doc.numPages}…`);const original=page.getViewport({scale:1});const scale=Math.min(2,2500/Math.max(original.width,original.height));const viewport=page.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext('2d');if(!context)throw new Error('Could not render this PDF page.');await page.render({canvas,canvasContext:context,viewport}).promise;worker??=await ocrWorker(onProgress,language);output=await recognizeImage(worker,canvas,onProgress,onWarning);canvas.width=canvas.height=0;}pages.push(output.trim());page.cleanup();}return pages.join('\n\n');}finally{await worker?.terminate();await task.destroy();}
 }
 if(['jpg','jpeg','png','webp'].includes(ext||'')){
  onProgress('Recognizing text on your device…');const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>25000000){bitmap.close();throw new Error('Choose an image with 25 million pixels or fewer.');}
  const canvas=document.createElement('canvas');const scale=Math.min(1,4000/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const context=canvas.getContext('2d');if(!context){bitmap.close();throw new Error('Could not decode this image.');}context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const worker=await ocrWorker(onProgress,language);try{return await recognizeImage(worker,canvas,onProgress,onWarning);}finally{await worker.terminate();canvas.width=canvas.height=0;}
 }
 throw new Error('Choose a TXT, PDF, PPTX, DOCX, JPG, PNG, or WebP file.');
}
export function download(data:BlobPart,name:string,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
