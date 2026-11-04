// Sample around the overlay so its own text and tint cannot decide the result.
function contrastColor(bitmap,size,bounds,display,previous){
 const points=[];for(const fraction of [.2,.5,.8]){points.push([bounds.x-24,bounds.y+bounds.height*fraction],[bounds.x+bounds.width+24,bounds.y+bounds.height*fraction],[bounds.x+bounds.width*fraction,bounds.y-24],[bounds.x+bounds.width*fraction,bounds.y+bounds.height+24]);}
 const values=[];for(const [px,py] of points){if(px<display.x||py<display.y||px>=display.x+display.width||py>=display.y+display.height)continue;const x=Math.min(size.width-1,Math.floor((px-display.x)/display.width*size.width)),y=Math.min(size.height-1,Math.floor((py-display.y)/display.height*size.height));const i=(y*size.width+x)*4;values.push(.2126*bitmap[i+2]+.7152*bitmap[i+1]+.0722*bitmap[i]);}
 if(!values.length)return previous||'#ffffff';values.sort((a,b)=>a-b);const luminance=values[Math.floor(values.length/2)];const threshold=previous==='#151515'?120:previous==='#ffffff'?165:145;return luminance>threshold?'#151515':'#ffffff';
}
module.exports={contrastColor};
