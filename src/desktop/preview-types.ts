type PreviewBase={name?:string;changedSinceDelivery?:boolean};
export type PreviewPayload=PreviewBase&(
 | {kind:'image';bytes:Uint8Array;mime:string;label?:string}
 | {kind:'pdf';bytes:Uint8Array}
 | {kind:'media';bytes:Uint8Array;mediaType:'audio'|'video';mime:string}
 | {kind:'text';text:string}
 | {kind:'unsupported';reason:string}
);
export type Thumbnail={image?:string;text?:string;reason?:string;changedSinceDelivery?:boolean;label?:string};
export type MediaPreview={url:string;mediaType:'audio'|'video';release:()=>void;changedSinceDelivery?:boolean};
