import {deadlineForDate} from './leave-calendar.js';
import {datesBetween,dayPeriods,quarterHours,hourLabel} from './leave-days.js';
const $=s=>document.querySelector(s), form=$('#leaveForm');
const parts=location.pathname.split('/'),test=location.pathname==='/conges-test';
const store=location.pathname==='/conges';
const token=parts[1]==='h'?parts[2]:null;
const base=(test||store)?'/api/leave':`/api/public-schedules/${encodeURIComponent(token)}`;
const keyName=`leave-draft-key:${test?'test':store?'store':token}`;
let submissionKey=sessionStorage.getItem(keyName)||crypto.randomUUID();sessionStorage.setItem(keyName,submissionKey);
let earliest='';const choices=new Map();
const longDate=d=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'full',timeZone:'UTC'}).format(new Date(`${d}T12:00:00Z`));
function updateDeadline(){
  const dates=[...document.querySelectorAll('[name=startDate]')].map(i=>i.value).filter(Boolean).sort();
  const date=dates[0]||earliest;if(!date)return;
  $('#deadline').textContent=dates.length?`Pour cette demande : envoi avant 9 h le ${longDate(deadlineForDate(date))} (heure du Québec).`:`Première semaine encore admissible : celle du ${longDate(earliest)}. Envoi avant 9 h le ${longDate(deadlineForDate(earliest))}.`;
}
function picker(day,field){
 const details=document.createElement('details');details.className='time-picker';
 const summary=document.createElement('summary'),grid=document.createElement('div');grid.className='time-options';
 const label=()=>{const t=day[field];return t==='00:00'?'Début de journée (0 h 00)':t==='24:00'?'Fin de journée (24 h 00)':hourLabel(t);};
 summary.textContent=label();summary.setAttribute('aria-label',(field==='startTime'?'Début':'Fin')+' de l’absence le '+longDate(day.date)+' : '+label());details.append(summary,grid);
 function populate(){if(grid.children.length)return;for(const t of quarterHours.filter(t=>field==='endTime'?t!=='00:00':t!=='24:00')){const button=document.createElement('button');button.type='button';button.className='time-option';button.textContent=t==='00:00'?'Début de journée':t==='24:00'?'Fin de journée':hourLabel(t);button.setAttribute('aria-pressed',String(t===day[field]));button.onclick=()=>{day[field]=t;summary.textContent=label();summary.setAttribute('aria-label',(field==='startTime'?'Début':'Fin')+' de l’absence le '+longDate(day.date)+' : '+label());grid.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));details.open=false;summary.focus();updateSummary();};grid.append(button);}}
 details.addEventListener('toggle',()=>{if(details.open){populate();const chosen=grid.querySelector('[aria-pressed=true]');grid.scrollTop=Math.max(0,(chosen?.offsetTop||grid.offsetTop)-grid.offsetTop-48);}});return details;
}
function selectedDays(){return [...$('#periods').children].map(box=>choices.get(box.dataset.date));}
function updateSummary(){
 const days=selectedDays();$('#daysSummary').replaceChildren();
 for(const d of days){const li=document.createElement('li');li.textContent=longDate(d.date)+' — '+(d.allDay?'journée complète':d.startTime==='00:00'?'du début de la journée à '+hourLabel(d.endTime):d.endTime==='24:00'?'de '+hourLabel(d.startTime)+' à la fin de la journée':'de '+hourLabel(d.startTime)+' à '+hourLabel(d.endTime));$('#daysSummary').append(li);}
 $('#summaryBox').hidden=!days.length;
 try{if(days.length)dayPeriods(days);$('#dateError').textContent='';}catch(e){$('#dateError').textContent=e.message;}
}
function renderDays(){
 $('#periods').replaceChildren();$('#summaryBox').hidden=true;const start=$('#firstDate').value,end=$('#lastDate').value;updateDeadline();if(!start||!end)return;
 try{for(const date of datesBetween(start,end)){
 const day=choices.get(date)||{date,allDay:true,startTime:'00:00',endTime:'17:00'};choices.set(date,day);
 const box=document.createElement('fieldset');box.dataset.date=date;const legend=document.createElement('legend');legend.textContent=longDate(date);box.append(legend);
 const radios=document.createElement('div');radios.className='day-kind';const hours=document.createElement('div');hours.className='grid day-hours';hours.hidden=day.allDay;
 for(const [value,label] of [['all','Journée complète'],['partial','Seulement une partie de la journée']]){const l=document.createElement('label'),input=document.createElement('input');l.className='check';input.type='radio';input.name='kind-'+date;input.value=value;input.checked=day.allDay===(value==='all');input.onchange=()=>{day.allDay=value==='all';hours.hidden=day.allDay;updateSummary();};l.append(input,document.createTextNode(label));radios.append(l);}
 for(const [field,label] of [['startTime','Mon absence commence'],['endTime','Mon absence se termine']]){const wrap=document.createElement('div'),p=document.createElement('p');p.textContent=label;wrap.append(p,picker(day,field));hours.append(wrap);}
 box.append(radios,hours);$('#periods').append(box);
 }updateSummary();}catch(e){$('#dateError').textContent=e.message;}
}
$('#firstDate').onchange=()=>{if(!$('#lastDate').value||$('#lastDate').value<$('#firstDate').value)$('#lastDate').value=$('#firstDate').value;renderDays();};$('#lastDate').onchange=renderDays;
function message(value){$('#message').textContent=value;$('#message').focus();}
$('#another').onclick=()=>location.reload();
form.onsubmit=async event=>{
  event.preventDefault();$('#send').disabled=true;$('#message').textContent='Envoi en cours…';
  try {
    datesBetween($('#firstDate').value,$('#lastDate').value);
    const periods=dayPeriods(selectedDays());
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
    form.hidden=false;
  }catch(error){message(error.message);$('#deadline').textContent='Veuillez vous connecter pour remplir le formulaire.';}
}
$('#accessForm').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;try{const r=await fetch('/api/leave/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('#staffCode').value})});const d=await r.json();if(!r.ok)throw new Error(d.error);$('#staffCode').value='';await load();}catch(error){message(error.message);}finally{button.disabled=false;}};
load();
