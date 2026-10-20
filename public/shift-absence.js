export function normalizeAbsence(value,start,end,breakMinutes=0){
  if(value==null)return null;
  if(typeof value!=='object'||Array.isArray(value)||!Number.isInteger(value.start)||!Number.isInteger(value.end)||value.start<start||value.end>end||value.end<=value.start||typeof value.includesMeal!=='boolean')throw Error('L’absence doit avoir un début et une fin à l’intérieur du quart.');
  if(value.includesMeal&&value.end-value.start<breakMinutes)throw Error('Pour inclure toute la pause repas, l’absence doit durer au moins autant que cette pause.');
  if(end-start-(value.end-value.start)-(value.includesMeal?0:breakMinutes)<0)throw Error('L’absence et la pause dépassent la durée du quart.');
  return {start:value.start,end:value.end,includesMeal:value.includesMeal};
}
export const absenceDeduction=(absence,meal=0)=>absence?absence.end-absence.start-(absence.includesMeal?meal:0):0;
const time=n=>String(Math.floor(n%1440/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')+(n>=1440?' +1':'');
export const absenceLabel=a=>a?'Absence à ses frais : '+time(a.start)+'–'+time(a.end)+(a.includesMeal?' (repas compris)':''):'';
export function workingIntervals(start,end,absence){return absence?[[start,absence.start],[absence.end,end]].filter(([a,b])=>b>a):[[start,end]];}
