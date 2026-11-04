const {test}=require('node:test'),assert=require('node:assert/strict');
const {createSongAutosave}=require('../src/shared/song-autosave.js');
const result=hash=>({contentHash:hash,path:'Lyrics/song.pro',title:'Same title'});
test('typing while a write is in flight saves the latest lyrics using the returned hash',async()=>{
 let finish;const calls=[],states=[];
 const saver=createSongAutosave({save:(id,hash,data)=>{calls.push({id,hash,data});return calls.length===1?new Promise(resolve=>finish=resolve):Promise.resolve(result('third'));},onState:value=>states.push(value.state),delay:100000});
 saver.open({id:'song',contentHash:'first',data:{text:'original'}});saver.edit({text:'first edit'});
 const pending=saver.flush();saver.edit({text:'second edit'});saver.edit({text:'latest edit'});finish(result('second'));await pending;
 assert.deepEqual(calls,[{id:'song',hash:'first',data:{text:'first edit'}},{id:'song',hash:'second',data:{text:'latest edit'}}]);assert.equal(states.at(-1),'saved');saver.dispose();
});
test('a failed autosave keeps the latest lyrics and manual flush retries without inventing a new hash',async()=>{
 let failed=true;const calls=[],states=[];const saver=createSongAutosave({save:async(id,hash,data)=>{calls.push({id,hash,data});if(failed)throw Error('The song changed externally.');return result('next');},onState:value=>states.push(value),delay:100000});
 saver.open({id:'song',contentHash:'old',data:{text:'original'}});saver.edit({text:'kept edit'});await assert.rejects(saver.flush(),/changed externally/);assert.equal(states.at(-1).state,'error');failed=false;await saver.flush();assert.deepEqual(calls.map(c=>c.hash),['old','old']);assert.equal(calls[1].data.text,'kept edit');saver.dispose();
});
test('a response after switching songs cannot change the new song hash or saved state',async()=>{
 let finish;const saved=[],calls=[];const saver=createSongAutosave({save:(id,hash,data)=>{calls.push({id,hash,data});return id==='one'?new Promise(resolve=>finish=resolve):Promise.resolve(result('two-new'));},onSaved:value=>saved.push(value),delay:100000});
 saver.open({id:'one',contentHash:'one-old',data:'one'});saver.edit('changed one');const pending=saver.flush();saver.open({id:'two',contentHash:'two-old',data:'two'});saver.edit('changed two');finish(result('one-new'));await pending;await saver.flush();assert.deepEqual(saved,[result('two-new')]);assert.equal(calls[1].hash,'two-old');saver.dispose();
});
test('an unchanged song is never rewritten just because it was opened',async()=>{
 let writes=0;const saver=createSongAutosave({save:async()=>{writes++;return result('same');}});saver.open({id:'song',contentHash:'same',data:'original'});saver.edit('original');await saver.flush();assert.equal(writes,0);saver.dispose();
});
test('default browser timers keep their required global receiver while lyric edits schedule and cancel autosave',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),source=fs.readFileSync(require.resolve('../src/shared/song-autosave.js'),'utf8');
 const browser=vm.createContext({});
 vm.runInContext(`globalThis.scheduled=[];globalThis.canceled=[];function setTimeout(callback,delay){if(this!==globalThis)throw TypeError('Illegal invocation');scheduled.push({callback,delay});return scheduled.length;}function clearTimeout(id){if(this!==globalThis)throw TypeError('Illegal invocation');canceled.push(id);}`,browser);
 const create=vm.runInContext(source.replace(/^export /gm,'')+'\ncreateSongAutosave;',browser),writes=[];
 const saver=create({save:async(id,hash,data)=>{writes.push({id,hash,data});return result('saved-hash');}});
 saver.open({id:'song',contentHash:'original-hash',data:{text:'Before deletion\nLine to delete'}});
 assert.doesNotThrow(()=>saver.edit({text:'Before deletion'}));assert.equal(browser.scheduled[0].delay,850);
 assert.doesNotThrow(()=>saver.edit({text:'Final words'}));assert.equal(browser.canceled[0],1);
 browser.scheduled.at(-1).callback();await saver.flush();assert.deepEqual(writes,[{id:'song',hash:'original-hash',data:{text:'Final words'}}]);saver.dispose();
});
