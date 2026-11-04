/** Derived reading pages only: preserve source wording, including any existing ending. */
export function songReaderPages(text:string,linesPerSlide=6):string[]{
 const limit=Math.min(12,Math.max(1,Math.floor(linesPerSlide))),pages:string[]=[];let lines:string[]=[];
 const flush=()=>{for(let n=0;n<lines.length;n+=limit)pages.push(lines.slice(n,n+limit).join('\n'));lines=[];};
 for(const line of text.replace(/\r\n?/g,'\n').split('\n')){if(!line.trim())flush();else lines.push(line);}
 flush();return pages;
}
