import {escapeHTML as e,monday,addDays,today,hoursLabel} from './departments-core.js';
import {weekInfo,weekRange,fullDate} from './portal-weeks.js';
import {storeSelection} from './store-portal-core.js';

const $=s=>document.querySelector(s);
let listing,week,data,sequence=0,loading=false,personId=null;
async function api(path,options={}){
  const response=await fetch(path,{cache:'no-store',...options}),body=await response.json();
  if(!response.ok)throw Object.assign(Error(body.error||'Impossible de charger les horaires.'),{unauthorized:response.status===401||response.status===403});
  return body;
}
function message(text){$('#status').textContent=text;$('#status').hidden=!text;}
function clear(){data=null;$('#storeSchedule').innerHTML='';$('#storeSummary').textContent='';$('#storePublications').innerHTML='';$('#storeMatches').innerHTML='';}
function failed(error){clear();message(error.message);if(error.unauthorized){$('#storeContent').hidden=true;$('#adminSignIn').hidden=false;}}
function navigation(){
  const current=monday(listing.today),next=addDays(current,7);
  for(const [id,value] of [['storeCurrent',current],['storeNext',next]]){
    const info=weekInfo(value,listing.today),button=$('#'+id);
    button.innerHTML=`<strong>${info.title}</strong><span>${weekRange(value)}</span><small>${listing.weeks.includes(value)?'Des horaires sont publiés':'Aucun horaire publié'}</small>`;
    button.setAttribute('aria-pressed',String(week===value));button.onclick=()=>chooseWeek(value);
  }
  const others=listing.weeks.filter(w=>w!==current&&w!==next);
  $('#storeOtherLabel').hidden=!others.length;
  $('#storeOther').innerHTML='<option value="">Autres semaines publiées…</option>'+others.map(w=>`<option value="${e(w)}">${weekInfo(w,listing.today).title} · ${weekRange(w)}</option>`).join('');
  $('#storeOther').value=others.includes(week)?week:'';
  const info=weekInfo(week,listing.today),banner=$('#storeWeekBanner');banner.hidden=false;banner.className='week-banner '+info.kind;
  banner.innerHTML=`<p>VOUS CONSULTEZ · TOUT LE MAGASIN</p><h2>${info.title}</h2><strong>${info.range}</strong><p>${info.note}</p>`;
  $('#storeReturnCurrent').hidden=week===current;
}
function render(){
  if(!data)return;
  const department=$('#storeDepartment').value,search=$('#storeSearch').value,result=storeSelection(data,{department,search,personId});
  $('#storeBack').hidden=!result.selected;$('#storeFilters').hidden=!!result.selected;
  $('#storeHeading').textContent=result.selected?result.selected.name:department?listing.departments.find(d=>d.key===department)?.name:'Tous les départements';
  $('#storeSummary').textContent=`${result.peopleCount} employé${result.peopleCount===1?'':'s'} planifié${result.peopleCount===1?'':'s'} · ${result.count} quart${result.count===1?'':'s'} · ${hoursLabel(result.minutes)} h affichées${result.selected?' · Semaine complète, tous départements':''}`;
  $('#storePublications').innerHTML=data.publications.map(p=>`<span class="publication-tag theme-${e(p.key)}${p.published?'':' unpublished'}">${e(p.name)} · ${p.published?'publié':'non publié'}</span>`).join('');
  $('#storeMatches').innerHTML=!result.selected&&search.trim()?`<p>${result.matches.length} employé${result.matches.length===1?'':'s'} trouvé${result.matches.length===1?'':'s'}. Choisis un nom pour voir sa semaine complète.</p><div class="store-person-choices">${result.matches.map(p=>`<button class="quiet" data-store-person="${p.id}">${e(p.name)}</button>`).join('')}</div>`:'';
  const anyPublished=data.publications.some(p=>p.published),personalUnpublished=result.selected&&!result.selected.published;
  const notice=!anyPublished||personalUnpublished?'<div class="empty-week"><h3>Horaire pas encore publié</h3><p>Aucun horaire publié pour cette sélection. Cela ne signifie pas que les employés sont en congé.</p></div>':'';
  $('#storeSchedule').innerHTML=notice+`<div class="store-days">${result.days.map(day=>`<article class="store-day${day.date===data.today?' is-today':''}"><header><div><h3>${day.name}</h3><span>${fullDate(day.date)}</span></div><span>${day.date===data.today?'Aujourd’hui · ':''}${day.entries.filter(c=>c.minutes!==null).length} quart(s)</span></header><div>${day.entries.map(c=>`<div class="store-shift theme-${e(c.departmentKeys[0]||'service')}"><button class="store-person" data-store-person="${c.personId}">${e(c.personName)}</button><div class="store-post"><span class="department-tag">${e(c.department)}</span>${c.detail?`<span>${e(c.detail)}</span>`:''}</div><strong>${e(c.hours)}</strong>${c.minutes!==null?`<small>${hoursLabel(c.minutes)} h</small>`:'<small></small>'}</div>`).join('')||`<p class="no-shift">${personalUnpublished||!anyPublished?'Aucun horaire publié.':result.selected?'Aucun quart inscrit dans les horaires publiés.':'Aucun quart publié pour cette sélection.'}</p>`}</div></article>`).join('')}</div>`;
  document.querySelectorAll('[data-store-person]').forEach(button=>button.onclick=()=>{personId=Number(button.dataset.storePerson);render();$('#storeHeading').scrollIntoView({block:'center'});});
}
async function loadWeek(){
  const request=++sequence,chosen=week;clear();message('Chargement de la semaine choisie…');
  try{const result=await api('/api/store-portal/weeks/'+chosen);if(request!==sequence)return;if(result.weekStart!==chosen)throw Error('La semaine reçue ne correspond pas à la semaine choisie. Actualise le portail.');data=result;render();message('');}
  catch(error){if(request===sequence)failed(error);}
}
async function chooseWeek(value){if(loading||!listing)return;week=value;navigation();await loadWeek();}
async function load({reset=false}={}){
  const request=++sequence;loading=true;clear();message('Actualisation du magasin…');$('#storeWeekControls').inert=true;$('#storeWeekBanner').hidden=true;
  try{
    const next=await api('/api/store-portal');if(request!==sequence)return;
    const current=monday(next.today),allowed=[current,addDays(current,7),...next.weeks];
    if(reset||!week||!listing||monday(listing.today)!==current||!allowed.includes(week))week=current;
    listing=next;
    const chosenDepartment=$('#storeDepartment').value;
    $('#storeDepartment').innerHTML='<option value="">Tout le magasin</option>'+listing.departments.map(d=>`<option value="${e(d.key)}">${e(d.name)}</option>`).join('');
    $('#storeDepartment').value=listing.departments.some(d=>d.key===chosenDepartment)?chosenDepartment:'';
    navigation();await loadWeek();
  }catch(error){if(request===sequence)failed(error);}
  finally{loading=false;$('#storeWeekControls').inert=false;}
}
export function startStorePortal(){
  document.title='Tout le magasin · IGA Famille Benoit';
  document.querySelector('.employee-portal').classList.add('store-portal');
  document.querySelector('.portal-header h1').textContent='Tout le magasin';
  document.querySelector('.portal-header .eyebrow').textContent='PORTAIL EMPLOYÉS · ADMINISTRATION';
  document.querySelector('.portal-header p:last-child').textContent='Les horaires publiés du Service et des sept départements.';
  $('#accessForm').hidden=true;$('#staffContent').hidden=true;$('#adminSignIn').hidden=true;$('#adminPortalLink').hidden=true;$('#storeContent').hidden=false;
  $('#storeContent').innerHTML=`<div class="store-admin-note"><div><strong>Vue administrateur</strong><p>Tu consultes les horaires sans modifier le suivi des consultations des employés.</p></div><a class="button quiet" href="/departements">Gestion des horaires</a></div>
  <div id="storeWeekControls"><div class="week-choices"><button id="storeCurrent" class="week-choice current"></button><button id="storeNext" class="week-choice next"></button></div><label id="storeOtherLabel">Historique et autres semaines<select id="storeOther"></select></label><button id="storeReturnCurrent" class="quiet" hidden>Revenir à cette semaine</button></div>
  <section id="storeWeekBanner" class="week-banner" aria-label="Semaine consultée"></section>
  <div class="store-filters" id="storeFilters"><label>Département<select id="storeDepartment"></select></label><label>Rechercher un employé<input type="search" id="storeSearch" placeholder="Nom ou prénom" autocomplete="off"></label></div>
  <div id="storeMatches"></div><div class="store-heading"><div><h2 id="storeHeading"></h2><p id="storeSummary"></p></div><div class="actions"><button id="storeBack" class="quiet" hidden>Retour au magasin</button><button id="storeRefresh" class="quiet">Actualiser</button></div></div>
  <details class="store-publications"><summary>Horaires publiés pour cette semaine</summary><div id="storePublications"></div></details><div id="storeSchedule"></div>
  <p class="muted">Les heures affichées correspondent aux quarts visibles, repas non payés déduits. +1 indique une fin le lendemain. Les brouillons ne sont pas affichés.</p>
  <div class="portal-links"><a class="button quiet" href="/horaires-departements?vue=employe">Ouvrir le portail personnel</a><button id="storeLogout" class="quiet">Déconnecter mon accès administrateur</button></div>`;
  $('#storeDepartment').onchange=render;$('#storeSearch').oninput=render;
  $('#storeBack').onclick=()=>{personId=null;render();};$('#storeRefresh').onclick=()=>load();
  $('#storeOther').onchange=event=>{if(event.target.value)chooseWeek(event.target.value);};
  $('#storeReturnCurrent').onclick=()=>chooseWeek(monday(listing.today));
  $('#storeLogout').onclick=async()=>{try{++sequence;clear();await api('/api/logout',{method:'POST'});location.assign('/horaires-departements');}catch(error){failed(error);}};
  document.querySelector('.portal-footer').textContent='Vérifie les dates de la semaine avant de consulter les quarts de ton équipe.';
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&listing)load({reset:true});});
  window.addEventListener('pageshow',event=>{if(event.persisted)load({reset:true});});
  let observedDate=today();setInterval(()=>{const date=today();if(date!==observedDate){observedDate=date;if(listing)load({reset:true});}},60000);
  return load({reset:true});
}
