import type {ServicePlan,ServiceLeadershipAction} from './service-plan-types';

export function ServiceLeadership({plan,disabled,onChange,compact=false,actionsOnly=false}:{plan:ServicePlan;disabled:boolean;onChange:(action:ServiceLeadershipAction)=>void;compact?:boolean;actionsOnly?:boolean}){
 const state=plan.leadership;if(!state)return null;
 const finalized=state.finalizedRevision===plan.revision,acknowledged=state.acknowledgedRevision===plan.revision;
 function act(type:ServiceLeadershipAction['type'],takeOver=false){onChange({type,id:plan.id,expectedRevision:plan.revision||1,expectedLeadershipRevision:state!.revision,...(takeOver?{takeOver:true}:{})});}
 if(actionsOnly)return <div className="service-leader-actions">{state.canClaim&&<button type="button" className="button small" disabled={disabled} onClick={()=>act('claim-leadership')}>Lead service</button>}{state.canTakeOver&&<button type="button" className="button small" disabled={disabled} onClick={()=>act('claim-leadership',true)}>Take over</button>}{state.isLeader&&!plan.archived&&<button type="button" className="button small" disabled={disabled} onClick={()=>act('release-leadership')}>Leave service</button>}</div>;
 return <section className="service-leadership" aria-label={'Service leadership: '+plan.title}>
  <p className={state.leaderId?'muted caption':'service-leader-missing'} role="status">{state.leaderId?'Service leader: '+state.leaderLabel:'No service leader selected'}{state.isLeader?' · You are leading':''}</p>
  {!compact&&<>
   {(finalized||state.finalizedRevision)&&<p className="muted caption" role="status">{finalized?'Running order finalized':state.finalizedRevision?'Running order changed · leader needs to finalize again':'Running order has not been finalized'}{acknowledged?' · Presentation computer acknowledged this version':finalized?' · Waiting for computer acknowledgement':''}</p>}
   {state.isLeader&&!plan.archived&&<div className="service-plan-actions"><button type="button" className="button small" disabled={disabled||finalized} onClick={()=>act('finalize-order')}>Finalize running order</button></div>}
   {state.canAcknowledge&&<button type="button" className="button small" disabled={disabled} onClick={()=>act('acknowledge-order')}>Acknowledge this order</button>}
  </>}
 </section>;
}
