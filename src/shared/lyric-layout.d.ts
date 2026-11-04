export const LYRIC_BOUNDS:{x:number;y:number;width:number;height:number};
export function lyricFontSize(text:string,requested?:number):number;
export const LYRIC_MIN_FONT_SIZE:number;
export function layoutLyricSlides<T extends {section:string;text:string}>(slides:T[],requested?:number,linesPerSlide?:number):T[];
export function lyricQualityIssues(slides:{text:string}[],requested?:number):{slide:number;code:string;message:string}[];
