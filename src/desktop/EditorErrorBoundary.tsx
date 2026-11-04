import {Component,useEffect,useState,type ReactNode} from 'react';
import {Copy,RotateCcw} from 'lucide-react';
import './editor-recovery.css';

function EditorRecovery(){
 const [draft,setDraft]=useState<string|null>(null),[message,setMessage]=useState('Opening the saved draft…');
 useEffect(()=>{let live=true;void window.stati.loadPrepareDraft().then(saved=>{if(!live)return;setDraft(typeof saved?.draft?.text==='string'?saved.draft.text:'');setMessage(saved?'Your saved draft is available below.':'No editor draft is saved. Your library files are kept in Lyrics.');},()=>{if(live)setMessage('The draft could not be opened. Sign in to your profile and try again.');});return()=>{live=false;};},[]);
 async function copy(){if(!draft)return;try{await navigator.clipboard.writeText(draft);setMessage('Draft copied.');}catch{setMessage('Select the lyrics below and copy them.');}}
 return <main className="editor-recovery"><section className="panel"><h1>Reopen the editor</h1><p>Stați couldn’t display this page. Recover your saved draft before trying again.</p><p role="status">{message}</p>{draft!==null&&<label>Saved lyrics<textarea readOnly value={draft} rows={12}/></label>}<div className="actions"><button type="button" className="button" disabled={!draft} onClick={()=>void copy()}><Copy size={17} aria-hidden="true"/>Copy draft</button><button type="button" className="button primary" onClick={()=>window.location.reload()}><RotateCcw size={17} aria-hidden="true"/>Reopen editor</button></div></section></main>;
}

export class EditorErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return{failed:true};}
 componentDidCatch(error:Error){console.error('Stați editor display failed:',error instanceof Error?error.name:'Error');}
 render(){return this.state.failed?<EditorRecovery/>:this.props.children;}
}
