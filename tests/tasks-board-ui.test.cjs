const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('esbuild'),{parseHTML}=require('linkedom');
const fixture=(extra={})=>({id:'11111111-1111-4111-8111-111111111111',title:'Fix cable',body:'Check the cable near the choir.',status:'new',urgent:false,revision:1,authorId:'author-fixture',authorName:'Author T.',authorPhotoUrl:'/api/members/author-fixture/photo',createdAt:1791738900,updatedAt:1791738900,noteCount:0,canManage:true,canDelete:true,...extra});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
async function ui(options,check){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),old={};for(const key of ['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'])old[key]=Object.getOwnPropertyDescriptor(global,key);
 Object.assign(global,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(global,'navigator',{configurable:true,value:window.navigator});document.oninput=null;window.location=new URL('https://isolated.invalid/');window.confirm=()=>true;window.scrollBy=()=>{};window.innerHeight=800;
 let task=fixture(options.task),notes=options.notes||[],deleted=false,leave;const calls=[];
 const detail=()=>({task:structuredClone({...task,noteCount:notes.length}),notes:structuredClone(notes),noteTotal:notes.length});
 const board=()=>({items:deleted?[]:[detail().task],total:deleted?0:1,offset:0,counts:{new:!deleted&&task.status==='new'?1:0,'in-progress':!deleted&&task.status==='in-progress'?1:0,complete:!deleted&&task.status==='complete'?1:0}});
 const api=async endpoint=>endpoint.includes('?')||endpoint==='/tasks'?board():detail();
 const post=async(endpoint,data)=>{calls.push(structuredClone(data));if(options.post){const value=await options.post(data,calls);if(value!==undefined)return value;}assert.equal(data.id,task.id);assert.equal(data.revision,task.revision,'Every mutation uses the latest saved revision');task.revision++;if(data.action==='update')task={...task,title:data.title,body:data.body,urgent:data.urgent,status:data.status};if(data.action==='delete'){deleted=true;return{deleted:true,id:task.id,revision:task.revision};}if(data.action==='restore')deleted=false;if(data.action==='delete-note')notes=notes.filter(note=>note.id!==data.noteId);if(data.action==='restore-note')notes=options.notes;return detail();};
 const compile=filename=>{const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));const original=loaded.require.bind(loaded);loaded.require=name=>{if(name==='./api')return{api,post};if(name.endsWith('.css'))return{};if(name.startsWith('.')){const candidate=path.resolve(path.dirname(filename),name);for(const extension of ['', '.tsx','.ts','.js'])if(fs.existsSync(candidate+extension))return compile(candidate+extension).exports;}return original(name);};loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{loader:filename.endsWith('.tsx')?'tsx':filename.endsWith('.ts')?'ts':'js',format:'cjs',jsx:'automatic'}).code,filename);return loaded;};const loaded=compile(path.resolve('src/web/TasksBoard.tsx'));
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),root=createRoot(document.getElementById('root'));
 const button=name=>[...document.querySelectorAll('button')].find(element=>(element.getAttribute('aria-label')||element.textContent)===name),click=async element=>{assert.ok(element,'Expected button');assert.equal(element.disabled,false);await act(async()=>element.dispatchEvent(new window.Event('click',{bubbles:true})));};
 const fire=async(element,type,values={})=>{assert.ok(element);const event=new window.Event(type,{bubbles:true,cancelable:true});for(const [key,value]of Object.entries(values))Object.defineProperty(event,key,{value});await act(async()=>element.dispatchEvent(event));return event;};
 const edit=async(selector,value)=>{const element=document.querySelector(selector),key=Object.keys(element).find(key=>key.startsWith('__reactProps'));assert.ok(key);await act(async()=>element[key].onChange({target:{value}}));};
 try{await act(async()=>root.render(React.createElement(loaded.exports.TasksBoard,{registerBeforeLeave:callback=>leave=callback})));await check({window,document,act,calls,button,click,fire,edit,leave:()=>leave,task:()=>task,detail});}
 finally{await act(async()=>root.unmount());for(const [key,value]of Object.entries(old))if(value)Object.defineProperty(global,key,value);else delete global[key];}
}
test('native drag drops onto a collapsed status without opening it and removes the old action clutter',async()=>{
 await ui({},async({document,fire,calls,button,click})=>{
  const target=document.querySelector('[data-task-drop="complete"]');assert.equal(target.hasAttribute('open'),false);
  const values=new Map(),dataTransfer={setData:(key,value)=>values.set(key,value),getData:key=>values.get(key)||'',effectAllowed:'',dropEffect:''};
  await fire(button('Move task: Fix cable'),'dragstart',{dataTransfer});await fire(target,'dragover',{dataTransfer});await fire(target,'drop',{dataTransfer});
  assert.equal(calls.length,1);assert.equal(calls[0].status,'complete');assert.equal(target.hasAttribute('open'),false);
  await click(document.querySelector('.task-open'));assert.match(document.body.textContent,/Author/);assert.ok(document.querySelector('.task-detail-meta img[src="/api/members/author-fixture/photo"]'));
  assert.doesNotMatch(document.body.textContent,/Submitted by|updated by|Save details|Move to In progress|Move to Complete/);
  assert.equal(document.querySelectorAll('input[type="checkbox"]').length,0);assert.ok(button('Mark urgent'));assert.ok(document.querySelector('select[aria-label="Task status"]'));
 });
});
for(const pointerType of ['touch','mouse'])test(pointerType+' dragging uses the closed status hit target and cancel makes no change',async()=>{
 await ui({},async({document,button,fire,calls})=>{
  const handle=button('Move task: Fix cable'),target=document.querySelector('[data-task-drop="complete"]');document.elementFromPoint=()=>target.querySelector('summary');
  await fire(handle,'pointerdown',{pointerType,button:0,pointerId:1,clientX:100,clientY:200});await fire(handle,'pointermove',{pointerType,button:0,pointerId:1,clientX:150,clientY:400});await fire(handle,'pointercancel',{pointerType,button:0,pointerId:1});assert.equal(calls.length,0);
  await fire(handle,'pointerdown',{pointerType,button:0,pointerId:2,clientX:100,clientY:200});await fire(handle,'pointermove',{pointerType,button:0,pointerId:2,clientX:150,clientY:400});await fire(handle,'pointerup',{pointerType,button:0,pointerId:2,clientX:150,clientY:400});
  assert.equal(calls.length,1);assert.equal(calls[0].status,'complete');assert.equal(target.hasAttribute('open'),false);
 });
});
test('details autosave and a second edit during a save uses its resulting revision',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});const pending=deferred();
 await ui({post:async(data,calls)=>{if(data.action==='update'&&calls.length===1)await pending.promise;}},async({document,button,click,edit,act,calls,task})=>{
  await click(document.querySelector('.task-open'));await edit('.task-editor input','First title');assert.equal(calls.length,0);await act(async()=>context.mock.timers.tick(500));assert.equal(calls.length,1);
  await edit('.task-editor textarea','New detail while saving');await act(async()=>pending.resolve());await act(async()=>context.mock.timers.tick(500));
  assert.equal(calls.length,2);assert.equal(calls[1].revision,2);assert.equal(task().title,'First title');assert.equal(task().body,'New detail while saving');assert.match(document.body.textContent,/Saved/);assert.equal(button('Save details'),undefined);
 });
});
test('failed autosave keeps the draft, blocks navigation and retries only deliberately',async context=>{
 context.mock.timers.enable({apis:['setTimeout','setInterval']});let fail=true;
 await ui({post:data=>{if(data.action==='update'&&fail)throw Error('The task changed. Your text was kept.');}},async({document,click,button,edit,act,calls,leave,task})=>{
  await click(document.querySelector('.task-open'));await edit('.task-editor input','Keep this draft');await act(async()=>context.mock.timers.tick(500));assert.equal(calls.length,1);assert.equal(document.querySelector('.task-editor input').value,'Keep this draft');assert.match(document.body.textContent,/Not saved/);
  await act(async()=>context.mock.timers.tick(3000));assert.equal(calls.length,1);let allowed;await act(async()=>allowed=await leave()());assert.equal(allowed,false);assert.equal(calls.length,2);assert.equal(task().title,'Fix cable');
  fail=false;await click(button('Retry saving'));assert.equal(task().title,'Keep this draft');await act(async()=>allowed=await leave()());assert.equal(allowed,true);
 });
});
test('comments and tasks have reversible delete icons and preserve the author picture',async()=>{
 const note={id:'note-fixture',authorId:'author-fixture',authorName:'Author T.',authorPhotoUrl:'/api/members/author-fixture/photo',body:'Keep the comment content',createdAt:1791738900,canDelete:true};
 await ui({notes:[note]},async({document,button,click,calls})=>{
  await click(document.querySelector('.task-open'));assert.ok(document.querySelector('.task-note-heading img'));
  await click(button('Delete comment by Author T.'));assert.equal(calls.at(-1).action,'delete-note');assert.doesNotMatch(document.body.textContent,/Keep the comment content/);
  await click(button('Undo'));assert.equal(calls.at(-1).action,'restore-note');assert.match(document.body.textContent,/Keep the comment content/);
  await click(button('Delete task'));assert.equal(calls.at(-1).action,'delete');assert.equal(document.querySelector('.task-editor'),null);await click(button('Undo'));assert.equal(calls.at(-1).action,'restore');assert.match(document.body.textContent,/Keep the comment content/);
 });
});
test('read-only task cards and other authors’ comments omit privileged actions',async()=>{
 await ui({task:{canManage:false,canDelete:false},notes:[{id:'note-other',authorId:'other',authorName:'Another T.',body:'Shared comment',createdAt:1,canDelete:false}]},async({document,button,click})=>{
  assert.equal(button('Move task: Fix cable'),undefined);await click(document.querySelector('.task-open'));assert.equal(button('Delete task'),undefined);assert.equal(button('Mark urgent'),undefined);assert.equal(document.querySelector('select[aria-label="Task status"]'),null);assert.equal(button('Delete comment by Another T.'),undefined);assert.match(document.body.textContent,/Shared comment/);
 });
});
test('comment count and card background open task details directly',async()=>{
 const note={id:'note-fixture',authorId:'author-fixture',authorName:'Author T.',body:'Visible comment',createdAt:1,canDelete:true};
 for(const selector of ['.task-comment-count','.task-card'])await ui({notes:[note]},async({document,click,fire})=>{
  const target=selector==='.task-comment-count'?document.querySelector('button[aria-label="Open 1 comments for Fix cable"]'):document.querySelector(selector);
  await fire(target,'click');assert.ok(document.querySelector('.task-editor'));assert.match(document.querySelector('.task-notes').textContent,/Visible comment/);
 });
});
