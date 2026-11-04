import {env,SELF} from 'cloudflare:test';
import {expect,it,vi} from 'vitest';
import {hash,now,token,type Device} from '../src/server/core';
import {publishStationCatalog,readStationCatalog} from '../src/server/station-catalog';
import type {MinistryRole} from '../src/server/ministry-roles';

async function person(ministryRole:MinistryRole|null='worship_member',role='member',status='active'){
 const id=crypto.randomUUID(),session=token(),sessionHash=await hash(session);
 await env.DB.batch([env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Catalog','T',?,?,?)").bind(id,role,status,now()),env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(sessionHash,id,now()+86400)]);
 if(ministryRole)await env.DB.prepare('INSERT INTO user_ministry_roles VALUES(?,?,NULL,?)').bind(id,ministryRole,now()).run();
 return{id,sessionHash,cookie:'stati_session='+session};
}
async function station(){
 const owner=await person(null,'admin'),id=crypto.randomUUID(),credential=token();
 await env.DB.prepare("INSERT INTO devices(id,name,token_hash,owner_id,created_at,pair_expires,last_seen) VALUES(?,'Isolated catalog PC',?,?,?,?,?)").bind(id,await hash(credential),owner.id,now(),now()+300,now()).run();
 const device=await env.DB.prepare('SELECT * FROM devices WHERE id=?').bind(id).first<Device>();if(!device)throw Error('Fixture device missing');
 return{id,credential,device,owner};
}
const song=(number=1,overrides:Record<string,unknown>={})=>({id:number.toString(16).padStart(64,'0'),contentHash:'a'.repeat(64),title:'Song '+number,filename:'song-'+number+'.pro',category:'Worship',language:'ron',fontSize:96,text:'Împreună cântăm\nIubire și har',firstSlide:'Împreună cântăm',addedAt:1000,modifiedAt:2000,...overrides});
async function respond(action:()=>Promise<Response>){try{return await action();}catch(error){if(error&&typeof error==='object'&&'status'in error)return Response.json({error:(error as Error).message},{status:Number(error.status)});throw error;}}
async function fixture(){
 const computer=await station(),reader=await person();await approve(computer.id,reader.id);
 const publish=(data:unknown,bindings=env,authorization:string|null='Bearer '+computer.credential)=>respond(()=>publishStationCatalog(new Request('http://localhost:8787/api/station/catalog',{method:'POST',headers:{'Content-Type':'application/json',Cookie:reader.cookie,...(authorization?{Authorization:authorization}:{})},body:JSON.stringify(data)}),bindings,computer.device));
 const read=(options:{actor?:Awaited<ReturnType<typeof person>>;id?:string;stationId?:string;query?:string;language?:string;category?:string;offset?:string;bindings?:Env}={})=>{
  const parameters=new URLSearchParams({query:options.query||'',language:options.language||'all',category:options.category||'',offset:options.offset||'0'}),stationId=options.stationId||computer.id;
  return respond(()=>readStationCatalog(new Request('http://localhost:8787/api/computers/'+stationId+'/songs'+(options.id?'/'+options.id:'')+'?'+parameters,{headers:{Cookie:(options.actor||reader).cookie}}),options.bindings||env,stationId,options.id));
 };
 const commit=async(songs:ReturnType<typeof song>[],unreadable=0)=>{const generation=crypto.randomUUID();expect((await publish({action:'begin',generation,count:songs.length,unreadable})).status).toBe(200);for(let i=0;i<songs.length;i+=4)expect((await publish({action:'chunk',generation,songs:songs.slice(i,i+4)})).status).toBe(200);expect((await publish({action:'finish',generation})).status).toBe(200);return generation;};
 return{...computer,reader,publish,read,commit};
}
async function approve(deviceId:string,userId:string,status='approved'){await env.DB.prepare('INSERT INTO station_memberships VALUES(?,?,?,?) ON CONFLICT(device_id,user_id) DO UPDATE SET status=excluded.status').bind(deviceId,userId,status,now()).run();}
function beforeBatch(change:()=>Promise<unknown>){let count=0;const DB=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(statements:D1PreparedStatement[])=>{if(!count++)await change();return target.batch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});return{bindings:{...env,DB},count:()=>count};}
const list=async(response:Response)=>{expect(response.status).toBe(200);return await response.json() as {items:{id:string;title:string;firstSlide:string;lyricPreview:string}[];total:number;categories:string[];unreadable:number;updatedAt:number|null};};
const staging=async(deviceId:string)=>(await env.DB.prepare('SELECT COUNT(*) AS count FROM station_catalog_staging WHERE device_id=?').bind(deviceId).first<{count:number}>())!.count;

it('keeps the complete old catalog and metadata readable while a new snapshot is partial or missing songs',async()=>{
 const f=await fixture();await f.commit([song(1)],3);const generation=crypto.randomUUID();expect((await f.publish({action:'begin',generation,count:2,unreadable:7})).status).toBe(200);
 expect((await f.publish({action:'chunk',generation,songs:[song(2)]})).status).toBe(200);expect((await list(await f.read())).items.map(item=>item.id)).toEqual([song(1).id]);expect((await list(await f.read())).unreadable).toBe(3);
 expect((await f.publish({action:'finish',generation})).status).toBe(409);expect((await list(await f.read())).items[0].id).toBe(song(1).id);
 expect((await f.publish({action:'chunk',generation,songs:[song(3)]})).status).toBe(200);expect((await f.publish({action:'finish',generation})).status).toBe(200);
 const next=await list(await f.read());expect(next.items.map(item=>item.id)).toEqual([song(2).id,song(3).id]);expect(next.unreadable).toBe(7);expect(await staging(f.id)).toBe(0);expect((await f.read({id:song(1).id})).status).toBe(404);
});
it('an explicitly empty complete snapshot clears the old catalog while an incomplete snapshot never does',async()=>{
 const f=await fixture();await f.commit([song(1)]);await f.commit([]);expect((await list(await f.read())).items).toEqual([]);
});
it('an all-unreadable scan from an older computer cannot erase the last good shared songs or metadata',async()=>{
 const f=await fixture();await f.commit([song(1)],1);const before=await list(await f.read()),generation=crypto.randomUUID();
 expect((await f.publish({action:'begin',generation,count:0,unreadable:2})).status).toBe(200);expect((await f.publish({action:'finish',generation})).status).toBe(409);
 const kept=await list(await f.read());expect(kept.items).toEqual(before.items);expect(kept.updatedAt).toBe(before.updatedAt);expect(kept.unreadable).toBe(before.unreadable);
});
it('approved readers can search and open shared lyrics with the computer offline and outside service hours',async()=>{
 vi.setSystemTime(new Date('2026-10-12T12:00:00-07:00'));const f=await fixture();await f.commit([song(1)]);await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now()-86400*7,f.id).run();
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM receivers WHERE device_id=? AND closed_at IS NULL').bind(f.id).first<{count:number}>())?.count).toBe(0);
 const call=(path:string)=>SELF.fetch('http://localhost:8787/api'+path,{headers:{Origin:'http://localhost:8787',Cookie:f.reader.cookie}});
 const devices=await call('/devices');expect(devices.status).toBe(200);expect(await devices.json()).toEqual(expect.arrayContaining([expect.objectContaining({id:f.id})]));
 const result=await list(await call('/computers/'+f.id+'/songs?query=impreuna'));expect(result.total).toBe(1);expect(result.items[0].title).toBe(song(1).title);expect(result.updatedAt).toBe(now());
 const detail=await call('/computers/'+f.id+'/songs/'+song(1).id);expect(detail.status).toBe(200);expect(await detail.json()).toMatchObject({id:song(1).id,text:song(1).text});
});
it.each(['membership','device'] as const)('offline song access still stops immediately after %s is revoked',async kind=>{
 vi.setSystemTime(new Date('2026-10-12T12:00:00-07:00'));const f=await fixture();await f.commit([song(1)]);await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now()-86400,f.id).run();expect((await list(await f.read())).total).toBe(1);
 if(kind==='membership')await approve(f.id,f.reader.id,'denied');else await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.id).run();
 for(const id of [undefined,song(1).id])expect((await f.read({id})).status).toBe(403);
 expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM station_catalog WHERE device_id=?').bind(f.id).first<{count:number}>())?.count).toBe(1);
});
it('replaced or expired generations cannot append or finish over the current snapshot',async()=>{
 const f=await fixture();await f.commit([song(1)]);const first=crypto.randomUUID(),second=crypto.randomUUID();
 await f.publish({action:'begin',generation:first,count:1,unreadable:0});await f.publish({action:'chunk',generation:first,songs:[song(2)]});await f.publish({action:'begin',generation:second,count:1,unreadable:0});expect(await staging(f.id)).toBe(0);
 for(const action of [{action:'chunk',generation:first,songs:[song(3)]},{action:'finish',generation:first}])expect((await f.publish(action)).status).toBe(409);
 expect((await list(await f.read())).items[0].id).toBe(song(1).id);vi.setSystemTime(new Date((now()+3601)*1000));expect((await f.publish({action:'chunk',generation:second,songs:[song(4)]})).status).toBe(409);expect((await f.publish({action:'finish',generation:second})).status).toBe(409);expect((await list(await f.read())).items[0].id).toBe(song(1).id);
});
it('a failed commit transaction restores both the old rows and the pending snapshot for retry',async()=>{
 const f=await fixture();await f.commit([song(1)]);const generation=crypto.randomUUID();await f.publish({action:'begin',generation,count:1,unreadable:0});await f.publish({action:'chunk',generation,songs:[song(2)]});
 const DB=new Proxy(env.DB,{get(target,property){if(property==='batch')return(statements:D1PreparedStatement[])=>target.batch([...statements.slice(0,2),target.prepare('INSERT INTO catalog_fixture_missing_table VALUES(1)'),...statements.slice(2)]);const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 await expect(f.publish({action:'finish',generation},{...env,DB})).rejects.toThrow();expect((await list(await f.read())).items[0].id).toBe(song(1).id);expect((await env.DB.prepare('SELECT status FROM station_catalog_snapshots WHERE device_id=?').bind(f.id).first())?.status).toBe('pending');expect(await staging(f.id)).toBe(1);
 expect((await f.publish({action:'finish',generation})).status).toBe(200);expect((await list(await f.read())).items[0].id).toBe(song(2).id);
});
it('staging never exceeds its declared count, including zero, duplicate retries and replacements',async()=>{
 const f=await fixture();await f.commit([song(1)]);let generation=crypto.randomUUID();await f.publish({action:'begin',generation,count:0,unreadable:0});expect((await f.publish({action:'chunk',generation,songs:[song(2)]})).status).toBe(409);expect(await staging(f.id)).toBe(0);
 generation=crypto.randomUUID();await f.publish({action:'begin',generation,count:1,unreadable:0});expect((await f.publish({action:'chunk',generation,songs:[song(2),song(3)]})).status).toBe(409);expect(await staging(f.id)).toBeLessThanOrEqual(1);
 expect((await f.publish({action:'chunk',generation,songs:[song(2,{title:'Replacement'})]})).status).toBe(200);expect(await staging(f.id)).toBe(1);await f.publish({action:'finish',generation});expect((await list(await f.read())).items[0].title).toBe('Replacement');
});
it('a paired publisher cannot accumulate more than eight MiB across many individually valid chunks',async()=>{
 const f=await fixture();await f.commit([song(1)]);const generation=crypto.randomUUID();await f.publish({action:'begin',generation,count:1000,unreadable:0});let rejected=false;
 for(let index=0;index<90;index+=4){const songs=Array.from({length:4},(_,offset)=>song(100+index+offset,{text:'x'.repeat(100000)})),response=await f.publish({action:'chunk',generation,songs});if(response.status!==200){expect(response.status).toBe(409);rejected=true;break;}}
 expect(rejected).toBe(true);const rows=await env.DB.prepare('SELECT text,first_slide,title,filename,category FROM station_catalog_staging WHERE device_id=?').bind(f.id).all<{text:string;first_slide:string;title:string;filename:string;category:string}>();
 const minimumBytes=rows.results.reduce((sum,row)=>sum+new TextEncoder().encode(row.text+row.first_slide+row.title+row.filename+row.category).length,0);expect(minimumBytes).toBeLessThanOrEqual(8*1024*1024);expect((await list(await f.read())).items[0].id).toBe(song(1).id);expect((await f.publish({action:'finish',generation})).status).toBe(409);
});
it.each(['credential','revoked','owner'] as const)('rechecks paired %s before publishing any commit',async kind=>{
 const f=await fixture();await f.commit([song(1)]);const generation=crypto.randomUUID();await f.publish({action:'begin',generation,count:1,unreadable:0});await f.publish({action:'chunk',generation,songs:[song(2)]});
 const race=beforeBatch(async()=>{if(kind==='credential')await env.DB.prepare('UPDATE devices SET token_hash=? WHERE id=?').bind(await hash(token()),f.id).run();if(kind==='revoked')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.id).run();if(kind==='owner')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.owner.id).run();});
 expect((await f.publish({action:'finish',generation},race.bindings)).status).toBe(409);expect(race.count()).toBe(1);expect((await env.DB.prepare('SELECT song_id FROM station_catalog WHERE device_id=?').bind(f.id).first())?.song_id).toBe(song(1).id);
});
it('phone sessions and another paired computer cannot publish this computer catalog',async()=>{
 const f=await fixture(),other=await station(),generation=crypto.randomUUID();expect((await f.publish({action:'begin',generation,count:0,unreadable:0},env,null)).status).toBe(401);expect((await f.publish({action:'begin',generation,count:0,unreadable:0},env,'Bearer '+other.credential)).status).toBe(409);expect(await env.DB.prepare('SELECT * FROM station_catalog_snapshots WHERE device_id=?').bind(f.id).first()).toBeNull();
});
it.each(['worship_leader','worship_member','pastor','choir_director'] as const)('lets a current approved %s view whole songs without granting publication',async role=>{
 const f=await fixture(),reader=await person(role);await approve(f.id,reader.id);await f.commit([song(1)]);expect((await list(await f.read({actor:reader}))).items[0].firstSlide).toBe(song(1).firstSlide);const detail=await f.read({actor:reader,id:song(1).id});expect(detail.status).toBe(200);expect(await detail.json()).toMatchObject({text:song(1).text,contentHash:song(1).contentHash});
});
it('unapproved members, ordinary members and cross-computer memberships cannot read catalog data',async()=>{
 const f=await fixture();await f.commit([song(1)]);const unapproved=await person(),ordinary=await person(null),other=await station();await approve(f.id,ordinary.id);expect((await f.read({actor:unapproved})).status).toBe(403);expect((await f.read({actor:ordinary})).status).toBe(403);expect((await f.read({stationId:other.id})).status).toBe(403);expect((await f.read({stationId:other.id,id:song(1).id})).status).toBe(403);
});
it.each(['ministry','session','membership','user','device'] as const)('does not leak catalog rows if %s is revoked after the first authorization read',async kind=>{
 const f=await fixture();await f.commit([song(1)]);const race=beforeBatch(async()=>{if(kind==='ministry')await env.DB.prepare('DELETE FROM user_ministry_roles WHERE user_id=?').bind(f.reader.id).run();if(kind==='session')await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(f.reader.sessionHash).run();if(kind==='membership')await approve(f.id,f.reader.id,'denied');if(kind==='user')await env.DB.prepare("UPDATE users SET status='removed' WHERE id=?").bind(f.reader.id).run();if(kind==='device')await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),f.id).run();});
 const result=await list(await f.read({bindings:race.bindings}));expect(race.count()).toBe(1);expect(result.items).toEqual([]);expect(result.total).toBe(0);expect(result.categories).toEqual([]);expect(result.updatedAt).toBeNull();expect((await f.read()).status).not.toBe(200);
});
it('Romanian lyric search is diacritic insensitive and preserves actual opening-slide text',async()=>{
 const f=await fixture();await f.commit([song(1,{title:'Titlu separat',text:'Prima linie\n\nÎmpreună cântăm, iubire și har',firstSlide:'Prima linie'}),song(2,{title:'English song',language:'eng',text:'Hope returns',firstSlide:'Hope returns'})]);
 const result=await list(await f.read({query:'impreuna cantam iubire',language:'ron',category:'Worship'}));expect(result.total).toBe(1);expect(result.items[0]).toMatchObject({title:'Titlu separat',firstSlide:'Prima linie'});expect(result.items[0].lyricPreview).toContain('Împreună cântăm');expect((await list(await f.read({query:"' OR 1=1 --"}))).items).toEqual([]);
 expect((await f.read({query:'x'.repeat(201)})).status).toBe(400);expect((await f.read({offset:'-1'})).status).toBe(400);
});
it('rejects oversized request streams and invalid song entries before staging them',async()=>{
 const f=await fixture(),generation=crypto.randomUUID();await f.publish({action:'begin',generation,count:40,unreadable:0});
 expect((await f.publish({action:'chunk',generation,songs:Array.from({length:6},(_,index)=>song(index+1,{text:'x'.repeat(100000)}))})).status).toBe(413);
 expect((await f.publish({action:'chunk',generation,songs:[song(1,{fontSize:12})]})).status).toBe(400);expect(await staging(f.id)).toBe(0);
});


