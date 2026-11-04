export const MAX_GROUP_MATERIAL_BYTES=12*1024*1024;
export type GroupMaterial={id:string;contentVersion?:string;groupName:string;groupId?:string;title:string;filename:string;bytes:number;contentType:'application/pdf'|'image/jpeg'|'image/png'|'image/webp';authorId:string;authorName:string;createdAt:number;removalPending:boolean;canDelete:boolean;fileUrl:string;downloadUrl:string};
export type GroupMaterialList={materials:GroupMaterial[];groups:string[];nextCursor:string|null;canUpload:boolean;linkContext?:{computerId:string;songId:string}};
