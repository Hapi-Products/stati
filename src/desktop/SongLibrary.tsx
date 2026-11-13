import {useEffect,useRef,useState} from 'react';
import {BookOpen,Copy,ChevronLeft,ChevronRight,Eye,FolderOpen,History,MoreHorizontal,X,LayoutGrid,List,PenLine,RefreshCw,Search,SlidersHorizontal,Star,Trash2} from 'lucide-react';
import {lyricFontSize} from '../shared/lyric-layout.js';
import type {LibrarySyncStatus} from './bridge';
import type {LibraryEntry,LibraryResult,LibrarySearch} from './song-library-types';
import './song-library.css';
import {hasSongHistory,SongHistory,type SongHistoryBridge} from './SongHistory';

type LibraryBridge=Pick<Window['stati'],'searchSongLibrary'|'favoriteSong'>&Partial<Pick<Window['stati'],'librarySyncStatus'|'rescanSongLibrary'|'chooseSongLibraryFolder'|'cloneLibrarySong'|'librarySongInfo'|'openSongArchive'>>&Partial<SongHistoryBridge>;
type Props={renderActions?:(song:LibraryEntry)=>React.ReactNode;bridge?:LibraryBridge;active?:boolean;refreshKey?:number;emptyMessage?:string;disabled:boolean;readOnly?:boolean;allowFavorites?:boolean;onOpen:(id:string)=>Promise<void>;embedded?:boolean;beforeHistory?:()=>Promise<boolean>;onRestored?:(id:string,contentHash:string)=>void};
function FirstSlide({song}:{song:LibraryEntry}){
 const text=song.firstSlide??song.lyricPreview??song.firstLine;
 return <div className="library-slide-preview" role="img" aria-label={'First slide: '+song.title}>
  {text?<p style={{fontSize:(lyricFontSize(text,song.fontSize)/19.2)+'cqw'}}>{text}</p>:<span>Preview unavailable</span>}
 </div>;
}
export function SongLibrary({bridge=window.stati,disabled,onOpen,readOnly=false,allowFavorites=true,embedded=false,active=true,refreshKey=0,emptyMessage,beforeHistory,onRestored,renderActions}:Props){
 const [query,setQuery]=useState(''),[groupName,setGroupName]=useState(''),[favoritesOnly,setFavoritesOnly]=useState(false);
 const [view,setView]=useState<'list'|'grid'>('list'),[result,setResult]=useState<LibraryResult|null>(null),[applied,setApplied]=useState(''),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0),[searching,setSearching]=useState(false),[action,setAction]=useState<string|null>(null),[error,setError]=useState('');
 const [sync,setSync]=useState<LibrarySyncStatus|null>(null),[syncBusy,setSyncBusy]=useState(false);
 const [historySong,setHistorySong]=useState<LibraryEntry|null>(null);
 const [versionSong,setVersionSong]=useState<LibraryEntry|null>(null),[versionGroup,setVersionGroup]=useState(''),[notice,setNotice]=useState('');
 const request=useRef(0),scope=useRef(0),mounted=useRef(false);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const filters:LibrarySearch={query,language:'all',category:'',groupName,favoritesOnly},key=JSON.stringify(filters),latestKey=useRef(key);latestKey.current=key;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current++;scope.current++;};},[]);
 useEffect(()=>{scope.current++;setAction(null);setHistorySong(null);setVersionSong(null);setVersionGroup('');setNotice('');},[active,disabled,readOnly,bridge]);
 useEffect(()=>{
  const token=++request.current;let live=true;
  if(!active||disabled){setSearching(false);return;}
  setSearching(true);setError('');
  const search=()=>{
   void bridge.searchSongLibrary({...filters,offset}).then(value=>{
    if(live&&token===request.current&&key===latestKey.current){setResult(value);setApplied(key);}
   },failure=>{if(live&&token===request.current&&key===latestKey.current)setError(failure instanceof Error?failure.message:'Songs could not be loaded.');})
    .finally(()=>{if(live&&token===request.current)setSearching(false);});
  };
  const timer=query?setTimeout(search,180):null;if(!query)search();
  return()=>{live=false;if(timer!==null)clearTimeout(timer);};
 },[active,disabled,refreshKey,key,offset,refresh,bridge]);
 useEffect(()=>{
  let live=true,reading=false;setSync(null);setSyncBusy(false);
  if(!bridge.librarySyncStatus||!active||disabled||readOnly)return;
  async function read(){if(reading||document.visibilityState==='hidden')return;reading=true;try{const value=await bridge.librarySyncStatus!();if(live)setSync(value);}catch(failure){if(live)setSync({state:'error',updatedAt:null,songCount:0,error:failure instanceof Error?failure.message:'Song sharing is unavailable.'});}finally{reading=false;}}
  void read();const timer=setInterval(()=>void read(),30000);return()=>{live=false;clearInterval(timer);};
 },[bridge,active,disabled,refreshKey,readOnly]);
 async function rescan(chooseFolder=false){
  const change=chooseFolder?bridge.chooseSongLibraryFolder:bridge.rescanSongLibrary;
  if(disabled||readOnly||syncBusy||!change)return;const generation=scope.current;setSyncBusy(true);
  try{const value=await change();if(value&&mounted.current&&generation===scope.current){setSync(value);setOffset(0);setRefresh(value=>value+1);}}
  catch(failure){if(mounted.current&&generation===scope.current)setSync(current=>({state:'error',updatedAt:current?.updatedAt||null,songCount:current?.songCount||0,error:failure instanceof Error?failure.message:'Could not share songs. The last shared library has been kept.'}));}
  finally{if(mounted.current&&generation===scope.current)setSyncBusy(false);}
 }
 async function favorite(song:LibraryEntry){
  if(disabled||action)return;const generation=scope.current,requestKey=key;
  setAction(song.id);setError('');
  try{
   await bridge.favoriteSong(song.id,!song.favorite);
   if(!mounted.current||generation!==scope.current)return;
   setResult(current=>current?{...current,items:current.items.map(item=>item.id===song.id?{...item,favorite:!song.favorite}:item)}:current);
   if(requestKey===latestKey.current&&favoritesOnly&&result?.items.length===1)setOffset(value=>Math.max(0,value-50));
   setRefresh(value=>value+1);
  }catch(failure){if(mounted.current&&generation===scope.current)setError(failure instanceof Error?failure.message:'The favorite could not be saved.');}
  finally{if(mounted.current&&generation===scope.current)setAction(null);}
 }
 async function open(id:string){
  if(disabled||action)return;const generation=scope.current;setAction(id);setError('');
  try{await onOpen(id);}catch(failure){if(mounted.current&&generation===scope.current)setError(failure instanceof Error?failure.message:'This song could not be opened.');}
  finally{if(mounted.current&&generation===scope.current)setAction(null);}
 }
 async function history(song:LibraryEntry){
  if(disabled||readOnly||action||!hasSongHistory(bridge))return;const generation=scope.current;setAction(song.id);setError('');
  try{if(beforeHistory&&!await beforeHistory())return;if(mounted.current&&generation===scope.current)setHistorySong(song);}
  catch(failure){if(mounted.current&&generation===scope.current)setError(failure instanceof Error?failure.message:'Finish saving this song before opening its history.');}
  finally{if(mounted.current&&generation===scope.current)setAction(null);}
 }
 async function createVersion(event:React.FormEvent){
  event.preventDefault();if(disabled||readOnly||action||!versionSong||!bridge.cloneLibrarySong)return;
  const song=versionSong,generation=scope.current;setAction(song.id);setError('');setNotice('');
  try{
   if(beforeHistory&&!await beforeHistory())return;
   if(!mounted.current||generation!==scope.current)return;
   const current=bridge.librarySongInfo?await bridge.librarySongInfo(song.id):song;
   if(!mounted.current||generation!==scope.current)return;
   const saved=await bridge.cloneLibrarySong(song.id,current.contentHash,versionGroup);
   if(!mounted.current||generation!==scope.current)return;
   setVersionSong(null);setVersionGroup('');setNotice('Created '+saved.title+'. The original song was kept.');setRefresh(value=>value+1);
   await onOpen(saved.id);
  }catch(failure){if(mounted.current&&generation===scope.current)setError(failure instanceof Error?failure.message:'The group version could not be created.');}
  finally{if(mounted.current&&generation===scope.current)setAction(null);}
 }
 const locked=disabled||!!action,filtersChanged=key!==applied;
 const selectedSong=result?.items.find(song=>song.id===selectedId);
 const content=<>
  <div className="song-library-toolbar">
   <label className="song-library-search"><Search size={18} aria-hidden="true"/><span className="song-library-sr">Search songs</span><input type="search" value={query} maxLength={200} placeholder="Search titles or lyrics" disabled={disabled} onChange={event=>{setQuery(event.target.value);setOffset(0);setSelectedId(null);}}/></label>
   <label className="song-library-version"><span className="song-library-sr">Version</span><select aria-label="Version" value={groupName} disabled={disabled} onChange={event=>{setGroupName(event.target.value);setOffset(0);setSelectedId(null);}}><option value="">All versions</option><option value="__generic__">Original songs</option>{result?.groups?.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
   {allowFavorites&&<button type="button" className="button library-icon" title="Favorites only" aria-label="Favorites only" aria-pressed={favoritesOnly} disabled={disabled} onClick={()=>{setFavoritesOnly(value=>!value);setOffset(0);}}><Star size={17} aria-hidden="true" fill={favoritesOnly?'currentColor':'none'}/></button>}
   {!readOnly&&bridge.openSongArchive&&<button type="button" className="button library-icon" title="Deleted songs · open recovery archive" aria-label="Open deleted song archive" disabled={locked} onClick={()=>void bridge.openSongArchive!().catch(failure=>setError(failure.message))}><Trash2 size={17}/></button>}
   <div className="song-library-views" role="group" aria-label="Song layout"><button type="button" className="button library-icon" title="List" aria-label="List" aria-pressed={view==='list'} onClick={()=>setView('list')}><List size={17} aria-hidden="true"/></button><button type="button" className="button library-icon" title="Grid" aria-label="Grid" aria-pressed={view==='grid'} onClick={()=>setView('grid')}><LayoutGrid size={17} aria-hidden="true"/></button></div>
  </div>
  {!readOnly&&bridge.rescanSongLibrary&&<div className="song-library-sync"><span className={'library-sync-pill '+(sync?.state==='error'?'is-error':'')} role={sync?.state==='error'?'alert':'status'} title={sync?.state==='error'?sync.error||'Sharing needs attention':sync?.updatedAt?'Last shared '+new Date(sync.updatedAt).toLocaleString():'Share this library to make it available on phones'}><i aria-hidden="true"/>{sync?.state==='error'?sync.error||'Sharing needs attention':syncBusy||sync?.state==='syncing'?'Sharing…':sync?.updatedAt?(sync.songCount===null?'Songs':sync.songCount+' songs')+' shared':'Not shared yet'}</span><button type="button" className="button library-icon" title="Share songs with phones" aria-label="Share songs with phones" disabled={disabled||syncBusy||sync?.state==='syncing'} onClick={()=>void rescan()}><RefreshCw size={16} aria-hidden="true"/></button></div>}
  {!readOnly&&bridge.chooseSongLibraryFolder&&<button type="button" className="button" disabled={locked||syncBusy} onClick={()=>void rescan(true)}>
   <FolderOpen size={17} aria-hidden="true"/>Choose library folder
  </button>}
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {versionSong&&active&&!disabled&&!readOnly&&bridge.cloneLibrarySong&&<section className="song-version-dialog panel" role="dialog" aria-label="Create a group version"><h3>Create a group version</h3><p>Copy {versionSong.title} before changing a person or group’s arrangement. The original song stays as it is.</p><form onSubmit={event=>void createVersion(event)}><label>Person or group<input type="text" value={versionGroup} maxLength={80} required disabled={!!action} onChange={event=>setVersionGroup(event.target.value)}/></label><div><button className="button primary" disabled={locked||!versionGroup.trim()}>Create and edit copy</button><button type="button" className="button" disabled={!!action} onClick={()=>setVersionSong(null)}>Cancel</button></div></form></section>}
  <p className="song-library-count muted caption" role="status">{searching?'Searching…':result?(!result.total&&emptyMessage?emptyMessage:result.total+' matching song'+(result.total===1?'':'s')):'Your songs will appear here.'}</p>
  {result&&<>
   {result.unreadable>0&&<p className="inline-error">{result.unreadable} files could not be read. Results are incomplete. {result.warnings.join(', ')}</p>}
   <div className="library-browser">
   <div className={'library-results song-library-results song-library-'+view} aria-busy={searching}>
    {result.items.map(song=><article key={song.id} className={'library-song song-library-card'+(selectedId===song.id?' is-selected':'')}>
     <button type="button" className="song-select" aria-label={'Preview: '+song.title} aria-pressed={selectedId===song.id} disabled={disabled} onClick={()=>setSelectedId(selectedId===song.id?null:song.id)}>
      <FirstSlide song={song}/><span className="song-library-info"><strong>{song.title}</strong><small>{song.groupName?song.groupName+' version':'Original song'}</small>{query&&song.lyricPreview&&song.lyricPreview!==song.firstSlide&&<span className="library-lyric-preview song-library-match">{song.lyricPreview}</span>}</span>
     </button>
     <details className="song-action-menu"><summary title={'Actions: '+song.title} aria-label={'Actions: '+song.title}><MoreHorizontal size={18} aria-hidden="true"/></summary><div className="song-library-actions">{renderActions?.(song)}
      {allowFavorites&&<button type="button" className="button" disabled={locked} title={song.favorite?'Remove favorite':'Favorite song'} aria-label={(song.favorite?'Remove favorite: ':'Favorite: ')+song.title} aria-pressed={song.favorite} onClick={()=>void favorite(song)}><Star size={17} aria-hidden="true" fill={song.favorite?'currentColor':'none'}/>{song.favorite?'Remove favorite':'Favorite'}</button>}
      {!readOnly&&bridge.cloneLibrarySong&&/\.(pro|txt)$/i.test(song.filename)&&<button type="button" className="button" disabled={locked} title="Create a separate group arrangement" aria-label={'Create group version: '+song.title} onClick={()=>{setVersionSong(song);setVersionGroup('');setError('');setNotice('');}}><Copy size={17} aria-hidden="true"/>Group version</button>}
      {!readOnly&&hasSongHistory(bridge)&&/\.(pro|txt)$/i.test(song.filename)&&<button type="button" className="button" disabled={locked} aria-label={'Version history: '+song.title} onClick={()=>void history(song)}><History size={17} aria-hidden="true"/>History</button>}
      <button type="button" className="button" disabled={locked||!song.editable} onClick={()=>void open(song.id)}>{readOnly?<Eye size={17} aria-hidden="true"/>:<PenLine size={17} aria-hidden="true"/>}{readOnly?'View lyrics':'Edit lyrics'}</button>
     </div></details>
    </article>)}
    {!result.items.length&&!emptyMessage&&<p className="library-empty">No songs match. Try another title or version.</p>}
   </div>
   <aside className={'library-context'+(selectedSong?' has-selection':'')} aria-label="Selected song">{selectedSong?<>
    <div className="library-context-heading"><h3>{selectedSong.title}</h3><button type="button" className="button library-icon" title="Close preview" aria-label="Close preview" onClick={()=>setSelectedId(null)}><X size={17}/></button></div>
    <FirstSlide song={selectedSong}/><p className="library-context-meta">{selectedSong.groupName?selectedSong.groupName+' version':'Original song'}</p>
    <button type="button" className="button primary" disabled={locked||!selectedSong.editable} onClick={()=>void open(selectedSong.id)}>{readOnly?<Eye size={17} aria-hidden="true"/>:<PenLine size={17} aria-hidden="true"/>}{readOnly?'View lyrics':'Open song'}</button>
    <p className="muted">Group arrangements stay separate from the original.</p>
   </>:<div className="library-context-empty"><BookOpen size={25} aria-hidden="true"/><h3>Choose a song</h3><p>Preview its opening slide, then open the lyrics or use its actions menu.</p></div>}</aside>
   </div>
   {result.total>50&&<div className="song-library-pagination"><button type="button" className="button small" disabled={locked||searching||filtersChanged||result.offset===0} onClick={()=>setOffset(Math.max(0,result.offset-50))}><ChevronLeft size={16} aria-hidden="true"/>Previous</button><span>{result.total?result.offset+1:0}–{Math.min(result.offset+50,result.total)} of {result.total}</span><button type="button" className="button small" disabled={locked||searching||filtersChanged||result.offset+50>=result.total} onClick={()=>setOffset(result.offset+50)}>Next<ChevronRight size={16} aria-hidden="true"/></button></div>}
  </>}
  {historySong&&active&&!disabled&&!readOnly&&hasSongHistory(bridge)&&<SongHistory songId={historySong.id} title={historySong.title} bridge={bridge} disabled={disabled} onClose={()=>setHistorySong(null)} onRestored={(id,contentHash)=>{setRefresh(value=>value+1);onRestored?.(id,contentHash);}}/>}
 </>;
 return embedded?<section className="panel song-library" aria-label="Song library">{content}</section>:<details className="panel song-library"><summary><BookOpen size={18} aria-hidden="true"/>Song library</summary>{content}</details>;
}
