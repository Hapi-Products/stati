import {z} from 'zod';
import {hash,HttpError,json,now,type Device} from './core';
import {accountSongReadSql} from './ministry-roles';

const pairingPrefix='ilumin8-device:';
export const ilumin8PairingKey=(id:string)=>pairingPrefix+id;
const sourceLimit=100;
const songLimit=40;
const pageBytes=512*1024;
// Stored payload_bytes includes fields omitted from the response. Leave room
// for the JSON envelope and cursor when selecting more than one song.
const songBytesBudget=pageBytes-256;
const pageQuery=z.object({
 source:z.string().uuid().transform(id=>id.toLowerCase()),
 after:z.string().regex(/^[a-f0-9]{64}$/i).transform(id=>id.toLowerCase()).optional(),
});

export function markIlumin8Pairing(env:Env,deviceId:string){
 return env.DB.prepare("INSERT INTO settings (key,value) VALUES (?,'1')").bind(ilumin8PairingKey(deviceId));
}

export function removeExpiredIlumin8Pairings(env:Env,time:number){
 return env.DB.prepare(`DELETE FROM settings WHERE key IN (
  SELECT ?||id FROM devices WHERE owner_id IS NULL AND pair_expires<?
 )`).bind(pairingPrefix,time);
}

const currentPairing=`
 FROM devices destination
 JOIN users actor ON actor.id=destination.owner_id AND actor.status='active'
 LEFT JOIN user_ministry_roles ministry ON ministry.user_id=actor.id
 JOIN settings pairing ON pairing.key=? AND pairing.value='1'
 WHERE destination.id=? AND actor.id=? AND destination.token_hash=? AND destination.revoked_at IS NULL
`;

async function pairingParams(request:Request,device:Device){
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer ')||authorization.length===7)throw new HttpError(401,'Pair this computer first.');
 return[ilumin8PairingKey(device.id),device.id,device.owner_id,await hash(authorization.slice(7))];
}

const destinationAccess=`SELECT destination.id,actor.id AS owner_id,${accountSongReadSql} AS can_read ${currentPairing}`;

const sourceAccess=`
 destination.can_read AND source.id<>destination.id AND source.revoked_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=source.id AND removed.user_id=destination.owner_id)
 AND (source.owner_id=destination.owner_id OR EXISTS(
  SELECT 1 FROM station_memberships membership
  WHERE membership.device_id=source.id AND membership.user_id=destination.owner_id AND membership.status='approved'
 ))
`;

function pairingChanged(){
 return new HttpError(403,'Pair Ilumin8 with Stați to access the shared song library.');
}

export async function readIlumin8Sources(request:Request,env:Env,device:Device){
 const {results}=await env.DB.prepare(`
  WITH destination_access AS MATERIALIZED (${destinationAccess}),
  sources AS MATERIALIZED (
   SELECT source.id,source.name
   FROM destination_access destination
   JOIN station_catalog_snapshots snapshot ON snapshot.ready_at IS NOT NULL
   JOIN devices source ON source.id=snapshot.device_id
   JOIN users owner ON owner.id=source.owner_id AND owner.status='active'
   WHERE ${sourceAccess}
   ORDER BY source.name,source.id
   LIMIT ?
  )
  SELECT sources.id,sources.name FROM destination_access
  LEFT JOIN sources ON 1=1
  ORDER BY sources.name,sources.id
 `).bind(...await pairingParams(request,device),sourceLimit).all<{id:string;name:string}|{id:null;name:null}>();
 if(!results.length)throw pairingChanged();
 return json({sources:results.filter(source=>source.id!==null)});
}

type Song={id:string;contentHash:string;title:string;text:string;language:string;firstSlide:string};
type PageRow={sourceId:string|null;generation:string|null;candidateCount:number}&(Song|{[key in keyof Song]:null});

export async function readIlumin8Songs(request:Request,env:Env,device:Device){
 const params=new URL(request.url).searchParams;
 const query=pageQuery.safeParse({source:params.get('source'),after:params.get('after')??undefined});
 if(!query.success)throw new HttpError(400,'Choose a valid source and song cursor.');
 const {source,after=''}=query.data;

 // Read access, generation and lyrics in one statement. A pending upload
 // leaves both the committed rows and the previous ready timestamp intact.
 const {results}=await env.DB.prepare(`
  WITH destination_access AS MATERIALIZED (${destinationAccess}),
  eligible_source AS MATERIALIZED (
   SELECT source.id
   FROM destination_access destination
   JOIN devices source ON source.id=?
   JOIN users owner ON owner.id=source.owner_id AND owner.status='active'
   WHERE ${sourceAccess}
  ),
  ready AS MATERIALIZED (
   SELECT snapshot.device_id,COALESCE((
    SELECT generation FROM station_catalog
    WHERE device_id=snapshot.device_id ORDER BY song_id LIMIT 1
   ),'empty:'||snapshot.ready_at) AS generation
   FROM eligible_source source
   JOIN station_catalog_snapshots snapshot ON snapshot.device_id=source.id
   WHERE snapshot.ready_at IS NOT NULL
  ),
  candidates AS MATERIALIZED (
   SELECT song_id,payload_bytes FROM station_catalog
   WHERE device_id=(SELECT device_id FROM ready) AND song_id>?
   ORDER BY song_id LIMIT ?
  ),
  page AS MATERIALIZED (
   SELECT song_id,ROW_NUMBER() OVER(ORDER BY song_id) AS position,
    SUM(payload_bytes+1) OVER(ORDER BY song_id) AS bytes
   FROM candidates
  )
  SELECT source.id AS sourceId,ready.generation,(SELECT COUNT(*) FROM candidates) AS candidateCount,
   song.song_id AS id,song.content_hash AS contentHash,song.title,song.text,song.language,song.first_slide AS firstSlide
  FROM destination_access
  LEFT JOIN eligible_source source ON 1=1
  LEFT JOIN ready ON 1=1
  LEFT JOIN page ON page.position<=? AND (page.position=1 OR page.bytes<=?)
  LEFT JOIN station_catalog song ON song.device_id=ready.device_id AND song.song_id=page.song_id
  ORDER BY page.position
 `).bind(...await pairingParams(request,device),source,after,songLimit+1,songLimit,songBytesBudget).all<PageRow>();

 const state=results[0];
 if(!state)throw pairingChanged();
 if(!state.sourceId)throw new HttpError(404,'This source library is unavailable.');
 if(!state.generation)throw new HttpError(409,'This computer has not finished sharing its song library.');
 const items=results.flatMap(({sourceId,generation,candidateCount,...song})=>song.id===null?[]:[song]);
 const nextCursor=state.candidateCount>items.length?items.at(-1)!.id:null;
 return json({items,nextCursor,generation:state.generation});
}

export async function disconnectIlumin8(request:Request,env:Env,device:Device){
 const time=now(),params=await pairingParams(request,device),guard=`EXISTS(SELECT 1 ${currentPairing})`;
 const [,updated]=await env.DB.batch([
  env.DB.prepare(`UPDATE receivers SET closed_at=? WHERE device_id=? AND closed_at IS NULL AND ${guard}`).bind(time,device.id,...params),
  env.DB.prepare(`UPDATE devices SET revoked_at=? WHERE id=? AND ${guard}`).bind(time,device.id,...params),
 ]);
 if(!updated.meta.changes)throw pairingChanged();
 return json({ok:true});
}
