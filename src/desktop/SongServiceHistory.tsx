import {useState} from 'react';
import {History} from 'lucide-react';
import {songServiceHistory,type SongServiceHistoryEntry} from '../shared/song-service-history.js';
export function SongServiceHistory({songId,contentHash,disabled}:{songId:string;contentHash:string;disabled:boolean}){
 const [entries,setEntries]=useState<SongServiceHistoryEntry[]|null>(null),[working,setWorking]=useState(false),[error,setError]=useState('');
 async function load(){setWorking(true);setError('');try{setEntries(songServiceHistory(await window.stati.listServicePlans(),songId,contentHash));}catch(e){setEntries(null);setError((e as Error).message);}finally{setWorking(false);}}
 return <details className="song-service-history"><summary><History size={15}/>Saved service history</summary><p className="muted caption">Plans for this profile on this computer. This records inclusion in a saved setlist, not live playback.</p><button type="button" className="button small" disabled={disabled||working} onClick={()=>void load()}>{working?'Checking…':entries?'Refresh history':'Check saved services'}</button>{error&&<p className="inline-error" role="alert">{error}</p>}{entries&&(!entries.length?<p>No saved services reference this library file.</p>:<ul>{entries.map(entry=><li key={entry.id}><strong>{entry.title}</strong> · {entry.date} · {entry.time}{entry.archived?' · Archived':''}<small>Positions {entry.positions.join(', ')} · {entry.version==='matching'?'Matches this file version':'Contains a different file version'}</small></li>)}</ul>)}</details>;
}
