import {programmedMinutes,budgetMinutes,budgetDelta,budgetLabel,budgetDeltaLabel,programmedDetail,budgetComparisonTotals,budgetComparisonTotalsHTML} from './department-budget-comparison.js';
import {prepareSharedDraft} from './department-buffet.js';
import {mergeIncoming,totalMinutes,trainingMinutes,buffetMinutes,kitchenMinutes,mentionMinutes,grandMinutes,hoursLabel,dateLabel,addDays,escapeHTML as e} from './departments-core.js';

export function plannedSummary(data){
  const prepared=prepareSharedDraft(mergeIncoming(data.draft,data.incoming||[]),data.related||[],data.people,data.department.key);
  const sum=fn=>prepared.draft.rows.reduce((n,row)=>n+fn(row),0);
  return {department:data.department,weekStart:data.weekStart,totals:{shift:sum(totalMinutes),training:sum(trainingMinutes),buffet:sum(buffetMinutes),kitchen:sum(kitchenMinutes),mention:sum(mentionMinutes)},total:sum(grandMinutes),revision:data.revision,empty:!data.revision};
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
export const actualKitchenMinutes=row=>row.actual.minutes===null?null:row.actual.minutes===0?0:row.actual.kitchenMinutes??(row.totals.kitchen===0&&!['pam','cuisine'].includes(row.department.key)?0:null);
export const actualProductiveMinutes=row=>row.actual.minutes===null||actualKitchenMinutes(row)===null?null:row.actual.minutes-actualKitchenMinutes(row);
export const summaryDelta=row=>row.actual.minutes===null?null:row.actual.minutes-row.total;
const signed=value=>(value>0?'+':'')+hoursLabel(value);
export const valueLabel=value=>value===null?'—':hoursLabel(value);
export function serviceSummaryDetail(row){
  const s=row.serviceBreakdown;
  return s?`Sous-total caisse / emballeurs : ${hoursLabel(s.checkout)} h (gérante et supervision incluses)\nCommandes téléphoniques : ${hoursLabel(s.orders)} h${row.totals.training ? `\nFormation : ${hoursLabel(row.totals.training)} h` : ''}\nTotal Service : ${hoursLabel(row.total)} h`:row.detail||'';
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
  return `<article class="control-sheet summary-sheet" aria-label="Sommaire budget horaire et écarts"><header class="sheet-header control-header"><div><p>CONTRÔLE HEBDOMADAIRE DES HEURES</p><h2>Budget et heures programmées</h2><strong>Du ${e(dateLabel(rows[0].weekStart))} au ${e(dateLabel(addDays(rows[0].weekStart,6)))}</strong></div><div class="control-reference">Budgets des prévisions<br>Horaires enregistrés</div></header><table class="summary-print-table"><colgroup><col style="width:20%"><col style="width:13%"><col style="width:25%"><col style="width:13%"><col style="width:12%"><col style="width:17%"></colgroup><thead><tr><th>Département</th><th>Prévues<br>Budget</th><th>Programmées<br>Horaire</th><th>Écart<br>Horaire − budget</th><th>Payées<br>Saisie facultative</th><th>Note</th></tr></thead><tbody>${rows.map(row=>`<tr><th>${e(row.department.name)}${row.empty?'<small>Aucun horaire saisi</small>':''}</th><td>${budgetLabel(row)}</td><td><strong>${hoursLabel(programmedMinutes(row))} h</strong><small>${e(programmedDetail(row))}</small></td><td>${budgetDeltaLabel(row)}</td><td>${valueLabel(row.actual.minutes)}${row.actual.kitchenMinutes!=null?'<small>dont cuisine '+hoursLabel(row.actual.kitchenMinutes)+' h</small>':''}</td><td>${e(row.actual.note||'')}</td></tr>`).join('')}</tbody></table>${budgetComparisonTotalsHTML(rows)}<footer class="control-footer summary-print-footer"><p>Prévues = budgets des feuilles de prévisions pour les mêmes dates. Formation et buffet inclus; commandes téléphoniques incluses au Service. Programmées = heures des quarts enregistrés, nettes des pauses et absences. Au Service, seulement les quarts attribués.</p><p>Écart = horaire − budget : positif = dépassement; négatif = heures disponibles. Cuisine et affectations séparées restent hors du budget du département. La cuisine est exclue du total du magasin. Un budget manquant n’est jamais remplacé par les heures de l’horaire.</p><p>Les heures payées saisies sont un suivi distinct et ne modifient ni le budget ni les heures programmées.</p><div>Vérifié par : ____________________ Date : ______________ Signature : ____________________</div></footer></article>`;
}
export function summaryCSV(rows){
 const records=[['Département','Semaine du','Heures prévues - budget (h)','Heures programmées (h)','Écart horaire - budget (h)','État du budget','Régulier programmé (h)','Formation programmée (h)','Buffet programmé (h)','Commandes programmées (h)','Cuisine séparée (h)','Affectations séparées (h)','Heures payées saisies (h)','Dont cuisine payée (h)','Note']];
 for(const row of rows)records.push([row.department.name,row.weekStart,budgetMinutes(row)===null?'':hoursLabel(budgetMinutes(row)),hoursLabel(programmedMinutes(row)),budgetDelta(row)===null?'':hoursLabel(budgetDelta(row)),budgetMinutes(row)!==null?'Disponible':row.budget?.status==='ready'?'Non renseigné':'Indisponible',...['shift','training','buffet','orders','kitchen','mention'].map(key=>hoursLabel(row.totals[key]??0)),row.actual.minutes===null?'':hoursLabel(row.actual.minutes),row.actual.kitchenMinutes==null?'':hoursLabel(row.actual.kitchenMinutes),row.actual.note]);
 for(const m of budgetComparisonTotals(rows))records.push([m.label,rows[0]?.weekStart||'',m.budget===null?'':hoursLabel(m.budget),hoursLabel(m.programmed),m.delta===null?'':hoursLabel(m.delta),m.known+'/'+m.count+' budgets disponibles','','','','','','','','','']);
 return '\ufeff'+records.map(record=>record.map(value=>'"'+String(value??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"').join(';')).join('\r\n');
}
