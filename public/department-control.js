import {prepareSharedDraft} from './department-buffet.js';
import {escapeHTML as e,DAY_NAMES,dateLabel,addDays,timeLabel,hoursLabel,cellMinutes,cellBreakMinutes,isTimedCell,isOutgoing,cellLabel,cellDetail,departmentLabel,mergeIncoming,orderDraft,grandMinutes} from './departments-core.js';

const kinds=[['shift','Régulier'],['training','Formation'],['buffet','Buffet'],['kitchen','Cuisine']];
const zero=()=>Object.fromEntries(kinds.map(([key])=>[key,0]));
const charged=c=>isTimedCell(c)?c.departmentMinutes??(isOutgoing(c)?0:cellMinutes(c)):0;
export function controlReport(data){
  const key=data.department.key;
  const prepared=prepareSharedDraft(mergeIncoming(data.draft,data.incoming||[]),data.related||[],data.people,key);
  const draft=orderDraft(prepared.draft,data.people,data.department.id);
  const rows=draft.rows.map(row=>{
    const person=data.people.find(p=>p.id===row.personId);
    if(!person)throw Error('Une fiche employé est manquante. Actualisez la liste avant de préparer le contrôle.');
    const days=row.cells.map((cell,day)=>{
      const entries=[cell,...prepared.related.filter(item=>item.personId===row.personId&&item.day===day&&row.accountingCells.includes(item.cell)).map(item=>item.cell)];
      const totals=zero();for(const c of entries)if(isTimedCell(c))totals[c.kind]+=charged(c);
      return {entries,totals,total:Object.values(totals).reduce((a,b)=>a+b,0)};
    });
    const totals=zero();for(const day of days)for(const [kind] of kinds)totals[kind]+=day.totals[kind];
    const total=Object.values(totals).reduce((a,b)=>a+b,0);
    if(total!==grandMinutes(row))throw Error('La ventilation ne correspond pas au total de l’horaire pour '+person.name+'.');
    return {person,days,totals,total};
  });
  const days=Array.from({length:7},(_,day)=>{const totals=zero();for(const row of rows)for(const [kind] of kinds)totals[kind]+=row.days[day].totals[kind];return totals;});
  const totals=zero();for(const day of days)for(const [kind] of kinds)totals[kind]+=day[kind];
  return {department:data.department,weekStart:data.weekStart,manager:data.draft.manager||'',revision:data.revision,rows,days,totals,total:Object.values(totals).reduce((a,b)=>a+b,0)};
}
function dayHTML(day){
  return day.entries.map(c=>!isTimedCell(c)?`<span>${e(cellLabel(c)||'—')}</span>`:`<strong>${e(timeLabel(c.start))}–${e(timeLabel(c.end))}</strong><span>${e(cellDetail(c)||'Régulier')}</span><span>Pause ${cellBreakMinutes(c)} min · payé ${hoursLabel(cellMinutes(c))} h</span>${c.paidMinutesOverride!==undefined?'<span>Heures convenues</span>':''}${c.sourceDepartment?`<span>Reçu : ${e(departmentLabel(c.sourceDepartment))}</span>`:''}${c.buffetAllocation||isOutgoing(c)?`<span>Ce dépt : ${hoursLabel(charged(c))} h</span>`:''}${c.note?`<span>${e(c.note)}</span>`:''}`).join('<hr>');
}
export function controlPages(reports){
  const overview=reports.length>1?`<article class="control-sheet" aria-label="Sommaire des départements"><header class="sheet-header control-header"><div><p>CONTRÔLE HEBDOMADAIRE DES HEURES</p><h2>Sommaire des départements</h2><strong>Du ${e(dateLabel(reports[0].weekStart))} au ${e(dateLabel(addDays(reports[0].weekStart,6)))}</strong></div><div class="control-reference">Heures prévues<br>Brouillons enregistrés</div></header><section class="control-summary control-overview"><h3>Répartition des heures imputées</h3><table><thead><tr><th>Département</th><th>Employés</th>${kinds.map(([,label])=>`<th>${label}</th>`).join('')}<th>Total</th></tr></thead><tbody>${reports.map(r=>`<tr><th>${e(r.department.name)}</th><td>${r.rows.length}</td>${kinds.map(([kind])=>`<td>${hoursLabel(r.totals[kind])}</td>`).join('')}<td>${hoursLabel(r.total)} h</td></tr>`).join('')}<tr class="control-grand"><th>Total des départements sélectionnés</th><td>—</td>${kinds.map(([kind])=>`<td>${hoursLabel(reports.reduce((n,r)=>n+r.totals[kind],0))}</td>`).join('')}<td>${hoursLabel(reports.reduce((n,r)=>n+r.total,0))} h</td></tr></tbody></table><h3>Totaux par jour</h3><table><thead><tr><th>Département</th>${DAY_NAMES.map(day=>`<th>${day.slice(0,3)}</th>`).join('')}</tr></thead><tbody>${reports.map(r=>`<tr><th>${e(r.department.name)}</th>${r.days.map(day=>`<td>${hoursLabel(Object.values(day).reduce((a,b)=>a+b,0))}</td>`).join('')}</tr>`).join('')}</tbody></table></section><footer class="control-footer"><p>Les employés partagés peuvent figurer dans plusieurs départements. Les heures sont imputées à leur département selon les affectations et la règle Buffet. Le nombre d’employés ne s’additionne donc pas entre départements.</p><p>Sommaire des départements accessibles dans cet écran, hors Service. Les pages suivantes détaillent chaque employé.</p><div>Vérifié par : ____________________ Date : ______________ Signature : ____________________</div></footer></article>`:'';
  return overview+reports.map(report=>{
    const chunks=[];for(let n=0;n<Math.max(1,report.rows.length);n+=8)chunks.push(report.rows.slice(n,n+8));
    return chunks.map((rows,index)=>`<article class="control-sheet" aria-label="Contrôle ${e(report.department.name)}, page ${index+1}"><header class="sheet-header control-header"><div><p>CONTRÔLE HEBDOMADAIRE DES HEURES</p><h2>${e(report.department.name)}</h2><strong>Du ${e(dateLabel(report.weekStart))} au ${e(dateLabel(addDays(report.weekStart,6)))}</strong></div><div class="control-reference">Heures prévues · brouillon enregistré<br>Révision ${report.revision||0} · page ${index+1}/${chunks.length}<br>Responsable : ${e(report.manager||'________________')}</div></header><table class="control-detail"><colgroup><col style="width:17%">${DAY_NAMES.map(()=>'<col style="width:10%">').join('')}<col style="width:13%"></colgroup><thead><tr><th>Employé</th>${DAY_NAMES.map((day,i)=>`<th>${day.slice(0,3)} ${addDays(report.weekStart,i).slice(8)}</th>`).join('')}<th>Contrôle semaine</th></tr></thead><tbody>${rows.map(row=>`<tr><th>${e(row.person.name)}<small>${e(row.person.jobTitle||'')}</small><small>${row.person.group==='regular'?'Régulier':'Temps partiel'}</small></th>${row.days.map(day=>`<td>${dayHTML(day)}<b class="control-day-total">Dépt : ${hoursLabel(day.total)} h</b></td>`).join('')}<td>${kinds.map(([kind,label])=>`<span>${label} : ${hoursLabel(row.totals[kind])} h</span>`).join('')}<strong>Total : ${hoursLabel(row.total)} h</strong><span class="control-write">Réel : ______</span><span>Écart : ______</span></td></tr>`).join('')||'<tr><td colspan="9">Aucun employé sur cet horaire.</td></tr>'}</tbody></table><section class="control-summary"><h3>Totaux du département · semaine complète · ${report.rows.length} employés</h3><table><thead><tr><th>Catégorie</th>${DAY_NAMES.map(day=>`<th>${day.slice(0,3)}</th>`).join('')}<th>Semaine</th></tr></thead><tbody>${kinds.map(([kind,label])=>`<tr><th>${label}</th>${report.days.map(day=>`<td>${hoursLabel(day[kind])}</td>`).join('')}<td>${hoursLabel(report.totals[kind])} h</td></tr>`).join('')}<tr class="control-grand"><th>Total</th>${report.days.map(day=>`<td>${hoursLabel(Object.values(day).reduce((a,b)=>a+b,0))}</td>`).join('')}<td>${hoursLabel(report.total)} h</td></tr></tbody></table></section><footer class="control-footer"><p>Heures nettes après les pauses enregistrées. Les heures convenues et les répartitions entre départements sont respectées. Les congés restent des mentions sans heures travaillées. Les totaux ci-dessus couvrent toute la semaine, sans additionner les pages.</p><p>Heures réelles et écarts à compléter à la main (écart = réel − prévu). Aucune donnée de pointage n’est intégrée.</p><div>Vérifié par : ____________________ Date : ______________ Signature : ____________________</div></footer></article>`).join('');
  }).join('');
}
export function controlCSV(reports){
  const records=[['Département','Semaine du','Employé','Groupe','Date','Jour','Début','Fin','Catégorie','Poste / affectation','Pause (min)','Heures payées du quart','Heures convenues','Heures imputées au département','Heures réelles (à saisir)','Écart (à saisir)','Note']];
  for(const report of reports)for(const row of report.rows)for(const [dayIndex,day] of row.days.entries())for(const c of day.entries){
    if(c.kind==='blank')continue;
    records.push([report.department.name,report.weekStart,row.person.name,row.person.group==='regular'?'Régulier':'Temps partiel',addDays(report.weekStart,dayIndex),DAY_NAMES[dayIndex],isTimedCell(c)?timeLabel(c.start):'',isTimedCell(c)?timeLabel(c.end):'',kinds.find(([key])=>key===c.kind)?.[1]||cellLabel(c),cellDetail(c),isTimedCell(c)?cellBreakMinutes(c):'',isTimedCell(c)?hoursLabel(cellMinutes(c)):'',c.paidMinutesOverride!==undefined?'Oui':'',hoursLabel(charged(c)),'','',c.note||'']);
  }
  return '\ufeff'+records.map(record=>record.map(value=>'"'+String(value??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"').join(';')).join('\r\n');
}

