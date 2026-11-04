import {imageSize} from 'image-size';

export const MAX_PROFILE_BYTES=1024*1024;
export const MAX_PROFILE_PIXELS=25000000;
export const MAX_PROFILE_EDGE=16384;
const invalid=()=>Object.assign(Error('Choose a readable JPG, PNG or WebP photo.'),{code:'PHOTO_INVALID'});
const text=(bytes,start,value)=>value.split('').every((character,index)=>bytes[start+index]===character.charCodeAt(0));

// A length-prefixed linear walk avoids repeated copying of a malicious JPEG's
// remaining bytes. Stop at the first supported SOF; no pixel data is decoded.
function jpegInfo(bytes){
 let cursor=2;
 while(cursor<bytes.length){
  if(bytes[cursor++]!==0xff)throw invalid();
  while(cursor<bytes.length&&bytes[cursor]===0xff)cursor++;
  if(cursor>=bytes.length)throw invalid();
  const marker=bytes[cursor++];
  if(marker===0x01)continue;
  if(marker===0||marker===0xd8||marker===0xd9||marker===0xda||marker>=0xd0&&marker<=0xd7||cursor+2>bytes.length)throw invalid();
  const length=bytes[cursor]*256+bytes[cursor+1];
  if(length<2||length>bytes.length-cursor)throw invalid();
  if(marker===0xc0||marker===0xc1||marker===0xc2){
   if(length<8||!bytes[cursor+7]||length!==8+3*bytes[cursor+7])throw invalid();
   return {width:bytes[cursor+5]*256+bytes[cursor+6],height:bytes[cursor+3]*256+bytes[cursor+4],mime:'image/jpeg'};
  }
  cursor+=length;
 }
 throw invalid();
}

// Header/dimension preflight only: bounds the eventual decoded image, without
// claiming to validate every compressed pixel or every frame of an animation.
export function profilePhotoInfo(bytes){
 if(!(bytes instanceof Uint8Array)||!bytes.byteLength||bytes.byteLength>MAX_PROFILE_BYTES)throw invalid();
 let info;
 if(bytes[0]===0xff&&bytes[1]===0xd8)info=jpegInfo(bytes);
 else{
  const png=bytes[0]===0x89&&text(bytes,1,'PNG\r\n\x1a\n'),webp=text(bytes,0,'RIFF')&&text(bytes,8,'WEBP');
  if(!png&&!webp)throw invalid();
  try{const dimensions=imageSize(bytes);if(dimensions.type!==(png?'png':'webp'))throw invalid();info={width:dimensions.width,height:dimensions.height,mime:png?'image/png':'image/webp'};}catch{throw invalid();}
 }
 if(!Number.isSafeInteger(info.width)||!Number.isSafeInteger(info.height)||info.width<1||info.height<1)throw invalid();
 if(info.width>MAX_PROFILE_EDGE||info.height>MAX_PROFILE_EDGE||info.width*info.height>MAX_PROFILE_PIXELS)throw Object.assign(Error('Choose a profile photo with at most 25 million pixels and no side longer than 16,384 pixels.'),{code:'PHOTO_DIMENSIONS'});
 return info;
}
