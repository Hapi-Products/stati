// Container support does not promise that every embedded codec can play locally.
export const MEDIA_FORMATS=Object.freeze({
 mp4:{kind:'video',mime:'video/mp4',container:'iso',detected:['mp4','m4v']},
 m4v:{kind:'video',mime:'video/mp4',container:'iso',detected:['mp4','m4v']},
 mov:{kind:'video',mime:'video/quicktime',container:'quicktime',detected:['mov']},
 webm:{kind:'video',mime:'video/webm',container:'ebml',detected:['webm']},
 ogv:{kind:'video',mime:'video/ogg',container:'ogg',detected:['ogv']},
 mp3:{kind:'audio',mime:'audio/mpeg',container:'mpeg',detected:['mp3']},
 m4a:{kind:'audio',mime:'audio/mp4',container:'iso',detected:['m4a','mp4']},
 wav:{kind:'audio',mime:'audio/wav',container:'wave',detected:['wav']},
 ogg:{kind:'audio',mime:'audio/ogg',container:'ogg',detected:['ogg','opus','oga','spx']},
 opus:{kind:'audio',mime:'audio/ogg',container:'ogg',detected:['opus']},
 flac:{kind:'audio',mime:'audio/flac',container:'flac',detected:['flac']},
 aac:{kind:'audio',mime:'audio/aac',container:'mpeg',detected:['aac']},
});
export function mediaUploadFormat(name){const extension=name.split('.').at(-1).toLowerCase();return Object.hasOwn(MEDIA_FORMATS,extension)?MEDIA_FORMATS[extension]:undefined;}
export const UPLOAD_ACCEPT=['.pdf','.pptx','.docx','.txt','.jpg','.jpeg','.png','.webp',...Object.keys(MEDIA_FORMATS).map(extension=>'.'+extension),...new Set(Object.values(MEDIA_FORMATS).map(format=>format.mime))].join(',');
