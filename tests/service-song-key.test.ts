import {env,SELF} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {fixture} from './helpers/service-fixture';

it('shares defaults per song appearance and fences unassigned writers and stale saves',async()=>{
 const f=await fixture('worship_leader'),plan=await f.create(),song=f.song(),repeat=f.song();
 const saved=(await f.change({type:'save',id:plan.id,plan:{...plan,songs:[song,repeat]}})).plans[0];
 const request=(item:string,body?:object)=>SELF.fetch('http://localhost:8787/api/computers/'+f.deviceId+'/services/'+plan.id+'/song-key/'+item,{
  method:body?'PUT':'GET',headers:{Origin:'http://localhost:8787',Cookie:'stati_session='+f.session},body:body?JSON.stringify(body):undefined,
 });
 const value={pitch:9,contentHash:f.contentHash,revision:0};
 expect(await (await request(song.id)).json()).toMatchObject({pitch:null,canEdit:false,revision:0});
 expect((await request(song.id,value)).status).toBe(409);
 await f.change({type:'claim-leadership',id:plan.id,expectedRevision:saved.revision,expectedLeadershipRevision:0});
 expect(await (await request(song.id,value)).json()).toMatchObject({pitch:9,canEdit:true,revision:1});
 expect((await request(song.id,value)).status).toBe(409);
 expect(await (await request(repeat.id)).json()).toMatchObject({pitch:null,revision:0});
 expect(await (await request(song.id,{...value,revision:1,pitch:null})).json()).toMatchObject({pitch:null,revision:2});
 const planAfter=(await f.read()).plans[0];
 expect(planAfter.revision).toBe(saved.revision);
 expect(planAfter.songs).toHaveLength(2);
 await env.DB.prepare('UPDATE station_service_leadership SET leader_id=NULL WHERE device_id=? AND service_id=?').bind(f.deviceId,plan.id).run();
 expect((await request(song.id,{...value,revision:2})).status).toBe(409);
});
