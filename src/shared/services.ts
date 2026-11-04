import schedule from './service-schedule.json';
// Phoenix remains UTC-07:00. Inspect adjacent days so windows survive midnight.
export function accountSetupWindow(at=new Date()){
 const local=new Date(at.getTime()-7*3600000),time=at.getTime();let ending:number|null=null;
 for(let offset=-1;offset<=1;offset++){
  const day=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+offset));
  for(const service of schedule.services){if(service.day!==day.getUTCDay())continue;const start=day.getTime()+7*3600000+(service.hour*60+service.minute)*60000;const end=start+schedule.durationMinutes*60000;
   if(time>=start-120*60000&&time<end+120*60000)ending=Math.max(ending||0,end+120*60000);
  }
 }
 return{accountCreationAllowed:ending!==null,skipAccountSetup:ending===null,serviceWindowEndsAt:ending};
}
