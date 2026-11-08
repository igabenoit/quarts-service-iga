import {addDays,blankCell} from './public/departments-core.js';
// effectiveOn is the FIRST day without employment. Keep every earlier day intact.
export function applyDepartures(snapshot,weekStart,people){
  if(!snapshot)return snapshot;
  const dates=new Map(people.filter(p=>p.employmentEndedOn).map(p=>[p.id,p.employmentEndedOn]));
  return {...snapshot,rows:snapshot.rows.flatMap(row=>{
    const date=dates.get(Number(row.personId));
    if(!date||date>addDays(weekStart,6))return [row];
    if(date<=weekStart)return [];
    return [{...row,cells:row.cells.map((cell,day)=>addDays(weekStart,day)>=date?blankCell():cell)}];
  })};
}
