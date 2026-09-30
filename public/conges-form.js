import {deadlineForDate} from './leave-calendar.js';
const $=s=>document.querySelector(s), form=$('#leaveForm');
const parts=location.pathname.split('/'),test=location.pathname==='/conges-test';
const store=location.pathname==='/conges';
const token=parts[1]==='h'?parts[2]:null;
const base=(test||store)?'/api/leave':`/api/public-schedules/${encodeURIComponent(token)}`;
const keyName=`leave-draft-key:${test?'test':store?'store':token}`;
let submissionKey=sessionStorage.getItem(keyName)||crypto.randomUUID();sessionStorage.setItem(keyName,submissionKey);
let earliest='',index=0;
const longDate=d=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'full',timeZone:'UTC'}).format(new Date(`${d}T12:00:00Z`));
function updateDeadline(){
  const dates=[...document.querySelectorAll('[name=startDate]')].map(i=>i.value).filter(Boolean).sort();
  const date=dates[0]||earliest;if(!date)return;
  $('#deadline').textContent=dates.length?`Pour cette demande : envoi avant 9 h le ${longDate(deadlineForDate(date))} (heure du Québec).`:`Première semaine encore admissible : celle du ${longDate(earliest)}. Envoi avant 9 h le ${longDate(deadlineForDate(earliest))}.`;
}
$('#periods').addEventListener('input',updateDeadline);
function addPeriod(){
  if($('#periods').children.length>=31)return;
  const id=++index,box=document.createElement('fieldset');
  box.innerHTML=`<legend>Période ${id}</legend><div class="grid"><label>Du<input name="startDate" type="date" required></label><label>Au (inclusivement)<input name="endDate" type="date" required></label></div><label>Type d’indisponibilité<select name="kind"><option value="all">Journée complète</option><option value="partial">Une partie de la journée</option></select></label><div class="grid hours" hidden><label>De<input name="startTime" type="time"></label><label>À<input name="endTime" type="time"></label></div><button type="button" class="secondary remove">Retirer cette période</button>`;
  box.querySelector('[name=startDate]').addEventListener('change',e=>{const end=box.querySelector('[name=endDate]');if(!end.value||end.value<e.target.value)end.value=e.target.value;});
  box.querySelector('[name=kind]').addEventListener('change',e=>{const partial=e.target.value==='partial';box.querySelector('.hours').hidden=!partial;box.querySelectorAll('input[type=time]').forEach(i=>i.required=partial);});
  box.querySelector('.remove').onclick=()=>{if($('#periods').children.length>1){box.remove();updateDeadline();}};
  $('#periods').append(box);
}
function message(value){$('#message').textContent=value;$('#message').focus();}
$('#addPeriod').onclick=addPeriod;
$('#another').onclick=()=>location.reload();
form.onsubmit=async event=>{
  event.preventDefault();$('#send').disabled=true;$('#message').textContent='Envoi en cours…';
  const periods=[...$('#periods').children].map(box=>{const v=n=>box.querySelector(`[name=${n}]`).value;return{startDate:v('startDate'),endDate:v('endDate'),allDay:v('kind')==='all',startTime:v('startTime'),endTime:v('endTime')};});
  try {
    const response=await fetch(`${base}/${test?'test-requests':store?'submit':'leave-requests'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submissionKey,employeeId:$('#employee').value,employeeName:$('#employeeName').value,departmentId:$('#department').value,email:$('#email').value,reason:$('#reason').value,periods})});
    const data=await response.json();
    if(response.status===409){submissionKey=crypto.randomUUID();sessionStorage.setItem(keyName,submissionKey);throw new Error('Une demande a déjà été enregistrée avec cette référence. Vérifiez avec votre gérante avant de renvoyer une nouvelle demande.');}
    if(!response.ok&&!(response.status===422&&data.id))throw new Error(data.error||'Envoi impossible.');
    sessionStorage.removeItem(keyName);form.hidden=true;$('#receipt').hidden=false;$('#another').hidden=false;
    const date=new Intl.DateTimeFormat('fr-CA',{dateStyle:'long',timeStyle:'short',timeZone:'America/Toronto'}).format(new Date(data.submittedAt));
    $('#receipt').textContent=`${data.isTest?'TEST — ':''}Référence ${data.id} · Remise le ${date} (Québec). ${data.message}`;
    if(data.status!=='late')$('#receipt').classList.add('success');
    message(data.status==='late'?'Demande hors délai — veuillez contacter votre gérante.':'Demande enregistrée.');
  }catch(error){message(error.message);}finally{$('#send').disabled=false;}
};
async function load(){
  if(store)$('#back').hidden=true;
  if(test)$('#back').href='/conges-gestion';else if(token)$('#back').href=`/h/${encodeURIComponent(token)}`;
  $('#back').textContent=test?'← Suivi des demandes':'← Retour à mon horaire';
  try{
    const response=await fetch(`${base}/${test?'test-form':store?'form':'leave-form'}`,{cache:'no-store'}),data=await response.json();
    if(store&&response.status===401){$('#accessForm').hidden=false;form.hidden=true;$('#deadline').textContent='Entrez le code du magasin pour remplir votre demande.';$('#message').textContent='';return;}
    if(!response.ok)throw new Error(data.error||'Connexion requise.');
    $('#accessForm').hidden=true;
    earliest=data.earliest;updateDeadline();
    $('#employee').replaceChildren(new Option('Sélectionnez votre nom',''));
    $('#department').replaceChildren(new Option('Choisissez votre département',''));
    for(const d of data.departments||[])$('#department').append(new Option(d.name,d.id));
    const manual=data.nameEntry==='manual';$('#employeeNameLabel').hidden=!manual;$('#employeeName').disabled=!manual;$('#employeeName').required=manual;$('#employeeSelectLabel').hidden=manual;$('#employee').disabled=manual;$('#employee').required=!manual;
    if(!store){const service=data.departments?.find(d=>d.isService);if(service)$('#department').value=service.id;$('#department').disabled=!test;}
    for(const e of data.employees){const option=document.createElement('option');option.value=e.id??'test';option.textContent=e.name;$('#employee').append(option);}
    $('#testBanner').hidden=!data.isTest;if(data.isTest)$('#employee').value='test';
    if(!$('#periods').children.length)addPeriod();form.hidden=false;
  }catch(error){message(error.message);$('#deadline').textContent='Veuillez vous connecter pour remplir le formulaire.';}
}
$('#accessForm').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;try{const r=await fetch('/api/leave/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('#staffCode').value})});const d=await r.json();if(!r.ok)throw new Error(d.error);$('#staffCode').value='';await load();}catch(error){message(error.message);}finally{button.disabled=false;}};
load();
