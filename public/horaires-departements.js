import {DAY_NAMES,escapeHTML as e,dateLabel,addDays,timeLabel,hoursLabel,totalMinutes,trainingMinutes,buffetMinutes,cellDetail,isTimedCell,cellMinutes,cellLabel,cellTone} from './departments-core.js';
const $=s=>document.querySelector(s);let listing,current;
async function api(path,options={}){const r=await fetch(path,{cache:'no-store',...options}),data=await r.json();if(r.status===401){$('#accessForm').hidden=false;$('#staffContent').hidden=true;throw Error('Entre le même code que pour les demandes de congé.');}if(!r.ok)throw Error(data.error||'Horaire indisponible.');return data;}
const status=text=>$('#status').textContent=text;
async function load(){
  listing=await api('/api/leave/department-schedules');$('#accessForm').hidden=true;$('#staffContent').hidden=false;
  const previous=$('#schedulePicker').value;$('#schedulePicker').innerHTML=listing.schedules.map((s,i)=>`<option value="${i}">${e(s.name)} · ${dateLabel(s.weekStart)}</option>`).join('')||'<option value="">Aucun horaire publié pour le moment</option>';
  if(previous&&listing.schedules[Number(previous)])$('#schedulePicker').value=previous;
  $('#serviceLinks').innerHTML=listing.service.map(s=>`<a class="button quiet" href="${e(s.path)}">Semaine du ${dateLabel(s.weekStart)}</a>`).join('')||'<p>Aucun lien Service disponible.</p>';status('');await loadSchedule();
}
async function loadSchedule(){
  const index=$('#schedulePicker').value;if(index===''){$('#personalSchedule').innerHTML='';$('#employeePicker').innerHTML='<option>Aucun horaire disponible</option>';return;}
  const s=listing.schedules[Number(index)];current=await api(`/api/leave/department-schedules/${s.departmentId}/${s.weekStart}`);document.body.className='theme-'+current.department.key;
  const previous=$('#employeePicker').value;$('#employeePicker').innerHTML='<option value="">Choisir mon nom</option>'+current.schedule.rows.map(r=>`<option value="${r.personId}">${e(r.name)}</option>`).join('');
  if(current.schedule.rows.some(r=>String(r.personId)===previous))$('#employeePicker').value=previous;render();
}
function render(){
  const row=current.schedule.rows.find(r=>String(r.personId)===$('#employeePicker').value);
  if(!row){$('#personalSchedule').innerHTML='<p class="notice">Choisis ton nom pour voir tes journées.</p>';return;}
  $('#personalSchedule').innerHTML=`<header class="personal-heading"><p class="eyebrow">${e(current.department.name)}</p><h2>${e(row.name)}</h2>${row.jobTitle?`<p class="person-job-title">${e(row.jobTitle)}</p>`:''}${row.specification?`<p class="person-specification">${e(row.specification)}</p>`:''}<p>Du ${dateLabel(current.weekStart)} au ${dateLabel(addDays(current.weekStart,6))} · <strong>${hoursLabel(totalMinutes(row))} h régulières</strong>${trainingMinutes(row)>0?`<br><span class="training-hours">Formation : ${hoursLabel(trainingMinutes(row))} h</span>`:''}${buffetMinutes(row)>0?`<br><span class="buffet-hours">Buffet : ${hoursLabel(buffetMinutes(row))} h</span>`:''}</p></header><p id="weekScrollHint" class="week-scroll-hint">Lundi → dimanche · Fais défiler horizontalement pour voir toute la semaine.</p><div class="week-strip" role="region" aria-label="Horaire du lundi au dimanche" tabindex="0"><div class="week-cards">${row.cells.map((c,d)=>`<article class="day-card ${cellTone(c)}"><h3>${DAY_NAMES[d]} <span>${addDays(current.weekStart,d).slice(8)}</span></h3><strong>${isTimedCell(c)?timeLabel(c.start)+' – '+timeLabel(c.end):c.kind==='off'?'Congé':c.kind==='blank'?'Aucun quart inscrit':e(cellLabel(c))}</strong>${isTimedCell(c)?`<p>${cellDetail(c)?e(cellDetail(c))+' · ':''}${hoursLabel(cellMinutes(c))} h</p>`:''}${c.note&&c.kind!=='note'?`<p>${e(c.note)}</p>`:''}</article>`).join('')}</div></div>${current.schedule.notes?`<div class="notice"><strong>Notes de l’équipe</strong><p>${e(current.schedule.notes)}</p></div>`:''}<p class="muted">Publication : ${e(new Date(current.publishedAt).toLocaleString('fr-CA'))}. En cas de question, communique avec ton gérant.</p>`;
}
$('#accessForm').onsubmit=async event=>{event.preventDefault();const b=event.target.querySelector('button');b.disabled=true;try{await api('/api/leave/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('#staffCode').value})});$('#staffCode').value='';await load();}catch(err){status(err.message);}finally{b.disabled=false;}};
$('#schedulePicker').onchange=()=>loadSchedule().catch(err=>{current=null;$('#personalSchedule').innerHTML='';status(err.message);});$('#employeePicker').onchange=render;$('#refresh').onclick=()=>load().catch(err=>status(err.message));
load().catch(err=>status(err.message));
