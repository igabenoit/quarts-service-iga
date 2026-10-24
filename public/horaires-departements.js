import {escapeHTML as e,addDays,monday,today,hoursLabel} from './departments-core.js';
import {availableWeeks,selectedWeek,weekInfo,weekRange,fullDate,personalDays} from './portal-weeks.js';
import {scrollToToday} from './portal-current-day.js';
import {watchAccess} from './access-session.js';
const accessGuard=watchAccess('employee');
const $=s=>document.querySelector(s);
let requestedWeek=new URLSearchParams(location.search).get('week');
let listing=null,week=null,listSequence=0,scheduleSequence=0,loading=false;
const status=text=>$('#status').textContent=text;
async function api(path,options={}){
  const response=await fetch(path,{cache:'no-store',...options}),data=await response.json();
  if(!response.ok)throw Object.assign(Error(response.status===401?'Entre ton code employé de six chiffres.':data.error||'Horaire indisponible.'),{unauthorized:response.status===401});
  return data;
}
function failed(error){
  $('#personalSchedule').innerHTML='';
  status(error.message+(error.unauthorized?'':' Aucun ancien horaire n’est affiché.'));
  if(error.unauthorized){listing=null;week=null;$('#accessForm').hidden=false;$('#staffContent').hidden=true;}
}
function renderNavigation(){
  $('#weekBanner').hidden=false;
  const current=monday(listing.today),next=addDays(current,7),available=availableWeeks(listing);
  for(const [id,value] of [['currentWeek',current],['nextWeek',next]]){
    const info=weekInfo(value,listing.today),button=$('#'+id);
    button.innerHTML=`<strong>${info.title}</strong><span>${weekRange(value)}</span><small>${available.includes(value)?'Horaire disponible':'Pas encore publié'}</small>`;
    button.setAttribute('aria-pressed',String(week===value));
    button.onclick=()=>chooseWeek(value);
  }
  const other=available.filter(w=>w!==current&&w!==next);
  $('#otherWeeksLabel').hidden=!other.length;
  $('#otherWeeks').innerHTML='<option value="">Autres semaines publiées…</option>'+other.map(w=>`<option value="${w}">${weekInfo(w,listing.today).title} · ${weekRange(w)}</option>`).join('');
  $('#otherWeeks').value=other.includes(week)?week:'';
  const info=weekInfo(week,listing.today);
  $('#weekBanner').className='week-banner '+info.kind;
  $('#weekBanner').innerHTML=`<p>VOUS CONSULTEZ</p><h2>${info.title}</h2><strong>${info.range}</strong><p>${info.note}</p>`;
  $('#returnCurrent').hidden=week===current;
  $('#employeeName').textContent=listing.employeeName||'Mon horaire personnel';
}
async function load({reset=false}={}){
  const sequence=++listSequence;scheduleSequence++;loading=true;
  $('#personalSchedule').innerHTML='';$('#weekControls').inert=true;$('#weekBanner').hidden=true;status('Actualisation des horaires…');
  try{
    const next=await api('/api/leave/department-schedules');if(sequence!==listSequence)return;
    accessGuard.activate();
    next.today=next.today||today();const showToday=reset||!listing||listing.today!==next.today;
    week=selectedWeek(week,next,listing?.today,reset);if(requestedWeek&&availableWeeks(next).includes(requestedWeek)){week=requestedWeek;}requestedWeek=null;listing=next;
    $('#accessForm').hidden=true;$('#staffContent').hidden=false;$('#weekBanner').hidden=false;
    renderNavigation();await loadSchedule({showToday});
  }catch(error){if(sequence===listSequence)failed(error);}
  finally{if(sequence===listSequence){loading=false;$('#weekControls').inert=false;}}
}
async function chooseWeek(value){if(loading||!listing)return;week=value;renderNavigation();await loadSchedule({showToday:value===monday(listing.today)});}
async function loadSchedule({showToday=false}={}){
  const sequence=++scheduleSequence,chosen=week;
  $('#personalSchedule').innerHTML='';status('Chargement de la semaine choisie…');
  const sources=[...listing.schedules.filter(s=>s.weekStart===chosen).map(s=>({kind:'department',path:`/api/leave/department-schedules/${s.departmentId}/${chosen}`})),...listing.service.filter(s=>s.weekStart===chosen).map(s=>({kind:'service',path:'/api/public-schedules/'+encodeURIComponent(s.path.split('/').pop())}))];
  if(!sources.length){status('');$('#personalSchedule').innerHTML=`<div class="empty-week"><h3>Horaire pas encore publié</h3><p>Aucun horaire personnel publié pour la période du ${weekRange(chosen)}.</p><p>Cela ne signifie pas que tu es en congé. Vérifie plus tard ou communique avec ton gérant.</p></div>`;return;}
  try{
    const results=await Promise.all(sources.map(async s=>({...s,data:await api(s.path)})));
    if(sequence!==scheduleSequence)return;
    const days=personalDays(chosen,results),total=days.flatMap(d=>d.entries).reduce((n,c)=>n+(c.minutes||0),0);
    $('#personalSchedule').innerHTML=`<p class="week-total"><strong>${hoursLabel(total)} h planifiées</strong> · Pauses déduites · Horaires publiés seulement</p><div class="personal-days">${days.map(day=>`<article class="portal-day${day.date===listing.today?' is-today':''}"><header><h3>${day.name}</h3><span>${fullDate(day.date)}</span>${day.date===listing.today?'<b class="today-tag">Aujourd’hui</b>':''}</header><div>${day.entries.map(c=>`<div class="portal-shift"><span class="department-tag">${e(c.department)}</span><strong>${e(c.hours)}</strong>${c.detail?`<span>${e(c.detail)}</span>`:''}${c.minutes!==null?`<small>${hoursLabel(c.minutes)} h</small>`:''}</div>`).join('')||'<p class="no-shift">Aucun quart inscrit dans les horaires publiés.</p>'}${day.birthday?'<p class="birthday-greeting">Bonne fête !</p>':''}</div></article>`).join('')}</div><p class="muted">+1 indique une fin le lendemain. Le quart figure au jour de son début.</p><p class="muted">Actualisé à ${new Date().toLocaleTimeString('fr-CA',{hour:'2-digit',minute:'2-digit'})}. En cas de question, communique avec ton gérant.</p>`;
    status('');
    if(showToday)scrollToToday($('#personalSchedule'),$('#weekBanner'));
    for(const r of results.filter(r=>r.kind==='service'))fetch(r.path+'/views',{method:'POST'}).catch(()=>{});
  }catch(error){if(sequence===scheduleSequence)failed(error);}
}
$('#accessForm').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await api('/api/employee-portal/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('#staffCode').value})});$('#staffCode').value='';await load({reset:true});}catch(error){status(error.message);}finally{button.disabled=false;}};
$('#otherWeeks').onchange=event=>{if(event.target.value)chooseWeek(event.target.value);};
$('#returnCurrent').onclick=()=>chooseWeek(monday(listing.today));
$('#refresh').onclick=()=>load();
$('#logoutEmployee').onclick=async()=>{listSequence++;scheduleSequence++;$('#personalSchedule').innerHTML='';try{await api('/api/employee-portal/logout',{method:'POST'});location.reload();}catch(error){failed(error);}};
// A saved icon, a restored tab or a new Monday always returns to the current week.
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&listing)load({reset:true});});
window.addEventListener('pageshow',event=>{if(event.persisted)load({reset:true});});
let observedDate=today();
setInterval(()=>{const date=today();if(date!==observedDate){observedDate=date;if(listing)load({reset:true});}},60000);
load();
