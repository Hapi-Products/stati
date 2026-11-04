import {now} from './core';

// Eligible transfers only move toward expiry/decided status. Their immutable
// random object keys cannot be reassigned by the upload API.
export async function cleanupTransfers(env:Env,time=now()){
 const eligible=await env.DB.prepare("SELECT id,object_key FROM transfers WHERE expires_at<? OR status IN ('delivered','rejected') ORDER BY created_at,id LIMIT 500").bind(time).all<{id:string;object_key:string}>();
 if(!eligible.results.length)return {failed:0,attempted:0};
 const saved:{id:string;object_key:string}[]=[];let failed=0;
 try{await env.FILES.delete(eligible.results.map(row=>row.object_key));saved.push(...eligible.results);}
 catch{
  // A bulk failure may be partial. Idempotent per-key retries keep one failed
  // object from blocking others, without a D1 query for each deleted file.
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,eligible.results.length)},async()=>{
   for(;;){const row=eligible.results[cursor++];if(!row)break;try{await env.FILES.delete(row.object_key);saved.push(row);}catch{failed++;}}
  }));
 }
 if(saved.length)try{
  await env.DB.prepare("DELETE FROM transfers WHERE (id,object_key) IN (SELECT json_extract(value,'$.id'),json_extract(value,'$.object_key') FROM json_each(?)) AND (expires_at<? OR status IN ('delivered','rejected'))").bind(JSON.stringify(saved),time).run();
 }catch{failed+=saved.length;}
 return {failed,attempted:eligible.results.length};
}
