import schedule from './service-schedule.json';
// Phoenix remains UTC-07:00. Inspect adjacent days so windows survive midnight.
function scheduleEnd(at:Date,bufferMinutes:number){
 const local=new Date(at.getTime()-7*3600000),time=at.getTime();let ending:number|null=null;
 for(let offset=-1;offset<=1;offset++){
  const day=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+offset));
  for(const service of schedule.services){if(service.day!==day.getUTCDay())continue;const start=day.getTime()+7*3600000+(service.hour*60+service.minute)*60000;const end=start+schedule.durationMinutes*60000;
   const buffer=bufferMinutes*60000;
   if(time>=start-buffer&&time<end+buffer)ending=Math.max(ending||0,end+buffer);
  }
 }
 return ending;
}
export function accountSetupWindow(at=new Date()){
 const ending=scheduleEnd(at,120);
 return{accountCreationAllowed:ending!==null,skipAccountSetup:ending===null,serviceWindowEndsAt:ending};
}
export const scheduledServiceEnd=(at=new Date())=>scheduleEnd(at,0);
