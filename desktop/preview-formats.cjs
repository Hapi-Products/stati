const path=require('node:path');
const media={'.mp4':['video','video/mp4'],'.m4v':['video','video/mp4'],'.mov':['video','video/quicktime'],'.webm':['video','video/webm'],'.ogv':['video','video/ogg'],'.mp3':['audio','audio/mpeg'],'.m4a':['audio','audio/mp4'],'.wav':['audio','audio/wav'],'.ogg':['audio','audio/ogg'],'.opus':['audio','audio/ogg'],'.flac':['audio','audio/flac'],'.aac':['audio','audio/aac']};
function previewFormat(name,contentType=''){
 const extension=path.extname(name).toLowerCase();
 if(media[extension])return {kind:'media',mediaType:media[extension][0],mime:media[extension][1]};
 if(contentType.startsWith('image/')||['.png','.jpg','.jpeg','.webp','.gif','.bmp','.ico','.heic','.heif','.avif'].includes(extension))return {kind:'image',sampleBytes:1024*1024};
 if(extension==='.pdf')return {kind:'pdf'};
 if(['.pptx','.docx','.pro','.rtf'].includes(extension))return {kind:'document'};
 if(['.txt','.md','.csv','.json'].includes(extension))return {kind:'text',sampleBytes:16384};
 return {kind:'unsupported'};
}
module.exports={previewFormat};
