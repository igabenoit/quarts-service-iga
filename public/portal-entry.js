import {startStorePortal} from './store-portal.js';
const $=selector=>document.querySelector(selector);
const view=new URLSearchParams(location.search).get('vue');
$('#adminSignInForm').onsubmit=async event=>{
  event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
  try{
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('#adminCode').value})}),data=await response.json();
    if(!response.ok)throw Error(data.error||'Connexion impossible.');
    $('#adminCode').value='';location.assign('/horaires-departements?vue=magasin');
  }catch(error){$('#adminLoginStatus').textContent=error.message;}finally{button.disabled=false;}
};
let user=null;
try{const response=await fetch('/api/session',{cache:'no-store'});if(response.ok)user=(await response.json()).user;}catch{}
if(user?.kind==='account'&&!view)location.replace('/horaires-departements?vue=gerant');
else if((user?.kind==='admin'||user?.kind==='account')&&view!=='employe')await startStorePortal(user);
else if(view==='gerant')location.replace('/connexion?retour=horaires');
else if(view==='magasin'){
  $('#adminSignIn').hidden=false;$('#status').hidden=true;$('#adminPortalLink').hidden=true;
}else{
  $('#adminPortalLink').hidden=false;
  await import('./horaires-departements.js');
}
