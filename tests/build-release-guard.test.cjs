const {test}=require('node:test');
const assert=require('node:assert/strict');
const {requireBuildsAllowed}=require('../desktop/build-release-guard.cjs');

test('only a current positive decision permits a build release',async()=>{
 const response=data=>async()=>Response.json(data);
 await requireBuildsAllowed({fetchStatus:response({version:1,allowed:true})});
 await assert.rejects(requireBuildsAllowed({fetchStatus:response({version:1,allowed:false})}),/Builds are paused/);
 for(const fetchStatus of [response({allowed:true}),response({version:1,allowed:'true'}),async()=>new Response('',{status:503}),async()=>{throw new Error('offline');}]){
  await assert.rejects(requireBuildsAllowed({fetchStatus}),/could not be checked/);
 }
});
