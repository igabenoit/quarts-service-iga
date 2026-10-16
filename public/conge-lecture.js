import {escapeHTML as escape,DEPARTMENT_STYLES,nameKey} from './departments-core.js';
const $=s=>document.querySelector(s),token=location.hash.slice(1);
const labels={approved:'Congé confirmé',refused:'Congé refusé',conditional:'Congé sous conditions'};
const summaries={approved:'Les périodes suivantes sont approuvées.',refused:'Ces périodes de congé ne sont pas autorisées. Votre horaire actuel reste en vigueur.',conditional:'Votre congé n’est pas encore confirmé. Votre horaire actuel reste en vigueur.'};
const date=d=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'full',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
const stamp=d=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'long',timeStyle:'short',timeZone:'America/Toronto'}).format(new Date(d));
const time=m=>String(Math.floor(m/60)).padStart(2,'0')+' h '+String(m%60).padStart(2,'0');
async function api(action,confirmed=false){
  const res=await fetch('/api/leave/acknowledgements/'+action,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,confirmed})});
  const data=await res.json();if(!res.ok)throw Error(data.error||'Impossible de charger la confirmation.');return data;
}
function receipt(data){
  $('#ackForm').hidden=true;$('#receipt').hidden=false;
  $('#receipt').innerHTML=`<h2>Prise de connaissance confirmée</h2><p>Enregistrée le <strong>${escape(stamp(data.acknowledgedAt))} (Québec)</strong>.</p><p>Votre responsable peut voir cette confirmation dans la demande de congé.</p><p>${escape(summaries[data.kind])}</p>`;
}
async function load(){
  try{
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('Ouvrez le bouton « J’ai pris connaissance » dans votre courriel pour accéder à cette page.');
    const data=await api('preview');
    const styles=[{key:'service',name:'Service'},...DEPARTMENT_STYLES];
    document.body.dataset.department=styles.find(d=>d.key===data.department_key)?.key||styles.find(d=>nameKey(d.name)===nameKey(data.department_name))?.key||'';
    $('#message').textContent='';$('#testBanner').hidden=!data.isTest;
    $('#decision').innerHTML=`<header class="hero"><small>${escape(data.department_name)} · Demande n° ${escape(data.requestId)}</small><h1>${labels[data.kind]}</h1><p>${escape(summaries[data.kind])}</p></header><div class="content"><p>Bonjour ${escape(data.employee_name)},</p>${data.decision_note?`<section class="note ${data.kind==='refused'?'refused':''}"><h2>${data.kind==='conditional'?'CONDITIONS À REMPLIR':'RAISON DU REFUS'}</h2><p>${escape(data.decision_note)}</p></section>`:''}<section class="periods"><h2>${data.kind==='approved'?'PÉRIODES CONFIRMÉES':data.kind==='refused'?'PÉRIODES REFUSÉES':'PÉRIODES DEMANDÉES — À CONFIRMER'}</h2><ul>${data.periods.map(p=>`<li><strong>${escape(date(p.date))}</strong><br>${p.allDay?'Journée complète':escape(time(p.startMinute)+' à '+time(p.endMinute))}</li>`).join('')}</ul></section></div>`;
    $('#decision').hidden=false;
    if(data.acknowledgedAt)receipt(data);else $('#ackForm').hidden=false;
  }catch(error){$('#message').textContent=error.message;}
}
$('#ackForm').onsubmit=async event=>{
  event.preventDefault();if(!$('#ackCheck').checked)return;
  $('#ackButton').disabled=true;$('#message').textContent='Enregistrement…';
  try{const data=await api('confirm',true);$('#message').textContent='';receipt(data);$('#receipt').focus();}
  catch(error){$('#message').textContent=error.message;$('#ackButton').disabled=false;}
};
load();
