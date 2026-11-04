import {useEffect,useRef,useState} from 'react';
import {History,RotateCcw,X} from 'lucide-react';
import './song-history.css';

export type SongVersion={hash:string;savedAt:number;bytes:number};
export type SongVersionList={songId:string;title:string;currentHash:string;currentText:string;versions:SongVersion[];truncated:boolean};
export type SongVersionPreview={songId:string;title:string;currentHash:string;currentText:string;version:SongVersion&{text:string}};
export type SongRestoreResult={path:string;title:string;contentHash:string};
export type SongHistoryBridge={listSongVersions:(id:string)=>Promise<SongVersionList>;previewSongVersion:(id:string,currentHash:string,versionHash:string)=>Promise<SongVersionPreview>;restoreSongVersion:(id:string,currentHash:string,versionHash:string)=>Promise<SongRestoreResult>};
export function hasSongHistory(bridge:Partial<SongHistoryBridge>):bridge is SongHistoryBridge{return typeof bridge.listSongVersions==='function'&&typeof bridge.previewSongVersion==='function'&&typeof bridge.restoreSongVersion==='function';}
type Props={songId:string;title:string;bridge:SongHistoryBridge;disabled:boolean;onClose:()=>void;onRestored:(id:string,contentHash:string)=>void};
const message=(failure:unknown)=>failure instanceof Error?failure.message:'Song history could not be opened.';

export function SongHistory({songId,title,bridge,disabled,onClose,onRestored}:Props){
 const [history,setHistory]=useState<SongVersionList|null>(null),[preview,setPreview]=useState<SongVersionPreview|null>(null),[busy,setBusy]=useState<'loading'|'preview'|'restore'|null>('loading'),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const epoch=useRef(0),operation=useRef(false),dialog=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{close.current?.focus();},[]);
 useEffect(()=>{const token=++epoch.current;operation.current=true;setHistory(null);setPreview(null);setError('');setNotice('');setBusy('loading');
  if(disabled){operation.current=false;setBusy(null);return;}
  void bridge.listSongVersions(songId).then(value=>{if(epoch.current===token)setHistory(value);},failure=>{if(epoch.current===token)setError(message(failure));}).finally(()=>{if(epoch.current===token){operation.current=false;setBusy(null);}});
  return()=>{epoch.current++;operation.current=false;};
 },[songId,bridge,disabled]);
 async function choose(version:SongVersion){if(disabled||operation.current||!history)return;const token=epoch.current;operation.current=true;setBusy('preview');setPreview(null);setError('');setNotice('');
  try{const value=await bridge.previewSongVersion(songId,history.currentHash,version.hash);if(epoch.current===token)setPreview(value);}catch(failure){if(epoch.current===token)setError(message(failure));}finally{if(epoch.current===token){operation.current=false;setBusy(null);}}
 }
 async function restore(){if(disabled||operation.current||!history||!preview||preview.currentHash!==history.currentHash)return;const token=epoch.current;operation.current=true;setBusy('restore');setError('');setNotice('');
  try{const saved=await bridge.restoreSongVersion(songId,history.currentHash,preview.version.hash);if(epoch.current!==token)return;setPreview(null);setHistory(null);setNotice('Version restored. The previous current version remains in history.');onRestored(songId,saved.contentHash);const next=await bridge.listSongVersions(songId);if(epoch.current===token)setHistory(next);}
  catch(failure){if(epoch.current===token)setError(message(failure));}finally{if(epoch.current===token){operation.current=false;setBusy(null);}}
 }
 function keyDown(event:React.KeyboardEvent){if(event.key==='Escape'&&busy!=='restore'){event.preventDefault();onClose();return;}if(event.key!=='Tab')return;const controls=[...dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),[tabindex="0"]')||[]];if(!controls.length)return;const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
 return <div className="song-history-shade"><section className="song-history" role="dialog" aria-modal="true" aria-labelledby="song-history-title" ref={dialog} onKeyDown={keyDown}>
  <header><div><h2 id="song-history-title"><History size={20} aria-hidden="true"/>Song history</h2><p>{history?.title||title}</p></div><button type="button" className="button" ref={close} aria-label="Close song history" disabled={busy==='restore'} onClick={onClose}><X size={18} aria-hidden="true"/></button></header>
  <p className="song-history-help">Compare an earlier save with the current lyrics before restoring. Your current version will also remain in history.</p>
  {error&&<p role="alert" className="inline-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {busy==='loading'&&<p role="status">Opening saved versions…</p>}
  {history&&<><div className="song-history-versions" aria-label="Saved song versions">{history.versions.length?history.versions.map((version,index)=><button type="button" className="button" key={version.hash} disabled={disabled||!!busy} aria-pressed={preview?.version.hash===version.hash} onClick={()=>void choose(version)}>Earlier save {index+1}<small>{new Date(version.savedAt).toLocaleString()}</small></button>):<p>No earlier saves yet. Editing and saving this song keeps its previous version here.</p>}{history.truncated&&<p>Showing the 100 most recent saved versions. Older copies are preserved.</p>}</div>
   {busy==='preview'&&<p role="status">Verifying the saved version…</p>}
   <div className="song-history-comparison"><section aria-label="Current lyrics"><h3>Current lyrics</h3><pre>{history.currentText||'No lyric text.'}</pre></section><section aria-label="Earlier lyrics"><h3>Earlier lyrics</h3><pre>{preview?.version.text||'Choose an earlier save to compare.'}</pre></section></div>
   <footer><span>{preview?'Restoring keeps this song’s filename and presentation identity.':'Choose and review an earlier save first.'}</span><button type="button" className="button primary" disabled={disabled||!!busy||!preview} onClick={()=>void restore()}><RotateCcw size={17} aria-hidden="true"/>{busy==='restore'?'Restoring…':'Restore this version'}</button></footer>
  </>}
 </section></div>;
}
