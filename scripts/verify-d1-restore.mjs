// Read-only production export; restore is always local and all copies are temporary.
import {spawnSync} from 'node:child_process';
import {mkdtemp,chmod,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

const directory=await mkdtemp(join(tmpdir(),'stati-restore-drill-'));
await chmod(directory,0o700);
const databases=[];
function wrangler(args){
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{encoding:'utf8',maxBuffer:8*1024*1024});
 // Do not emit CLI output: SQL exports contain private account/session records.
 if(result.status!==0)throw new Error('Restore drill CLI step failed: '+args.slice(0,2).join(' '));
}
const identifier=name=>'"'+name.replaceAll('"','""')+'"';
const tables=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map(row=>row.name);
function digest(db,table){
 const rows=db.prepare('SELECT * FROM '+identifier(table)).all().map(row=>JSON.stringify(row)).sort();
 return {rows:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
}
try{
 const sql=join(directory,'snapshot.sql'),persistence=join(directory,'local');
 wrangler(['d1','export','stati','--remote','--env','production','--output',sql,'--skip-confirmation']);
 await chmod(sql,0o600);
 wrangler(['d1','execute','stati','--local','--env','production','--persist-to',persistence,'--file',sql,'--yes']);
 const expected=new DatabaseSync(':memory:');databases.push(expected);
 expected.exec(await readFile(sql,'utf8'));
 const candidates=(await readdir(persistence,{recursive:true})).filter(path=>path.endsWith('.sqlite'));
 let restored;
 for(const path of candidates){const db=new DatabaseSync(join(persistence,path),{readOnly:true});databases.push(db);if(tables(db).includes('users')){restored=db;break;}}
 if(!restored)throw new Error('Restored application database was not found.');
 const names=tables(expected);
 if(JSON.stringify(names)!==JSON.stringify(tables(restored)))throw new Error('Restored table set differs from the exported snapshot.');
 for(const table of names){
  if(JSON.stringify(digest(expected,table))!==JSON.stringify(digest(restored,table)))throw new Error('Restored table content mismatch: '+table);
  const schema=db=>db.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name=? AND sql IS NOT NULL ORDER BY type,name").all(table);
  if(JSON.stringify(schema(expected))!==JSON.stringify(schema(restored)))throw new Error('Restored schema mismatch: '+table);
 }
 for(const db of [expected,restored]){
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Database integrity check failed.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Database foreign-key check failed.');
 }
 console.log(JSON.stringify({result:'passed',tablesVerified:names.length,contents:'exact snapshot match',schema:'exact snapshot match',integrity:'ok',foreignKeys:'ok',productionWrites:0}));
}finally{
 for(const db of databases)db.close();
 await rm(directory,{recursive:true,force:true});
 console.log('Temporary database exports and restored copies removed.');
}
