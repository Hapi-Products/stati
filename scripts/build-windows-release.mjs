import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Validate before packaging; never silently fall back to an unsigned production release.
require('../desktop/builder.release.cjs');
const result=spawnSync(process.execPath,['node_modules/electron-builder/cli.js','--config','desktop/builder.release.cjs','--win','nsis','--x64','--publish','never'],{encoding:'utf8',maxBuffer:10*1024*1024});
const secrets=[process.env.CSC_KEY_PASSWORD,process.env.WIN_CSC_KEY_PASSWORD,process.env.AZURE_CLIENT_SECRET].filter(Boolean);
const redact=value=>secrets.reduce((output,secret)=>output.replaceAll(secret,'[REDACTED]'),value||'');
process.stdout.write(redact(result.stdout));process.stderr.write(redact(result.stderr));process.exit(result.status===0?0:(result.status||1));
