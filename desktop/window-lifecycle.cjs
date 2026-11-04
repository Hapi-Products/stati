function showMainWindow(current,create){
 const win=!current||current.isDestroyed()?create():current;
 if(win.isMinimized())win.restore();
 win.show();win.focus();
 return win;
}
function clockLoginSettings({platform,packaged,executable}){
 if(platform!=='win32'||!packaged)return null;
 // Receiver and clocks share one entry. Identity 'off' only suppresses its popup.
 return {openAtLogin:true,path:executable,args:['--stati-startup']};
}
module.exports={showMainWindow,clockLoginSettings};
