/** Saved plan references, not evidence of live playback. Includes archived plans. */
export function songServiceHistory(plans,songId,contentHash){
 return plans.flatMap(plan=>{
  const matches=(plan.songs||[]).map((song,index)=>({song,index})).filter(({song})=>song.songId===songId);
  if(!matches.length)return [];
  return [{id:plan.id,title:plan.title,date:plan.date,time:plan.time,archived:plan.archived,positions:matches.map(({index})=>index+1),version:matches.every(({song})=>song.contentHash===contentHash)?'matching':'different'}];
 }).sort((a,b)=>(b.date+' '+b.time).localeCompare(a.date+' '+a.time)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
}
