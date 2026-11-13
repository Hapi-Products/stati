import {SELF,env} from 'cloudflare:test';
import {afterEach,expect,it,vi} from 'vitest';
import {fixture} from './helpers/service-fixture';

const origin='http://localhost:8787';
const status=async()=>await (await SELF.fetch(origin+'/api/build-status')).json();
const adminRoute=(session:string,paused?:boolean,requestOrigin=origin)=>SELF.fetch(origin+'/api/admin/build-pause',{
 method:paused===undefined?'GET':'PUT',headers:{Cookie:'stati_session='+session,Origin:requestOrigin},
 body:paused===undefined?undefined:JSON.stringify({paused})
});
afterEach(()=>vi.useRealTimers());

it('allows only active admins to change the manual pause and keeps it across sessions',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-12T17:00:00-07:00'));
 const admin=await fixture(null,true),second=await fixture(null,true),member=await fixture('worship_leader');
 expect(await status()).toEqual({version:1,allowed:true});
 expect((await adminRoute(member.session)).status).toBe(403);
 expect((await adminRoute(member.session,true)).status).toBe(403);
 expect((await adminRoute(admin.session,true,'https://elsewhere.example')).status).toBe(403);
 expect(await (await adminRoute(admin.session,true)).json()).toMatchObject({manualPaused:true,allowed:false});
 expect(await status()).toEqual({version:1,allowed:false});
 expect(await (await adminRoute(second.session)).json()).toMatchObject({manualPaused:true});
 await env.DB.prepare("UPDATE users SET role='member' WHERE id=?").bind(admin.user).run();
 expect((await adminRoute(admin.session,false)).status).toBe(403);
 expect(await (await adminRoute(second.session,false)).json()).toMatchObject({manualPaused:false,allowed:true});
 expect(await env.DB.prepare("SELECT action FROM audit WHERE actor_id=? AND subject_id='release_manual_pause'").bind(second.user).first()).toEqual({action:'resume-builds'});
});

it('blocks for a scheduled service and resumes at the end, unless a manual pause is still set',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-12T18:59:59-07:00'));
 expect(await status()).toMatchObject({allowed:true});
 vi.setSystemTime(new Date('2026-11-12T19:00:00-07:00'));
 expect(await status()).toMatchObject({allowed:false});
 const adminDuring=await fixture(null,true);
 expect(await (await adminRoute(adminDuring.session,false)).json()).toMatchObject({manualPaused:false,allowed:false});
 vi.setSystemTime(new Date('2026-11-12T21:00:00-07:00'));
 expect(await status()).toMatchObject({allowed:true});
 const adminAfter=await fixture(null,true);
 expect((await adminRoute(adminAfter.session,true)).status).toBe(200);
 vi.setSystemTime(new Date('2026-11-13T00:00:00-07:00'));
 expect(await status()).toMatchObject({allowed:false});
 const adminNextDay=await fixture(null,true);
 expect(await (await adminRoute(adminNextDay.session,false)).json()).toMatchObject({allowed:true});
});

it('keeps protecting a selected service outside the schedule until it is cleared',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-12T21:30:00-07:00'));
 const admin=await fixture(null,true);
 const plan=await admin.create();
 expect(plan.active).toBe(true);
 expect(await status()).toMatchObject({allowed:false});
 expect(await (await adminRoute(admin.session,false)).json()).toMatchObject({manualPaused:false,activeService:true,allowed:false});
 await admin.change({type:'select',id:null});
 expect(await status()).toMatchObject({allowed:true});
});
