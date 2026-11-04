import {useEffect,useRef,useState} from 'react';
import {FolderOpen,PackageOpen} from 'lucide-react';
import './service-package-import.css';
export type ServicePackageImportPreview={canceled?:boolean;sessionId?:string;title?:string;date?:string;time?:string;songCount?:number;audioCount?:number;warnings?:string[];missing?:{position:number;title:string;reason:string}[];files?:{kind:'song'|'audio';filename:string;status:'new'|'reuse'|'rename'|'conflict'}[];conflicts?:string[];resuming?:boolean;canImport?:boolean};
export type ServicePackageImportResult={serviceId:string;title:string;songCount:number;audioCount:number;alreadyImported?:boolean;warnings?:string[]};
export type ServicePackageImportBridge={chooseServicePackageImport?:()=>Promise<ServicePackageImportPreview>;importServicePackage?:(sessionId:string)=>Promise<ServicePackageImportResult>;onIdentityRequired?:(callback:(value?:unknown)=>void)=>(()=>void)};
type Props={disabled:boolean;active?:boolean;bridge?:ServicePackageImportBridge;beforeImport?:()=>Promise<boolean>;onImported?:(value:ServicePackageImportResult)=>void|Promise<void>};
export function ServicePackageImport({disabled,active=true,bridge=window.stati,beforeImport,onImported}:Props){
 const epoch=useRef(0),running=useRef(false),flushing=useRef(false),[busy,setBusy]=useState<'choose'|'import'|null>(null),[preview,setPreview]=useState<ServicePackageImportPreview|null>(null),[result,setResult]=useState<ServicePackageImportResult|null>(null),[error,setError]=useState(''),[attempted,setAttempted]=useState(false);
 function reset(){epoch.current++;running.current=false;flushing.current=false;setBusy(null);setPreview(null);setResult(null);setError('');setAttempted(false);}
 useEffect(()=>{reset();let live=true;const unsubscribe=bridge.onIdentityRequired?.(()=>{if(live)reset();});return()=>{live=false;epoch.current++;unsubscribe?.();};},[bridge,active]);
 // Saving this component's open service temporarily disables its parent. Keep
 // that own flush alive; external disabling still fences native late responses.
 useEffect(()=>{if(disabled&&!flushing.current)reset();},[disabled]);
 async function operation(kind:'choose'|'import'){
  if(disabled||!active||running.current)return;if(kind==='choose'&&!bridge.chooseServicePackageImport||kind==='import'&&(!bridge.importServicePackage||!preview?.canImport||!preview.sessionId))return;
  const scope=epoch.current;running.current=true;setBusy(kind);setError('');
  try{
   if(beforeImport){flushing.current=true;let saved;try{saved=await beforeImport();}finally{flushing.current=false;}if(!saved)throw Error('Save your open service changes before importing a package.');}if(scope!==epoch.current)return;
   if(kind==='choose'){const value=await bridge.chooseServicePackageImport!();if(scope===epoch.current&&!value.canceled){setPreview(value);setResult(null);setAttempted(false);}}
   else{setAttempted(true);const value=await bridge.importServicePackage!(preview!.sessionId!);if(scope!==epoch.current)return;setResult(value);setPreview(null);await onImported?.(value);}
  }catch(failure){if(scope===epoch.current)setError((failure as Error).message||'The service package could not be imported.');}
  finally{if(scope===epoch.current){running.current=false;setBusy(null);}}
 }
 if(!bridge.chooseServicePackageImport||!bridge.importServicePackage)return null;
 const locked=disabled||!active||busy!==null;
 return <details className="service-secondary service-package-import"><summary><PackageOpen size={16} aria-hidden="true"/>Import a service package</summary><p>Bring a verified Stați ZIP onto this computer. Existing songs stay saved; the package is checked automatically before import.</p><button type="button" className="button small" disabled={locked} onClick={()=>void operation('choose')}><FolderOpen size={16} aria-hidden="true"/>{busy==='choose'?'Checking package…':'Choose service ZIP'}</button>{error&&<p role="alert" className="inline-error">{error}</p>}
  {preview&&<section className="service-package-import-preview" aria-label="Package import preview"><strong>{preview.title}</strong><p>{preview.date} · {preview.time} · {preview.songCount||0} song file{preview.songCount===1?'':'s'} · {preview.audioCount||0} MP3{preview.audioCount===1?'':'s'}</p>{preview.resuming&&<p role="status">An earlier import was found. Continuing keeps the same service and checks its files again.</p>}{preview.files?.length?<ul aria-label="Files in package">{preview.files.map((file,index)=><li key={file.kind+':'+index}><strong>{file.filename}</strong><span>{file.status==='reuse'?'Reuse matching file':file.status==='rename'?'Keep existing file; add a new name':file.status==='conflict'?'Conflicting native song version':'Add verified file'}</span></li>)}</ul>:null}
   {!!preview.missing?.length&&<ul className="inline-error">{preview.missing.map(item=><li key={item.position}>{item.position}. {item.title}: {item.reason}</li>)}</ul>}{preview.conflicts?.map((conflict,index)=><p className="inline-error" key={'conflict:'+index}>{conflict}</p>)}{preview.warnings?.map((warning,index)=><p key={'warning:'+index}>{warning}</p>)}
   <p>MP3s go to this computer’s Imported Audio folder. Import them into ProPresenter manually. Nothing will play automatically.</p><button type="button" className="button primary small" disabled={locked||!preview.canImport||!preview.sessionId} onClick={()=>void operation('import')}>{busy==='import'?'Importing…':attempted?'Retry import':'Import verified package'}</button>{!preview.canImport&&<p role="status">Resolve the missing files or conflicting song versions, then choose the corrected ZIP.</p>}</section>}
  {result&&<div className="service-package-import-result" role="status"><strong>{result.alreadyImported?'Service already imported':'Service imported'}</strong><p>{result.title} · {result.songCount} song file{result.songCount===1?'':'s'} · {result.audioCount} MP3{result.audioCount===1?'':'s'}</p><p>The service and its songs are available in Services.</p>{result.warnings?.map((warning,index)=><p key={index}>{warning}</p>)}</div>}
 </details>;
}
