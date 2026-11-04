import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ImagePlus,Send,X,SquarePen} from 'lucide-react';
import {api,ApiError,type Me} from './api';
import type {LibrarySong} from '../desktop/song-library-types';
import type {TaskImage} from '../shared/feedback-tasks-types';
import {safeTransferFilename} from '../shared/file-name.js';
import {archiveCorrection,correctionImageMatches,correctionMatches,readCorrection,readCorrectionPhoto,saveCorrection,saveCorrectionPhoto,type CorrectionDraft} from './song-comment-store';
export function WebSongComment({me,computerId,song,close,changed}:{me:Me;computerId:string;song:LibrarySong;close:()=>void;changed:()=>void}){
 const fresh=():CorrectionDraft=>({ownerId:me.id,computerId,songId:song.id,payload:{id:crypto.randomUUID(),songId:song.id,contentHash:song.contentHash,message:'',quote:'',replacement:''},phase:'editing',photos:[]});
 const [draft,setDraft]=useState<CorrectionDraft>(fresh),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const dialog=useRef<HTMLFormElement>(null),closeRef=useRef(close);closeRef.current=close;
 const current=useRef(draft),alive=useRef(true),work=useRef(false),queue=useRef(Promise.resolve()),input=useRef<HTMLInputElement>(null),controller=useRef(new AbortController());current.current=draft;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,element=dialog.current;
  const controls=()=>Array.from(element?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([hidden]),textarea:not(:disabled),[tabindex="0"]')||[]);
  controls()[0]?.focus();
  const keys=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();if(!work.current)closeRef.current();}
   else if(event.key==='Tab'){const items=controls(),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  };
  element?.addEventListener('keydown',keys);return()=>{element?.removeEventListener('keydown',keys);if(previous?.isConnected)previous.focus();};
 },[]);
 function persist(value:CorrectionDraft){current.current=value;setDraft(value);const next=queue.current.catch(()=>{}).then(()=>saveCorrection(value));queue.current=next;return next;}
 useEffect(()=>{alive.current=true;void readCorrection(me.id,computerId,song.id).then(value=>{if(alive.current){if(value){current.current=value;setDraft(value);}setReady(true);}},()=>{if(alive.current)setError('Your saved comment could not be read. Its existing files have been kept.');});return()=>{alive.current=false;controller.current.abort();};},[me.id,computerId,song.id]);
 useEffect(()=>{const before=(event:BeforeUnloadEvent)=>{if(current.current.phase!=='sent'&&current.current.payload.message){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before);},[]);
 const editable=ready&&!busy&&draft.phase==='editing';
 function edit(changes:Partial<CorrectionDraft['payload']>){if(!editable)return;void persist({...current.current,payload:{...current.current.payload,...changes}}).catch(()=>{if(alive.current)setError('Your draft could not be saved. Keep this form open and retry.');});}
 async function attach(files:File[]){if(!editable)return;work.current=true;setBusy(true);try{for(const file of files.slice(0,6-current.current.photos.length)){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>8*1024*1024)throw Error('Choose JPG, PNG or WebP images up to 8 MB.');
  const bytes=await file.arrayBuffer(),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join(''),id=crypto.randomUUID();if(!alive.current)return;
  await saveCorrectionPhoto(me.id,id,file);if(!alive.current)return;await persist({...current.current,photos:[...current.current.photos,{id,filename:safeTransferFilename(file.name),bytes:file.size,sha256,confirmed:false}]});
 }}catch(e){if(alive.current)setError((e as Error).message);}finally{work.current=false;if(alive.current)setBusy(false);}}
 async function send(event:FormEvent){event.preventDefault();if(!ready||work.current||['sent','rejected'].includes(current.current.phase))return;work.current=true;setBusy(true);setError('');let rejected=false;
 try{
  let value=current.current;
  if(value.phase==='editing'){const payload={...value.payload,message:value.payload.message.trim()};if(!payload.message||payload.message.length>2000||payload.quote.length>1000||payload.replacement.length>1000||payload.replacement&&!payload.quote||payload.quote&&!song.text.includes(payload.quote))throw Error('Write a comment and select the exact lyrics for any suggested correction.');value={...value,payload,phase:'unconfirmed'};}
  await persist(value);if(!alive.current)return;let receipt:unknown;
  try{receipt=await api('/song-comments/'+value.payload.id,{signal:controller.current.signal});}
  catch(e){if(!(e instanceof ApiError)||e.status!==404)throw e;if(!alive.current)return;if(value.phase!=='unconfirmed')throw Error('The accepted comment is unavailable. Its saved copy is kept.');try{receipt=await api('/computers/'+computerId+'/song-comments',{method:'POST',body:JSON.stringify(value.payload),signal:controller.current.signal});}catch(e){rejected=e instanceof ApiError&&[400,403,404,409,413,415].includes(e.status);throw e;}}
  if(!alive.current)return;if(!correctionMatches(value,receipt))throw Error('The confirmation did not match your saved comment. Retry checks the same request.');
  value={...value,phase:'accepted'};await persist(value);if(!alive.current)return;
  if(value.photos.length){let images=(await api<{images:TaskImage[]}>('/tasks/'+value.payload.id+'/images',{signal:controller.current.signal})).images;
   for(const photo of value.photos){if(!alive.current)return;const existing=images.find(image=>image.id===photo.id);if(existing&&!correctionImageMatches(photo,existing))throw Error('The saved image could not be verified. Its local copy is kept.');
    if(!existing){const file=await readCorrectionPhoto(me.id,photo.id),bytes=await file.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');if(file.size!==photo.bytes||digest!==photo.sha256)throw Error('The saved image changed. Its bytes are kept.');if(!alive.current)return;
     try{const result=await api<{image:TaskImage}>('/tasks/'+value.payload.id+'/images/'+photo.id,{method:'PUT',body:file,headers:{'X-Filename':encodeURIComponent(photo.filename),'Content-Type':file.type},signal:controller.current.signal});if(!correctionImageMatches(photo,result.image))throw Error('The image upload was not confirmed.');images.push(result.image);}
     catch(e){if(!alive.current)return;images=(await api<{images:TaskImage[]}>('/tasks/'+value.payload.id+'/images',{signal:controller.current.signal})).images;if(!images.some(row=>correctionImageMatches(photo,row)))throw e;}
    }
    if(!alive.current)return;value={...value,photos:value.photos.map(row=>row.id===photo.id?{...row,confirmed:true}:row)};await persist(value);
   }
  }
  value={...value,phase:'sent'};await persist(value);await archiveCorrection(value);if(alive.current){setStatus('Sent for review.');changed();}
 }catch(e){if(alive.current){if(rejected)await persist({...current.current,phase:'rejected'}).catch(()=>{});setError((e as Error).message+' Your comment and images are kept.');}}
 finally{work.current=false;if(alive.current)setBusy(false);}
 }
 async function startNew(){if(work.current||!['sent','rejected'].includes(current.current.phase))return;try{await archiveCorrection(current.current);await persist(fresh());setError('');setStatus('');}catch{setError('The previous draft is kept. A new draft could not be saved.');}}
 return <div className="shade"><form ref={dialog} className="modal worship-song" onSubmit={send} role="dialog" aria-modal="true" aria-labelledby="song-comment-title">
  <button type="button" className="close" aria-label="Close comment" title="Close comment" disabled={busy} onClick={close}><X size={18}/></button><h2 id="song-comment-title">{song.title}</h2>
  {editable&&<p className="hint">Select lyrics, then use “Include selection” to point out a change.</p>}<div className="worship-song-lyrics" tabIndex={0}>{song.text}</div>
  {editable&&<button type="button" className="button" onClick={()=>{const quote=window.getSelection()?.toString()||'';if(quote&&song.text.includes(quote))edit({quote:quote.slice(0,1000)});}}>Include selection</button>}
  <label>Comment<textarea required maxLength={2000} rows={3} value={draft.payload.message} disabled={!editable} onChange={event=>edit({message:event.target.value})}/></label>
  {draft.payload.quote&&<><label>Selected lyrics<textarea readOnly value={draft.payload.quote}/></label><label>Suggested correction<textarea maxLength={1000} rows={2} value={draft.payload.replacement} disabled={!editable} onChange={event=>edit({replacement:event.target.value})}/></label></>}
  {draft.photos.length>0&&<ul>{draft.photos.map(photo=><li key={photo.id}>{photo.filename}{photo.confirmed?' · Saved':''}</li>)}</ul>}
  <input hidden ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event=>{void attach(Array.from(event.target.files||[]));event.currentTarget.value='';}}/>
  {error&&<p className="inline-error" role="alert">{error}</p>}{(status||draft.phase==='sent')&&<p role="status">{status||'Sent for review.'}</p>}
  <div className="actions">{['sent','rejected'].includes(draft.phase)?<button type="button" className="button primary" aria-label="New comment" title="New comment" onClick={()=>void startNew()}><SquarePen size={20}/></button>:<><button type="button" className="button" aria-label="Add images" title="Add images" disabled={!editable||draft.photos.length>=6} onClick={()=>input.current?.click()}><ImagePlus size={20}/></button><button className="button primary" aria-label={draft.phase==='editing'?'Send comment':'Retry saved comment'} title={draft.phase==='editing'?'Send comment':'Retry saved comment'} disabled={!ready||busy||!draft.payload.message.trim()}><Send size={20}/>{busy?'Sending…':null}</button></>}</div>
 </form></div>;
}
