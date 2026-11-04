const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('esbuild'),{parseHTML}=require('linkedom');
function load(filename,post){
 filename=path.resolve(filename);const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));const original=loaded.require.bind(loaded);
 loaded.require=name=>name==='./api'?{post}:name==='./access-device'?load('src/web/access-device.ts',post):original(name);
 loaded._compile(transformSync(fs.readFileSync(filename,'utf8'),{loader:filename.endsWith('.tsx')?'tsx':'ts',format:'cjs',jsx:'automatic'}).code,filename);return loaded.exports;
}
const {usesMobileCodeScreen}=load('src/web/access-device.ts');
test('only phones and tablets use the connection-code screen, regardless of window width',()=>{
 for(const device of [{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)'},{userAgent:'Mozilla/5.0 (Linux; Android 16; Pixel 10)'},{userAgent:'Mozilla/5.0 (Linux; Android 16; Tablet)'},{userAgent:'Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X)'},{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X)',platform:'MacIntel',maxTouchPoints:5},{userAgent:'A future mobile browser',userAgentData:{mobile:true}}])assert.equal(usesMobileCodeScreen(device),true,JSON.stringify(device));
 for(const device of [{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',maxTouchPoints:10},{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X)',platform:'MacIntel',maxTouchPoints:0},{userAgent:'Mozilla/5.0 (X11; Linux x86_64)'},{userAgentData:{mobile:false}},{}])assert.equal(usesMobileCodeScreen(device),false,JSON.stringify(device));
});
async function ui(device,props,check){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),previous={window:global.window,document:global.document,navigator:Object.getOwnPropertyDescriptor(global,'navigator'),act:global.IS_REACT_ACT_ENVIRONMENT};
 global.window=window;global.document=window.document;Object.defineProperty(global,'navigator',{configurable:true,value:device});global.IS_REACT_ACT_ENVIRONMENT=true;
 const calls=[];let passkeys=0,unlocked=0;const {Gate}=load('src/web/AccessGate.tsx',async(...args)=>{calls.push(args);return{ok:true};}),React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),root=createRoot(document.getElementById('root'));
 try{await act(async()=>root.render(React.createElement(Gate,{open:true,initialCode:'123456',passkey:()=>passkeys++,unlocked:async()=>{unlocked++;},...props})));await check({document,window,act,calls,passkeys:()=>passkeys,unlocked:()=>unlocked});}
 finally{await act(async()=>root.unmount());global.window=previous.window;global.document=previous.document;if(previous.navigator)Object.defineProperty(global,'navigator',previous.navigator);else delete global.navigator;global.IS_REACT_ACT_ENVIRONMENT=previous.act;}
}
for(const invite of [false,true])test('desktop '+(invite?'invite':'home')+' opens existing passkey sign-in without a computer-code form, even when the service is closed',async()=>{
 await ui({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'},{invite,open:false},async({document,window,act,calls,passkeys,unlocked})=>{
  assert.equal(document.querySelector('input'),null);assert.equal(document.querySelector('form'),null);assert.match(document.body.textContent,/Sign in to Stați/);assert.doesNotMatch(document.body.textContent,/Enter computer code|Enter invite code|Stați is closed/);
  const button=document.querySelector('button');assert.equal(button.textContent,'Sign in with passkey');assert.equal(button.disabled,false);await act(async()=>button.dispatchEvent(new window.Event('click',{bubbles:true})));assert.equal(passkeys(),1);assert.equal(unlocked(),0);assert.equal(calls.length,0,'The desktop button must not request a replacement pairing or submit a code.');
  window.innerWidth=320;await act(async()=>window.dispatchEvent(new window.Event('resize')));assert.equal(document.querySelector('input'),null);
 });
});
for(const invite of [false,true])test('mobile '+(invite?'invite':'home')+' preserves the verified six-digit-code flow',async()=>{
 await ui({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)'},{invite},async({document,window,act,calls,unlocked})=>{
  assert.equal(document.querySelector('h1').textContent,invite?'Enter invite code':'Enter computer code');assert.equal(document.querySelector('input').value,'123456');assert.equal(document.querySelector('input').getAttribute('pattern'),'[0-9]{6}');
  await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));assert.deepEqual(calls,[['/access',{code:'123456'}]]);assert.equal(unlocked(),1);assert.equal(document.querySelector('input').value,'');
 });
});
