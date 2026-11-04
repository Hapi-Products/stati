const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {removeLegacyDesktopShortcuts}=require('../desktop/desktop-shortcut.cjs');
async function fixture(run){const root=await fs.mkdtemp(path.join(os.tmpdir(),'stati-shortcut-test-'));try{await run(root);}finally{await fs.rm(root,{recursive:true,force:true});}}

test('a successful migration runs quietly once per install path and retains recovery shortcuts',()=>fixture(async userData=>{
 const calls=[],options={userData,executablePath:'C:\\Users\\Church\\Apps\\Stați.exe',scriptDirectory:path.join('fixture','app.asar','desktop'),execFile:(...args)=>{calls.push(args.slice(0,3));args[3](null);}};
 assert.equal(await removeLegacyDesktopShortcuts(options),true);assert.equal(await removeLegacyDesktopShortcuts(options),false);
 assert.equal(await removeLegacyDesktopShortcuts({...options,executablePath:'c:\\USERS\\church\\Apps\\Stați.exe'}),false);
 assert.equal(calls.length,1);assert.equal(calls[0][0],'powershell.exe');
 const argv=calls[0][1];assert.ok(argv.includes('-NonInteractive'));assert.equal(argv[argv.indexOf('-File')+1],path.join('fixture','app.asar.unpacked','desktop','desktop-shortcut.ps1'));
 assert.equal(argv[argv.indexOf('-BackupDirectory')+1],path.join(userData,'legacy-desktop-shortcuts'));
 assert.deepEqual(calls[0][2],{windowsHide:true,timeout:10000});
 assert.equal(await removeLegacyDesktopShortcuts({...options,executablePath:'D:\\Stați.exe'}),true);assert.equal(calls.length,2);
 assert.deepEqual((await fs.readdir(userData)),['desktop-shortcut-migration.json']);
}));

test('failed or interrupted cleanup leaves no success marker and retries on the next launch',()=>fixture(async userData=>{
 let calls=0,fail=true;const options={userData,executablePath:'C:\\Stați.exe',execFile:(...args)=>{calls++;args[3](fail?Error('Denied'):null);}};
 await assert.rejects(()=>removeLegacyDesktopShortcuts(options),/Denied/);assert.deepEqual(await fs.readdir(userData),[]);
 fail=false;assert.equal(await removeLegacyDesktopShortcuts(options),true);assert.equal(calls,2);
 await fs.writeFile(path.join(userData,'desktop-shortcut-migration.json'),'interrupted marker');assert.equal(await removeLegacyDesktopShortcuts(options),true);assert.equal(calls,3);
}));

test('legacy cleanup targets only two exact Stați aliases pointing at this executable, with no Shell recycle or refresh',async()=>{
 const script=await fs.readFile(path.join(__dirname,'../desktop/desktop-shortcut.ps1'),'utf8');
 assert.match(script,/DesktopDirectory.*CommonDesktopDirectory/);assert.match(script,/0x021b.*Stati\.lnk/);
 assert.match(script,/GetFullPath\(\$shortcut\.TargetPath\)\.Equals\(\$expected, \[StringComparison\]::OrdinalIgnoreCase\)/);
 assert.match(script,/\[IO\.File\]::Move\(\$shortcutPath, \$backupPath\)/);
 assert.doesNotMatch(script,/SendToRecycleBin|DeleteFile|Remove-Item|SHChangeNotify|Stop-Process|Restart-Computer/);
 assert.match(script,/catch \{ throw/);
});
