const $=s=>document.querySelector(s),escape=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const mailLabels={pending:'En attente d’envoi',sending:'Envoi en cours',sent:'Pris en charge par Resend',error:'Envoi non confirmé',review:'À vérifier dans Resend'};
const labels={pending:'En attente',approved:'Approuvée',refused:'Refusée',cancelled:'Annulée',late:'Hors délai'};
const date=d=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'long',timeZone:'UTC'}).format(new Date(`${d.slice(0,10)}T12:00:00Z`));
const stamp=d=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'long',timeStyle:'short',timeZone:'America/Toronto'}).format(new Date(d));
const time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const monday=d=>{const dt=new Date(`${d}T12:00:00Z`),day=dt.getUTCDay();dt.setUTCDate(dt.getUTCDate()-(day===0?6:day-1));return dt.toISOString().slice(0,10);};
let requests=[];
async function api(url,options={}){const res=await fetch(url,{cache:'no-store',...options});const data=await res.json();if(!res.ok)throw new Error(res.status===401?'Connexion gestionnaire requise : utilisez « Retour aux horaires » pour vous connecter.':data.error);return data;}
function render(){
  const query=$('#search').value.trim().toLocaleLowerCase('fr-CA'),status=$('#status').value;
  const rows=requests.filter(r=>(!status||r.status===status)&&r.employee_name.toLocaleLowerCase('fr-CA').includes(query));
  $('#requests').innerHTML=rows.map(r=>{
    const weeks=[...new Set(r.periods.map(p=>monday(p.date)))];
    const actions=r.status==='pending'?['approved','refused','cancelled']:r.status==='approved'?['cancelled']:[];
    return `<article class="request" data-id="${r.id}"><header><h2>${escape(r.employee_name)}${r.is_test?' · TEST':''}</h2><span class="badge ${r.status}">${labels[r.status]}</span></header><p class="muted">Demande n° ${r.id} · Remise le ${stamp(r.submitted_at)} (Québec)<br>${escape(r.email)}</p>${r.is_test?`<p><strong>Notification :</strong> ${mailLabels[r.notification_status]||'Non configurée'}${r.notification_error?' · '+escape(r.notification_error):''}</p>`:''}<p><strong>Semaines concernées :</strong> ${weeks.map(w=>date(w)).join(' · ')}</p><ul class="period-list">${r.periods.map(p=>`<li><strong>${date(p.date)}</strong> — ${p.allDay?'Journée complète':`${time(p.startMinute)} à ${time(p.endMinute)}`}</li>`).join('')}</ul><p class="reason"><strong>Motif :</strong> ${escape(r.reason)}</p>${r.decision_note?`<p class="reason"><strong>Note de décision :</strong> ${escape(r.decision_note)}</p>`:''}${actions.length?`<label>Note de décision (obligatoire pour refuser ou annuler)<textarea rows="2" maxlength="1000"></textarea></label><div class="actions">${actions.map(a=>`<button data-status="${a}" class="${a==='approved'?'':'secondary'}">${a==='approved'?'Approuver':a==='refused'?'Refuser':'Annuler la demande'}</button>`).join('')}</div>`:''}<details><summary>Historique</summary><ul>${r.events.map(e=>`<li>${stamp(e.created_at)} — ${labels[e.status]}${e.note?' · '+escape(e.note):''}</li>`).join('')}</ul></details></article>`;
  }).join('')||'<p class="notice">Aucune demande pour ces critères.</p>';
  $('#requests').querySelectorAll('button[data-status]').forEach(button=>button.onclick=async()=>{
    const card=button.closest('.request'),r=requests.find(r=>String(r.id)===card.dataset.id);
    card.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await api(`/api/leave/requests/${r.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:button.dataset.status,note:card.querySelector('textarea').value,version:r.version})});await load();$('#message').textContent='Décision enregistrée. Actualisez l’horaire pour voir les congés approuvés.';}catch(e){$('#message').textContent=e.message;card.querySelectorAll('button').forEach(b=>b.disabled=false);}
  });
}
async function load(){
  $('#message').textContent='Chargement…';
  try{
    const params=new URLSearchParams({test:$('#mode').value});if($('#start').value)params.set('start',$('#start').value);if($('#end').value)params.set('end',$('#end').value);
    const data=await api(`/api/leave/requests?${params}`);requests=data.requests;const s=data.statistics;
    const metrics=[['Demandes',s.total],['En attente',s.pending],['Approuvées',s.approved],['Refusées',s.refused],['Annulées',s.cancelled],['Hors délai',s.late],['Journées complètes approuvées',s.fullDays],['Heures partielles approuvées',s.partialHours.toLocaleString('fr-CA',{maximumFractionDigits:2})],['Délai moyen de décision',s.averageResponseHours===null?'—':s.averageResponseHours.toLocaleString('fr-CA',{maximumFractionDigits:1})+' h']];
    $('#stats').innerHTML=metrics.map(([label,value])=>`<div class="metric">${label}<strong>${value}</strong></div>`).join('');
    $('#byEmployee').innerHTML=`<table><thead><tr><th>Employé</th><th>Demandes</th><th>Approuvées</th><th>Hors délai</th></tr></thead><tbody>${s.employees.map(e=>`<tr><td>${escape(e.name)}</td><td>${e.total}</td><td>${e.approved}</td><td>${e.late}</td></tr>`).join('')}</tbody></table>`;
    render();$('#message').textContent=$('#mode').value==='true'?'Mode test — données isolées.':'Suivi à jour.';
  }catch(e){$('#message').textContent=e.message;$('#requests').replaceChildren();$('#stats').replaceChildren();$('#byEmployee').replaceChildren();}
}
$('#filters').onsubmit=e=>{e.preventDefault();load();};$('#refresh').onclick=load;$('#mode').onchange=load;$('#status').onchange=render;$('#search').oninput=render;load();

async function loadMail(){try{const d=await api('/api/leave/notifications');$('#testRecipient').value=d.recipient;$('#mailStatus').textContent=d.configured?'Resend est configuré. Notifications pour les tests uniquement.':'Envoi en attente de configuration : ajoutez RESEND_API_KEY et votre expéditeur RESEND_FROM_EMAIL dans Render.';}catch(e){$('#mailStatus').textContent=e.message;}}
$('#mailSettings').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/leave/notifications',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient:$('#testRecipient').value})});$('#mailStatus').textContent=d.configured?'Destinataire enregistré. Les notifications de test en attente seront envoyées.':'Destinataire enregistré. La clé Resend reste à configurer dans Render.';}catch(e){$('#mailStatus').textContent=e.message;}};loadMail();
