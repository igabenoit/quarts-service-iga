const $=s=>document.querySelector(s);let people=[];
async function api(path='',body){const r=await fetch('/api/employee-passkeys/admin'+path,{method:body?'POST':'GET',cache:'no-store',headers:{'Content-Type':'application/json','X-Passkey-Request':'1'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error||'Accès indisponible.');return d;}
function selection(){const p=people.find(p=>String(p.id)===$('#person').value);$('#personState').textContent=p?`${p.keys} clé(s) active(s)${p.invitation?' · Activation en attente':''}. ${p.required?'Le matricule seul ne permet plus la connexion.':''}`:'';$('#action').value=p?.keys||p?.required?'recover':'activate';$('#verified').checked=false;}
function render(){const q=$('#search').value.trim().toLocaleLowerCase('fr');$('#person').replaceChildren(new Option('Choisir la fiche exacte',''));for(const p of people.filter(p=>(p.name+' '+(p.matricule||'')).toLocaleLowerCase('fr').includes(q)))$('#person').append(new Option(`${p.name} · ${p.matricule||'matricule à confirmer'}`,p.id));selection();}
async function load(){const d=await api();people=d.people.filter(p=>Number(p.id)!==d.currentPerson.id);let own=$('#selfState');if(!own){own=document.createElement('section');own.id='selfState';own.className='help';$('#invitationForm').before(own);}own.textContent=`Connexion réussie : ${d.currentPerson.name}. Ta clé de direction est active. Choisis un autre employé ci-dessous pour activer ou récupérer sa clé. Pour utiliser Face ID sur ton iPhone, ajoute cet appareil avec le bouton ci-dessous.`;render();$('#invitationForm').hidden=false;$('#myDevice').hidden=false;}
$('#search').oninput=render;$('#person').onchange=selection;
$('#invitationForm').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;$('#result').hidden=true;try{const d=await api('/invitations',{personId:Number($('#person').value),identityConfirmed:$('#verified').checked,reason:$('#reason').value,recover:$('#action').value==='recover'});$('#activationLink').href=d.url;$('#activationLink').textContent=d.url;$('#result').hidden=false;$('#status').textContent='Lien créé. Remets-le uniquement à la personne vérifiée.';$('#verified').checked=false;await load();}catch(e){$('#status').textContent=e.message;}finally{b.disabled=false;}};
$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#activationLink').href);$('#status').textContent='Lien copié.';}catch{$('#status').textContent='Sélectionne le lien pour le copier.';}};
try{await load();}catch(e){$('#status').textContent=e.message;}

let deviceTimer;
$('#addMyDevice').onclick=async()=>{
  const button=$('#addMyDevice');button.disabled=true;$('#myDeviceResult').hidden=true;
  try{
    const d=await api('/my-device',{});
    $('#myDeviceQR').src=d.qr;$('#myDeviceLink').href=d.url;$('#myDeviceResult').hidden=false;
    $('#myDeviceExpiry').textContent='Valide 15 minutes. Garde ce QR pour toi.';
    $('#status').textContent='QR prêt. Scanne-le avec ton iPhone.';
    clearTimeout(deviceTimer);deviceTimer=setTimeout(()=>{
      $('#myDeviceQR').removeAttribute('src');$('#myDeviceLink').removeAttribute('href');$('#myDeviceResult').hidden=true;
      $('#status').textContent='Le QR a expiré. Confirme ta clé de direction pour en afficher un nouveau.';
    },d.expiresInMinutes*60000);
  }catch(e){$('#status').textContent=e.message;}finally{button.disabled=false;}
};
