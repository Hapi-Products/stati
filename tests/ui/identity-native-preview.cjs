// Isolated native layout/clock fixture: no real accounts, credentials or network.
const {app,BrowserWindow,ipcMain,nativeTheme}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'stati-identity-ui-'));
app.setName('Stați isolated UI preview');app.setPath('userData',temporary);
let identity,clock,presentation='fullscreen',chosen=false,mode='before-service';
const status=()=>({presentation,windowControlsOverlay:false});
const member={id:'isolated-preview-profile',first_name:'UI preview',last_initial:'P',role:'member',has_photo:false};
const state=()=>({paired:true,adminUnlocked:false,device:{name:'Isolated UI fixture',operator_id:chosen?member.id:null},members:[member],transfers:[],requests:[],accessRequests:[],receiver:{id:'isolated-receiver'},organization:'',accessApprover:'operator'});
for(const [name,fn] of Object.entries({
 'identity-status':status,'identity-settings':()=>({mode,scheduleSummary:'Isolated UI preview; no account or production connection',...status()}),
 'identity-windowed':()=>{presentation='window';identity.webContents.send('identity-presentation',status());return status();},
 'identity-open':()=>{presentation='fullscreen';identity.webContents.send('identity-presentation',status());return status();},
 'access-status':()=>({allowed:true}),'state':state,'operator':({id})=>{chosen=!!id;return{ok:true};},'workspace-open':()=>{presentation='window';identity.webContents.send('identity-presentation',status());return{ok:true};},
 'update-state':()=>({phase:'disabled',message:'Isolated UI fixture; updates disabled.'}),'clock-contrast-status':()=>'',clocks:()=>[],
 'sender-photo':()=>null,'clock-delete':()=>{clock.close();return{ok:true};}
}))ipcMain.handle(name,(_event,...args)=>fn(...args));
app.whenReady().then(()=>{
 nativeTheme.themeSource='system';
 const root=path.resolve(__dirname,'../../desktop');
 const options={webPreferences:{preload:path.join(root,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}};
 identity=new BrowserWindow({width:900,height:720,title:'Stați · ISOLATED UI PREVIEW',backgroundColor:nativeTheme.shouldUseDarkColors?'#17191f':'#f8f9fc',...options});
 identity.webContents.on('will-navigate',event=>event.preventDefault());identity.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 identity.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
 identity.loadFile(path.join(root,'index.html'));
 clock=new BrowserWindow({x:60,y:80,width:350,height:140,minWidth:100,minHeight:50,frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,...options});
 clock.loadFile(path.join(root,'clock.html'));
 clock.webContents.once('did-finish-load',()=>{clock.webContents.send('clock-settings',{id:'isolated-clock',font:'Arial',fontSize:52,bold:false,italic:false,color:'#ffffff',background:'#202020',blur:false,showBackground:true,showBorder:false,autoSize:true});console.log('Clock fixture initial bounds:',JSON.stringify(clock.getBounds()));});
 clock.on('move',()=>console.log('Clock fixture moved bounds:',JSON.stringify(clock.getBounds())));
 console.log('ISOLATED UI PREVIEW: no real accounts or production connections. Fullscreen card layout is simulated on Mac; native Windows Acrylic is not verified.');
});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>fs.rmSync(temporary,{recursive:true,force:true}));
