import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
const require=createRequire(import.meta.url),{recoverSigningBackup}=require('./recover-signing-backup.cjs');
const file=process.argv[2];if(!file)throw new Error('Supply the encrypted .statibackup file path.');const encrypted=await readFile(file);if(!process.stdin.isTTY)throw new Error('Run this in a terminal and enter the passphrase privately. Do not put it in command arguments or chat.');
const muted=new Writable({write(_chunk,_encoding,callback){callback();}}),input=createInterface({input:process.stdin,output:muted,terminal:true});process.stdout.write('Backup passphrase: ');let passphrase;try{passphrase=await input.question('');}finally{input.close();process.stdout.write('\n');}
try{const result=await recoverSigningBackup(encrypted,passphrase);console.log('Recovered private-key signing verified. Certificate SHA-256: '+result.fingerprint);}finally{passphrase='';}
