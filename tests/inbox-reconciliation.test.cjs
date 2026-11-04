const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const files=require('../desktop/station-files.cjs');
const id=()=>crypto.randomUUID();
const status=(id,extra={})=>({id,status:'queued',remoteAvailable:true,sender_role:'member',rejection_reason:null,expires_at:123,...extra});

test('status batches rotate through a large retained backlog and always include an active download first',()=>{
 const rows=Array.from({length:401},()=>({id:id(),status:'queued'})),active=rows[400].id,visible=rows[399].id;
 const seen=new Set();let cursor=0;
 for(let pass=0;pass<5;pass++){
  const batch=files.historyStatusBatch([...rows,{id:'legacy-non-uuid',status:'queued'},{id:id(),status:'delivered'}],[visible],cursor,[active,active]);
  assert.equal(batch.ids.length,100);assert.equal(batch.ids[0],active);assert.equal(new Set(batch.ids).size,100);assert.equal(batch.ids.includes(visible),false);for(const id of batch.ids)seen.add(id);cursor=batch.cursor;
 }
 assert.equal(seen.size,400);
 assert.deepEqual(files.historyStatusBatch([],[],123),{ids:[],cursor:0});
});
test('status responses must exactly cover requested IDs and cannot insert another file or duplicate a result',()=>{
 const first=id(),second=id();
 assert.deepEqual(files.historyStatusUpdates([first,second],{statuses:[status(second),status(first)]}).map(row=>row.id),[second,first]);
 for(const value of [{},null,{statuses:[]},{statuses:[status(first)]},{statuses:[status(first),status(first)]},{statuses:[status(first),status(id())]}])assert.throws(()=>files.historyStatusUpdates([first,second],value),/Invalid delivery/);
 for(const patch of [{status:'invented'},{remoteAvailable:'true'},{status:'expired',remoteAvailable:true},{remoteAvailable:false,sender_role:'admin'},{sender_role:'owner'},{expires_at:NaN},{expires_at:-1},{rejection_reason:'x'.repeat(501)}])assert.throws(()=>files.historyStatusUpdates([first],{statuses:[status(first,patch)]}),/Invalid delivery/);
});
test('queued unavailable and terminal responses preserve their independent availability fields',()=>{
 const key=id();assert.deepEqual(files.historyStatusUpdates([key],{statuses:[status(key,{remoteAvailable:false,sender_role:null})]})[0],status(key,{remoteAvailable:false,sender_role:null}));
 const rejected=files.historyStatusUpdates([key],{statuses:[status(key,{status:'rejected',remoteAvailable:false,sender_role:null,rejection_reason:'Different service'})]})[0];assert.equal(rejected.rejection_reason,'Different service');
});
async function diskFixture(t){const folder=await fs.mkdtemp(path.join(os.tmpdir(),'stati-inbox-status-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));return{folder,history:path.join(folder,'history.json'),receipts:path.join(folder,'receipts.json')};}
test('terminal reconciliation retains names and sender identity and cannot be revived by a late queue merge',async t=>{
 const f=await diskFixture(t),key=id();await files.mergeHistory(f.history,[{id:key,status:'queued',filename:'Cântare.txt',first_name:'Sender',created_at:1}]);
 for(const terminal of ['delivered','rejected','expired','unavailable']){
  await files.mergeHistory(f.history,[{id:key,status:terminal,rejection_reason:terminal==='rejected'?'Wrong version':null,remoteAvailable:false}]);
  const rows=await files.mergeHistory(f.history,[{id:key,status:'queued',remoteAvailable:true,sender_role:'admin'}]);assert.equal(rows[0].status,terminal);assert.equal(rows[0].remoteAvailable,false);assert.equal(rows[0].filename,'Cântare.txt');assert.equal(rows[0].first_name,'Sender');
 }
});
test('expired and unavailable history does not delete or alter receipts, saved bytes or the other queued cards',async t=>{
 const f=await diskFixture(t),saved=path.join(f.folder,'song.txt'),key=id(),waiting=id();await fs.writeFile(saved,'Original verified lyrics');await files.saveReceipt(f.receipts,key,saved);await files.mergeHistory(f.history,[{id:key,status:'queued',filename:'song.txt',created_at:1},{id:waiting,status:'queued',created_at:2}]);
 await files.mergeHistory(f.history,[{id:key,status:'expired',remoteAvailable:false}]);assert.equal((await files.mergeHistory(f.history,[])).find(row=>row.id===waiting).status,'queued');assert.equal((await files.readReceipts(f.receipts))[key],saved);assert.equal(await fs.readFile(saved,'utf8'),'Original verified lyrics');await files.clearHistory(f.history,[key,waiting]);assert.deepEqual((await files.mergeHistory(f.history,[])).map(row=>row.id),[waiting]);assert.equal((await files.readReceipts(f.receipts))[key],saved);assert.equal(await fs.readFile(saved,'utf8'),'Original verified lyrics');
});
test('a cancelled history commit keeps the exact old file and removes its temporary metadata file',async t=>{
 const f=await diskFixture(t),key=id();await files.mergeHistory(f.history,[{id:key,status:'queued',created_at:1}]);const before=await fs.readFile(f.history);let checks=0;
 await assert.rejects(files.mergeHistory(f.history,[{id:key,status:'expired'}],{beforeCommit:()=>{if(++checks===2)throw Error('Credential changed');}}),/Credential changed/);assert.deepEqual(await fs.readFile(f.history),before);assert.deepEqual(await fs.readdir(f.folder),['history.json']);
});
test('a waiting serialized merge checks its lifecycle before committing after another operation',async t=>{
 const f=await diskFixture(t),key=id();let release,entered;const waiting=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);let active=true;
 const first=files.mergeHistory(f.history,[{id:key,status:'queued',created_at:1}],{beforeCommit:async()=>{entered();await waiting;}});await started;
 const second=files.mergeHistory(f.history,[{id:key,status:'expired'}],{beforeCommit:()=>{if(!active)throw Error('Old poll stopped');}});const rejected=assert.rejects(second,/Old poll stopped/);active=false;release();await first;await rejected;assert.equal((await files.mergeHistory(f.history,[]))[0].status,'queued');
});
