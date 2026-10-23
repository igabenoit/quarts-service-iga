const keys=['fruits','boulangerie','viande','charcuterie','pam','poissonnerie','epicerie','cuisine','administration'];
const hours=new Intl.NumberFormat('fr-CA',{maximumFractionDigits:2});
export function normalizeDepartmentBudget(value,key){
  if(!keys.includes(key)||!value||value.department!==key||!(value.hours===null||typeof value.hours==='number'&&Number.isFinite(value.hours)&&value.hours>=0&&value.hours<=99999999.99))throw Error('Budget invalide.');
  return {department:key,hours:value.hours};
}
export function departmentBudgetHTML(key,{status='loading',data=null}={}){
  const budget=data?.departmentBudget;
  const ready=status==='ready'&&budget?.department===key;
  const label=ready?(budget.hours===null?'Non renseignées':hours.format(budget.hours)+' h'):status==='unavailable'?'Indisponibles':'Chargement…';
  const detail=key==='cuisine'?'Cuisine séparée du PAM, hors productivité.':key==='pam'?'Heures productives du PAM, hors cuisine.':'Heures prévues dans les prévisions de ventes.';
  return `<strong>Heures budgétées · semaine</strong><b>${label}</b><small>${detail}${ready&&budget.hours===null?' À renseigner dans les prévisions.':''}${status==='unavailable'?' Actualisez les prévisions pour réessayer.':''}</small>`;
}
