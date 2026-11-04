import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Prepare} from './prepare';
import {EditorErrorBoundary} from './EditorErrorBoundary';
function snapshot(){return {operator:document.documentElement.dataset.workspaceOperator,section:document.documentElement.dataset.workspaceTab||'station'};}
function StationWorkspace(){
 const [route,setRoute]=useState(snapshot);
 useEffect(()=>{const update=()=>setRoute(snapshot());window.addEventListener('stati-workspace-change',update);update();return()=>window.removeEventListener('stati-workspace-change',update);},[]);
 const active=['prepare','library','services','powerpoint','audio'].includes(route.section);
 // Switching profiles destroys the previous profile's in-memory editor and previews.
 // Navigation keeps its tree mounted so local drafts and service edits survive.
 return route.operator?<EditorErrorBoundary key={route.operator}><div className="desktop-prepare embedded-workspace"><Prepare embedded active={active} section={route.section}/></div></EditorErrorBoundary>:null;
}
const element=document.getElementById('station-workspace-root');if(element)createRoot(element).render(<StationWorkspace/>);
