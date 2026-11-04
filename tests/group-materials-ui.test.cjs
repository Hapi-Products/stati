const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('esbuild'),{parseHTML}=require('linkedom');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const material=group=>({id:'isolated-'+group,groupName:group,title:group+' chord sheet',filename:'chords.pdf',bytes:100,contentType:'application/pdf',authorName:'Fixture T.',createdAt:1791738900,removalPending:false,canDelete:true,fileUrl:'/api/group-materials/'+group+'/file',downloadUrl:'/api/group-materials/'+group+'/file?download=1'});
async function ui(handler,check){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),old={window:global.window,document:global.document,navigator:Object.getOwnPropertyDescriptor(global,'navigator'),act:global.IS_REACT_ACT_ENVIRONMENT};
 global.window=window;global.document=window.document;Object.defineProperty(global,'navigator',{configurable:true,value:window.navigator});global.IS_REACT_ACT_ENVIRONMENT=true;window.location=new URL('https://isolated.invalid/');window.document.oninput=null;window.confirm=()=>true;
 const cache=new Map(),calls=[];
 const api=async(endpoint,init={})=>{const call={endpoint,method:init.method||'GET'};calls.push(call);return handler(call);};
 function load(filename){filename=path.resolve(filename);if(cache.has(filename))return cache.get(filename).exports;const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));cache.set(filename,loaded);const original=loaded.require.bind(loaded);loaded.require=name=>{if(name.endsWith('.css'))return{};if(name==='./api')return{api};if(name.startsWith('.')){const base=path.resolve(path.dirname(filename),name),resolved=[base,base+'.ts',base+'.tsx'].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());if(resolved)return load(resolved);}return original(name);};loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{loader:filename.endsWith('.tsx')?'tsx':'ts',format:'cjs',jsx:'automatic'}).code,filename);return loaded.exports;}
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Component=load('src/web/GroupMaterials.tsx').GroupMaterials,root=createRoot(document.getElementById('root'));
 const button=name=>[...document.querySelectorAll('button')].find(element=>element.textContent===name),click=async element=>{assert.ok(element);assert.equal(element.disabled,false);await act(async()=>element.dispatchEvent(new window.Event('click',{bubbles:true})));};
 const select=()=>document.querySelector('.group-material-filter select');
 const choose=async value=>{assert.equal(select().disabled,false,'A user can change the group only when enabled');Object.defineProperty(select(),'value',{configurable:true,value,writable:true});await act(async()=>select().dispatchEvent(new window.Event('change',{bubbles:true})));};
 try{await act(async()=>root.render(React.createElement(Component,{me:{id:'isolated-reader',capabilities:{readSongs:true,planServices:false}}})));await check({window,document,act,calls,button,click,select,choose});}
 finally{await act(async()=>root.unmount());global.window=old.window;global.document=old.document;if(old.navigator)Object.defineProperty(global,'navigator',old.navigator);else delete global.navigator;global.IS_REACT_ACT_ENVIRONMENT=old.act;}
}

test('a delayed removal locks the group scope until its refresh completes, then switching groups shows the matching rows',async()=>{
 const removed=deferred();let deleted=false;
 await ui(call=>{
  if(call.method==='DELETE')return removed.promise.then(()=>{deleted=true;return{ok:true};});
  const group=new URL('https://isolated.invalid'+call.endpoint).searchParams.get('groupName')||'A';
  return{materials:deleted&&group==='A'?[]:[material(group)],groups:['A','B'],nextCursor:group==='A'&&!deleted?'1791738899:11111111-1111-4111-8111-111111111111':null,canUpload:false};
 },async({document,act,calls,button,click,select,choose})=>{
  await choose('A');await click(button('Remove'));
  assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
  assert.equal(select().disabled,true,'Group switching must stay unavailable while the old-group deletion is pending');
  assert.equal(button('Refresh').disabled,true);assert.equal(button('Load more files').disabled,true);
  assert.match(document.querySelector('.group-material-card').textContent,/A chord sheet/);
  await act(async()=>removed.resolve());
  assert.equal(select().disabled,false);assert.match(document.body.textContent,/No shared files for this group yet/);
  await choose('B');assert.match(document.querySelector('.group-material-card').textContent,/B chord sheet/);
  assert.equal(new URL('https://isolated.invalid'+calls.at(-1).endpoint).searchParams.get('groupName'),'B');
  assert.doesNotMatch(document.querySelector('.group-material-card').textContent,/A chord sheet/);
 });
});

test('declining Remove confirmation preserves the shared row and makes no deletion request',async()=>{
 await ui(()=>({materials:[material('A')],groups:['A'],nextCursor:null,canUpload:false}),async({window,document,calls,button,click,select})=>{
  window.confirm=()=>false;await click(button('Remove'));
  assert.equal(calls.some(call=>call.method==='DELETE'),false);assert.equal(select().disabled,false);assert.match(document.querySelector('.group-material-card').textContent,/A chord sheet/);
 });
});
