import {WebSongComment} from './WebSongComment';
import {WebCommenterContext} from './WebCommenterContext';
import {useWorkspaceRevision} from './use-workspace-change';
import {WebSongActions} from './WebSongActions';
import {GroupMaterials} from './GroupMaterials';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {BookOpen,CalendarDays,Monitor,RefreshCw,X,Plus,Copy,Trash2,MessageCircle} from 'lucide-react';
import {api,post,ApiError,type Computer,type Me} from './api';
import {SongLibrary} from '../desktop/SongLibrary';
import {ServicePlans,type ServiceBridge} from '../desktop/ServicePlans';
import type {LibraryEntry,LibraryResult,LibrarySearch,LibrarySong} from '../desktop/song-library-types';
import type {ServicePlan,ServiceVersions} from '../desktop/service-plan-types';
import type {ServiceRequestSnapshot} from '../shared/service-requests-types';
import type {ServiceDeskSnapshot} from '../shared/service-desk-types';
import '../desktop/services.css';
import './worship-workspace.css';

export type SongHeaderActions={status:'online'|'offline'|'blocked';label:string;description:string;refreshing:boolean;refresh:()=>void};
export function WorshipWorkspace({me,computers,registerBeforeLeave,registerHeaderActions,refreshComputers}:{me:Me;computers:Computer[];registerBeforeLeave?:(callback:(()=>Promise<boolean>)|null)=>void;registerHeaderActions?:(actions:SongHeaderActions|null)=>void;refreshComputers?:()=>Promise<void>}){
 const commenter=me.role!=='admin'&&me.ministryRole==='commenter';
 const [area,setArea]=useState<'songs'|'services'|'group-files'>('songs');
 const [computer,setComputer]=useState(computers[0]?.id||''),[switching,setSwitching]=useState(false),beforeLeave=useRef<(()=>Promise<boolean>)|null>(null);
 useEffect(()=>{if(commenter)setArea('songs');},[commenter]);
 const firstComputer=computers[0]?.id;
 useEffect(()=>{if(!computer&&firstComputer)setComputer(firstComputer);},[computer,firstComputer]);
 const register=useCallback((callback:(()=>Promise<boolean>)|null)=>{beforeLeave.current=callback;},[]);
 useEffect(()=>{registerBeforeLeave?.(async()=>beforeLeave.current?beforeLeave.current():true);return()=>registerBeforeLeave?.(null);},[registerBeforeLeave]);
 async function changeComputer(value:string){if(switching)return;setSwitching(true);try{if(beforeLeave.current&&!await beforeLeave.current())return;setComputer(value);}finally{setSwitching(false);}}
 async function changeArea(next:typeof area){if(switching||next===area)return;setSwitching(true);try{if(beforeLeave.current&&!await beforeLeave.current())return;setArea(next);}finally{setSwitching(false);}}
 const target=computers.find(item=>item.id===(computer||firstComputer));
 return <section className="worship-workspace"><div className="worship-heading"><h1>{area==='services'?'Services':area==='group-files'?'Group files':'Library'}</h1>{area!=='group-files'&&<label className="worship-computer"><Monitor size={18} aria-hidden="true"/><span className="song-library-sr">Computer</span><select value={target?.id||''} disabled={switching} onChange={event=>void changeComputer(event.target.value)}><option value="" disabled>Choose a computer</option>{computers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>{!commenter&&<div className="worship-sections" role="group" aria-label="Song workspace">{([['songs',BookOpen,'Songs'],['services',CalendarDays,'Services'],['group-files',BookOpen,'Group files']] as const).map(([id,Icon,label])=><button key={id} className="button" aria-pressed={area===id} disabled={switching} onClick={()=>void changeArea(id)}><Icon size={17}/>{label}</button>)}</div>}{area==='group-files'&&<GroupMaterials me={me}/>}<div hidden={area==='group-files'}>{target?<ComputerWorkspace key={me.id+':'+target.id} page={area==='services'?'services':'songs'} active={area!=='group-files'} computer={target} me={me} commenter={commenter} canPlan={!!me.capabilities?.planServices} canEdit={!!me.capabilities?.editLyrics} registerBeforeLeave={register} registerHeaderActions={registerHeaderActions} refreshComputers={refreshComputers}/>:<p>Connect to a computer and wait for approval to browse its songs.</p>}</div></section>;
}

function ComputerWorkspace({computer,me,commenter,canPlan,canEdit,registerBeforeLeave,registerHeaderActions,page,active,refreshComputers}:{computer:Computer;me:Me;commenter:boolean;canPlan:boolean;canEdit:boolean;page:'songs'|'services';active:boolean;registerBeforeLeave:(callback:(()=>Promise<boolean>)|null)=>void;registerHeaderActions?:(actions:SongHeaderActions|null)=>void;refreshComputers?:()=>Promise<void>}){
 const [songAction,setSongAction]=useState<{song:LibraryEntry;mode:'add'|'clone'|'archive'}|null>(null);const actionChanged=useCallback(()=>setRefreshKey(value=>value+1),[]);
 const [comment,setComment]=useState<LibrarySong|null>(null);
 const [song,setSong]=useState<LibrarySong|null>(null),[error,setError]=useState(''),generation=useRef(0);
 const [refreshKey,setRefreshKey]=useState(0),[checking,setChecking]=useState(false),[snapshot,setSnapshot]=useState<{updatedAt:number|null}|null>(null),[snapshotError,setSnapshotError]=useState<'blocked'|'unavailable'|null>(null);
 const catalogRevision=useWorkspaceRevision('catalog');
 const viewActive=useRef(active&&page==='songs');viewActive.current=active&&page==='songs';
 const searches=useRef(new Map<string,{promise:Promise<LibraryResult>;controller:AbortController}>()),latestSearch=useRef(0),catalogEpoch=useRef(0);
 useEffect(()=>()=>{viewActive.current=false;generation.current++;catalogEpoch.current++;for(const task of searches.current.values())task.controller.abort();searches.current.clear();},[]);
 const bridge=useMemo<ServiceBridge&Pick<Window['stati'],'favoriteSong'>>(()=>({
  searchSongLibrary:(filters:LibrarySearch)=>{
   const query=new URLSearchParams();for(const [name,value] of Object.entries(filters))if(value!==undefined)query.set(name,String(value));query.sort();const key=query.toString(),existing=searches.current.get(key);if(existing)return existing.promise;
   const token=++latestSearch.current,version=catalogEpoch.current,controller=new AbortController();setChecking(true);
   const promise=(async()=>{try{const result=await api<LibraryResult>('/computers/'+computer.id+'/songs?'+key,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if(version===catalogEpoch.current&&token===latestSearch.current){setSnapshot({updatedAt:result.updatedAt||null});setSnapshotError(null);}return result;}catch(failure){if(version===catalogEpoch.current&&token===latestSearch.current)setSnapshotError(failure instanceof ApiError&&failure.status===403?'blocked':'unavailable');throw failure;}finally{searches.current.delete(key);if(version===catalogEpoch.current)setChecking(searches.current.size>0);}})();
   searches.current.set(key,{promise,controller});return promise;
  },
  favoriteSong:async()=>{throw Error('Favorites are managed on the computer.');},
  loadServicePreview:id=>api('/computers/'+computer.id+'/songs/'+id),
  listServicePlans:async()=>(await api<{plans:ServicePlan[]}>('/computers/'+computer.id+'/services')).plans,
  listServiceTemplates:async()=>[],
  listServiceVersions:(id,versionId)=>api<ServiceVersions>('/computers/'+computer.id+'/services/'+id+'/versions'+(versionId?'?versionId='+encodeURIComponent(versionId):'')),
  saveServiceVersion:(id,expectedRevision)=>post<ServiceVersions>('/computers/'+computer.id+'/services/'+id+'/versions',{expectedRevision}),
  listServiceRequests:id=>api<ServiceRequestSnapshot>('/computers/'+computer.id+'/services/'+id+'/requests'),
  changeServiceRequest:(id,action)=>post<ServiceRequestSnapshot>('/computers/'+computer.id+'/services/'+id+'/requests',action),
  listServiceReadiness:id=>api<ServiceDeskSnapshot>('/computers/'+computer.id+'/services/'+id+'/readiness'),
  changeServicePlan:async action=>(await post<{plans:ServicePlan[]}>('/computers/'+computer.id+'/services',action)).plans,
 }),[computer.id]);
 const refresh=useCallback(()=>{if(viewActive.current&&document.visibilityState!=='hidden'&&!searches.current.size)setRefreshKey(value=>value+1);},[page,active]);
 useEffect(()=>{if(!active||page!=='songs')return;const timer=setInterval(refresh,30000),visible=()=>{if(document.visibilityState!=='hidden')refresh();};document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[page,active,refresh]);
 useEffect(()=>{if(catalogRevision)refresh();},[catalogRevision,refresh]);
 async function open(id:string){const token=++generation.current;setError('');try{const result=await api<LibrarySong>('/computers/'+computer.id+'/songs/'+id);if(token===generation.current){if(commenter)setComment(result);else setSong(result);}}catch(failure){if(token===generation.current)setError((failure as Error).message);}}
 const manualRefresh=useCallback(()=>{if(!viewActive.current)return;refresh();void refreshComputers?.();},[refresh,refreshComputers]);
 const online=!!computer.last_seen&&Date.now()/1000-computer.last_seen<45;
 const status=snapshotError==='blocked'?'blocked':online?'online':'offline',label=status==='blocked'?'Blocked':online?'Online':'Offline';
 const description=computer.name+' · '+(status==='blocked'?'Access blocked. Ask your administrator.':snapshot?.updatedAt?'Last synced '+new Date(snapshot.updatedAt*1000).toLocaleString():online?'Checking shared library':'Computer offline. Saved songs stay available.');
 useEffect(()=>{if(!active||page!=='songs'){registerHeaderActions?.(null);return;}registerHeaderActions?.({status,label,description,refreshing:checking,refresh:manualRefresh});return()=>registerHeaderActions?.(null);},[active,page,status,label,description,checking,manualRefresh,registerHeaderActions]);
 return <>
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {commenter&&<WebCommenterContext computerId={computer.id} open={id=>void open(id)}/>}
  <div hidden={page!=='songs'}>
   {!registerHeaderActions&&<div className={'song-header-pill status-'+status} title={description}><span className="song-connection-status" role="status"><span aria-hidden="true"/>Computer {label.toLowerCase()}</span><button type="button" className="header-refresh" title="Refresh songs" aria-label="Refresh songs" disabled={checking} onClick={manualRefresh}><RefreshCw size={17}/></button></div>}
   {snapshotError&&<p className="inline-error" role="status">{snapshotError==='blocked'?'Library access is blocked. Ask your administrator.':'Couldn’t check the shared library. Refresh to try again.'}</p>}
   {snapshot&&!snapshot.updatedAt&&<p className="hint">Open the updated Stați app on this computer to share its Lyrics library. Songs stay available here after it syncs, even when the computer is offline.</p>}
   <SongLibrary renderActions={item=><>{canPlan&&<button type="button" className="button" onClick={()=>setSongAction({song:item,mode:'add'})}><Plus size={17}/>Add to service</button>}{canEdit&&<><button type="button" className="button" onClick={()=>setSongAction({song:item,mode:'clone'})}><Copy size={17}/>Group version</button><button type="button" className="button danger" onClick={()=>setSongAction({song:item,mode:'archive'})}><Trash2 size={17}/>Delete song</button></>}</>} embedded active={active&&page==='songs'} disabled={false} readOnly allowFavorites={false} bridge={bridge} refreshKey={refreshKey} emptyMessage={snapshot&&!snapshot.updatedAt?"Waiting for the computer’s first sync.":undefined} onOpen={open}/>
  </div>
  {!commenter&&<div hidden={page!=='services'}><ServicePlans embedded active={active&&page==='services'} disabled={false} readOnly={!canPlan} bridge={bridge} registerBeforeLeave={registerBeforeLeave}/></div>}
  {songAction&&(songAction.mode==='add'?canPlan:canEdit)&&active&&page==='songs'&&<WebSongActions key={songAction.mode+songAction.song.id} computerId={computer.id} song={songAction.song} mode={songAction.mode} onClose={()=>setSongAction(null)} onChanged={actionChanged}/>}
  {comment&&<WebSongComment key={comment.id} me={me} computerId={computer.id} song={comment} close={()=>setComment(null)} changed={actionChanged}/>}
  {song&&<div className="shade"><section className="modal worship-song" role="dialog" aria-modal="true" aria-labelledby="worship-song-title"><button className="close" aria-label="Close lyrics" onClick={()=>setSong(null)}><X size={18}/></button><h2 id="worship-song-title">{song.title}</h2><p className="worship-song-lyrics">{song.text}</p>{me.capabilities?.commentSongs&&<button className="button" onClick={()=>{setComment(song);setSong(null);}}><MessageCircle size={18}/>Comment</button>}</section></div>}
 </>;
}
