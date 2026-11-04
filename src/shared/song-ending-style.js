export const DEFAULT_ENDING_SIZE=36;
export const MIN_ENDING_SIZE=16;
export const MAX_ENDING_SIZE=96;
export function songEndingSize(value=DEFAULT_ENDING_SIZE){return Number.isFinite(value)?Math.max(MIN_ENDING_SIZE,Math.min(MAX_ENDING_SIZE,value)):DEFAULT_ENDING_SIZE;}
export function songEndingBounds(value){const height=Math.max(80,songEndingSize(value)*1.2);return{x:1520,y:1040-height,width:320,height};}
