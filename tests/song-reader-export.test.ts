import {env,createExecutionContext} from 'cloudflare:test';
import {expect,it} from 'vitest';
import JSZip from 'jszip';
import worker from '../src/server/index';
import {hash,now,token} from '../src/server/core';
const songId='a'.repeat(64),contentHash='b'.repeat(64),text='Împreună cântăm\nHarul Tău\n\nAnother verse\nWith no added ending';
async function fixture(){
 const id=crypto.randomUUID(),session=token(),device=crypto.randomUUID();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Export','T','admin','active',?)").bind(id,now()),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),id,now()+86400),
  env.DB.prepare("INSERT INTO devices(id,name,token_hash,owner_id,created_at,pair_expires,last_seen) VALUES(?,'Export PC',?,?,?,?,?)").bind(device,await hash(token()),id,now(),now()+300,now()),
 ]);
 await env.DB.prepare("INSERT INTO station_catalog(device_id,song_id,title,content_hash,filename,category,language,font_size,text,first_slide,added_at,modified_at,generation,search_text,payload_bytes) VALUES(?,?,'Song export',?,'song.pro','Worship','ron',96,?,'Împreună cântăm',1,1,?,'export',100)").bind(device,songId,contentHash,text,crypto.randomUUID()).run();
 const call=(hashValue=contentHash,cookie='stati_session='+session)=>worker.fetch(new Request('http://localhost:8787/api/computers/'+device+'/songs/'+songId+'/export?format=pptx&contentHash='+hashValue,{headers:{Origin:'http://localhost:8787',Cookie:cookie}}),env,createExecutionContext());
 return{id,device,call};
}
it('exports a real PowerPoint with ordered stanza slides, Romanian text and no added Amen',async()=>{
 const f=await fixture(),response=await f.call();expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
 const zip=await JSZip.loadAsync(await response.arrayBuffer()),slides=Object.keys(zip.files).filter(path=>/^ppt\/slides\/slide\d+\.xml$/.test(path)).sort();expect(slides).toHaveLength(2);
 const first=await zip.file(slides[0])!.async('string'),second=await zip.file(slides[1])!.async('string');
 expect(first).toContain('Împreună cântăm');expect(first).toContain('Harul Tău');expect(second).toContain('Another verse');expect(second).not.toContain('Amen');expect(first).not.toContain('Song export');
 expect(await env.DB.prepare('SELECT text FROM station_catalog WHERE device_id=? AND song_id=?').bind(f.device,songId).first()).toEqual({text});
});
it('rejects stale source hashes, signed-out accounts and revoked computer access',async()=>{
 const f=await fixture();expect((await f.call('c'.repeat(64))).status).toBe(409);expect((await f.call(contentHash,'')).status).toBeGreaterThanOrEqual(400);
 await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.device).run();expect((await f.call()).status).toBeGreaterThanOrEqual(400);
});
