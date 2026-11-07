const $=s=>document.querySelector(s);
let activation=new URLSearchParams(location.hash.slice(1)).get('activation');
if(activation)history.replaceState(null,'',location.pathname+location.search);
const allowed=new Set(['/horaires-departements','/horaire','/conges','/disponibilites','/chandails','/discussion','/dossiers-employes','/cles-employes']);
const next=new URL(new URLSearchParams(location.search).get('retour')||'/horaires-departements?vue=employe',location.origin);
const target=next.origin===location.origin&&allowed.has(next.pathname)?next.pathname+next.search:'/horaires-departements?vue=employe';
async function post(path,body){const r=await fetch('/api/employee-passkeys/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Passkey-Request':'1'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Connexion impossible.');return d;}
if(activation){$('#title').textContent='Activer ma clé d’accès';$('#intro').textContent='Vérifie le nom affiché par ton appareil, puis crée ta clé avec son déverrouillage habituel. Fais cette étape sur ton appareil personnel ou avec ta clé de sécurité individuelle.';$('#continue').textContent='Créer ma clé d’accès';$('#sharedLabel').hidden=true;}
try{const config=await (await fetch('/api/employee-passkeys/config',{cache:'no-store'})).json();if(!config.enabled)throw Error('Les clés d’accès ne sont pas encore activées dans ce portail.');if(!window.PublicKeyCredential||!isSecureContext)throw Error('Ouvre ce lien dans une version récente de Safari, Chrome ou Edge.');$('#controls').hidden=false;}catch(e){$('#status').textContent=e.message;}
$('#continue').onclick=async()=>{
  $('#continue').disabled=true;$('#status').textContent='Suis la demande affichée par ton appareil…';
  try{
    if(activation){
      const optionsJSON=await post('register/options',{token:activation,shared:false});
      const response=await SimpleWebAuthnBrowser.startRegistration({optionsJSON});
      await post('register/verify',{response});activation=null;
    }else{
      const optionsJSON=await post('authenticate/options',{shared:$('#shared').checked});
      const response=await SimpleWebAuthnBrowser.startAuthentication({optionsJSON});
      await post('authenticate/verify',{response});
    }
    location.replace(target);
  }catch(e){$('#status').textContent=e.name==='NotAllowedError'?'Connexion annulée ou délai dépassé. Tu peux réessayer.':e.message||'Impossible de vérifier la clé. Communique avec la direction.';}finally{$('#continue').disabled=false;}
};
