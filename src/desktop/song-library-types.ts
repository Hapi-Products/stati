export type LibrarySearch={query?:string;language?:'all'|'eng'|'ron';category?:string;groupName?:string;offset?:number;favoritesOnly?:boolean};
export type LibraryEntry={id:string;contentHash:string;title:string;filename:string;category:string;groupName?:string|null;sourceSongId?:string|null;language:'eng'|'ron'|'unknown';fontSize:number;amenFontSize?:number;addedAt?:number;modifiedAt:number;bytes:number;firstLine:string;lyricPreview?:string;firstSlide?:string;editable:boolean;favorite:boolean};
export type LibraryResult={items:LibraryEntry[];total:number;scanned:number;categories:string[];groups?:string[];unreadable:number;warnings:string[];offset:number;updatedAt?:number|null};
export type LibrarySong=Omit<LibraryEntry,'firstLine'|'editable'|'favorite'>&{text:string;songName:string};
