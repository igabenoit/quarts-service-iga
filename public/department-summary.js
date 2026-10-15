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
  return {minutes:value.minutes,note:value.note.trim()};
}
export const summaryDelta=row=>row.actual.minutes===null?null:row.actual.minutes-row.total;
const signed=value=>(value>0?'+':'')+hoursLabel(value);
export function summaryPage(rows){
  if(!rows.length)throw Error('Aucun département accessible pour le sommaire.');
  const planned=rows.reduce((n,row)=>n+row.total,0),complete=rows.every(row=>row.actual.minutes!==null),actual=rows.reduce((n,row)=>n+(row.actual.minutes??0),0),filled=rows.filter(row=>row.actual.minutes!==null).length;
  return `<article class="control-sheet summary-sheet" aria-label="Sommaire prévu réel et écarts"><header class="sheet-header control-header"><div><p>CONTRÔLE HEBDOMADAIRE DES HEURES</p><h2>Sommaire des départements</h2><strong>Du ${e(dateLabel(rows[0].weekStart))} au ${e(dateLabel(addDays(rows[0].weekStart,6)))}</strong></div><div class="control-reference">Prévu · réel · écart<br>${rows.length} département(s)</div></header><table class="summary-print-table"><colgroup><col style="width:26%">${Array.from({length:7},()=>'<col>').join('')}</colgroup><thead><tr><th>Département</th><th>Régulier<br>prévu</th><th>Formation<br>prévue</th><th>Buffet<br>prévu</th><th>Cuisine<br>prévue</th><th>Total<br>prévu</th><th>Total<br>réel</th><th>Écart<br>réel − prévu</th></tr></thead><tbody>${rows.map(row=>`<tr><th>${e(row.department.name)}${row.empty?'<small>Aucun horaire saisi</small>':''}${row.detail?`<small>${e(row.detail)}</small>`:''}${row.actual.note?`<small>${e(row.actual.note)}</small>`:''}</th>${['shift','training','buffet','kitchen'].map(key=>`<td>${hoursLabel(row.totals[key])}</td>`).join('')}<td><strong>${hoursLabel(row.total)}</strong></td><td>${row.actual.minutes===null?'—':hoursLabel(row.actual.minutes)}</td><td>${summaryDelta(row)===null?'—':signed(summaryDelta(row))}</td></tr>`).join('')}<tr class="control-grand"><th>Total ${complete?'':'(réel partiel)'}</th>${['shift','training','buffet','kitchen'].map(key=>`<td>${hoursLabel(rows.reduce((n,row)=>n+row.totals[key],0))}</td>`).join('')}<td>${hoursLabel(planned)}</td><td>${filled?hoursLabel(actual):'—'}</td><td>${complete?signed(actual-planned):'—'}</td></tr></tbody></table><footer class="control-footer summary-print-footer"><p>Toutes les valeurs sont en heures payées nettes. Le prévu reprend les horaires enregistrés, les pauses et les heures convenues. Les catégories Régulier / Formation / Buffet / Cuisine détaillent le prévu.</p><p>Le réel est saisi manuellement par département. — signifie non saisi, distinct de 0 h. Réel renseigné pour ${filled}/${rows.length} départements; l’écart global s’affiche lorsque tous sont renseignés.</p><p>Service : caissières, superviseurs et emballeurs, y compris les quarts à couvrir. Le soutien provenant d’autres départements est exclu. Les affectations interdépartements et la règle Buffet sont imputées à leur département.</p><div>Vérifié par : ____________________ Date : ______________ Signature : ____________________</div></footer></article>`;
}
export function summaryCSV(rows){
  const records=[['Département','Semaine du','Régulier prévu (h)','Formation prévue (h)','Buffet prévu (h)','Cuisine prévue (h)','Total prévu (h)','Total réel (h)','Écart réel − prévu (h)','Statut','Justification']];
  for(const row of rows)records.push([row.department.name,row.weekStart,...['shift','training','buffet','kitchen'].map(key=>hoursLabel(row.totals[key])),hoursLabel(row.total),row.actual.minutes===null?'':hoursLabel(row.actual.minutes),summaryDelta(row)===null?'':hoursLabel(summaryDelta(row)),row.actual.minutes===null?'Non saisi':'Saisi',row.actual.note]);
  return '\ufeff'+records.map(record=>record.map(value=>'"'+String(value??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"').join(';')).join('\r\n');
}

