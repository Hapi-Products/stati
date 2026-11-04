const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const fixturePath=path.resolve(__dirname,'background-receiver.test.cjs'),source=fs.readFileSync(fixturePath,'utf8');
const load=vm.runInThisContext('(function(require,__dirname){'+source.slice(0,source.indexOf('\ntest('))+'\nreturn{fixture,drain,deferred};})',{filename:fixturePath});
const {fixture,drain,deferred}=load(createRequire(fixturePath),path.dirname(fixturePath));
const warning={id:'pair-fixture',name:'Private song.pro',kind:'missing-pro',message:'Missing ProPresenter library song'};
function native(options={}){let clock=0,calls=0,clears=0,run=async()=>({updated:0,warnings:[warning]});const f=fixture({notifications:true,at:'2026-10-26T07:00:00Z',...options,modules:{'./presentation-monitor.cjs':{createPresentationMonitor:options=>require('../desktop/presentation-monitor.cjs').createPresentationMonitor({...options,now:()=>clock})},'./presentation-tools.cjs':{installPresentationTools:()=>({backgroundSync:async()=>{calls++;return run();},clear(){clears++;},cancel(){}})}}});return{...f,advance:ms=>{clock+=ms;f.advance(ms);},callsMade:()=>calls,clears:()=>clears,setRun:value=>{run=value;}};}
const operator={id:'monitor-admin-fixture',role:'admin',capabilities:{readSongs:true,editLyrics:true,planServices:true}};
const attention=f=>f.calls.filter(call=>call[0]==='notification'&&call[1].title==='Stați · Linked song needs attention');
test('actual Windows background polling checks links only for an unlocked authorized operator and throttles repeats',async()=>{
 const f=native();await f.start();await drain();assert.equal(f.callsMade(),0);
 f.selectOperator({...operator,capabilities:{...operator.capabilities,editLyrics:false}});f.api.pollInBackground();await drain();assert.equal(f.callsMade(),0);
 f.selectOperator(operator);f.api.pollInBackground();await drain();assert.equal(f.callsMade(),1);assert.equal(attention(f).length,1);assert.doesNotMatch(attention(f)[0][1].body,/Private song/);
 f.api.pollInBackground();await drain();assert.equal(f.callsMade(),1);f.advance(60001);f.api.pollInBackground();await drain();assert.equal(f.callsMade(),2,JSON.stringify({active:f.api.getState().activeOperator,privacy:f.api.getState().privacyUnlocked,locked:f.api.getState().sessionLocked,notifications:attention(f).length}));assert.equal(attention(f).length,1);
});
test('a Windows lock cancels the native sync scope and suppresses late missing-file notices',async()=>{
 const f=native(),held=deferred();await f.start();await drain();f.selectOperator(operator);f.setRun(()=>held.promise);f.api.pollInBackground();await drain();assert.equal(f.callsMade(),1);
 f.power.emit('lock-screen');held.resolve({warnings:[warning]});await drain();assert.ok(f.clears()>0);assert.equal(attention(f).length,0);f.advance(60001);f.api.pollInBackground();await drain();assert.equal(f.callsMade(),1);
});
test('the new background synchronization monitor does not run on macOS',async()=>{
 const f=native({platform:'darwin'});await f.start();f.selectOperator(operator);f.api.pollInBackground();await drain();assert.equal(f.callsMade(),0);assert.equal(attention(f).length,0);
});
