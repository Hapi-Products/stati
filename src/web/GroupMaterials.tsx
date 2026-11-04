import {useWorkspaceRevision} from './use-workspace-change';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Download,FileText,RefreshCw,Trash2,Upload} from 'lucide-react';
import {api,type Me} from './api';
import {MAX_GROUP_MATERIAL_BYTES,type GroupMaterial,type GroupMaterialList} from '../shared/group-materials-types';
import './group-materials.css';

const bytesLabel=(bytes:number)=>bytes<1024*1024?Math.ceil(bytes/1024)+' KB':(bytes/1024/1024).toFixed(1)+' MB';
function shareFile(file:File,title:string,groupName:string,signal:AbortSignal,progress:(value:number)=>void){
 return new Promise<void>((resolve,reject)=>{
  const request=new XMLHttpRequest();let finished=false;
  const finish=(error?:Error)=>{if(finished)return;finished=true;signal.removeEventListener('abort',stop);if(error)reject(error);else resolve();};
  const stop=()=>{finish(new DOMException('Sharing stopped. Refresh the library before trying again.','AbortError'));request.abort();};
  signal.addEventListener('abort',stop,{once:true});
  if(signal.aborted){stop();return;}
  const query=new URLSearchParams({title,groupName,filename:file.name});
  request.open('POST','/api/group-materials?'+query);request.timeout=180000;
  request.upload.onprogress=event=>progress(Math.min(file.size,event.loaded));
  request.onerror=()=>finish(new Error('Connection lost. Refresh the library before trying again.'));
  request.ontimeout=()=>finish(new Error('Sharing timed out. Refresh the library before trying again.'));
  request.onabort=()=>finish(new DOMException('Sharing stopped. Refresh the library before trying again.','AbortError'));
  request.onload=()=>{
   let data:{error?:string;ok?:boolean};
   try{data=JSON.parse(request.responseText);}catch{finish(new Error('The sharing result is unclear. Refresh the library before trying again.'));return;}
   if(request.status<200||request.status>=300||!data.ok){finish(new Error(data.error||'The file could not be shared. Refresh and try again.'));return;}
   finish();
  };
  request.send(file);
 });
}
export function GroupMaterials({me}:{me:Me}){
 const [snapshot,setSnapshot]=useState<GroupMaterialList|null>(null),[group,setGroup]=useState(''),[busy,setBusy]=useState(false),[sharing,setSharing]=useState(false),[removing,setRemoving]=useState<string|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [title,setTitle]=useState(''),[groupName,setGroupName]=useState(''),[file,setFile]=useState<File|null>(null),[progress,setProgress]=useState(0);
 const epoch=useRef(0),input=useRef<HTMLInputElement>(null),upload=useRef<AbortController|null>(null);
 useEffect(()=>()=>{epoch.current++;upload.current?.abort();},[]);
 const refresh=useCallback(async(before?:string)=>{
  const version=++epoch.current;setBusy(true);setError('');
  try{
   const query=new URLSearchParams();if(group)query.set('groupName',group);if(before)query.set('before',before);
   const result=await api<GroupMaterialList>('/group-materials?'+query,{signal:AbortSignal.timeout(15000)});
   if(version===epoch.current)setSnapshot(previous=>before&&previous?{...result,materials:[...previous.materials,...result.materials.filter(row=>!previous.materials.some(old=>old.id===row.id))]}:result);
  }catch(failure){if(version===epoch.current)setError((failure as Error).message);}
  finally{if(version===epoch.current)setBusy(false);}
 },[group]);
 const workspaceRevision=useWorkspaceRevision('files');
 useEffect(()=>{setSnapshot(null);void refresh();},[refresh,workspaceRevision]);
 async function share(event:FormEvent){
  event.preventDefault();if(sharing||!file)return;
  if(!file.size||file.size>MAX_GROUP_MATERIAL_BYTES){setError('Choose a non-empty file up to 12 MB.');return;}
  if(!/\.(?:pdf|jpe?g|png|webp)$/i.test(file.name)){setError('Choose a PDF, JPG, PNG or WebP chord sheet or lyric image.');return;}
  if(!title.trim()||!groupName.trim()){setError('Add the song title and group name.');return;}
  const controller=new AbortController();upload.current=controller;setSharing(true);setProgress(0);setError('');setNotice('');
  try{
   await shareFile(file,title.trim(),groupName.trim(),controller.signal,setProgress);
   setFile(null);if(input.current)input.current.value='';setTitle('');
   setNotice('File shared with the approved ministry team.');await refresh();
  }catch(failure){setError((failure as Error).message);}
  finally{upload.current=null;setSharing(false);}
 }
 async function remove(row:GroupMaterial){
  if(removing||sharing||!window.confirm('Remove “'+row.title+'” from shared group files? Everyone on the ministry team will lose access to this shared copy. The original on your device is unchanged.'))return;
  setRemoving(row.id);setError('');setNotice('');
  try{await api('/group-materials/'+row.id,{method:'DELETE'});setNotice('Shared copy removed.');await refresh();}
  catch(failure){setError((failure as Error).message);}
  finally{setRemoving(null);}
 }
 const canUpload=snapshot?.canUpload??!!me.capabilities?.planServices;
 const groups=snapshot?.groups||[],options=group&&!groups.includes(group)?[group,...groups]:groups;
 return <section className="group-materials" aria-label="Shared group files">
  <div className="group-materials-heading"><div><h2>Group files</h2><p>Chord sheets and lyric references shared with the approved ministry team. Group names help you find the right version; they do not restrict who can read it.</p></div><button type="button" className="button" disabled={busy||sharing||!!removing} onClick={()=>void refresh()}><RefreshCw size={17} aria-hidden="true"/>Refresh</button></div>
  {canUpload&&<form className="group-material-upload card" onSubmit={event=>void share(event)}>
   <h3>Share a chord sheet or lyric image</h3>
   <div className="group-material-fields"><label>Song title<input value={title} maxLength={160} required disabled={sharing} onChange={event=>setTitle(event.target.value)}/></label><label>Group name<input value={groupName} maxLength={80} required disabled={sharing} onChange={event=>setGroupName(event.target.value)} placeholder="For example, Jason’s group"/></label></div>
   <label className="group-material-file">File<input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={sharing} required onChange={event=>setFile(event.target.files?.[0]||null)}/></label>
   <p className="hint">PDF, JPG, PNG or WebP · up to 12 MB. Sharing adds a new copy and keeps existing files. Files stay available until the uploader or an administrator removes them.</p>
   {sharing&&<div role="status"><progress max={file?.size||1} value={progress} aria-label="File sharing progress"/><p>{progress===(file?.size||0)?'Upload received; checking and saving…':Math.floor(progress/(file?.size||1)*100)+'% uploaded'}</p></div>}
   <div className="group-material-actions"><button type="submit" className="button primary" disabled={sharing||!file||!title.trim()||!groupName.trim()}><Upload size={17} aria-hidden="true"/>{sharing?'Sharing…':'Share with team'}</button>{sharing&&<button type="button" className="button" onClick={()=>upload.current?.abort()}>Stop sharing</button>}</div>
  </form>}
  <label className="group-material-filter">Group<select value={group} disabled={sharing||!!removing} onChange={event=>{setGroup(event.target.value);setNotice('');}}><option value="">All groups</option>{options.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
  {error&&<p role="alert" className="inline-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {busy&&!snapshot&&<p role="status">Loading shared files…</p>}
  {snapshot&&!snapshot.materials.length&&<p className="group-material-empty">{group?'No shared files for this group yet.':'No shared group files yet.'}</p>}
  <div className="group-material-grid">{snapshot?.materials.map(row=><article className="group-material-card card" key={row.id}>
   {!row.removalPending&&row.contentType.startsWith('image/')?<a className="group-material-preview" href={row.fileUrl} target="_blank" rel="noopener noreferrer" aria-label={'View '+row.title}><img src={row.fileUrl} alt={row.title+' · '+row.groupName} loading="lazy"/></a>:<div className="group-material-preview group-material-document"><FileText size={38} aria-hidden="true"/><span>{row.removalPending?'Removal pending':'PDF'}</span></div>}
   <div className="group-material-caption"><h3>{row.title}</h3><p>{row.groupName}</p><small>{row.filename} · {bytesLabel(row.bytes)}</small><small>Shared by {row.authorName} · {new Date(row.createdAt*1000).toLocaleDateString()}</small></div>
   <div className="group-material-actions">{!row.removalPending&&<><a className="button" href={row.fileUrl} target="_blank" rel="noopener noreferrer">View</a><a className="button" href={row.downloadUrl}><Download size={16} aria-hidden="true"/>Download</a></>}{row.canDelete&&<button type="button" className="button" disabled={!!removing||sharing} onClick={()=>void remove(row)}><Trash2 size={16} aria-hidden="true"/>{removing===row.id?'Removing…':row.removalPending?'Retry removal':'Remove'}</button>}</div>
  </article>)}</div>
  {snapshot?.nextCursor&&<button type="button" className="button" disabled={busy||sharing||!!removing} onClick={()=>void refresh(snapshot.nextCursor!)}>{busy?'Loading…':'Load more files'}</button>}
 </section>;
}
