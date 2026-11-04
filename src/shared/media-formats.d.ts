export type MediaUploadFormat={kind:'audio'|'video';mime:string;container:'iso'|'quicktime'|'ebml'|'ogg'|'mpeg'|'wave'|'flac';detected:readonly string[]};
export const MEDIA_FORMATS:Readonly<Record<string,MediaUploadFormat>>;
export function mediaUploadFormat(name:string):MediaUploadFormat|undefined;
export const UPLOAD_ACCEPT:string;
