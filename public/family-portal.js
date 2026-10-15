import {escapeHTML as e,monday,addDays,today,hoursLabel} from './departments-core.js';
import {weekInfo,weekRange,fullDate} from './portal-weeks.js';
const $=s=>document.querySelector(s),colors=['#176747','#2458a4','#854589','#ad4b24','#736000'];
let listing=null,week=null,data=null,chosenPerson='',sequence=0,loading=false;
const message=text=>{$('#status').textContent=text;$('#status').hidden=!text;};
async function api(path,options={}){const response=await fetch(path,{cache:'no-store',...options}),body=await response.json();if(!response.ok)throw Object.assign(Error(body.error||'Horaires indisponibles.'),{unauthorized:response.status===401});return body;}
function clear(){data=null;$('#familySchedule').innerHTML='';$('#familySummary').textContent='';}
function failed(error){clear();message(error.message);if(error.unauthorized){listing=null;$('#familyChoices').innerHTML='';$('#familyName').textContent='';$('#familyContent').hidden=true;$('#familyLogin').hidden=false;}}
function navigation(){
  const current=monday(listing.today),next=addDays(current,7);
  for(const [id,value] of [['currentWeek',current],['nextWeek',next]]){const info=weekInfo(value,listing.today),button=$('#'+id);button.innerHTML=`<strong>${info.title}</strong><span>${weekRange(value)}</span><small>${listing.weeks.includes(value)?'Des horaires sont publiés':'Aucun horaire publié'}</small>`;button.setAttribute('aria-pressed',String(week===value));button.onclick=()=>chooseWeek(value);}
  const others=listing.weeks.filter(w=>w!==current&&w!==next);$('#otherWeeksLabel').hidden=!others.length;$('#otherWeeks').innerHTML='<option value="">Autres semaines publiées…</option>'+others.map(w=>`<option value="${e(w)}">${weekInfo(w,listing.today).title} · ${weekRange(w)}</option>`).join('');$('#otherWeeks').value=others.includes(week)?week:'';
  const info=weekInfo(week,listing.today);$('#weekBanner').className='week-banner '+info.kind;$('#weekBanner').innerHTML=`<p>VOUS CONSULTEZ · FAMILLE</p><h2>${info.title}</h2><strong>${info.range}</strong><p>${info.note}</p>`;$('#returnCurrent').hidden=week===current;
}
function render(){
  if(!data)return;
  if(chosenPerson&&!data.people.some(p=>String(p.id)===chosenPerson))chosenPerson='';
  $('#familyChoices').innerHTML=[{id:'',name:'Tous les enfants'},...data.people].map(p=>`<button data-person="${p.id}" aria-pressed="${String(p.id)===chosenPerson}">${e(p.name)}</button>`).join('');
  document.querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>{chosenPerson=b.dataset.person;render();});
  const people=data.people.filter(p=>!chosenPerson||String(p.id)===chosenPerson),shifts=people.flatMap(p=>p.days.flatMap(d=>d.entries)).filter(c=>c.minutes!==null);
  $('#familySummary').textContent=`${people.length} enfant${people.length===1?'':'s'} · ${shifts.length} quart${shifts.length===1?'':'s'} publié${shifts.length===1?'':'s'} · ${hoursLabel(shifts.reduce((n,c)=>n+c.minutes,0))} h`;
  const notices=people.filter(p=>!p.published).map(p=>`<div class="family-unpublished"><strong>${e(p.name)} · Horaire pas encore publié</strong><p>Cela ne signifie pas qu’il ou elle est en congé.</p></div>`).join('');
  $('#familySchedule').innerHTML=(!people.length?'<div class="empty-week">Aucun enfant actif n’est rattaché à cet accès. Communique avec l’administration.</div>':notices+`<div class="personal-days">${Array.from({length:7},(_,i)=>{
    const day=people[0].days[i],entries=people.flatMap(p=>p.days[i].entries.map(c=>({...c,person:p}))).sort((a,b)=>(a.start??0)-(b.start??0)||a.person.name.localeCompare(b.person.name,'fr-CA'));
    return `<article class="portal-day${day.date===data.today?' is-today':''}"><header><h3>${day.name}</h3><span>${fullDate(day.date)}</span>${day.date===data.today?'<span class="today-tag">Aujourd’hui</span>':''}</header><div>${entries.map(c=>`<div class="family-shift" style="--person-color:${colors[data.people.findIndex(p=>p.id===c.person.id)%colors.length]}"><strong>${e(c.person.name)}</strong><div class="shift-detail"><span class="department-tag">${e(c.department)}</span><span>${e(c.detail||'')}</span></div><strong class="shift-time">${e(c.hours)}</strong></div>`).join('')||'<p class="no-shift">Aucun quart inscrit dans les horaires publiés.</p>'}</div></article>`;
  }).join('')}</div>`);
}
async function loadWeek(){const request=++sequence,selected=week;clear();message('Chargement des horaires…');try{const result=await api('/api/family-portal/weeks/'+selected);if(request!==sequence)return;if(result.weekStart!==selected)throw Error('La semaine reçue ne correspond pas à la semaine choisie. Actualise la page.');data=result;render();message('');}catch(error){if(request===sequence)failed(error);}}
async function chooseWeek(value){if(loading||!listing)return;week=value;navigation();await loadWeek();}
async function load({reset=false}={}){
  const request=++sequence;loading=true;clear();$('#weekControls').inert=true;message('Actualisation des horaires…');
  try{const next=await api('/api/family-portal');if(request!==sequence)return;const current=monday(next.today);if(reset||!week||!listing||monday(listing.today)!==current||![current,addDays(current,7),...next.weeks].includes(week))week=current;listing=next;$('#familyName').textContent=next.name;$('#familyLogin').hidden=true;$('#familyContent').hidden=false;navigation();await loadWeek();}catch(error){if(request===sequence)failed(error);}finally{loading=false;$('#weekControls').inert=false;}
}
$('#familyLogin').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await api('/api/family-portal/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('#familyCode').value})});$('#familyCode').value='';await load({reset:true});}catch(error){failed(error);}finally{button.disabled=false;}};
$('#refresh').onclick=()=>load();$('#otherWeeks').onchange=event=>{if(event.target.value)chooseWeek(event.target.value);};$('#returnCurrent').onclick=()=>chooseWeek(monday(listing.today));
$('#familyLogout').onclick=async()=>{++sequence;clear();try{await api('/api/family-portal/logout',{method:'POST'});listing=null;$('#familyContent').hidden=true;$('#familyLogin').hidden=false;$('#familyChoices').innerHTML='';$('#familyName').textContent='';message('Tu es déconnectée.');}catch(error){failed(error);}};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&listing)load({reset:true});});window.addEventListener('pageshow',event=>{if(event.persisted)load({reset:true});});let observedDate=today();setInterval(()=>{const date=today();if(date!==observedDate){observedDate=date;if(listing)load({reset:true});}},60000);
await load({reset:true});
