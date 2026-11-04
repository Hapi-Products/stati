const path=require('node:path'),JSZip=require('jszip'),{DOMParser}=require('linkedom');
const {imageSize}=require('image-size');
const MAX_IMAGE_PIXELS=25000000,MAX_THUMBNAIL_BYTES=3*1024*1024,MAX_XML_BYTES=4*1024*1024;
const {previewFormat}=require('./preview-formats.cjs');
const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',ico:'image/x-icon',heif:'image/heif',avif:'image/avif',jxl:'image/jxl'};
function imageInfo(bytes){const info=imageSize(bytes);if(!mime[info.type]||!Number.isSafeInteger(info.width)||!Number.isSafeInteger(info.height)||info.width<=0||info.height<=0||info.width>16384||info.height>16384||info.width*info.height>MAX_IMAGE_PIXELS)throw Error('Image preview exceeds the supported size or format.');return {width:info.width,height:info.height,mime:mime[info.type]};}
async function zipBytes(entry,maximum){
 const size=entry?._data?.uncompressedSize;if(!entry||!Number.isSafeInteger(size)||size<0||size>maximum)throw Error('Document preview exceeds its size limit.');
 return new Promise((resolve,reject)=>{const chunks=[];let length=0,ended=false;const stream=entry.internalStream('uint8array');
 stream.on('data',chunk=>{if(ended)return;length+=chunk.length;if(length>maximum){ended=true;stream.pause();reject(Error('Document preview exceeded its size limit.'));return;}chunks.push(Buffer.from(chunk));});
 stream.on('error',error=>{if(!ended){ended=true;reject(error);}});stream.on('end',()=>{if(!ended){ended=true;if(length!==size)reject(Error('Document preview is incomplete.'));else resolve(Buffer.concat(chunks,length));}});stream.resume();
 });
}
function part(base,target){if(typeof target!=='string'||!target||target.includes('\\')||target.includes('\0')||/^[a-z]+:/i.test(target))throw Error('Unsupported document link.');const name=path.posix.normalize(target.startsWith('/')?target.slice(1):path.posix.join(base,target));if(name.startsWith('../')||name.includes('/../'))throw Error('Unsupported document link.');return name;}
function xml(bytes){const text=bytes.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Document preview contains unsupported XML.');return new DOMParser().parseFromString(text,'text/xml');}
function previewText(text){return {kind:'text',text:Array.from(String(text).replace(/\r\n?/g,'\n').trim().slice(0,1200)).slice(0,600).join('')};}
async function officePreview(bytes,extension){
 const zip=await JSZip.loadAsync(bytes),entry=name=>zip.file(name);let total=0;
 async function readXml(name){const data=await zipBytes(entry(name),Math.min(MAX_XML_BYTES,8*1024*1024-total));total+=data.length;return xml(data);}
 try{
  const relations=await readXml('_rels/.rels');
  for(const relation of relations.getElementsByTagName('Relationship')){
   if(relation.getAttribute('TargetMode')==='External'||! /\/metadata\/thumbnail$/.test(relation.getAttribute('Type')||''))continue;
   try{const image=await zipBytes(entry(part('',relation.getAttribute('Target'))),MAX_THUMBNAIL_BYTES),info=imageInfo(image);return {kind:'image',bytes:image,mime:info.mime,label:'Saved document thumbnail'};}catch{}
  }
 }catch{}
 if(extension==='.docx'){
  const document=await readXml('word/document.xml'),lines=[];let length=0;
  for(const paragraph of document.getElementsByTagName('w:p')){const line=[...paragraph.getElementsByTagName('w:t')].map(node=>node.textContent).join('');if(line){lines.push(line);length+=line.length;if(length>=600)break;}}
  return previewText(lines.join('\n'));
 }
 const presentation=await readXml('ppt/presentation.xml'),id=presentation.getElementsByTagName('p:sldId')[0]?.getAttribute('r:id');if(!id)throw Error('No slide preview found.');
 const relations=await readXml('ppt/_rels/presentation.xml.rels'),relation=[...relations.getElementsByTagName('Relationship')].find(item=>item.getAttribute('Id')===id&&item.getAttribute('TargetMode')!=='External');if(!relation)throw Error('No slide preview found.');
 const name=part('ppt',relation.getAttribute('Target'));if(!/^ppt\/slides\/[^/]+\.xml$/.test(name))throw Error('Unsupported slide link.');
 const slide=await readXml(name),lines=[];let length=0;for(const paragraph of slide.getElementsByTagName('a:p')){const line=[...paragraph.getElementsByTagName('a:t')].map(node=>node.textContent).join('');if(line){lines.push(line);length+=line.length;if(length>=600)break;}}return previewText(lines.join('\n'));
}
async function documentPreview({bytes,name,contentType=''}){
 bytes=Buffer.from(bytes);const extension=path.extname(name).toLowerCase(),format=previewFormat(name,contentType);
 if(format.kind==='media'||format.kind==='pdf')return format;
 if(format.kind==='image'){const info=imageInfo(bytes);return {kind:'image',original:true,mime:info.mime};}
 if(['.pptx','.docx'].includes(extension))return officePreview(bytes,extension);
 if(extension==='.pro'){
  if(bytes.length>8*1024*1024)return {kind:'unsupported',reason:'Open the saved file to view this large presentation.'};
  const doc=require('./presentation.cjs').decode(bytes);
  for(const cue of doc.cues||[]){const lines=[];for(const action of cue.actions||[])for(const item of action.slide?.presentation?.baseSlide?.elements||[]){const element=item.element;if(element?.name==='Song ending'||!element?.text?.rtfData)continue;lines.push(require('./rtf-text.cjs').rtfPlain(Buffer.from(element.text.rtfData,'base64').toString('latin1')));}if(lines.some(line=>line.trim()))return previewText(lines.join('\n'));}
  return {kind:'unsupported',reason:'This presentation has no editable text preview.'};
 }
 if(extension==='.rtf'){if(bytes.length>MAX_XML_BYTES)return{kind:'unsupported',reason:'Open the saved file to view this large document.'};return previewText(require('./rtf-text.cjs').rtfPlain(bytes.toString('latin1')));}
 if(['.txt','.md','.csv','.json'].includes(extension)){
  const sample=bytes.subarray(0,16384);let text;if(sample[0]===255&&sample[1]===254)text=new TextDecoder('utf-16le').decode(sample);else if(sample[0]===254&&sample[1]===255)text=new TextDecoder('utf-16be').decode(sample);else text=new TextDecoder().decode(sample);return previewText(text);
 }
 return {kind:'unsupported',reason:'Open the saved file to view this format.'};
}
module.exports={documentPreview,imageInfo,zipBytes,MAX_IMAGE_PIXELS};
