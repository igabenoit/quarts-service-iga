import {serviceShiftTiming} from './service-rules.js';
const roles={manager:'Gérante',supervisor:'Superviseur',cashier:'Caissière',packer:'Emballeur',orders:'Commandes téléphoniques',support:'Aide autre département'};
const days=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const e=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const time=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const hours=n=>(n/60).toLocaleString('fr-CA',{maximumFractionDigits:2});
const dayDate=(week,i)=>{const d=new Date(week+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);return new Intl.DateTimeFormat('fr-CA',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(d);};
export function serviceNeedsReport(data){
 const dayRows=days.map(()=>new Map());
 for(const s of data.shifts){
  const timing=serviceShiftTiming(s.startMinute,s.endMinute),department=s.role==='support'?s.sourceDepartment||'':'';
  const key=JSON.stringify([s.role,s.startMinute,s.endMinute,department]);
  const rows=dayRows[s.dayIndex],r=rows.get(key)||{role:s.role,start:s.startMinute,end:s.endMinute,department,quantity:0,paidMinutes:timing.paidMinutes,breakMinutes:timing.breakMinutes};r.quantity++;rows.set(key,r);
 }
 const report=dayRows.map(rows=>[...rows.values()].sort((a,b)=>a.start-b.start||a.end-b.end||Object.keys(roles).indexOf(a.role)-Object.keys(roles).indexOf(b.role)||a.department.localeCompare(b.department,'fr')));
 return {days:report,count:data.shifts.length,totalMinutes:report.flat().reduce((sum,r)=>sum+r.paidMinutes*r.quantity,0)};
}
export function serviceNeedsHTML(data){
 const report=serviceNeedsReport(data);
 return `<article class="service-sheet service-needs-sheet"><header class="sheet-header"><img src="/logo-famille-benoit.svg" alt="IGA extra Famille Benoit"><div><p>PLANIFICATION AVANT ATTRIBUTION</p><h1>Besoins du Service</h1><strong>Du ${e(dayDate(data.weekStart,0))} au ${e(dayDate(data.weekStart,6))}</strong><small>${report.count} quart(s) · ${hours(report.totalMinutes)} h nettes</small></div></header><table class="sheet-table needs-table"><colgroup><col class="needs-role"><col><col><col><col><col></colgroup><thead><tr><th>Fonction</th><th>Début</th><th>Fin</th><th>Quantité</th><th>Heures<br>par quart</th><th>Total<br>d’heures</th></tr></thead><tbody>${report.days.map((rows,i)=>`<tr class="sheet-group"><th colspan="6">${days[i]} · ${e(dayDate(data.weekStart,i))}</th></tr>${rows.length?rows.map(r=>`<tr class="needs-row"><th scope="row">${e(roles[r.role]||r.role)}${r.department?`<small>${e(r.department)}</small>`:''}</th><td>${time(r.start)}</td><td>${time(r.end)}</td><td>${r.quantity}</td><td>${hours(r.paidMinutes)}${r.breakMinutes?`<small>Repas ${r.breakMinutes} min</small>`:''}</td><td>${hours(r.paidMinutes*r.quantity)}</td></tr>`).join(''):'<tr class="needs-row"><td colspan="6">Aucun besoin saisi</td></tr>'}<tr class="needs-subtotal"><th colspan="3">Total ${days[i].toLocaleLowerCase('fr-CA')}</th><td>${rows.reduce((n,r)=>n+r.quantity,0)}</td><td></td><td>${hours(rows.reduce((n,r)=>n+r.paidMinutes*r.quantity,0))}</td></tr>`).join('')}</tbody></table><footer class="needs-footer"><strong>Total de la semaine : ${report.count} quart(s) · ${hours(report.totalMinutes)} h nettes</strong><p>Tous les besoins saisis sont inclus, qu’ils soient attribués ou à couvrir. Heures nettes après repas non payé, sans déduction des absences individuelles. Les pauses payées restent comprises. Les commandes téléphoniques et l’aide des autres départements sont incluses.</p></footer></article>`;
}
