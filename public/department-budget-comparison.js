import {hoursLabel,escapeHTML as e} from './departments-core.js';

// Compare only hours charged to the selected department. Separately labelled
// assignments and kitchen stay outside the department/store forecast subtotal.
export const programmedMinutes=row=>row.department.key==='cuisine'?(row.totals.kitchen??0):['shift','training','buffet','orders'].reduce((sum,key)=>sum+(row.totals[key]??0),0);
export const budgetMinutes=row=>row.budget?.status==='ready'&&typeof row.budget.hours==='number'?row.budget.hours*60:null;
export const budgetDelta=row=>budgetMinutes(row)===null?null:Math.round((programmedMinutes(row)-budgetMinutes(row))*100)/100;
export const budgetLabel=row=>budgetMinutes(row)!==null?hoursLabel(budgetMinutes(row))+' h':row.budget?.status==='ready'?'Non renseigné':'Indisponible';
export const budgetDeltaLabel=row=>budgetDelta(row)===null?'—':(budgetDelta(row)>0?'+':'')+hoursLabel(budgetDelta(row))+' h';
export function programmedDetail(row){
 const labels={shift:'Régulier',training:'Formation',buffet:'Buffet',orders:'Commandes téléphoniques'};
 const lines=Object.entries(labels).filter(([key])=>row.totals[key]>0).map(([key,label])=>label+' : '+hoursLabel(row.totals[key])+' h');
 if(row.department.key!=='cuisine'&&row.totals.kitchen>0)lines.push('Cuisine séparée : '+hoursLabel(row.totals.kitchen)+' h');
 if(row.totals.mention>0)lines.push('Affectations séparées : '+hoursLabel(row.totals.mention)+' h');
 return lines.join('\n');
}
export function budgetComparisonTotals(rows){
 const groups=[['store','Total du magasin · hors cuisine',rows.filter(r=>r.department.key!=='cuisine')],['kitchen','Cuisine séparée',rows.filter(r=>r.department.key==='cuisine')]];
 return groups.filter(([, ,items])=>items.length).map(([key,label,items])=>{
  const known=items.filter(r=>budgetMinutes(r)!==null),complete=known.length===items.length;
  const budget=complete?known.reduce((sum,row)=>sum+budgetMinutes(row),0):null,programmed=items.reduce((sum,row)=>sum+programmedMinutes(row),0);
  return {key,label,budget,programmed,delta:budget===null?null:Math.round((programmed-budget)*100)/100,known:known.length,count:items.length};
 });
}
export function budgetComparisonTotalsHTML(rows){
 return '<table class="summary-totals budget-comparison-totals"><thead><tr><th>Comparaison des heures</th><th>Prévues · budget</th><th>Programmées</th><th>Écart horaire − budget</th></tr></thead><tbody>'+budgetComparisonTotals(rows).map(m=>'<tr><th>'+e(m.label)+'</th><td>'+(m.budget===null?'—<small>'+m.known+'/'+m.count+' budgets disponibles</small>':hoursLabel(m.budget)+' h')+'</td><td>'+hoursLabel(m.programmed)+' h</td><td>'+(m.delta===null?'—':(m.delta>0?'+':'')+hoursLabel(m.delta)+' h')+'</td></tr>').join('')+'</tbody></table>';
}
