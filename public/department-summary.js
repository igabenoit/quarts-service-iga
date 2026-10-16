import {prepareSharedDraft} from './department-buffet.js';
import {mergeIncoming,totalMinutes,trainingMinutes,buffetMinutes,kitchenMinutes,grandMinutes,hoursLabel,dateLabel,addDays,escapeHTML as e} from './departments-core.js';

export function plannedSummary(data){
  const prepared=prepareSharedDraft(mergeIncoming(data.draft,data.incoming||[]),data.related||[],data.people,data.department.key);
  const sum=fn=>prepared.draft.rows.reduce((n,row)=>n+fn(row),0);
  return {department:data.department,weekStart:data.weekStart,totals:{shift:sum(totalMinutes),training:sum(trainingMinutes),buffet:sum(buffetMinutes),kitchen:sum(kitchenMinutes)},total:sum(grandMinutes),revision:data.revision,empty:!data.revision};
}
export function parseSummaryHours(value){
  const raw=String(value??'').trim();if(!raw)return null;
  let minutes;const clock=/^(\d{1,6})[:h](\d{2})$/.exec(raw);
  if(clock&&Number(clock[2])<60)minutes=Number(clock[1])*60+Number(clock[2]);
  else if(/^\d{1,6}(?:[.,]\d{1,4})?$/.test(raw))minutes=Number(raw.replace(',','.'))*60;
  if(!Number.isFinite(minutes)||minutes<0||minutes>10000000||Math.abs(minutes-Math.round(minutes))>0.00001)throw Error('Entrez des heures positives à la minute près, par exemple 37,5 ou 37:30.');
  return Math.round(minutes);
}
export function normalizeSummaryActual(value){
  if(!value||value.minutes!==null&&(!Number.isInteger(value.minutes)||value.minutes<0||value.minutes>10000000)||typeof value.note!=='string'||value.note.length>240)throw Error('Heures réelles ou justification invalides (240 caractères maximum).');
  const kitchen=value.kitchenMinutes??null;
  if(kitchen!==null&&(!Number.isInteger(kitchen)||kitchen<0||value.minutes===null||kitchen>value.minutes))throw Error('Les heures réelles de cuisine doivent être comprises entre 0 et le total réel payé.');
  return {minutes:value.minutes,kitchenMinutes:kitchen,note:value.note.trim()};
}
export const productiveMinutes=row=>row.total-row.totals.kitchen;
export const actualKitchenMinutes=row=>row.actual.minutes===null?null:row.actual.minutes===0?0:row.actual.kitchenMinutes??(row.totals.kitchen===0&&row.department.key!=='pam'?0:null);
export const actualProductiveMinutes=row=>row.actual.minutes===null||actualKitchenMinutes(row)===null?null:row.actual.minutes-actualKitchenMinutes(row);
export const summaryDelta=row=>row.actual.minutes===null?null:row.actual.minutes-row.total;
const signed=value=>(value>0?'+':'')+hoursLabel(value);
export const valueLabel=value=>value===null?'—':hoursLabel(value);
export function serviceSummaryDetail(row){
  const s=row.serviceBreakdown;
  return s?`Sous-total caisse / emballeurs : ${hoursLabel(s.checkout)} h (gérante et supervision incluses)\nCommandes téléphoniques : ${hoursLabel(s.orders)} h\nTotal Service : ${hoursLabel(row.total)} h`:row.detail||'';
}
export function summaryMetrics(rows){
  const values=[['productive','Heures productives',productiveMinutes,actualProductiveMinutes],['kitchen','Cuisine séparée',row=>row.totals.kitchen,actualKitchenMinutes],['paid','Grand total des heures payées',row=>row.total,row=>row.actual.minutes]];
  return values.map(([key,label,plannedValue,realValue])=>{
    const planned=rows.reduce((n,row)=>n+plannedValue(row),0),values=rows.map(realValue),filled=values.filter(v=>v!==null).length,actual=filled?values.reduce((n,v)=>n+(v??0),0):null,complete=filled===rows.length;
    return {key,label,planned,actual,filled,complete,delta:complete?actual-planned:null};
  });
}
export function summaryPage(rows){
  if(!rows.length)throw Error('Aucun département accessible pour le sommaire.');
  return `<article class="control-sheet summary-sheet" aria-label="Sommaire prévu réel et écarts"><header class="sheet-header control-header"><div><p>CONTRÔLE HEBDOMADAIRE DES HEURES</p><h2>Sommaire des départements</h2><strong>Du ${e(dateLabel(rows[0].weekStart))} au ${e(dateLabel(addDays(rows[0].weekStart,6)))}</strong></div><div class="control-reference">Productives + cuisine = payées<br>${rows.length} département(s)</div></header><table class="summary-print-table"><colgroup><col style="width:25%">${Array.from({length:9},()=>'<col>').join('')}</colgroup><thead><tr><th>Département</th><th>Régulier<br>prévu</th><th>Formation<br>prévue</th><th>Buffet<br>prévu</th><th>Cuisine<br>séparée</th><th>Commandes<br>téléphoniques</th><th>Productives<br>prévues</th><th>Total payé<br>prévu</th><th>Total payé<br>réel</th><th>Écart payé<br>réel − prévu</th></tr></thead><tbody>${rows.map(row=>`<tr><th>${e(row.department.name)}${row.empty?'<small>Aucun horaire saisi</small>':''}${serviceSummaryDetail(row)?`<small>${e(serviceSummaryDetail(row))}</small>`:''}${row.actual.note?`<small>${e(row.actual.note)}</small>`:''}</th>${['shift','training','buffet','kitchen','orders'].map(key=>`<td>${hoursLabel(row.totals[key]??0)}</td>`).join('')}<td><strong>${hoursLabel(productiveMinutes(row))}</strong></td><td>${hoursLabel(row.total)}</td><td>${valueLabel(row.actual.minutes)}${actualKitchenMinutes(row)!==null&&actualKitchenMinutes(row)>0?`<small>dont cuisine ${hoursLabel(actualKitchenMinutes(row))}</small>`:''}</td><td>${summaryDelta(row)===null?'—':signed(summaryDelta(row))}</td></tr>`).join('')}</tbody></table><table class="summary-totals"><thead><tr><th>Contrôle des totaux</th><th>Prévu (h)</th><th>Réel (h)</th><th>Écart (h)</th></tr></thead><tbody>${summaryMetrics(rows).map(m=>`<tr class="${m.key==='paid'?'control-grand summary-paid-total':''}"><th>${e(m.label)}</th><td>${hoursLabel(m.planned)}</td><td>${valueLabel(m.actual)}${m.actual!==null&&!m.complete?' *':''}</td><td>${m.delta===null?'—':signed(m.delta)}</td></tr>`).join('')}</tbody></table><footer class="control-footer summary-print-footer"><p>Heures nettes après pauses et heures convenues. Les heures productives excluent la cuisine. Grand total des heures payées = heures productives + cuisine, comptée séparément comme service extérieur.</p><p>Service = sous-total caisse / emballeurs (supervision incluse) + commandes téléphoniques. Quarts à couvrir inclus; soutien d’autres départements exclu.</p><p>Le réel payé inclut la cuisine. Pour le PAM, préciser « dont cuisine » pour calculer le réel productif. — = non saisi; * = réel partiel. L’écart global exige tous les réels correspondants.</p><div>Vérifié par : ____________________ Date : ______________ Signature : ____________________</div></footer></article>`;
}
export function summaryCSV(rows){
  const records=[['Département','Semaine du','Régulier prévu (h)','Formation prévue (h)','Buffet prévu (h)','Cuisine séparée prévue (h)','Heures productives prévues (h)','Grand total prévu payé (h)','Réel payé (h)','Réel cuisine (h)','Réel productif (h)','Écart payé réel − prévu (h)','Sous-total caisse / emballeurs prévu (h)','Commandes téléphoniques prévues (h)','Total Service prévu (h)','Justification']];
  for(const row of rows)records.push([row.department.name,row.weekStart,...['shift','training','buffet','kitchen'].map(key=>hoursLabel(row.totals[key])),hoursLabel(productiveMinutes(row)),hoursLabel(row.total),row.actual.minutes===null?'':hoursLabel(row.actual.minutes),actualKitchenMinutes(row)===null?'':hoursLabel(actualKitchenMinutes(row)),actualProductiveMinutes(row)===null?'':hoursLabel(actualProductiveMinutes(row)),summaryDelta(row)===null?'':hoursLabel(summaryDelta(row)),row.serviceBreakdown?hoursLabel(row.serviceBreakdown.checkout):'',row.serviceBreakdown?hoursLabel(row.serviceBreakdown.orders):'',row.serviceBreakdown?hoursLabel(row.total):'',row.actual.note]);
  for(const m of summaryMetrics(rows))records.push([m.label,rows[0]?.weekStart||'','','','',m.key==='kitchen'?hoursLabel(m.planned):'',m.key==='productive'?hoursLabel(m.planned):'',m.key==='paid'?hoursLabel(m.planned):'',m.key==='paid'&&m.actual!==null?hoursLabel(m.actual):'',m.key==='kitchen'&&m.actual!==null?hoursLabel(m.actual):'',m.key==='productive'&&m.actual!==null?hoursLabel(m.actual):'',m.key==='paid'&&m.delta!==null?hoursLabel(m.delta):'','','','',m.complete?'Complet':'Réel partiel ou non saisi']);
  return '\ufeff'+records.map(record=>record.map(value=>'"'+String(value??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"').join(';')).join('\r\n');
}

