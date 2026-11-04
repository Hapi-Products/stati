import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);const result=spawnSync(require('electron'),['scripts/android-signing.cjs',...(process.argv.includes('--backup')?['--backup']:process.argv.includes('--rotate-password')?['--rotate-password']:process.argv.includes('--setup-only')?[]:['--build'])],{stdio:'inherit',env:{...process.env,STATI_NODE_BINARY:process.execPath}});process.exit(result.status===0?0:(result.status||1));
