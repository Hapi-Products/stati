import {randomBytes} from 'node:crypto';
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
let settings='';try{settings=await readFile('.dev.vars','utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
let secret=settings.match(/^ENROLLMENT_SECRET="?([a-f0-9]{64})"?$/m)?.[1];if(!secret){secret=randomBytes(32).toString('hex');await writeFile('.dev.vars',settings+'\nENROLLMENT_SECRET="'+secret+'"\n',{mode:0o600});}await chmod('.dev.vars',0o600);
const result=spawnSync('node',['node_modules/wrangler/bin/wrangler.js','secret','put','ENROLLMENT_SECRET','--env','production'],{input:secret+'\n',encoding:'utf8'});if(result.status!==0){process.stderr.write('Authenticator configuration failed. The local secret was preserved for retry.\n');process.exit(1);}process.stdout.write('Authenticator secret configured. Secret values were not printed.\n');
