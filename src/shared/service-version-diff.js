export function serviceVersionChanges(approved,draft,currentLyrics=[]){
 if(!approved)return{added:[],removed:[],files:[],arrangements:[],words:[],order:false,notes:false,details:false};
 const before=new Map(approved.plan.songs.map(song=>[song.id,song])),after=new Map(draft.songs.map(song=>[song.id,song])),oldWords=new Map(approved.lyrics.map(song=>[song.songId,song])),newWords=new Map(currentLyrics.map(song=>[song.songId,song])),result={added:[],removed:[],files:[],arrangements:[],words:[],order:false,notes:approved.plan.notes!==draft.notes,details:['title','date','time'].some(field=>approved.plan[field]!==draft[field])};
 for(const song of draft.songs){const old=before.get(song.id),source=newWords.get(song.songId);if(!old){result.added.push(song.title);continue;}if(old.songId!==song.songId||old.contentHash!==song.contentHash||source?.matchesReference===false)result.files.push(song.title);if(JSON.stringify(old.arrangement||null)!==JSON.stringify(song.arrangement||null))result.arrangements.push(song.title);if((oldWords.get(old.songId)?.text||'')!==(source?.text||''))result.words.push(song.title);}
 for(const song of approved.plan.songs)if(!after.has(song.id))result.removed.push(song.title);
 result.order=approved.plan.songs.map(song=>song.id).join('\0')!==draft.songs.map(song=>song.id).join('\0');return result;
}
export function changedWordRange(before,after){
 const first=String(before).split(/(\s+)/),second=String(after).split(/(\s+)/);let start=0,end=0;
 while(start<first.length&&start<second.length&&first[start]===second[start])start++;
 while(end<first.length-start&&end<second.length-start&&first[first.length-1-end]===second[second.length-1-end])end++;
 const pieces=value=>({before:value.slice(0,start).join(''),changed:value.slice(start,value.length-end).join(''),after:end?value.slice(value.length-end).join(''):''});return{approved:pieces(first),current:pieces(second)};
}
