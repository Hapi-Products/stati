import {fileTypeFromBuffer} from 'file-type';
import {HttpError} from './core';
import type {MediaUploadFormat} from '../shared/media-formats.js';

export const MEDIA_SIGNATURE_BYTES=4100;
function signature(head:Uint8Array,container:MediaUploadFormat['container']){
 const at=(text:string,offset=0)=>head.length>=offset+text.length&&Array.from(text).every((char,index)=>head[offset+index]===char.charCodeAt(0));
 switch(container){
  case'iso':return head.length>=16&&at('ftyp',4);
  case'quicktime':return head.length>=16&&at('ftyp',4)||['free','mdat','moov','wide'].some(type=>at(type,4));
  case'ebml':return [0x1a,0x45,0xdf,0xa3].every((byte,index)=>head[index]===byte);
  case'ogg':return at('OggS');
  case'wave':return at('RIFF')&&at('WAVE',8);
  case'flac':return at('fLaC');
  case'mpeg':return at('ID3')||head.length>=4&&head[0]===0xff&&(head[1]&0xe0)===0xe0;
 }
}
export async function mediaUploadType(format:MediaUploadFormat,head:Uint8Array){
 // Avoid entering unrelated archive/compression detectors for a renamed file.
 // The parser sees only the bounded prefix and never receives the body stream.
 const invalid=()=>new HttpError(415,'This file does not match a supported media format. Choose the original file or export it as MP4, MOV, MP3, or WAV.');
 if(!signature(head,format.container))throw invalid();
 try{
  const detected=await fileTypeFromBuffer(head,{maxBufferSize:MEDIA_SIGNATURE_BYTES});
  if(detected&&format.detected.includes(detected.ext))return format.mime;
 }catch{/* Unsupported or incomplete metadata never enters temporary storage. */}
 throw invalid();
}
