import {spawnSync} from 'node:child_process';
import buildGuard from '../desktop/build-release-guard.cjs';

const [device, app, ...extra]=process.argv.slice(2);
if(!device||device.startsWith('-')||!app||!app.endsWith('.app')||app.startsWith('-')||extra.length){
 console.error('Usage: node scripts/install-apple-preview.mjs <device> <path-to-signed.app>');
 process.exitCode=2;
}else{
 try {
  await buildGuard.requireBuildsAllowed();
  const result=spawnSync('xcrun',['devicectl','device','install','app','--device',device,app,'--timeout','30'],{stdio:'inherit'});
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
 } catch(error) {
  console.error(error.message);
  process.exitCode=1;
 }
}
