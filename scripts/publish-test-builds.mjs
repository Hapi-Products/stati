import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {publicationPlatform,publicationArtifacts,hashArtifact,mapUploads,runCommand} from './publish-utils.mjs';
import {verifyWindowsPreview,verifyAndroidPreview} from './publish-preview.mjs';

export function verifyDownloadMetadata(response,records) {
  if(!Array.isArray(response)||response.length!==1||response[0].success!==true||!Array.isArray(response[0].results))throw Error('Test download metadata readback returned an invalid result.');
  const rows=response[0].results,expected=new Map(records.map(record=>['release_'+record.id,record]));
  if(rows.length!==expected.size)throw Error('Test download metadata readback did not return every selected platform.');
  const seen=new Set();
  for(const row of rows) {
    const record=expected.get(row.key);
    if(!record||seen.has(row.key))throw Error('Test download metadata readback returned an unexpected or duplicate platform.');
    let actual;try{actual=JSON.parse(row.value);}catch{throw Error('Test download metadata readback returned invalid JSON.');}
    if(!actual||typeof actual!=='object'||Array.isArray(actual)||Object.keys(actual).length!==Object.keys(record).length||Object.entries(record).some(([key,value])=>actual[key]!==value))throw Error('Test download metadata readback did not match: '+record.id);
    seen.add(row.key);
  }
  return records;
}

export async function publishTestBuilds({argv=process.argv.slice(2),cwd=process.cwd(),env=process.env,run=runCommand,verifyWindows=verifyWindowsPreview,verifyAndroid=verifyAndroidPreview}={}) {
  const platform=publicationPlatform(argv),version=JSON.parse(await readFile(join(cwd,'package.json'),'utf8')).version;
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Use a stable numeric version.');
  const files=publicationArtifacts(version,platform);
  const records=await mapUploads(files,async artifact=>{
    const {bytes,sha256}=await hashArtifact(join(cwd,artifact.path));
    return {id:artifact.id,filename:artifact.filename,version,objectKey:`releases/${version}/${sha256}/${artifact.filename}`,bytes,sha256,test:true};
  });
  if(platform!=='android') {
    const preview=JSON.parse(await readFile(join(cwd,'desktop/preview-build.json'),'utf8')).number;
    await verifyWindows({cwd,version,preview,env,run});
  }
  if(platform!=='windows')await verifyAndroid({cwd,version,env,run});
  await mapUploads(files,async (artifact,index)=>{
    const result=await run(process.execPath,['node_modules/wrangler/bin/wrangler.js','r2','object','put','stati-files/'+records[index].objectKey,'--remote','--env','production','--file',artifact.path,'--content-type',artifact.contentType],{cwd,env,inherit:true});
    if(result.status!==0)throw Error('Test artifact upload failed; published metadata was preserved.');
    const after=await hashArtifact(join(cwd,artifact.path));
    if(after.sha256!==records[index].sha256||after.bytes!==records[index].bytes)throw Error('Test artifact changed during upload; published metadata was preserved.');
  });
  const directory=await mkdtemp(join(tmpdir(),'stati-releases-'));
  try {
    const file=join(directory,'releases.sql');
    const sql=records.map(record=>`INSERT INTO settings(key,value) VALUES('release_${record.id}','${JSON.stringify(record).replaceAll("'","''")}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;`).join('\n');
    await writeFile(file,sql,{mode:0o600});
    const result=await run(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','stati','--remote','--env','production','--file',file],{cwd,env,inherit:true});
    if(result.status!==0)throw Error('Test artifacts uploaded, but metadata update failed. Retry without deleting artifacts.');
    const query="SELECT key,value FROM settings WHERE key IN ("+records.map(record=>"'release_"+record.id+"'").join(',')+")";
    const readback=await run(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','stati','--remote','--env','production','--command',query,'--json'],{cwd,env});
    if(readback.status!==0)throw Error('Test download metadata was written, but readback failed. Inspect production release settings before retrying.');
    let response;try{response=JSON.parse(readback.stdout);}catch{throw Error('Test download metadata was written, but readback was not valid JSON. Inspect production release settings before retrying.');}
    verifyDownloadMetadata(response,records);
    return {platform,records,metadataVerified:true};
  } finally {await rm(directory,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.includes('--help'))console.log('Usage: node scripts/publish-test-builds.mjs [--platform=windows|android|all]\nDefault platform: all. Publishes only the selected administrator download entries after successful uploads.');
  else {
    await publishTestBuilds();
    console.log('Administrator-only test download metadata published and verified. R2 upload completed; its full payload was not downloaded again.');
  }
}
