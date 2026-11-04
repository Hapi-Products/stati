import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {basename} from 'node:path';

export function publicationPlatform(argv) {
  if(argv.some(arg=>arg.startsWith('--platform')&&!arg.startsWith('--platform=')))throw Error('Use --platform=windows, --platform=android or --platform=all.');
  const flags=argv.filter(arg=>arg.startsWith('--platform='));
  if(flags.length>1)throw Error('Specify --platform only once.');
  const platform=flags.length?flags[0].slice(11):'all';
  if(!['windows','android','all'].includes(platform))throw Error('Use --platform=windows, --platform=android or --platform=all.');
  return platform;
}

export function publicationArtifacts(version,platform,{blockmap=false}={}) {
  const files=[];
  if(platform!=='android') {
    files.push({id:'windows-test',path:`release/Stati-Setup-${version}-x64.exe`,filename:`Stati-Windows-${version}-test.exe`,contentType:'application/octet-stream'});
    if(blockmap)files.push({path:`release/Stati-Setup-${version}-x64.exe.blockmap`});
  }
  if(platform!=='windows')files.push({id:'android-test',path:`release/Stati-Android-${version}-test.apk`,filename:`Stati-Android-${version}-test.apk`,contentType:'application/vnd.android.package-archive'});
  return files;
}

export async function hashArtifact(path) {
  const before=await stat(path);
  if(!before.isFile()||before.size===0)throw Error('Missing or empty preview artifact: '+path);
  const hash=createHash('sha256');
  for await(const bytes of createReadStream(path))hash.update(bytes);
  const after=await stat(path);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Preview artifact changed while hashing: '+path);
  return {name:basename(path),bytes:after.size,sha256:hash.digest('hex')};
}

// Await every started upload before returning a failure. Never publish while an upload is still running.
export async function mapUploads(items,upload,{concurrency=2}={}) {
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>2)throw Error('Upload concurrency must be 1 or 2.');
  const results=new Array(items.length);let next=0,failure;
  async function worker() {
    while(!failure&&next<items.length) {
      const index=next++;
      try{results[index]=await upload(items[index],index);}catch(error){failure??=error;}
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},worker));
  if(failure)throw failure;
  return results;
}

export function runCommand(command,args,{cwd=process.cwd(),env=process.env,inherit=false}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env,stdio:inherit?'inherit':['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout?.on('data',bytes=>{stdout+=bytes;if(stdout.length>8*1024*1024)child.kill();});
    child.stderr?.on('data',bytes=>{stderr+=bytes;if(stderr.length>8*1024*1024)child.kill();});
    child.on('error',reject);
    child.on('close',(status,signal)=>resolve({status,signal,stdout,stderr}));
  });
}

export function verifyReleaseAssets(release,expected,{draft}={}) {
  if(typeof draft==='boolean'&&release.draft!==draft)throw Error('GitHub release visibility did not match the expected state.');
  if(!Array.isArray(release.assets)||release.assets.length!==expected.length)throw Error('GitHub release assets do not match the selected artifacts.');
  const actual=new Map(release.assets.map(asset=>[asset.name,asset]));
  if(actual.size!==expected.length)throw Error('GitHub release contains duplicate asset names.');
  for(const artifact of expected) {
    const asset=actual.get(artifact.name);
    if(!asset||asset.size!==artifact.bytes||asset.digest?.toLowerCase()!=='sha256:'+artifact.sha256)throw Error('GitHub asset checksum or size did not match: '+artifact.name);
  }
}
