"use strict";
// Old installations may retain approval metadata. Output follows the current
// authorized saved service; a history copy never blocks or replaces its edits.
function createApprovedServiceStore({base,current}){
 async function list(stationId){const scope=current();if(!scope||scope.deviceId!==stationId)throw Error('Choose your profile first.');const plans=await base.list(stationId),next=current();if(!next||scope.credential!==next.credential||scope.userId!==next.userId||scope.deviceId!==next.deviceId||scope.generation!==next.generation)throw Error('The selected user changed.');return plans.map(source=>{const plan=structuredClone(source);delete plan.approvedVersionId;delete plan.approvedRevision;return plan;});}
 return{list,change:(...args)=>base.change(...args),isShared:(...args)=>base.isShared(...args),clear:()=>{}};
}
module.exports={createApprovedServiceStore};
