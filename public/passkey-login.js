import {passkeyDestination} from './passkey-destination.js';
const $=s=>document.querySelector(s);
let activation=new URLSearchParams(location.hash.slice(1)).get('activation');
if(activation)history.replaceState(null,'',location.pathname+location.search);
const returnTo=new URLSearchParams(location.search).get('retour');
if(!activation){$('#intro').textContent='Une seule connexion pour tes accès autorisés. Sur iPhone, utilise Face ID; sur ordinateur, le déverrouillage habituel de ton appareil.';$('#continue').textContent='Me connecter — Face ID ou clé d’accès';}
async function post(path,body){const r=await fetch('/api/employee-passkeys/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Passkey-Request':'1'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Connexion impossible.');return d;}
if(activation){$('#title').textContent='Activer cet appareil';$('#intro').textContent='Sur ton iPhone, ouvre cette page dans Safari, puis enregistre la clé avec Face ID. Vérifie le nom de ton compte dans la fenêtre d’Apple. L’iPhone peut proposer son code de déverrouillage en secours. Une clé déjà active sur ton ordinateur reste utilisable lors de l’ajout d’un appareil.';$('#continue').textContent='Activer avec Face ID ou le déverrouillage de mon appareil';$('#sharedLabel').hidden=true;}
let passkeys;
try {
  const config=await (await fetch('/api/employee-passkeys/config',{cache:'no-store'})).json();
  if (!activation && !config.required && passkeyDestination(returnTo,{},location.origin).split('?')[0]==='/discussion') {
    $('#discussionReturn').hidden=false;
  }
  if (!config.enabled) throw Error('Les clés d’accès ne sont pas encore activées dans ce portail.');
  if (!window.PublicKeyCredential || !isSecureContext) throw Error('Ouvre ce lien dans une version récente de Safari, Chrome ou Edge.');
  try {
    await import('/vendor/simplewebauthn.js');
    passkeys=window.SimpleWebAuthnBrowser;
    if (typeof passkeys?.startRegistration!=='function' || typeof passkeys?.startAuthentication!=='function') throw Error();
  } catch {
    throw Error('Impossible de charger la connexion par clé d’accès. Recharge la page pour réessayer.');
  }
  $('#controls').hidden=false;
} catch(e) {
  $('#status').textContent=e.message;
}
$('#continue').onclick=async()=>{
  $('#continue').disabled=true;$('#status').textContent='Suis la demande affichée par ton appareil…';
  try{
    if(activation){
      const optionsJSON=await post('register/options',{token:activation,shared:false});
      const response=await passkeys.startRegistration({optionsJSON});
      await post('register/verify',{response});activation=null;
    }else{
      const optionsJSON=await post('authenticate/options',{shared:$('#shared').checked});
      const response=await passkeys.startAuthentication({optionsJSON});
      await post('authenticate/verify',{response});
    }
    const sessionResponse=await fetch('/api/session',{cache:'no-store'});
    if(!sessionResponse.ok)throw Error('Impossible de vérifier tes accès. Réessaie la connexion.');
    location.replace(passkeyDestination(returnTo,await sessionResponse.json(),location.origin));
  }catch(e){$('#status').textContent=e.name==='NotAllowedError'?'Connexion annulée ou délai dépassé. Tu peux réessayer.':e.message||'Impossible de vérifier la clé. Communique avec la direction.';}finally{$('#continue').disabled=false;}
};
