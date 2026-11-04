import {useEffect,useState} from 'react';
import {MessageCircle,Music2} from 'lucide-react';
import {api} from './api';
import {useWorkspaceRevision} from './use-workspace-change';
type Context={items:{id:string;title:string;message:string;status:string}[];service:{title:string;songs:{id:string;songId:string;title:string}[]}|null};
export function WebCommenterContext({computerId,open}:{computerId:string;open:(id:string)=>void}){
 const [context,setContext]=useState<Context|null>(null),[error,setError]=useState('');
 const tasks=useWorkspaceRevision('tasks'),services=useWorkspaceRevision('services');
 useEffect(()=>{const controller=new AbortController();void api<Context>('/computers/'+computerId+'/song-comments',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setContext(value);setError('');}},e=>{if(!controller.signal.aborted){setContext(null);setError(e.message);}});return()=>controller.abort();},[computerId,tasks,services]);
 return <section className="song-comment-context" aria-label="Song comments">
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {context?.service&&<><h2>{context.service.title}</h2><p className="hint">Current service</p><div className="song-comment-service">{context.service.songs.map(song=><button className="button" key={song.id} onClick={()=>open(song.songId)}><Music2 size={18}/>{song.title}</button>)}</div></>}
  {!!context?.items.length&&<details><summary>Your comments · {context.items.length}</summary><ul>{context.items.map(item=><li key={item.id}><MessageCircle size={18} aria-hidden="true"/><div><strong>{item.title.replace(/^Song: /,'')}</strong><p>{item.message}</p><small>{item.status==='complete'?'Reviewed':item.status==='in-progress'?'In review':'Sent'}</small></div></li>)}</ul></details>}
 </section>;
}
