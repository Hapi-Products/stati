import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Camera,Check,Download,IdCard,LogOut,Monitor,Pencil,ShieldCheck,Trash2,X} from 'lucide-react';
import {api,post,type Computer,type Me} from './api';
import {StationPin} from './AdminUnlock';
import {memberRoleLabel} from './TeamMembers';
import './account.css';

type Props={me:Me|null;computers:Computer[];refresh:()=>Promise<void>;signIn:()=>void;notice:(message:string)=>void;fail:(message:string)=>void;avatar:ReactNode};
export function AccountPage({me,computers,refresh,signIn,notice,fail,avatar}:Props){
 const [first,setFirst]=useState(me?.first_name||''),[last,setLast]=useState(me?.last_initial||''),[busy,setBusy]=useState(false);
 const photo=useRef<HTMLInputElement>(null),profileBase=useRef({id:me?.id,first:me?.first_name||'',last:me?.last_initial||''});
 useEffect(()=>{const previous=profileBase.current,next={id:me?.id,first:me?.first_name||'',last:me?.last_initial||''};if(previous.id!==next.id){setFirst(next.first);setLast(next.last);}else{setFirst(current=>current===previous.first?next.first:current);setLast(current=>current===previous.last?next.last:current);}profileBase.current=next;},[me?.id,me?.first_name,me?.last_initial]);
 const changed=!!me&&(first.trim()!==me.first_name||last.trim().toUpperCase()!==me.last_initial);
 async function save(){if(!changed||busy)return;setBusy(true);try{await api('/me',{method:'PATCH',body:JSON.stringify({firstName:first,lastInitial:last})});await refresh();notice('Profile saved.');}catch(error){fail((error as Error).message);}finally{setBusy(false);}}
 return <section className="account-page"><h1>Account</h1>{me?<>
  <section className="account-profile"><div className="row profile">{avatar}<div><strong>{me.first_name} {me.last_initial}.</strong><small>{me.status==='pending'?'Team membership pending':memberRoleLabel(me)}</small></div><button className="account-icon" title="Change photo" aria-label="Change profile photo" disabled={busy} onClick={()=>photo.current?.click()}><Camera size={19}/></button></div>
   <input ref={photo} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={async event=>{const input=event.currentTarget,file=input.files?.[0];input.value='';if(!file||busy)return;setBusy(true);try{if(file.size>1024*1024)throw Error('Choose a photo smaller than 1 MB.');await api('/me/photo',{method:'PUT',headers:{'X-Filename':file.name},body:file});await refresh();notice('Photo updated.');}catch(error){fail((error as Error).message);}finally{setBusy(false);}}}/>
   <form className="account-name-form" onSubmit={event=>{event.preventDefault();void save();}}><label>First name<input required maxLength={40} disabled={busy} value={first} onChange={event=>setFirst(event.target.value)}/></label><label>Last initial<input required maxLength={1} disabled={busy} value={last} onChange={event=>setLast(event.target.value)}/></label><button className="account-icon account-save" title="Save profile" aria-label="Save profile" disabled={busy||!changed}><Check size={19}/></button></form>
  </section>
  <div className="account-settings">
   {me.role==='admin'&&<StationPin/>}
   {computers.length>0&&<details className="card account-computers"><summary><Monitor size={19}/>Computers <span className="account-count">{computers.length}</span></summary>{computers.map(computer=><AccountComputer key={computer.id} computer={computer} canRename={me.status==='active'&&me.role==='admin'} canDisconnect={me.status==='active'} refresh={refresh} notice={notice} fail={fail}/>)}</details>}
   <details className="card install"><summary><Download size={19}/>Install Stați</summary><div className="account-install-copy"><p>iPhone: Share → Add to Home Screen. Android: browser menu → Install app.</p>{me.role==='admin'&&<TestDownloads/>}<p className="hint">Slide creation is available on the PC.</p></div></details>
  </div>
  <button className="button account-sign-out" onClick={async()=>{await post('/auth/logout');location.assign('/');}}><LogOut size={16}/>Sign out</button>
  <footer className="account-footer"><div className="account-links"><a href="/changelog">What’s new</a><a href="/privacy">Privacy</a></div><details className="account-id"><summary><IdCard size={16}/>Account ID</summary><code>{me.id}</code></details></footer>
 </>:<section className="card empty"><ShieldCheck size={32}/><p>Sign in to manage your profile.</p><button className="button primary" onClick={signIn}>Sign in</button></section>}</section>;
}
function TestDownloads(){
 const [builds,setBuilds]=useState<{id:string;bytes:number;url:string}[]>([]);
 useEffect(()=>{const controller=new AbortController();void api<typeof builds>('/downloads',{signal:controller.signal}).then(setBuilds).catch(()=>{});return()=>controller.abort();},[]);
 if(!builds.length)return null;
 return <><p className="hint">Test builds · device verification is pending. Windows is unsigned; Android uses a development signature.</p><div className="account-downloads">{builds.map(build=><a key={build.id} className="button" href={build.url} download><Download size={16}/>{build.id==='windows-test'?'Windows installer':'Android APK'} · {Math.ceil(build.bytes/1024/1024)} MB</a>)}</div></>;
}
export function AccountComputer({computer,canRename,canDisconnect,refresh,notice,fail}:{computer:Computer;canRename:boolean;canDisconnect:boolean;refresh:()=>Promise<void>;notice:(message:string)=>void;fail:(message:string)=>void}){
 const [mode,setMode]=useState<'view'|'rename'|'disconnect'>('view'),[name,setName]=useState(computer.name),[busy,setBusy]=useState(false);
 useEffect(()=>{if(mode==='view')setName(computer.name);},[computer.name,mode]);
 async function save(){if(busy||!canRename||!name.trim())return;setBusy(true);try{await api('/devices/'+computer.id,{method:'PATCH',body:JSON.stringify({name})});await refresh();setMode('view');notice('Computer renamed.');}catch(error){fail((error as Error).message);}finally{setBusy(false);}}
 async function disconnect(){if(busy||!canDisconnect)return;setBusy(true);try{await post('/devices/'+computer.id+'/disconnect');await refresh();setMode('view');notice('Your access to '+computer.name+' was disconnected.');}catch(error){fail((error as Error).message);}finally{setBusy(false);}}
 return <div className="computer-management"><div className="account-computer-row"><Monitor size={18}/><strong>{computer.name}</strong><div className="account-computer-actions">{canRename&&<button className="account-icon" title="Rename computer" aria-label={'Rename '+computer.name} disabled={busy} onClick={()=>setMode(mode==='rename'?'view':'rename')}><Pencil size={17}/></button>}{canDisconnect&&<button className="account-icon danger" title="Disconnect your access" aria-label={'Disconnect your access to '+computer.name} disabled={busy} onClick={()=>setMode(mode==='disconnect'?'view':'disconnect')}><Trash2 size={17}/></button>}</div></div>
  {mode==='rename'&&canRename&&<form className="account-computer-edit" onSubmit={event=>{event.preventDefault();void save();}}><label><span className="sr-only">Computer name</span><input aria-label="Computer name" required maxLength={60} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label><button className="account-icon" title="Save name" aria-label="Save computer name" disabled={busy||!name.trim()}><Check size={18}/></button><button className="account-icon" title="Cancel" aria-label="Cancel rename" disabled={busy} type="button" onClick={()=>setMode('view')}><X size={18}/></button></form>}
  {mode==='disconnect'&&canDisconnect&&<div className="account-disconnect" role="group" aria-label={'Disconnect '+computer.name}><p>Disconnect your access to {computer.name}? Other people will stay connected. You can scan its code to connect again.</p><div><button className="button small danger" disabled={busy} onClick={()=>void disconnect()}>{busy?'Disconnecting…':'Disconnect'}</button><button className="button small" disabled={busy} onClick={()=>setMode('view')}>Cancel</button></div></div>}
 </div>;
}
