// Local-only browser acceptance harness. Production entry/config never imports this file.
import worker from '../../src/server/index';
import {hash} from '../../src/server/core';
const user='11111111-1111-4111-8111-111111111111',device='22222222-2222-4222-8222-222222222222';
let initialized:Promise<void>|undefined;
async function seed(env:Env){
 const time=Math.floor(Date.now()/1000),sessionHash=await hash('local-rebuild-session');
 await env.DB.batch([
  env.DB.prepare("INSERT OR IGNORE INTO users(id,first_name,last_initial,status,role,created_at) VALUES(?,?,?,'active','admin',?)").bind(user,'Test operator','F',time),
  env.DB.prepare("INSERT OR IGNORE INTO users(id,first_name,last_initial,status,role,created_at) VALUES('33333333-3333-4333-8333-333333333333','Long test member name','T','active','member',?)").bind(time),
  env.DB.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').bind(sessionHash,user,time+86400),
  env.DB.prepare("INSERT OR IGNORE INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)").bind(device,await hash('isolated-device'),'Test station',user,time,0,time),
  env.DB.prepare("INSERT OR IGNORE INTO station_catalog_snapshots(device_id,generation,expected_count,status,ready_at,updated_at) VALUES(?,'fixture',18,'ready',?,?)").bind(device,time,time),
 ]);
 const names=['Împreună cântăm','A song for rehearsal','Doamne, noi cântăm','Test group arrangement','A very long song name to check wrapping on a narrow phone screen','Crezul'];
 for(let index=0;index<18;index++){
  const title=names[index%names.length]+(index>5?' '+(index+1):''),text=index%2?'Lord, we sing your glory\nTogether we praise Your name':'Doamne, noi cântăm\nSlavă pentru Tine',songId=await hash('fixture-song-'+index);
  await env.DB.prepare("INSERT OR IGNORE INTO station_catalog(device_id,song_id,title,content_hash,filename,category,language,font_size,text,first_slide,added_at,modified_at,generation,search_text,payload_bytes,group_name) VALUES(?,?,?,?,?,'Lyrics',?,96,?,?,?,?,?,?,0,?)").bind(device,songId,title,await hash(text),songId+'.pro',index%2?'eng':'ron',text,text,time,time,'fixture',(title+' '+text).toLocaleLowerCase(),index===3?'Youth':null).run();
 }
}
export default {
 async fetch(request:Request,env:Env,context:ExecutionContext){
  const url=new URL(request.url);if(!['localhost','127.0.0.1'].includes(url.hostname))return new Response('Local test harness only',{status:403});
  await(initialized||=seed(env));
  const headers=new Headers(request.headers);headers.set('Cookie','stati_session=local-rebuild-session');
  const response=await worker.fetch(new Request(request,{headers}),env,context);
  if(response.headers.get('Content-Type')?.includes('text/html')){
   const outputHeaders=new Headers(response.headers);outputHeaders.set('X-Stati-Fixture','isolated-local-only');
   return new Response((await response.text()).replace('<body>','<body><p class="fixture-banner" role="status">Isolated browser check · test profile and temporary songs · no production connection</p>'),{status:response.status,headers:outputHeaders});
  }
  return response;
 }
};
