import {useEffect,useRef,useState} from 'react';
import {lyricFontSize} from '../shared/lyric-layout.js';
export type ServicePreview={id:string;title:string;contentHash:string;fontSize:number;firstSlide:string};
export type ServicePreviewBridge={loadServicePreview?:(id:string)=>Promise<ServicePreview>};
export function ServiceSongPreview({id,contentHash,title,source,bridge}:{id:string;contentHash:string;title:string;source?:{fontSize:number;firstSlide?:string};bridge?:ServicePreviewBridge}){
 const ref=useRef<HTMLDivElement>(null),[preview,setPreview]=useState<{fontSize:number;firstSlide?:string}|undefined>(source);
 useEffect(()=>{let live=true;setPreview(source);if(source?.firstSlide||!bridge?.loadServicePreview)return;let started=false;const load=()=>{if(started)return;started=true;void bridge.loadServicePreview!(id).then(value=>{if(live&&value.id===id&&value.contentHash===contentHash)setPreview(value);}).catch(()=>{});};const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){load();observer?.disconnect();}},{rootMargin:'160px'});if(observer&&ref.current)observer.observe(ref.current);else load();return()=>{live=false;observer?.disconnect();};},[id,contentHash,source?.firstSlide,source?.fontSize,bridge]);
 const text=preview?.firstSlide;
 return <div ref={ref} className="service-slide-preview" role="img" aria-label={text?'First slide: '+title:'Slide preview unavailable: '+title}>{text?<p style={{fontSize:(lyricFontSize(text,preview?.fontSize||96)/19.2)+'cqw'}}>{text}</p>:<span>Preview unavailable</span>}</div>;
}
