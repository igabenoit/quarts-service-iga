import {serviceShiftTiming} from './service-rules.js';
const roles={training:"Formation",manager:'Gérante',supervisor:'Superviseur',cashier:'Caissière',packer:'Emballeur',orders:'Commandes téléphoniques',support:'Aide autre département'};
const days=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const e=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const time=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const hours=n=>(n/60).toLocaleString('fr-CA',{maximumFractionDigits:2});
const dayDate=(week,i)=>{const d=new Date(week+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);return new Intl.DateTimeFormat('fr-CA',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(d);};
export function serviceNeedsReport(data){
 const dayRows=days.map(()=>new Map());
 for(const s of data.shifts){
  const timing=serviceShiftTiming(s.startMinute,s.endMinute),department=s.role==='support'?s.sourceDepartment||'':'';
  const key=JSON.stringify([s.role,s.startMinute,s.endMinute,department,!!s.training]);
  const rows=dayRows[s.dayIndex],r=rows.get(key)||{training:!!s.training,role:s.role,start:s.startMinute,end:s.endMinute,department,quantity:0,paidMinutes:timing.paidMinutes,breakMinutes:timing.breakMinutes};r.quantity++;rows.set(key,r);
 }
 const report=dayRows.map(rows=>[...rows.values()].sort((a,b)=>a.start-b.start||a.end-b.end||Object.keys(roles).indexOf(a.role)-Object.keys(roles).indexOf(b.role)||a.department.localeCompare(b.department,'fr')));
 return {days:report,count:data.shifts.length,totalMinutes:report.flat().reduce((sum,r)=>sum+r.paidMinutes*r.quantity,0)};
}
const groups=[{id:'supervision',title:'Gérants et superviseurs',roles:['manager','supervisor']},{id:'cashiers',title:'Caissières',roles:['cashier','support']},{id:'packers',title:'Emballeurs',roles:['packer']},{id:'orders',title:'Commandes téléphoniques',roles:['orders'],optional:true}];
export function serviceNeedsHTML(data){
 const report=serviceNeedsReport(data);
 return groups.flatMap(group=>{
  const byDay=report.days.map(rows=>rows.filter(r=>group.roles.includes(r.role)));
  const all=byDay.flat();if(group.optional&&!all.length)return [];
  const count=all.reduce((n,r)=>n+r.quantity,0),total=all.reduce((n,r)=>n+r.paidMinutes*r.quantity,0);
  const height=Math.max(1,...byDay.map(rows=>rows.length));
  const entry=r=>r?`<div class="needs-entry"><strong>${r.quantity>1?r.quantity+' × ':''}${e(roles[r.role]||r.role)}${r.training?" · Formation":""}</strong>${r.department?`<small>${e(r.department)}</small>`:''}<span class="needs-time">${time(r.start)}–${time(r.end)}</span><small>${hours(r.paidMinutes)} h par quart${r.breakMinutes?` · repas ${r.breakMinutes} min`:''}</small>${r.quantity>1?`<small>Total : ${hours(r.paidMinutes*r.quantity)} h</small>`:''}</div>`:'<span class="needs-empty">—</span>';
  return [`<article class="service-sheet service-needs-sheet" data-needs-group="${group.id}"><header class="sheet-header"><img src="/logo-famille-benoit.svg" alt="IGA extra Famille Benoit"><div><p>PLANIFICATION AVANT ATTRIBUTION</p><h1>Besoins du Service</h1><h2>${group.title}</h2><strong>Du ${e(dayDate(data.weekStart,0))} au ${e(dayDate(data.weekStart,6))}</strong><small>${count} quart(s) · ${hours(total)} h nettes</small></div></header><table class="sheet-table needs-table"><colgroup>${'<col>'.repeat(7)}</colgroup><thead><tr>${days.map((d,i)=>`<th scope="col">${d}<small>${e(dayDate(data.weekStart,i))}</small></th>`).join('')}</tr></thead><tbody>${Array.from({length:height},(_,i)=>`<tr class="needs-row">${byDay.map(rows=>`<td>${entry(rows[i])}</td>`).join('')}</tr>`).join('')}<tr class="needs-subtotal">${byDay.map(rows=>`<td><strong>${rows.reduce((n,r)=>n+r.quantity,0)} quart(s)</strong><small>${hours(rows.reduce((n,r)=>n+r.paidMinutes*r.quantity,0))} h nettes</small></td>`).join('')}</tr></tbody></table><footer class="needs-footer"><strong>${group.title} : ${count} quart(s) · ${hours(total)} h nettes</strong><p>Total du Service pour la semaine : ${report.count} quart(s) · ${hours(report.totalMinutes)} h nettes.</p><p>Tous les besoins saisis sont inclus, attribués ou à couvrir. Heures nettes après repas non payé, sans déduction des absences individuelles. Les pauses payées restent comprises.</p></footer></article>`];
 }).join('');
}
