import {useEffect,useRef,useState} from 'react';
import type {ServicePlan} from './service-plan-types';
import {servicesChanged,useServiceSummary} from './service-summary';

export function ServiceTarget({active,disabled,onBusy}:{active:boolean;disabled:boolean;onBusy?:(busy:boolean)=>void}){
 const [plans,setPlans]=useState<ServicePlan[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[summaryError,setSummaryError]=useState('');
 const mounted=useRef(true),changing=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useServiceSummary(active&&!disabled,plans=>{setPlans(plans);setLoaded(true);},setSummaryError);
 async function select(id:string){
  if(changing.current)return;changing.current=true;setBusy(true);setError('');onBusy?.(true);
  try{const result=await window.stati.changeServicePlan({type:'select',id:id||null});if(mounted.current){setPlans(result);setLoaded(true);}servicesChanged();}
  catch(error){if(mounted.current)setError((error as Error).message);}
  finally{changing.current=false;if(mounted.current)setBusy(false);onBusy?.(false);}
 }
 const selected=plans.find(plan=>plan.active&&!plan.archived);
 return <section aria-label="New song destination">
  <div className="library-filters"><label>Add new songs to<select aria-label="Add new songs to" value={selected?.id||''} disabled={disabled||busy||!loaded} onChange={event=>void select(event.target.value)}><option value="">None · Lyrics only</option>{plans.filter(plan=>!plan.archived).map(plan=><option key={plan.id} value={plan.id}>{plan.title} · {plan.date} {plan.time}</option>)}</select></label><p className="muted caption" role="status">{!loaded?'Loading service destination…':selected?<>{selected.playlist?.message||'New songs will be added to this service.'}</>:'New songs stay in Lyrics. Create a service in Services when you need a playlist.'}</p></div>
  {error&&<p className="inline-error" role="alert">{error}</p>}{summaryError&&<p className="inline-error" role="alert">{summaryError}</p>}
 </section>;
}
