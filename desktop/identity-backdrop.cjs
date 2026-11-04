// One local, in-memory thumbnail. It is never written to disk or sent online.
async function capturePrimaryBackdrop({screen,capturer,timeout=1000}){
 let timer;
 try{
  const display=screen.getPrimaryDisplay(),scale=Math.min(1,1600/display.bounds.width,900/display.bounds.height);
  const capture=Promise.resolve(capturer.getSources({types:['screen'],thumbnailSize:{width:Math.max(1,Math.round(display.bounds.width*scale)),height:Math.max(1,Math.round(display.bounds.height*scale))}})).then(sources=>{
   const source=sources.find(item=>item.display_id===String(display.id));if(!source||source.thumbnail.isEmpty())return null;
   const image=source.thumbnail.toDataURL();return typeof image==='string'&&image.length<=12*1024*1024&&/^data:image\/png;base64,[a-z\d+/=]+$/i.test(image)?image:null;
  }).catch(()=>null);
  return await Promise.race([capture,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeout);})]);
 }catch{return null;}finally{clearTimeout(timer);}
}
module.exports={capturePrimaryBackdrop};
