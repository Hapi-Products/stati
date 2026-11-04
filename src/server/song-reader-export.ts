import {HttpError,safeFilename} from './core';
import {readStationCatalog,requireStationMinistry,stationMinistryGuard} from './station-catalog';
import {songReaderPages} from '../shared/song-reader-pages';

export async function exportSongSlides(request:Request,env:Env,computerId:string,songId:string){
 const query=new URL(request.url).searchParams,expected=query.get('contentHash');
 if(query.get('format')!=='pptx'||!expected||!/^[a-f0-9]{64}$/.test(expected))throw new HttpError(400,'Choose PowerPoint from the current song’s Share menu.');
 const response=await readStationCatalog(request,env,computerId,songId);
 const source=await response.json<{id:string;title:string;text:string;contentHash:string}>();
 if(source.contentHash!==expected)throw new HttpError(409,'This song changed. Reopen it before exporting slides.');
 const pages=songReaderPages(source.text);
 if(!pages.length)throw new HttpError(409,'This song has no lyrics to export.');
 const {default:PptxGenJS}=await import('pptxgenjs');
 const presentation=new PptxGenJS();presentation.layout='LAYOUT_WIDE';presentation.title=source.title;presentation.subject='Song reading slides';presentation.author='Stați';
 for(const text of pages){const slide=presentation.addSlide();slide.background={color:'000000'};slide.addText(text,{x:0.6,y:0.5,w:12.133,h:6.5,fontFace:'Arial',fontSize:36,color:'FFFFFF',align:'center',valign:'middle',margin:0,fit:'shrink'});}
 const bytes=await presentation.write({outputType:'arraybuffer',compression:true});
 if(!(bytes instanceof ArrayBuffer)||bytes.byteLength>12*1024*1024)throw new HttpError(413,'These slides are too large to share. Ask the computer operator to prepare this song.');
 // Generation yields. Recheck current source and authority before releasing any bytes.
 const authority=await requireStationMinistry(request,env,computerId,'readSongs'),guard=stationMinistryGuard(authority,computerId,'readSongs');
 const current=await env.DB.prepare(`SELECT content_hash FROM station_catalog WHERE device_id=? AND song_id=? AND ${guard.sql}`).bind(computerId,songId,...guard.params).first<{content_hash:string}>();
 if(!current||current.content_hash!==expected)throw new HttpError(409,'The song or your access changed while preparing the slides. Reopen it before sharing.');
 return new Response(bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.presentationml.presentation','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(safeFilename(source.title+'.pptx')),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
