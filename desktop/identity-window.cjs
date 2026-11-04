const {identityPresentation,servicePhase}=require('./identity-policy.cjs');

// A window with hidden native title bar remains reusable as the workspace. Acrylic is a DWM
// backdrop, not a captured image of the desktop, and needs no screen permission.
function createIdentityWindow({platform,screen,theme,mode,captureBackdrop,now=()=>new Date(),setTimer=setTimeout,clearTimer=clearTimeout,onPresentation=()=>{}}){
 let presentation='window',pending=true,dismissed=false,timer=null,current=null,backdrop=null,generation=0,reason='switch',acrylic=false,hiddenExitCleanup=null;
 const alive=win=>win&&!win.isDestroyed();
 const background=()=>theme.shouldUseDarkColors?'#17191f':'#f8f9fc';
 function cancelHiddenExit(){hiddenExitCleanup?.();hiddenExitCleanup=null;}
 function cancelTimer(){if(timer!==null){clearTimer(timer);timer=null;}}
 function publish(){onPresentation(status());}
 function fit(win,width,height){
  const area=screen.getDisplayMatching(win.getBounds()).workArea;
  win.setMinimumSize(Math.min(width===500?400:800,area.width),Math.min(height===640?500:600,area.height));
  win.setSize(Math.min(width,area.width),Math.min(height,area.height));win.center();
 }
 function windowed(win,workspace=false){
  cancelTimer();
  if(!alive(win))return;
  presentation='window';
  backdrop=null;acrylic=false;
  if(win.isFullScreen())win.setFullScreen(false);
  if(win.isMaximized?.())win.unmaximize();
  win.setAlwaysOnTop(false);
  if(platform==='win32'){
   try{win.setBackgroundMaterial(workspace?'none':'acrylic');acrylic=!workspace;}catch{acrylic=false;}
  }
  win.setBackgroundColor(acrylic?'#00000000':background());
  publish();
  fit(win,workspace?1120:500,workspace?780:640);
 }
 function scheduleEnd(win){
  cancelTimer();
  const at=now(),phase=servicePhase(at);
  if(phase.phase!=='before'||!phase.serviceStartsAt)return;
  timer=setTimer(()=>{timer=null;recheck(win);},Math.max(1,phase.serviceStartsAt-at.getTime()));
  timer?.unref?.();
 }
 function fullscreen(win){
  try{
   // Use the control display, never move the identity screen onto a projector.
   const display=screen.getPrimaryDisplay();
   acrylic=false;
   try{win.setBackgroundMaterial(backdrop?'none':'acrylic');acrylic=!backdrop;}catch{}
   win.setBackgroundColor(acrylic?'#00000000':background());
   presentation='fullscreen';publish();
   if(!win.isFullScreen())win.setBounds(display.bounds);
   win.setAlwaysOnTop(true,'floating');win.setFullScreen(true);
   scheduleEnd(win);
  }catch{
   dismissed=true;windowed(win);
  }
 }
 function show(win,{newPrompt=true,reason:nextReason=reason}={}){
  if(!alive(win))return status();
  reason=['startup','unlock','switch'].includes(nextReason)?nextReason:'switch';
  cancelHiddenExit();
  const token=++generation;current=win;pending=true;if(newPrompt)dismissed=false;
  const desired=identityPresentation({mode:mode(),platform,at:now(),dismissed,reason});
  if(desired!=='fullscreen'){windowed(win);return status();}
  if(captureBackdrop&&presentation!=='fullscreen'){
   // Capture before expanding, and discard a late result after selection,
   // dismissal, settings changes, close or the start of a service.
   void Promise.resolve().then(()=>captureBackdrop()).catch(()=>null).then(image=>{
    if(token!==generation||!pending||current!==win||!alive(win))return;
    if(identityPresentation({mode:mode(),platform,at:now(),dismissed,reason})!=='fullscreen'){windowed(win);return;}
    backdrop=typeof image==='string'&&image.length<=12*1024*1024&&/^data:image\/png;base64,[a-z\d+/=]+$/i.test(image)?image:null;
    fullscreen(win);
   });
  }else fullscreen(win);
  return status();
 }
 function recheck(win=current){
  // Time passing can only reduce an existing prompt. Never expand a window
  // over someone's work merely because a pre-service window has just begun.
  if(!pending||presentation!=='fullscreen'||!alive(win))return;
  if(identityPresentation({mode:mode(),platform,at:now(),dismissed,reason})!=='fullscreen')windowed(win);
  else scheduleEnd(win);
 }
 function workspace(win){cancelHiddenExit();generation++;pending=false;dismissed=false;current=win;windowed(win,true);return status();}
 function dismiss(win=current){cancelHiddenExit();generation++;dismissed=true;if(pending)windowed(win);return status();}
 function hide(win=current){
  cancelHiddenExit();
  const token=++generation;dismissed=true;current=win;
  if(!alive(win))return status();
  // Windows can restore a hidden window while leaving fullscreen. Hide after
  // resizing, and once more after that native transition; a later explicit
  // reopen owns a different generation and must never be hidden by this one.
  if(win.isFullScreen()&&typeof win.once==='function'){
   const afterExit=()=>{
    hiddenExitCleanup=null;
    if(token===generation&&current===win&&alive(win))win.hide();
   };
   win.once('leave-full-screen',afterExit);
   hiddenExitCleanup=()=>win.removeListener?.('leave-full-screen',afterExit);
  }
  try{if(pending)windowed(win);}finally{win.hide();}
  return status();
 }
 function themeChanged(win=current){if(alive(win))win.setBackgroundColor(acrylic?'#00000000':background());}
 function close(){cancelHiddenExit();generation++;cancelTimer();current=null;presentation='window';pending=true;dismissed=false;backdrop=null;reason='switch';acrylic=false;}
 function status(){return{presentation,backdrop};}
 return{show,workspace,dismiss,hide,recheck,themeChanged,close,status};
}
module.exports={createIdentityWindow};
