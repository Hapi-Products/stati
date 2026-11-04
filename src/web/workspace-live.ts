import {workspaceChange,type WorkspaceChange} from '../shared/workspace-events';
type LiveSocket={addEventListener(type:string,listener:EventListener):void;removeEventListener(type:string,listener:EventListener):void;close(code?:number,reason?:string):void};
type Visibility=EventTarget&{readonly visibilityState:string};
export function startWorkspaceEvents(notify:(change:WorkspaceChange)=>void,options:{visibility?:Visibility;create?:()=>LiveSocket}={}){
 const visibility=options.visibility??document,create=options.create??(()=>new WebSocket(location.origin.replace(/^http/,'ws')+'/api/tasks/events'));
 let stopped=false,blocked=false,socket:LiveSocket|null=null,retry=0,timer:ReturnType<typeof setTimeout>|undefined,flush:ReturnType<typeof setTimeout>|undefined;
 const pending=new Set<WorkspaceChange>();let detach=()=>{};
 function queue(type:WorkspaceChange){pending.add(type);if(flush)return;flush=setTimeout(()=>{flush=undefined;if(stopped||visibility.visibilityState==='hidden'){pending.clear();return;}const changes=pending.has('all')?['all' as const]:[...pending];pending.clear();for(const change of changes)notify(change);},150);}
 function disconnect(){clearTimeout(timer);timer=undefined;detach();socket?.close(1000,'Workspace paused');socket=null;}
 function connect(){
  if(stopped||blocked||socket||visibility.visibilityState==='hidden')return;
  let current:LiveSocket;try{current=create();}catch{schedule();return;}socket=current;
  const message:EventListener=event=>{if(stopped||socket!==current||!('data'in event)||typeof event.data!=='string'||event.data.length>1024)return;try{const change=workspaceChange(JSON.parse(event.data));if(change){retry=0;queue(change);}}catch{}};
  const closed:EventListener=event=>{if(stopped||socket!==current)return;detach();socket=null;if('code'in event&&event.code===1008){blocked=true;queue('all');return;}schedule();};
  const error:EventListener=()=>{if(socket===current){current.close();closed(new Event('close'));}};
  detach=()=>{current.removeEventListener('message',message);current.removeEventListener('close',closed);current.removeEventListener('error',error);};
  current.addEventListener('message',message);current.addEventListener('close',closed);current.addEventListener('error',error);
 }
 function schedule(){if(stopped||blocked||visibility.visibilityState==='hidden'||timer)return;timer=setTimeout(()=>{timer=undefined;connect();},Math.min(30000,1000*2**Math.min(++retry,5)));}
 const changed=()=>{if(visibility.visibilityState==='hidden'){disconnect();clearTimeout(flush);flush=undefined;pending.clear();}else{blocked=false;connect();}};
 visibility.addEventListener('visibilitychange',changed);connect();
 return()=>{stopped=true;disconnect();clearTimeout(flush);pending.clear();visibility.removeEventListener('visibilitychange',changed);};
}
