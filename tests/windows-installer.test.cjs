const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const upstreamRoot=path.dirname(require.resolve('app-builder-lib/package.json'));

test('the NSIS override changes only the reviewed update refresh and fails closed on dependency drift',()=>{
 const source=JSON.parse(read('desktop/nsis/SOURCE.json')),upstream=fs.readFileSync(path.join(upstreamRoot,source.source),'utf8');
 assert.equal(require(path.join(upstreamRoot,'package.json')).version,source.version);
 assert.equal(crypto.createHash('sha256').update(upstream).digest('hex'),source.upstreamSha256);
 const before="  # refresh the desktop\n  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'";
 const after="  # An upgrade keeps the same shortcut targets and AppUserModelID. Avoid a\n  # global association/icon-cache refresh that makes every desktop icon flicker.\n  # A real uninstall still refreshes Explorer after removing its shortcuts.\n  ${ifNot} ${isUpdated}\n  ${andIfNot} ${isKeepShortcuts}\n    System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'\n  ${endIf}";
 assert.equal(upstream.split(before).length,2);assert.equal(read('desktop/nsis/uninstaller.nsh'),'!define STATI_REVIEWED_UNINSTALLER\n'+upstream.replace(before,after));
});

test('installer retains the signed stock pipeline, disables desktop aliases, and preserves taskbar/start menu identity',()=>{
 const config=JSON.parse(read('desktop/builder.json'));assert.equal(config.nsis.include,'desktop/windows-installer.nsh');assert.equal(config.nsis.script,undefined);
 assert.equal(config.nsis.createDesktopShortcut,false);assert.equal(config.appId,'org.hapiproducts.stati');assert.equal(config.nsis.shortcutName,'Stați');assert.notEqual(config.nsis.createStartMenuShortcut,false);
 const include=read(config.nsis.include);assert.match(include,/!ifndef STATI_REVIEWED_UNINSTALLER/);assert.match(include,/!error/);assert.ok(include.includes('!addincludedir "${PROJECT_DIR}/node_modules/app-builder-lib/templates/nsis"'));assert.ok(include.includes('!cd "${PROJECT_DIR}/desktop/nsis"'));
 const util=fs.readFileSync(path.join(upstreamRoot,'templates/nsis/include/installUtil.nsh'),'utf8');assert.match(util,/StrCpy \$0 "\$0 --updated"/);assert.match(util,/StrCpy \$0 "\$0 --keep-shortcuts"/);
 assert.ok(read('desktop/nsis/multiUser.nsh').includes('!include "${PROJECT_DIR}/node_modules/app-builder-lib/templates/nsis/multiUser.nsh"'));
 assert.doesNotMatch(include,/Restart|taskkill|Stop-Process|PinToTaskbar|UninstAppUserModelId/);
});
