// A shared entry point for all existing personal portals. No credentials in localStorage.
const forms=document.querySelectorAll('[data-employee-passkey]');
try{
  const config=await (await fetch('/api/employee-passkeys/config',{cache:'no-store'})).json();
  if(config.enabled){
    for(const form of forms){
      const legacy=document.createElement('div');while(form.firstChild)legacy.append(form.firstChild);
      form.append(legacy);if(config.required)legacy.hidden=true;
      const link=document.createElement('a');link.className='button passkey-link';link.textContent='Me connecter avec ma clé d’accès';link.href='/connexion-employe?retour='+encodeURIComponent(location.pathname+location.search);form.prepend(link);
      if(!config.required){const p=document.createElement('p');p.textContent='Clé déjà activée? Utilise le bouton ci-dessus. Le matricule reste disponible uniquement pour les personnes qui n’ont pas encore été activées.';legacy.prepend(p);}
    }
  }
}catch{/* Existing authentication stays available if configuration cannot be read. */}
let hadSession=false,shared=false,lastInput=Date.now(),lastSent=0,busy=false;
for(const event of ['pointerdown','keydown','touchstart'])document.addEventListener(event,()=>{lastInput=Date.now();},{passive:true});
async function lock(){
  document.body.replaceChildren();
  try{await fetch('/api/employee-portal/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)});}catch{}finally{location.replace('/connexion-employe?retour='+encodeURIComponent(location.pathname+location.search));}
}
async function check(){
  if(busy)return;busy=true;
  try{
    // Clear a shared screen even while offline; polling must not postpone the lock.
    if(hadSession&&shared&&Date.now()-lastInput>=300000){await lock();return;}
    const r=await fetch('/api/employee-passkeys/session',{cache:'no-store'});if(!r.ok)return;
    const s=await r.json();
    if(hadSession&&(!s.authenticated||shared&&Date.now()-lastInput>=300000)){
      await lock();return;
    }
    hadSession=s.authenticated;shared=s.shared;
    if(s.authenticated&&!document.hidden&&lastInput>lastSent&&Date.now()-lastSent>60000){
      await fetch('/api/employee-passkeys/activity',{method:'POST',headers:{'Content-Type':'application/json','X-Passkey-Request':'1'},body:'{}'});lastSent=Date.now();
    }
  }catch{/* The server still enforces session expiration on every request. */}finally{busy=false;}
}
setInterval(check,15000);window.addEventListener('pageshow',check);document.addEventListener('visibilitychange',check);check();
