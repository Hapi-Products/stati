import {env} from 'cloudflare:test';
import {it,expect} from 'vitest';
import beforeSql from './fixtures/catalog-insert-before.sql?raw';
import {hash,now,token,type Device} from '../src/server/core';
import {publishStationCatalog} from '../src/server/station-catalog';

// Local Miniflare D1 counters, not production billing or remote measurements.
const normalize=(text:string)=>text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const song=(number:number)=>({id:number.toString(16).padStart(64,'0'),contentHash:'a'.repeat(64),title:'Song '+number,filename:'song-'+number+'.pro',category:'Worship',language:'ron',fontSize:96,text:'Împreună cântăm\nIubire și har',firstSlide:'Împreună cântăm',addedAt:1000,modifiedAt:2000});
type Song=ReturnType<typeof song>;
async function fixture(){const owner=crypto.randomUUID(),id=crypto.randomUUID(),credential=token(),credentialHash=await hash(credential);await env.DB.batch([
 env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Cost','T','admin','active',?)").bind(owner,now()),
 env.DB.prepare("INSERT INTO devices(id,name,token_hash,owner_id,created_at,pair_expires,last_seen) VALUES(?,'Local cost fixture',?,?,?,?,?)").bind(id,credentialHash,owner,now(),now()+300,now()),
]);const device=await env.DB.prepare('SELECT * FROM devices WHERE id=?').bind(id).first<Device>();if(!device)throw Error('Fixture station missing');
 const publish=(data:unknown,bindings=env)=>publishStationCatalog(new Request('http://localhost:8787/api/station/catalog',{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(data)}),bindings,device);
 return{id,credentialHash,publish};}
function oldStatement(f:Awaited<ReturnType<typeof fixture>>,generation:string,entry:Song){const live=[f.id,generation,now()-3600,f.id,f.credentialHash],payloadBytes=new TextEncoder().encode(JSON.stringify(entry)).byteLength;
 // Binding order is copied from the exact pre-change publisher alongside the
 // expanded statement fixture; no extra reads or constraints are removed.
 return env.DB.prepare(beforeSql).bind(f.id,entry.id,entry.title,entry.contentHash,entry.filename,entry.category,entry.language,entry.fontSize,entry.text,entry.firstSlide,entry.addedAt,entry.modifiedAt,generation,normalize(entry.title+' '+entry.text),payloadBytes,...live,f.id,generation,entry.id,f.id,generation,f.id,generation,f.id,generation,f.id,generation,entry.id,payloadBytes);
}
const staged=async(id:string)=>(await env.DB.prepare('SELECT song_id,title,content_hash,filename,category,language,font_size,text,first_slide,added_at,modified_at,search_text,payload_bytes FROM station_catalog_staging WHERE device_id=? ORDER BY song_id').bind(id).all()).results;
it('measures the exact old per-song INSERT against the current chunk publisher for the same 400 songs',async()=>{
 const f=await fixture(),songs=Array.from({length:400},(_,index)=>song(index+1)),oldGeneration=crypto.randomUUID();expect((await f.publish({action:'begin',generation:oldGeneration,count:songs.length,unreadable:0})).status).toBe(200);let beforeRowsRead=0,beforeRowsWritten=0,beforeStatements=0;
 for(let offset=0;offset<songs.length;offset+=40){const results=await env.DB.batch(songs.slice(offset,offset+40).map(entry=>oldStatement(f,oldGeneration,entry)));expect(results.every(result=>result.meta.changes===1)).toBe(true);for(const result of results){beforeRowsRead+=result.meta.rows_read||0;beforeRowsWritten+=result.meta.rows_written||0;beforeStatements++;}}
 const before=await staged(f.id);expect(before).toHaveLength(400);
 const generation=crypto.randomUUID();expect((await f.publish({action:'begin',generation,count:songs.length,unreadable:0})).status).toBe(200);let afterRowsRead=0,afterRowsWritten=0,afterStatements=0,chunks=0;
 const DB=new Proxy(env.DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{const results=await target.batch(statements);for(const result of results){afterRowsRead+=result.meta.rows_read||0;afterRowsWritten+=result.meta.rows_written||0;afterStatements++;}chunks++;return results;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 for(let offset=0;offset<songs.length;offset+=40)expect((await f.publish({action:'chunk',generation,songs:songs.slice(offset,offset+40)},{...env,DB})).status).toBe(200);
 expect(await staged(f.id)).toEqual(before);expect(chunks).toBe(10);expect(beforeStatements).toBe(400);expect(afterStatements).toBe(10);expect(afterRowsRead).toBeGreaterThan(0);expect(afterRowsRead).toBeLessThan(30000);expect(afterRowsRead).toBeLessThan(beforeRowsRead/3);
 console.log('Local D1 catalog INSERT comparison:',JSON.stringify({songs:songs.length,chunks,old:{statements:beforeStatements,rowsRead:beforeRowsRead,rowsWritten:beforeRowsWritten},current:{statements:afterStatements,rowsRead:afterRowsRead,rowsWritten:afterRowsWritten},fewerRowsReadPercent:Number(((1-afterRowsRead/beforeRowsRead)*100).toFixed(2))}));
});
