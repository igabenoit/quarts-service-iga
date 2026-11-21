import {SERVICE_ASSIGNMENTS,DAY_NAMES,isTimedCell,cellMinutes,cellBreakMinutes,departmentLabel,escapeHTML as e,timeLabel,hoursLabel,dateLabel} from './departments-core.js';

// A projection of the source schedule, never a second editable/paid shift.
export function departmentServiceSupport(weeks,people,{published=false}={}){
  const result=[];
  for(const week of weeks){
    if(week.key==='service')continue;
    for(const row of (published?week.published:week.draft)?.rows||[]){
      const person=people.find(p=>p.id===row.personId);
      row.cells.forEach((cell,dayIndex)=>{
        if(!isTimedCell(cell)||!Object.hasOwn(SERVICE_ASSIGNMENTS,cell.serviceAssignment))return;
        result.push({personId:row.personId,name:published?row.name:person?.name||'Employé retiré',sourceDepartment:week.key,sourceDepartmentId:Number(week.department_id),dayIndex,assignment:cell.serviceAssignment,startMinute:cell.start,endMinute:cell.end,paidMinutes:cellMinutes(cell),breakMinutes:cellBreakMinutes(cell),cell});
      });
    }
  }
  return result.sort((a,b)=>a.dayIndex-b.dayIndex||a.startMinute-b.startMinute||a.name.localeCompare(b.name));
}
export const supportTotals=items=>Object.fromEntries(Object.keys(SERVICE_ASSIGNMENTS).map(key=>[key,items.filter(s=>s.assignment===key).reduce((n,s)=>n+s.paidMinutes,0)]));
const totalsHTML=items=>Object.entries(supportTotals(items)).map(([key,n])=>`${SERVICE_ASSIGNMENTS[key]} : ${hoursLabel(n)} h`).join(' · ');
export function supportBoardHTML(items=[],weekStart){
  if(!items.length)return '';
  return `<section class="schedule-group"><h3>Renforts des départements · Service et Livraison</h3><p>${totalsHTML(items)}. Heures comptées séparément dans le département d’origine.</p><div class="schedule-grid">${DAY_NAMES.map((name,day)=>`<div class="schedule-day"><h4>${name}</h4>${items.filter(s=>s.dayIndex===day).map(s=>`<div class="schedule-item"><strong>${e(s.name)}</strong><p>${SERVICE_ASSIGNMENTS[s.assignment]} · ${timeLabel(s.startMinute)}–${timeLabel(s.endMinute)}</p><p>${hoursLabel(s.paidMinutes)} h · ${e(departmentLabel(s.sourceDepartment))}</p><a href="/departements?department=${s.sourceDepartmentId}&amp;week=${e(weekStart)}">Modifier dans le département</a></div>`).join('')||'<small>Aucun renfort</small>'}</div>`).join('')}</div></section>`;
}
export function supportPrintHTML(items=[],weekStart){
  if(!items.length)return '';
  const pages=[];
  for(let offset=0;offset<items.length;offset+=14){
    const page=items.slice(offset,offset+14);
    pages.push(`<article class="service-sheet"><header class="sheet-header"><div><h1>Service · Renforts des départements</h1><p>Service et Livraison · semaine du ${e(dateLabel(weekStart))}</p><small>Feuille ${pages.length+1} / ${Math.ceil(items.length/14)}</small></div></header><table class="sheet-table"><thead><tr><th>Employé</th><th>Département d’origine</th><th>Jour</th><th>Affectation</th><th>Début</th><th>Fin</th><th>Heures payées</th></tr></thead><tbody>${page.map(s=>`<tr class="sheet-person"><th>${e(s.name)}</th><td>${e(departmentLabel(s.sourceDepartment))}</td><td>${DAY_NAMES[s.dayIndex]}</td><td>${SERVICE_ASSIGNMENTS[s.assignment]}</td><td>${timeLabel(s.startMinute)}</td><td>${timeLabel(s.endMinute)}</td><td>${hoursLabel(s.paidMinutes)}</td></tr>`).join('')}</tbody></table><div class="service-week-total"><strong>${totalsHTML(items)}</strong><span>Totaux de la semaine, identiques sur chaque feuille de renforts. Comptabilisés séparément dans le département d’origine; exclus du total régulier du Service.</span></div></article>`);
  }
  return pages.join('');
}
