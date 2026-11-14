import {passkeyDestination} from './passkey-destination.js';
const $=s=>document.querySelector(s);
$('#managerLogin').onsubmit=async event=>{
  event.preventDefault();$('#connectAccount').disabled=true;$('#loginStatus').textContent='Connexion…';
  try{
    const response=await fetch('/api/manager-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:$('#accountLogin').value,password:$('#accountPassword').value})});
    const data=await response.json();if(!response.ok)throw Error(data.error);$('#accountPassword').value='';
    const sessionResponse=await fetch('/api/session',{cache:'no-store'});
    if(!sessionResponse.ok)throw Error('Impossible de vérifier vos accès. Réessayez.');
    location.assign(passkeyDestination(null,await sessionResponse.json(),location.origin));
  }catch(error){$('#loginStatus').textContent=error.message;}
  finally{$('#connectAccount').disabled=false;}
};