it('restarting begin with the same generation clears old staging before lowering the declared count',async()=>{
 const f=await fixture();await f.commit([song(1)]);const generation=crypto.randomUUID();await f.publish({action:'begin',generation,count:2,unreadable:0});await f.publish({action:'chunk',generation,songs:[song(2),song(3)]});expect(await staging(f.id)).toBe(2);
 expect((await f.publish({action:'begin',generation,count:0,unreadable:0})).status).toBe(200);expect(await staging(f.id)).toBe(0);expect((await list(await f.read())).items[0].id).toBe(song(1).id);expect((await f.publish({action:'finish',generation})).status).toBe(200);expect((await list(await f.read())).items).toEqual([]);
});
it.each(['begin','chunk'] as const)('a credential rotated immediately before %s cannot stage or reset catalog data',async action=>{
 const f=await fixture();await f.commit([song(1)]);const generation=crypto.randomUUID();if(action==='chunk')await f.publish({action:'begin',generation,count:1,unreadable:0});
 const race=beforeBatch(async()=>env.DB.prepare('UPDATE devices SET token_hash=? WHERE id=?').bind(await hash(token()),f.id).run());
 const data=action==='begin'?{action,generation,count:0,unreadable:0}:{action,generation,songs:[song(2)]};expect((await f.publish(data,race.bindings)).status).toBe(409);expect(await staging(f.id)).toBe(0);expect((await list(await f.read())).items[0].id).toBe(song(1).id);
});
it('real routes reject phone publication and device-only reading while serving approved ministry readers',async()=>{
 const f=await fixture(),generation=crypto.randomUUID(),call=(path:string,method='GET',data?:unknown,paired=false)=>SELF.fetch('http://localhost:8787/api'+path,{method,headers:{Origin:'http://localhost:8787',Cookie:'stati_access=isolated-test-access; '+f.reader.cookie,...(paired?{Authorization:'Bearer '+f.credential}:{}),...(method==='POST'?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
 expect((await call('/station/catalog','POST',{action:'begin',generation,count:0,unreadable:0})).status).toBe(401);
 await f.commit([song(1)]);expect((await call('/computers/'+f.id+'/songs')).status).toBe(200);expect((await call('/computers/'+f.id+'/songs/'+song(1).id)).status).toBe(200);
 const deviceOnly=await SELF.fetch('http://localhost:8787/api/computers/'+f.id+'/songs',{headers:{Origin:'http://localhost:8787',Authorization:'Bearer '+f.credential}});expect(deviceOnly.status).toBe(403);const gatedDevice=await SELF.fetch('http://localhost:8787/api/computers/'+f.id+'/songs',{headers:{Origin:'http://localhost:8787',Authorization:'Bearer '+f.credential,Cookie:'stati_access=isolated-test-access'}});expect(gatedDevice.status).toBe(401);
 expect((await call('/station/catalog','POST',{action:'begin',generation,count:0,unreadable:0},true)).status).toBe(200);expect((await call('/station/catalog','POST',{action:'finish',generation},true)).status).toBe(200);expect((await list(await call('/computers/'+f.id+'/songs'))).items).toEqual([]);
});

it('publishes full-size chunks with bounded read cost, supports retry replacements and atomically rejects overflow',async()=>{
 const f=await fixture(),generation=crypto.randomUUID();await f.publish({action:'begin',generation,count:400,unreadable:0});let reads=0,chunks=0;
 const DB=new Proxy(env.DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{const results=await target.batch(statements);for(const row of results)reads+=row.meta.rows_read||0;chunks++;return results;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}),bindings={...env,DB};
 for(let offset=0;offset<400;offset+=40)expect((await f.publish({action:'chunk',generation,songs:Array.from({length:40},(_,index)=>song(offset+index+1))},bindings)).status).toBe(200);
 expect(chunks).toBe(10);expect(reads).toBeGreaterThan(0);expect(reads).toBeLessThan(30000);console.log('Catalog cost fixture:',JSON.stringify({songs:400,chunks,rowsRead:reads}));expect(await staging(f.id)).toBe(400);
 expect((await f.publish({action:'chunk',generation,songs:[song(1,{title:'Replacement, same ID'})]})).status).toBe(200);expect(await staging(f.id)).toBe(400);
 expect((await f.publish({action:'chunk',generation,songs:[song(401),song(402)]})).status).toBe(409);expect(await staging(f.id)).toBe(400);
 expect((await f.publish({action:'chunk',generation,songs:[song(1),song(1)]})).status).toBe(400);expect(await staging(f.id)).toBe(400);expect((await f.publish({action:'finish',generation})).status).toBe(200);
});

it('shares group versions without changing generic originals and filters by group label',async()=>{
 const f=await fixture(),original=song(1),variant=song(2,{title:'Song 1 · Choir',groupName:'Choir',sourceSongId:original.id});
 await f.commit([original,variant]);
 const read=async(groupName:string)=>readStationCatalog(new Request('http://localhost:8787/api/computers/'+f.id+'/songs?groupName='+encodeURIComponent(groupName),{headers:{Cookie:f.reader.cookie}}),env,f.id);
 const all=await(await read('')).json<{items:{id:string;groupName:string|null;sourceSongId:string|null}[];groups:string[]}>();expect(all.groups).toEqual(['Choir']);expect(all.items).toContainEqual(expect.objectContaining({id:original.id,groupName:null,sourceSongId:null}));
 const group=await(await read('Choir')).json<{items:{id:string;groupName:string;sourceSongId:string}[]}>();expect(group.items).toHaveLength(1);expect(group.items[0]).toMatchObject({id:variant.id,groupName:'Choir',sourceSongId:original.id});
 const generic=await(await read('__generic__')).json<{items:{id:string}[]}>();expect(generic.items.map(item=>item.id)).toEqual([original.id]);
 expect(await(await f.read({id:variant.id})).json()).toMatchObject({groupName:'Choir',sourceSongId:original.id});
 await f.commit([original]);expect((await(await read('Choir')).json<{items:unknown[]}>()).items).toEqual([]);expect((await list(await f.read())).items[0].id).toBe(original.id);
});

it('notifies readers only after a complete catalog is committed, never for chunks or failed finishes',async()=>{
 const f=await fixture(),changed=vi.fn(),generation=crypto.randomUUID();
 const publish=(data:unknown)=>respond(()=>publishStationCatalog(new Request('http://localhost:8787/api/station/catalog',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+f.credential},body:JSON.stringify(data)}),env,f.device,changed));
 expect((await publish({action:'begin',generation,count:2,unreadable:0})).status).toBe(200);expect(changed).not.toHaveBeenCalled();
 expect((await publish({action:'chunk',generation,songs:[song(1)]})).status).toBe(200);expect(changed).not.toHaveBeenCalled();
 expect((await publish({action:'finish',generation})).status).toBe(409);expect(changed).not.toHaveBeenCalled();
 expect((await publish({action:'chunk',generation,songs:[song(2)]})).status).toBe(200);expect(changed).not.toHaveBeenCalled();
 expect((await publish({action:'finish',generation})).status).toBe(200);expect(changed).toHaveBeenCalledTimes(1);expect((await list(await f.read())).total).toBe(2);
});

it('provides exact full lyrics only when explicitly requested for a saved offline library',async()=>{
 const f=await fixture(),text='First line\n'+('Long lyric line\n'.repeat(100));await f.commit([song(1,{text})]);
 const headers={Cookie:f.reader.cookie};
 const base='http://localhost:8787/api/computers/'+f.id+'/songs';
 const short=await readStationCatalog(new Request(base,{headers}),env,f.id);expect((await short.json() as{items:Record<string,unknown>[]}).items[0].text).toBeUndefined();
 const full=await readStationCatalog(new Request(base+'?includeText=1',{headers}),env,f.id);expect((await full.json() as{items:Record<string,unknown>[]}).items[0].text).toBe(text);
 const outsider=await person();expect((await respond(()=>readStationCatalog(new Request(base+'?includeText=1',{headers:{Cookie:outsider.cookie}}),env,f.id))).status).toBe(403);
});

it('supports bounded larger native pages while preserving the default page and exact lyrics',async()=>{
 const f=await fixture(),songs=Array.from({length:121},(_,i)=>song(i+1,{title:'Fixture song '+String(i+1).padStart(3,'0')}));await f.commit(songs);
 const read=(limit:string,offset=0,actor=f.reader)=>respond(()=>readStationCatalog(new Request('http://localhost:8787/api/computers/'+f.id+'/songs?includeText=1&limit='+limit+'&offset='+offset,{headers:{Cookie:actor.cookie}}),env,f.id));
 const wide=await(await read('250')).json() as{items:{id:string;text:string}[];total:number};expect(wide.total).toBe(121);expect(wide.items.map(row=>row.id)).toEqual(songs.map(row=>row.id));expect(wide.items.every(row=>row.text===songs[0].text)).toBe(true);
 expect((await list(await f.read())).items).toHaveLength(50);
 expect((await(await read('250',100)).json() as{items:{id:string}[]}).items.map(row=>row.id)).toEqual(songs.slice(100).map(row=>row.id));
 expect((await read('501')).status).toBe(400);expect((await read('0')).status).toBe(400);expect((await read('250',0,await person())).status).toBe(403);
});
