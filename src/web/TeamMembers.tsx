import React,{useState} from 'react';
import {Check,ShieldMinus,ShieldPlus,Trash2,UserRoundPen} from 'lucide-react';
import {api,type Me,type Member,type MinistryRole} from './api';
import './team-roles.css';

const roleNames:Record<MinistryRole,string>={worship_leader:'Worship leader',worship_member:'Worship member',pastor:'Pastor',choir_director:'Choir director',commenter:'Commenter'};
const worshipRole=(role:MinistryRole|null|undefined)=>role==='worship_leader'||role==='worship_member';
export function memberRoleLabel(member:Pick<Member,'role'|'ministryRole'>){return member.role==='admin'?'Administrator':member.ministryRole?roleNames[member.ministryRole]:'Member';}

export default function TeamMembers({me,members,refresh,notice,fail,avatar}:{me:Me;members:Member[];refresh:()=>Promise<void>;notice:(text:string)=>void;fail:(text:string)=>void;avatar:(member:Member)=>React.ReactNode}){
 const [busy,setBusy]=useState<string|null>(null),admin=me.role==='admin',leader=me.ministryRole==='worship_leader';
 async function change(member:Member,action:string,ministryRole?:MinistryRole|null){
  if(busy)return;setBusy(member.id);
  try{await api('/members/'+member.id,{method:'PATCH',body:JSON.stringify({action,...(ministryRole!==undefined?{ministryRole}:{})})});await refresh();notice(action==='approve'?'Member approved.':'Member updated.');}catch(error){fail((error as Error).message);}finally{setBusy(null);}
 }
 return <section className="card team-list">
  {leader&&!admin&&<p className="hint">You can approve worship members and assign worship roles. Administrators manage other roles.</p>}
  {members.map(member=>{
   const own=member.id===me.id,canManage=!own&&(admin||leader&&member.role==='member'&&(!member.ministryRole||worshipRole(member.ministryRole))),person=member.first_name+' '+member.last_initial+'.';
   const options=(admin?Object.keys(roleNames):['worship_leader','worship_member']) as MinistryRole[];
   return <div className="row team-member-card" key={member.id}>
    {avatar(member)}<div className="team-member-identity"><strong>{person}</strong><small>{member.status==='pending'?'Waiting for approval · ':''}{memberRoleLabel(member)}</small></div>
    {canManage&&<div className="team-member-controls">
     <label className="sr-only" htmlFor={'ministry-'+member.id}>Role for {person}</label>
     <span className={'team-role-picker'+(busy!==null?' is-disabled':'')} title={'Change role for '+person+' · '+memberRoleLabel(member)}>
      <UserRoundPen size={19} aria-hidden="true"/>
      <select id={'ministry-'+member.id} aria-label={'Change role for '+person} value={member.ministryRole||''} disabled={busy!==null} onChange={event=>void change(member,'assign-role',(event.target.value||null) as MinistryRole|null)}>
      <option value="" disabled={!admin}>{admin?'Member':'Choose worship role'}</option>{options.map(role=><option value={role} key={role}>{roleNames[role]}</option>)}
      </select>
     </span>
     <div className="member-actions">
      {member.status==='pending'&&<button className="team-action" title={admin?'Approve member':'Approve worship member'} aria-label={'Approve '+person} disabled={busy!==null} onClick={()=>void change(member,'approve',admin?undefined:member.ministryRole||'worship_member')}><Check size={19}/></button>}
      {admin&&member.status==='active'&&<button className="team-action" title={member.role==='admin'?'Make member':'Make administrator'} aria-label={(member.role==='admin'?'Make member: ':'Make administrator: ')+person} disabled={busy!==null} onClick={()=>void change(member,member.role==='admin'?'demote':'promote')}>{member.role==='admin'?<ShieldMinus size={19}/>:<ShieldPlus size={19}/>}</button>}
      {admin&&<button className="team-action danger" title="Remove member" aria-label={'Remove '+person} disabled={busy!==null} onClick={()=>{if(confirm('Remove '+person+'?'))void change(member,'remove');}}><Trash2 size={19}/></button>}
     </div>
    </div>}
   </div>;
  })}
 </section>;
}
