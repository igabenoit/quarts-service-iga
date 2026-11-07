// This changes the entry screen only. The server independently rejects legacy admin sessions.
try {
  const r=await fetch('/api/employee-passkeys/config',{cache:'no-store'}),config=await r.json();
  if(config.enabled){
    for(const id of ['loginForm','adminSignInForm']){
      const form=document.getElementById(id);if(!form)continue;
      const link=document.createElement('a');link.className='button';
      link.textContent='Direction — Face ID ou clé d’accès';
      link.href='/connexion-employe?retour='+encodeURIComponent(location.pathname+location.search);
      form.insertBefore(link,form.querySelector('label')||form.firstChild);
      if(config.directionRequired){
        form.querySelectorAll('label,button').forEach(n=>{n.hidden=true;n.setAttribute('data-retired-master','');});
        form.querySelectorAll('input').forEach(n=>n.disabled=true);
        if(!document.querySelector('link[href="/direction-entry.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/direction-entry.css';document.head.append(css);}
        const note=document.createElement('p');note.textContent='Utilise ta clé personnelle sur ton appareil. Le code maître ne permet plus de se connecter.';link.before(note);
        form.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();location.assign(link.href);},true);
      }
    }
    const adminIntro=document.querySelector('#adminSignIn > p');
    if(adminIntro&&config.directionRequired)adminIntro.textContent='Une connexion personnelle pour consulter les horaires du magasin et tes autres espaces autorisés.';
  }
}catch{/* The server remains authoritative if configuration is unavailable. */}

// Only deliberate interaction renews inactivity; background polling never renews it.
let lastSent=0,busy=false;
async function activity(){
  if(busy||Date.now()-lastSent<60000||document.hidden)return;busy=true;lastSent=Date.now();
  try{await fetch('/api/employee-passkeys/activity',{method:'POST',headers:{'Content-Type':'application/json','X-Passkey-Request':'1'},body:'{}'});}catch{}finally{busy=false;}
}
for(const event of ['pointerdown','keydown','touchstart'])document.addEventListener(event,activity,{passive:true});
