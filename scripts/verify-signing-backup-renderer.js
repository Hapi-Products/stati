document.getElementById('verify-form').addEventListener('submit',async event=>{
 event.preventDefault();const password=document.getElementById('password'),button=document.getElementById('verify'),status=document.getElementById('status');
 button.disabled=true;status.textContent='Checking recovery…';
 try{const pending=window.signingRecovery.verify(password.value);password.value='';const result=await pending;status.textContent='Recovery check passed. Private-key signing verified. Certificate SHA-256: '+result.fingerprint+'. This was a local check; recovery on another device is still required.';}
 catch(error){status.textContent=error.message;}
 finally{password.value='';button.disabled=false;}
});
