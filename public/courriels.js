const $=s=>document.querySelector(s),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={ready:'Courriel obtenu',missing:'Courriel manquant',review:'Adresse à choisir'};
const roleLabels={cashier:'Caissière',packer:'Emballeur',supervisor:'Superviseur',orders:'Commandes téléphoniques'};
let directory=null,loading=false,saving=false;
const drafts=new Map();
async function api(url,options={}){
  const res=await fetch(url,{cache:'no-store',...options});const data=await res.json();
  if(!res.ok)throw new Error(res.status===401?'Connexion gestionnaire requise : ouvrez « Retour aux horaires » pour vous connecter.':data.error||'Erreur de chargement.');return data;
}
function render(){
  if(!directory)return;
  const s=directory.summary;
  $('#contactStats').innerHTML=[['Employés actifs',s.total],['Courriels obtenus',s.withEmail],['Courriels manquants',s.missing],['Adresses à choisir',s.review]].map(([label,n])=>`<div class="metric">${label}<strong>${n}</strong></div>`).join('');
  const query=$('#contactSearch').value.trim().toLocaleLowerCase('fr-CA'),filter=$('#contactFilter').value;
  const people=directory.employees.filter(e=>(!filter||e.status===filter)&&(!query||`${e.name} ${e.email} ${e.addresses.map(a=>a.email).join(' ')}`.toLocaleLowerCase('fr-CA').includes(query)));
  $('#contactEmployees').innerHTML=people.map(e=>`<article class="contact-row"><div><h2>${escape(e.name)}</h2><span class="badge ${e.status}">${labels[e.status]}</span><small>${escape(roleLabels[e.role]||e.role)}${e.source?' · '+escape(e.source):''}</small>${e.shared?'<small>Cette adresse est aussi utilisée par un autre employé. Elle sera copiée une seule fois.</small>':''}</div><form data-employee="${e.id}"><label>Courriel à utiliser<input type="email" name="email" aria-label="Courriel de ${escape(e.name)}" value="${escape(e.email)}" list="addresses-${e.id}" maxlength="254" required><datalist id="addresses-${e.id}">${e.addresses.map(a=>`<option value="${escape(a.email)}"></option>`).join('')}</datalist></label><button>Enregistrer</button></form>${e.addresses.length?`<details><summary>${e.addresses.length} adresse(s) reçue(s)</summary><ul>${e.addresses.map(a=>`<li>${escape(a.email)} · ${a.requestIds.length} demande(s)</li>`).join('')}</ul></details>`:''}</article>`).join('')||'<p class="notice">Aucun employé pour ces critères.</p>';
  $('#unmatchedSummary').textContent=`Autres adresses reçues à relier (${directory.unmatched.length})`;
  $('#unmatchedContacts').innerHTML=directory.unmatched.map((r,i)=>`<article class="contact-row"><div><h2>${escape(r.name)}</h2><p class="contact-email">${escape(r.email)}</p><small>${escape(r.department)} · ${r.requestIds.length} demande(s)${r.valid?'':' · Adresse invalide à vérifier'}</small></div>${r.valid?`<form data-link="${i}"><label>Employé actif correspondant<select name="employeeId" required><option value="">Choisir après vérification</option>${directory.employees.map(e=>`<option value="${e.id}">${escape(e.name)}</option>`).join('')}</select></label><button>Relier</button></form>`:''}</article>`).join('')||'<p>Aucune adresse en attente de rapprochement.</p>';
  $('#lastUpdated').textContent=`${s.withEmail} employés sur ${s.total} ont une adresse utilisable · ${s.uniqueEmails} adresses sans doublons · Actualisé à ${new Date(directory.updatedAt).toLocaleTimeString('fr-CA',{hour:'2-digit',minute:'2-digit'})}.`;
  $('#copyContacts').disabled=!directory.emails.length;$('#exportContacts').disabled=false;$('#exportReceived').disabled=false;
  for(const form of document.querySelectorAll('form[data-employee]')){
    if(drafts.has(form.dataset.employee))form.querySelector('input').value=drafts.get(form.dataset.employee);
  }
}
async function load({quiet=false}={}){
  if(loading||saving||quiet&&(drafts.size||document.activeElement?.closest('.contact-row form')))return;
  loading=true;
  try{const previous=directory?.summary;directory=await api('/api/employee-contacts');render();
    if(!quiet)$('#contactMessage').textContent='Liste à jour.';
    else if(previous&&JSON.stringify(previous)!==JSON.stringify(directory.summary))$('#contactMessage').textContent='La liste a changé : les compteurs et les employés à compléter ont été actualisés.';
  }catch(error){directory=null;$('#contactEmployees').replaceChildren();$('#unmatchedContacts').replaceChildren();$('#contactStats').replaceChildren();$('#lastUpdated').textContent='';$('#copyContacts').disabled=true;$('#exportContacts').disabled=true;$('#exportReceived').disabled=true;$('#copyFallback').hidden=true;$('#copyText').value='';$('#contactMessage').textContent=error.message;}
  finally{loading=false;}
}
document.addEventListener('input',event=>{const form=event.target.closest('form[data-employee]');if(form)drafts.set(form.dataset.employee,event.target.value);});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!form.matches('[data-employee],[data-link]'))return;event.preventDefault();if(saving)return;
  saving=true;const button=form.querySelector('button');button.disabled=true;
  try{
    const fields=new FormData(form);
    if(form.dataset.employee)await api('/api/employee-contacts/'+form.dataset.employee,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:fields.get('email')})});
    else await api('/api/employee-contacts/link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employeeId:Number(fields.get('employeeId')),requestIds:directory.unmatched[Number(form.dataset.link)].requestIds})});
    if(form.dataset.employee)drafts.delete(form.dataset.employee);
    saving=false;await load();if(directory)$('#contactMessage').textContent='Courriel enregistré. La liste de diffusion est à jour.';
  }catch(error){$('#contactMessage').textContent=error.message;}finally{saving=false;button.disabled=false;}
});
$('#refreshContacts').onclick=()=>load();$('#contactSearch').oninput=render;$('#contactFilter').onchange=render;
$('#copyContacts').onclick=async()=>{
  if(!directory)return;const text=directory.emails.join('; ');
  try{await navigator.clipboard.writeText(text);$('#contactMessage').textContent=`${directory.emails.length} adresses copiées. Collez-les dans le champ Cci de votre courriel.`;}
  catch{$('#copyText').value=text;$('#copyFallback').hidden=false;$('#copyText').focus();$('#copyText').select();$('#contactMessage').textContent='Sélectionnez et copiez les adresses ci-dessous, puis collez-les dans le champ Cci.';}
};
function csvCell(v){let s=String(v??'');if(/^\s*[=+\-@]|^[\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function downloadCsv(name,rows){const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#exportContacts').onclick=()=>{if(directory)downloadCsv('Courriels_employes_actifs.csv',[['Employé','Courriel retenu','Statut','Autres adresses reçues'],...directory.employees.map(e=>[e.name,e.email,labels[e.status],e.addresses.map(a=>a.email).join(' | ')])]);};
$('#exportReceived').onclick=()=>{if(directory)downloadCsv('Courriels_recus.csv',[['Nom','Courriel','Département','Suivi','Demandes'],...directory.received.map(r=>[r.name,r.email,r.department,r.status,r.requestIds.join(', ')])]);};
setInterval(()=>{if(!document.hidden)load({quiet:true});},60000);window.addEventListener('focus',()=>load({quiet:true}));load();
