export const MAX_PROFILE_BYTES:number;
export const MAX_PROFILE_PIXELS:number;
export const MAX_PROFILE_EDGE:number;
export function profilePhotoInfo(bytes:Uint8Array):{width:number;height:number;mime:'image/jpeg'|'image/png'|'image/webp'};
