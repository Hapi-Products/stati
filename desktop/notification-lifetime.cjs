// Keep timed-out Windows toasts alive so close() can remove their Action Center entry.
function notificationLifetime({delay=20*60*1000,schedule=setTimeout,cancel=clearTimeout}={}){
 const active=new Map();
 function forget(notification,close=false){const timer=active.get(notification);if(timer===undefined)return;active.delete(notification);cancel(timer);if(close)notification.close();}
 return {track(notification){const timer=schedule(()=>forget(notification,true),delay);timer?.unref?.();active.set(notification,timer);notification.on('click',()=>forget(notification,true));notification.on('failed',()=>forget(notification));notification.on('close',(_event,details)=>{if(details?.reason==='userCanceled')forget(notification);});},closeAll(){for(const notification of [...active.keys()])forget(notification,true);}};
}
module.exports={notificationLifetime};
