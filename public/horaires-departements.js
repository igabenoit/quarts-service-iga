import {birthdayGreeting,DAY_NAMES,escapeHTML as e,dateLabel,addDays,timeLabel,hoursLabel,totalMinutes,trainingMinutes,buffetMinutes,kitchenMinutes,cellDetail,isTimedCell,cellMinutes,cellLabel,cellTone} from './departments-core.js';
const $=s=>document.querySelector(s);let listing,current,listSequence=0,scheduleSequence=0;
async function api(path,options={}){const r=await fetch(path,{cache:'no-store',...options}),data=await r.json();if(r.status===401){$('#accessForm').hidden=false;$('#staffContent').hidden=true;throw Error('Entre ton code employé de six chiffres.');}if(!r.ok)throw Error(data.error||'Horaire indisponible.');return data;}
const status=text=>$('#status').textContent=text;
async function load(){
  const sequence=++listSequence;scheduleSequence++;$('#schedulePicker').disabled=true;$('#employeePicker').disabled=true;status('Actualisation…');
  const previous=listing?.schedules[Number($('#schedulePicker').value)];
  try{
    const next=await api('/api/leave/department-schedules');if(sequence!==listSequence)return;
    listing=next;$('#accessForm').hidden=true;$('#staffContent').hidden=false;
    $('#schedulePicker').innerHTML=listing.schedules.map((s,i)=>`<option value="${i}">${e(s.name)} · ${dateLabel(s.weekStart)}</option>`).join('')||'<option value="">Aucun horaire publié pour le moment</option>';
    const index=previous?listing.schedules.findIndex(s=>s.departmentId===previous.departmentId&&s.weekStart===previous.weekStart):-1;
    if(index>=0)$('#schedulePicker').value=String(index);
    $('#serviceLinks').innerHTML=listing.service.map(s=>`<a class="button quiet" href="${e(s.path)}">Semaine du ${dateLabel(s.weekStart)}</a>`).join('')||'<p>Aucun lien Service disponible.</p>';await loadSchedule();
  }catch(error){if(sequence===listSequence){current=null;$('#personalSchedule').innerHTML='';status(error.message);}}
  finally{if(sequence===listSequence){$('#schedulePicker').disabled=false;$('#employeePicker').disabled=!current;}}
}
async function loadSchedule(){
  const sequence=++scheduleSequence,index=$('#schedulePicker').value,previous=$('#employeePicker').value;
  current=null;$('#employeePicker').disabled=true;$('#personalSchedule').innerHTML='';
  const s=index===''?null:listing?.schedules[Number(index)];
  if(!s){$('#employeePicker').innerHTML='<option value="">Aucun horaire disponible</option>';status('Aucun horaire publié pour le moment.');return;}
  status('Chargement de l’horaire…');
  try{
    const loaded=await api(`/api/leave/department-schedules/${s.departmentId}/${s.weekStart}`);if(sequence!==scheduleSequence)return;
    current=loaded;document.body.className='theme-'+current.department.key;
    $('#employeePicker').innerHTML='<option value="">Choisir mon nom</option>'+current.schedule.rows.map(r=>`<option value="${r.personId}">${e(r.name)}</option>`).join('');
    if(current.schedule.rows.length===1)$('#employeePicker').value=String(current.schedule.rows[0].personId);else if(current.schedule.rows.some(r=>String(r.personId)===previous))$('#employeePicker').value=previous;status('');render();
  }catch(error){if(sequence===scheduleSequence){current=null;$('#employeePicker').innerHTML='<option value="">Horaire indisponible</option>';status(error.message);}}
  finally{if(sequence===scheduleSequence)$('#employeePicker').disabled=!current;}
}
function render(){
  if(!current){$('#personalSchedule').innerHTML='';return;}
  const row=current.schedule.rows.find(r=>String(r.personId)===$('#employeePicker').value);
  if(!row){$('#personalSchedule').innerHTML='<p class="notice">Choisis ton nom pour voir tes journées.</p>';return;}
  $('#personalSchedule').innerHTML=`<header class="personal-heading"><p class="eyebrow">${e(current.department.name)}</p><h2>${e(row.name)}</h2>${row.jobTitle?`<p class="person-job-title">${e(row.jobTitle)}</p>`:''}${row.specification?`<p class="person-specification">${e(row.specification)}</p>`:''}<p>Du ${dateLabel(current.weekStart)} au ${dateLabel(addDays(current.weekStart,6))} · <strong>${hoursLabel(totalMinutes(row))} h régulières</strong>${trainingMinutes(row)>0?`<br><span class="training-hours">Formation : ${hoursLabel(trainingMinutes(row))} h</span>`:''}${buffetMinutes(row)>0?`<br><span class="buffet-hours">Buffet : ${hoursLabel(buffetMinutes(row))} h</span>`:''}${kitchenMinutes(row)>0?`<br><span class="kitchen-hours">Cuisine : ${hoursLabel(kitchenMinutes(row))} h</span>`:''}</p></header><p id="weekScrollHint" class="week-scroll-hint">Lundi → dimanche · Fais défiler horizontalement pour voir toute la semaine.</p><div class="week-strip" role="region" aria-label="Horaire du lundi au dimanche" tabindex="0"><div class="week-cards">${row.cells.map((c,d)=>`<article class="day-card ${cellTone(c)}"><h3>${DAY_NAMES[d]} <span>${addDays(current.weekStart,d).slice(8)}</span></h3>${birthdayGreeting(row.birthdayMonthDay,addDays(current.weekStart,d))?'<p class="birthday-greeting">Bonne fête !</p>':''}<strong>${isTimedCell(c)?timeLabel(c.start)+' – '+timeLabel(c.end):c.kind==='off'?'Congé':c.kind==='blank'?'Aucun quart inscrit':e(cellLabel(c))}</strong>${isTimedCell(c)?`<p>${cellDetail(c)?e(cellDetail(c))+' · ':''}${hoursLabel(cellMinutes(c))} h</p>`:''}${c.note&&!isTimedCell(c)&&c.kind!=='note'?`<p>${e(c.note)}</p>`:''}</article>`).join('')}</div></div>${current.schedule.notes?`<div class="notice"><strong>Notes de l’équipe</strong><p>${e(current.schedule.notes)}</p></div>`:''}<p class="muted">Publication : ${e(new Date(current.publishedAt).toLocaleString('fr-CA'))}. En cas de question, communique avec ton gérant.</p>`;
}
$('#accessForm').onsubmit=async event=>{event.preventDefault();const b=event.target.querySelector('button');b.disabled=true;try{await api('/api/employee-portal/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('#staffCode').value})});$('#staffCode').value='';await load();}catch(err){status(err.message);}finally{b.disabled=false;}};
$('#schedulePicker').onchange=()=>loadSchedule().catch(err=>{current=null;$('#personalSchedule').innerHTML='';status(err.message);});$('#employeePicker').onchange=render;$('#refresh').onclick=()=>load().catch(err=>status(err.message));
load().catch(err=>status(err.message));

$('#logoutEmployee').onclick=async()=>{await api('/api/employee-portal/logout',{method:'POST'});location.reload();};
