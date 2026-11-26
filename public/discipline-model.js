export const disciplineSteps = [
  ['Verbal 1 / 3','verbal'],['Verbal 2 / 3','verbal'],['Verbal 3 / 3','verbal'],
  ['Écrit 1 / 2','written'],['Écrit 2 / 2','written'],
  ['Suspension · 1 jour','suspension'],['Suspension · 2 jours','suspension'],
  ['Avis final','final'],['Suspension · 3 jours','suspension'],
  ['Dernier avis · ultimatum','final'],['Congédiement','termination']
].map(([label,tone],index)=>({level:index+1,label,tone}));
export function disciplineLevel(records){return Math.max(0,...records.filter(r=>r.status==='approved').map(r=>Number(r.level)));}
export function disciplineNext(records){return disciplineSteps[disciplineLevel(records)]||null;}
