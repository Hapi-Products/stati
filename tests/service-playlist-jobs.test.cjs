const {test}=require('node:test'),assert=require('node:assert/strict');
const {createServicePlaylistJobs}=require('../desktop/service-playlist-jobs.cjs');
function fixture(overrides={}){
 let selected={id:'profile-one',generation:1};const changes=[],events=[],calls=[];
 const manager={sync:async(user,options)=>calls.push({user,...options}),flush:async()=>events.push('flushed')};
 const jobs=createServicePlaylistJobs({manager,plansStore:{change:async(...args)=>changes.push(args)},current:()=>selected,readDirectory:async()=>'/Lyrics',work:async(...args)=>{events.push(args);return[{songId:'a'.repeat(64),contentHash:'b'.repeat(64),title:'Împreună',filename:'song.pro'}];},onChanged:operator=>events.push(operator.id),delay:10,...overrides});
 return{jobs,manager,calls,changes,events,switch:()=>{selected={id:'profile-two',generation:2};jobs.cancel();},clear:()=>{selected=null;jobs.cancel();}};
}
test('saved ProPresenter files attach once to the captured active service before background syncing',async()=>{
 const f=fixture(),result={path:'/Lyrics/song.pro'};assert.equal(await f.jobs.attach({id:'profile-one',generation:1},result,[result.path],'service-id'),result);
 assert.equal(f.changes.length,1);assert.equal(f.changes[0][0],'profile-one');assert.equal(f.changes[0][1].expectedActiveServiceId,'service-id');assert.equal(f.changes[0][1].songs[0].title,'Împreună');
 await f.jobs.run();assert.equal(f.calls.length,1);assert.equal(f.calls[0].user,'profile-one');await f.jobs.flush();
});
test('no selected service leaves Lyrics alone and creates no guessed service or network task',async()=>{
 const f=fixture(),result={path:'/Lyrics/song.pro'};assert.equal(await f.jobs.attach({id:'profile-one',generation:1},result,[result.path],null),result);assert.equal(f.events.length,0);assert.equal(f.changes.length,0);await f.jobs.flush();
});
test('a profile switch during file resolution prevents service mutation and keeps the completed file result',async()=>{
 let finish;const f=fixture({work:()=>new Promise(resolve=>finish=resolve)}),result={path:'/Lyrics/song.pro'};
 const task=f.jobs.attach({id:'profile-one',generation:1},result,[result.path],'service-id');await new Promise(resolve=>setImmediate(resolve));f.switch();finish([{songId:'a'.repeat(64)}]);const saved=await task;
 assert.equal(saved.path,result.path);assert.match(saved.playlistMessage,/file was saved.*selected user changed/i);assert.equal(f.changes.length,0);assert.equal(f.calls.length,0);await f.jobs.flush();
});
test('a stale service target failure reports saved-file success without silently adding to another service',async()=>{
 const f=fixture({plansStore:{change:async()=>{throw Error('The selected service changed.');}}}),result={path:'/Lyrics/song.pro'};
 const saved=await f.jobs.attach({id:'profile-one',generation:1},result,[result.path],'previous-service');assert.equal(saved.path,result.path);assert.match(saved.playlistMessage,/file was saved.*selected service changed/i);assert.equal(f.calls.length,0);await f.jobs.flush();
});
test('Windows lock cancels in-flight playlist work and a new operator cannot inherit the prior completion',async()=>{
 let entered,finish;const started=new Promise(resolve=>entered=resolve),events=[];
 const f=fixture({manager:{sync:async(user,{signal})=>{entered(signal);await new Promise(resolve=>finish=resolve);},flush:async()=>{}},onChanged:operator=>events.push(operator.id)});
 const first=f.jobs.run(),signal=await started;assert.equal(signal.aborted,false);f.switch();assert.equal(signal.aborted,true);finish();await first;assert.deepEqual(events,[]);await f.jobs.flush();
});
test('many sync triggers coalesce while a slow local API is working',async()=>{
 let entered,finish,calls=0;const started=new Promise(resolve=>entered=resolve);
 const f=fixture({manager:{sync:async()=>{calls++;if(calls===1){entered();await new Promise(resolve=>finish=resolve);}},flush:async()=>{}}});
 const first=f.jobs.run();await started;for(let i=0;i<100;i++)f.jobs.schedule();assert.equal(calls,1);finish();await first;await new Promise(resolve=>setTimeout(resolve,30));assert.equal(calls,2);await f.jobs.flush();
});
