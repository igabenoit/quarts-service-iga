import {DAY_NAMES,addDays,escapeHTML as e,DEPARTMENT_STYLES,timeLabel} from './departments-core.js';
import {fullDate} from './portal-weeks.js';

const identity=p=>Number(p.portalPersonId||p.id);
export function leadershipRoster(people,departments,serviceEmployees){
  const groups=new Map();
  for(const p of people.filter(p=>p.active)){
    const title=p.jobTitle?.trim()||'',normalized=title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const service=serviceEmployees.find(s=>s.id===p.serviceEmployeeId);
    const supervisor=service&&(service.role==='supervisor'||service.shifts.some(s=>s.role==='supervisor'));
    if(!/\b(gerant|gerante|assistant|assistante|directeur|directrice)\b/.test(normalized)&&!supervisor)continue;
    const id=identity(p),owner=people.find(o=>o.id===id)||p;
    if(!groups.has(id))groups.set(id,{id,name:owner.name,title:title||'Supervision',departmentKeys:[]});
    const r=groups.get(id);
    for(const dept of departments.filter(d=>p.departments.includes(d.id)))if(!r.departmentKeys.includes(dept.key))r.departmentKeys.push(dept.key);
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'fr-CA'));
}

export function presenceWeek(weekStart,roster,current,previous={employees:[]}){
  const departments=current.publications;
  const days=DAY_NAMES.map((name,day)=>({name,date:addDays(weekStart,day),people:roster.map(person=>{
    const record=current.employees.find(p=>p.id===person.id),entries=record?.days[day]?.entries||[];
    const yesterday=day?record?.days[day-1]?.entries:previous.employees.find(p=>p.id===person.id)?.days[6]?.entries;
    const shifts=[...entries.filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.minutes!==null).map(c=>({start:c.start,end:c.end,department:c.department,departmentKeys:c.departmentKeys,fromPreviousDay:false})),
      ...(yesterday||[]).filter(c=>c.minutes!==null&&c.end>1440).map(c=>({start:0,end:c.end-1440,department:c.department,departmentKeys:c.departmentKeys,fromPreviousDay:true}))].sort((a,b)=>a.start-b.start);
    const unique=shifts.filter((c,i)=>!shifts.slice(0,i).some(s=>s.start===c.start&&s.end===c.end&&s.department===c.department));
    const missing=person.departmentKeys.some(key=>!departments.find(d=>d.key===key)?.published);
    // Only an explicit off entry means leave; no assignment must never imply a confirmed absence.
    const status=unique.length?'Prévu':missing?'À confirmer · horaire non publié':entries.length&&entries.every(c=>c.hours==='Congé')?'Congé':'Aucun quart indiqué';
    return {...person,shifts:unique,status};
  })}));
  return {weekStart,generatedAt:new Date().toISOString(),departments,days};
}

const styleFor=key=>key==='service'?{name:'Service',color:'#245a9a',pale:'#eaf1ff'}:DEPARTMENT_STYLES.find(d=>d.key===key)||{name:key,color:'#52616d',pale:'#eef1f4'};
const label=key=>styleFor(key).name;
export function presencePages(data){
  return data.days.map((day,index)=>{
    const people=[...day.people].sort((a,b)=>label(a.departmentKeys[0]).localeCompare(label(b.departmentKeys[0]),'fr-CA')||a.title.includes('ssistant')-b.title.includes('ssistant')||a.name.localeCompare(b.name,'fr-CA'));
    const rows=people.map(p=>`<tr class="presence-row${p.shifts.length?'':' presence-unplanned'}"><td class="presence-department theme-${e(p.departmentKeys[0])}">${p.departmentKeys.map(key=>e(label(key))).join('<br>')}</td><th scope="row"><strong>${e(p.name)}</strong><small>${e(p.title)}</small></th><td class="presence-hours">${p.shifts.length?p.shifts.map(s=>`<div>${timeLabel(s.start)} – ${timeLabel(s.end)}${s.fromPreviousDay?'<small>Depuis la veille</small>':''}${s.departmentKeys.some(k=>!p.departmentKeys.includes(k))?`<small>${e(s.department)}</small>`:''}</div>`).join(''):`<span class="presence-status">${e(p.status)}</span>`}</td><td class="presence-check">${p.shifts.length?'<span class="presence-box"></span>':'—'}</td><td class="presence-note">&nbsp;</td></tr>`).join('');
    const missing=data.departments.filter(d=>!d.published).map(d=>d.name);
    return `<article class="presence-page presence-compact" data-day="${index}"><header class="presence-title"><div><img src="/logo-famille-benoit.svg" alt="IGA Famille Benoit"><p>COURTOISIE · ACCUEIL ET TÉLÉPHONE</p><h1>Présences en magasin</h1><span>Gérants, assistants et superviseurs du Service</span></div><div class="presence-date"><b>${e(day.name)}</b><strong>${e(fullDate(day.date))}</strong><span>${people.filter(p=>p.shifts.length).length} responsable(s) prévu(s)</span></div></header><p class="presence-intro">Cocher les présences à l’arrivée. Noter les changements pour orienter les appels et les représentants.</p>${missing.length?`<p class="presence-warning">À confirmer — horaire non publié : ${e(missing.join(', '))}.</p>`:''}<table class="presence-table"><colgroup><col class="presence-col-dept"><col class="presence-col-name"><col class="presence-col-hours"><col class="presence-col-check"><col class="presence-col-note"></colgroup><thead><tr><th>Département</th><th>Responsable</th><th>Heures prévues</th><th>Présent</th><th>Notes / retour prévu</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Aucun responsable identifié dans les fiches. Vérifier les titres des employés.</td></tr>'}</tbody></table><section class="presence-messages"><h2>Messages et changements de la journée</h2><div></div><div></div><div></div></section><footer class="presence-footer"><span>Semaine du ${e(fullDate(data.weekStart))} · ${e(day.name)} · ${index+1}/7</span><small>Départements : horaires publiés · Service : horaire enregistré · +1 : fin le lendemain<br>Préparé le ${e(new Intl.DateTimeFormat('fr-CA',{dateStyle:'short',timeStyle:'short',timeZone:'America/Toronto'}).format(new Date(data.generatedAt)))} · Les présences réelles sont à confirmer sur place.</small></footer></article>`;
  });
}

export function dailyPacket(planograms,presences,{mode='both',day='all'}={}){
  const indices=day==='all'?[0,1,2,3,4,5,6]:[Number(day)];
  return indices.flatMap(i=>[...(mode!=='presence'?[planograms[i]]:[]),...(mode!=='planogram'?[presences[i]]:[])]).join('');
}
