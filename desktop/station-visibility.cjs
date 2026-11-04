// Device credentials receive the station queue in the trusted main process.
// Files are shared with every explicitly chosen station operator; settings remain admin-only.
function operatorScope(state,identity,generation){
 if(!identity||state.operatorGeneration!==generation||state.device?.operator_id!==identity.id)return null;
 const member=state.members?.find(m=>m.id===identity.id);
 if(!member)return null;
 return {id:member.id,admin:member.role==='admin'&&state.adminUnlocked===true};
}
function visibleFiles(state,identity,generation){
 const scope=operatorScope(state,identity,generation);
 if(!scope)return [];
 return state.transfers||[];
}
function visibleState(state,identity,generation){
 const scope=operatorScope(state,identity,generation);
 return {...state,adminUnlocked:!!scope?.admin,transfers:visibleFiles(state,identity,generation),requests:scope?state.requests:[],accessRequests:scope?state.accessRequests:[]};
}
module.exports={operatorScope,visibleFiles,visibleState};
