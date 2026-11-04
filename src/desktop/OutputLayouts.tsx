import {useEffect,useMemo,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {splitLyrics} from '../shared/slides';
import {buildOutputLayouts,outputLayoutIssues,outputTextFontSize,OUTPUT_LAYOUT_BOUNDS,type OutputProfile} from '../shared/output-layout.js';
import './output-layouts.css';

type Bridge=Pick<Window['stati'],'exportPresentation'|'exportPowerPoint'|'loadOutputTranslations'|'saveOutputTranslations'>;
type TranslationDraft={ownerId:string;source:string;translations:Record<string,string>};
export function OutputLayouts({text,title,fontSize=96,language='auto',disabled=false,onBusy=()=>{},bridge=window.stati}:{text:string;title:string;fontSize?:number;language?:'auto'|'eng'|'ron';disabled?:boolean;onBusy?:(busy:boolean)=>void;bridge?:Bridge}){
 const [translations,setTranslations]=useState<Record<string,string>>({}),[index,setIndex]=useState(0),[format,setFormat]=useState<'pro'|'pptx'>('pro'),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [draftScope,setDraftScope]=useState<{source:string;ownerId:string|null}>({source:text,ownerId:null}),[draftLoading,setDraftLoading]=useState(false),[draftDirty,setDraftDirty]=useState(false),[draftStatus,setDraftStatus]=useState('');
 const pendingDraft=useRef<TranslationDraft|null>(null),sourceScope=useRef(text);sourceScope.current=text;
 const operation=useRef(false),live=useRef(true),busyCallback=useRef(onBusy);busyCallback.current=onBusy;
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 async function persist(snapshot:TranslationDraft){if(!bridge.saveOutputTranslations)return;await bridge.saveOutputTranslations(snapshot);if(pendingDraft.current===snapshot){pendingDraft.current=null;if(live.current&&sourceScope.current===snapshot.source){setDraftDirty(false);setDraftStatus('Translation draft saved privately on this computer.');}}}
 useEffect(()=>{let active=true;setDraftLoading(!!bridge.loadOutputTranslations);setDraftDirty(false);pendingDraft.current=null;
  if(bridge.loadOutputTranslations)void bridge.loadOutputTranslations(text).then(saved=>{if(active){setTranslations(saved.translations);setDraftScope({source:text,ownerId:saved.ownerId});setDraftStatus('Translations restore for these exact source lyrics.');}},failure=>{if(active){setTranslations({});setDraftScope({source:text,ownerId:null});setDraftStatus((failure as Error).message);}}).finally(()=>{if(active)setDraftLoading(false);});
  else{setTranslations({});setDraftScope({source:text,ownerId:null});setDraftStatus('Translation drafts stay in this open view; export them before closing.');}
  return()=>{active=false;const pending=pendingDraft.current;if(pending)void persist(pending).catch(()=>{});};
 },[text,bridge]);
 useEffect(()=>{if(!draftDirty||!draftScope.ownerId||draftScope.source!==text||!bridge.saveOutputTranslations)return;const snapshot={ownerId:draftScope.ownerId,source:text,translations};pendingDraft.current=snapshot;setDraftStatus('Saving translation draft…');const timer=setTimeout(()=>{void persist(snapshot).catch(failure=>{if(live.current&&sourceScope.current===snapshot.source)setDraftStatus((failure as Error).message);});},450);return()=>clearTimeout(timer);},[draftDirty,draftScope,text,translations,bridge]);
 const result=useMemo(()=>{try{return{model:buildOutputLayouts(splitLyrics(text,6),{fontSize,translations:draftScope.source===text?translations:{}}),error:''};}catch(failure){return{model:null,error:(failure as Error).message};}},[text,fontSize,translations,draftScope.source]);
 const model=result.model,current=Math.min(index,Math.max(0,(model?.stream.length||1)-1)),cue=model?.stream[current],translated=cue&&draftScope.source===text?translations[cue.key]||'':'',church=cue?model?.church[cue.churchIndex]:undefined;
 const locked=disabled||working||draftLoading;
 async function exportCopy(profile:OutputProfile){
  if(locked||operation.current||!model?.stream.length)return;operation.current=true;setWorking(true);busyCallback.current(true);setError('');setNotice('');
  try{
   if(pendingDraft.current)await persist(pendingDraft.current);
   const slides=profile==='church'?model.church:profile==='stream-lyrics'?model.stream:model.translation,issues=outputLayoutIssues(slides,profile,fontSize);if(issues.length)throw Error(issues[0]);
   if(profile==='stream-translation'&&model.missingTranslations===model.translation.length)throw Error('Enter a translation for at least one online cue before exporting it.');
   const name=title.trim()||model.church[0]?.text.split('\n')[0]||'Song',data={title:name,songName:name,fontSize,language,linesPerSlide:profile==='church'?6:2,slides:slides.map(slide=>({section:slide.section,text:slide.text})),layoutCopy:profile};
   const saved=await(format==='pro'?bridge.exportPresentation(data):bridge.exportPowerPoint(data));if(!live.current)return;if('canceled' in saved&&saved.canceled)return;
   if(!saved.path||saved.existing)throw Error('A separate output copy could not be confirmed. The source song was kept.');
   setNotice('Separate copy saved: '+saved.path+(profile==='stream-translation'&&model.missingTranslations?' · '+model.missingTranslations+' untranslated cues are blank.':''));
  }catch(failure){if(live.current)setError((failure as Error).message);}
  finally{operation.current=false;busyCallback.current(false);if(live.current)setWorking(false);}
 }
 function overlay(value:string,profile:OutputProfile){const bounds=OUTPUT_LAYOUT_BOUNDS[profile];return <div className={'output-overlay '+profile} style={{left:bounds.x/1920*100+'%',top:bounds.y/1080*100+'%',width:bounds.width/1920*100+'%',height:bounds.height/1080*100+'%',fontSize:outputTextFontSize(value,fontSize,profile)/1920*100+'cqw'}}>{value}</div>;}
 return <details className="output-layouts"><summary>Church & online layouts</summary>
  <p className="muted caption">Preview separate church and online copies. The church copy uses up to six lines; online lyrics use two lines at the top, with your translation below.</p>
  {!model?.stream.length?<p className="muted">Enter or import lyrics to preview the layouts.</p>:<>
   <div className="output-layout-previews"><figure><figcaption>Church · cue {(cue?.churchIndex||0)+1} of {model.church.length}</figcaption><div className="output-layout-frame" aria-label="Church projection preview">{overlay(church?.text||'','church')}</div></figure><figure><figcaption>Online · cue {current+1} of {model.stream.length}</figcaption><div className="output-layout-frame" aria-label="Online lyrics and translation preview"><span className="output-video-placeholder">Video area</span>{overlay(cue?.text||'','stream-lyrics')}{overlay(translated,'stream-translation')}</div></figure></div>
   <div className="output-layout-navigation"><button type="button" className="button small" aria-label="Previous online cue" disabled={locked||current===0} onClick={()=>setIndex(current-1)}><ChevronLeft size={16}/></button><span>{cue?.section} · {current+1} / {model.stream.length}</span><button type="button" className="button small" aria-label="Next online cue" disabled={locked||current===model.stream.length-1} onClick={()=>setIndex(current+1)}><ChevronRight size={16}/></button></div>
   <label>Translation for online cue {current+1}<textarea aria-label={'Translation for online cue '+(current+1)} rows={2} maxLength={10000} value={translated} disabled={locked} onChange={event=>{if(cue)setTranslations(values=>({...values,[cue.key]:event.target.value}));setDraftDirty(true);setNotice('');}} placeholder="Enter your translation · up to two lines"/></label>
   <p className="muted caption">Translations are entered by you and matched to these exact lyrics. Untranslated cues stay blank. </p><p className="muted caption" role="status">{draftLoading?'Opening private translation draft…':draftStatus}</p>
   <div className="output-layout-export"><label>Copy format<select aria-label="Output copy format" value={format} disabled={locked} onChange={event=>setFormat(event.target.value as 'pro'|'pptx')}><option value="pro">ProPresenter</option><option value="pptx">PowerPoint</option></select></label><button type="button" className="button small" disabled={locked} onClick={()=>void exportCopy('church')}>Export church copy</button><button type="button" className="button small" disabled={locked} onClick={()=>void exportCopy('stream-lyrics')}>Export online lyrics copy</button><button type="button" className="button small" disabled={locked||model.missingTranslations===model.translation.length} onClick={()=>void exportCopy('stream-translation')}>Export translation copy</button></div>
   <p className="muted caption">Church and online copies have different cue counts. Online lyrics and translation copies have matching cue counts and advance separately. Test timing and output routing with the presentation team before using them live.</p>
  </>}
  {(error||result.error)&&<p className="inline-error" role="alert">{error||result.error}</p>}{notice&&<p role="status">{notice}</p>}
 </details>;
}
