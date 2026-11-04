import {useEffect,useState} from 'react';
import type {WorkspaceChange} from '../shared/workspace-events';
export const WORKSPACE_CHANGED='stati-workspace-changed';
export function publishWorkspaceChange(change:WorkspaceChange){window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED,{detail:change}));}
export function useWorkspaceRevision(domain:WorkspaceChange){
 const [revision,setRevision]=useState(0);
 useEffect(()=>{const receive=(event:Event)=>{const change=(event as CustomEvent<WorkspaceChange>).detail;if(change==='all'||change===domain||domain==='files'&&change==='groups')setRevision(value=>value+1);};window.addEventListener(WORKSPACE_CHANGED,receive);return()=>window.removeEventListener(WORKSPACE_CHANGED,receive);},[domain]);
 return revision;
}
