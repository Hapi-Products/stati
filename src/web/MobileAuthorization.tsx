import {useState} from 'react';
import {post,type Me} from './api';
export function MobileAuthorization({me}:{me:Me}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const input=new URLSearchParams(location.search),challenge=input.get('challenge')||'',state=input.get('state')||'';
 const valid=/^[A-Za-z0-9_-]{43}$/.test(challenge)&&/^[A-Za-z0-9_-]{16,100}$/.test(state);
 async function authorize(){if(busy||!valid)return;setBusy(true);setError('');try{const result=await post<{callback:string}>('/mobile/authorization',{challenge,state});const callback=new URL(result.callback);if(callback.protocol!=='stati-ios:'||callback.hostname!=='signin')throw Error('The app response was invalid. Start again in Stați.');location.assign(result.callback);}catch(failure){setError((failure as Error).message);setBusy(false);}}
 return <div className="locked"><section className="gate"><img src="/brand-icon.png" alt=""/><h1>Sign in to the Stați app</h1><p>Continue as {me.first_name} {me.last_initial}. on this iPhone. Your existing role and permissions stay the same.</p>{(!valid||error)&&<p role="alert">{error||'Open sign-in from the Stați iOS app to continue.'}</p>}<button className="button primary full" disabled={busy||!valid} onClick={()=>void authorize()}>{busy?'Returning to Stați…':'Continue to app'}</button><p className="hint">Your passkey stays with your device.</p></section></div>;
}
