import {env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {now} from '../src/server/core';
import {publishStationLiveSong,readStationLiveSong} from '../src/server/station-live-song';
import {fixture,native,rejected} from './helpers/service-fixture';

it('publishes only a confirmed service song from the selected operator and shares its canonical title with station readers', async()=>{
 const station=await fixture(),service=await station.create(),operator=await native(station);
 const position={serviceId:service.id,songId:station.songId};
 const write=(live:typeof position|null)=>publishStationLiveSong(new Request(operator.request().url,{
  method:'PUT',headers:operator.request().headers,body:JSON.stringify({live}),
 }),env,station.deviceId);
 const read=()=>readStationLiveSong(station.request(),env,station.deviceId).then(response=>response.json());
 await expect(read()).resolves.toEqual({live:null});
 await rejected(write(position),409);
 await station.change({type:'save',id:service.id,plan:{...service,songs:[station.song()]}});
 await rejected(publishStationLiveSong(station.request({live:position}),env,station.deviceId),403);
 await write(position);
 await expect(read()).resolves.toMatchObject({live:{...position,serviceTitle:'Tuesday worship',songTitle:'Împreună cântăm',expiresAt:expect.any(Number)}});
 const stranger=await fixture();
 await rejected(readStationLiveSong(stranger.request(),env,station.deviceId),403);
 await env.DB.prepare('UPDATE station_live_song SET expires_at=? WHERE device_id=?').bind(now()-1,station.deviceId).run();
 await expect(read()).resolves.toEqual({live:null});
 await write(position);
 await write(null);
 await expect(read()).resolves.toEqual({live:null});
 await write(position);
 await station.change({type:'archive',id:service.id,archived:true});
 await expect(read()).resolves.toEqual({live:null});
 await rejected(write(position),409);
});
