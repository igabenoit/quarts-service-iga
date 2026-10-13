import {DAY_NAMES,departmentLabel,isTimedCell} from './public/departments-core.js';

// A received shift is projected from its source, never stored as a second editable shift.
export function incomingFor(weeks,key,{published=false}={}){
  const incoming=[];
  for(const week of weeks){
    if(week.key===key)continue;
    const schedule=published?week.published:week.draft;
    for(const row of schedule?.rows||[])row.cells.forEach((cell,day)=>{
      if(!isTimedCell(cell)||cell.workDepartment!==key)return;
      incoming.push({personId:row.personId,day,cell,sourceDepartment:week.key,sourceDepartmentId:Number(week.department_id),sourceRevision:week.revision,publishedAt:week.published_at,
        ...(published?{person:{name:row.name,jobTitle:row.jobTitle||'',group:row.group}}:{})});
    });
  }
  return incoming;
}

// Check both visible publications and drafts so no transfer can overwrite a local day.
// Two revisions of the same source/day are one identity, not two distinct shifts.
export function assertTransferSlots(weeks){
  const occupied=new Map(),received=new Map(),outgoing=[];
  for(const week of weeks)for(const schedule of [week.draft,week.published])for(const row of schedule?.rows||[])row.cells.forEach((cell,day)=>{
    if(cell.kind!=='blank')occupied.set(`${week.key}:${row.personId}:${day}`,true);
    if(isTimedCell(cell)&&cell.workDepartment)outgoing.push({source:week.key,personId:row.personId,day,target:cell.workDepartment});
  });
  for(const shift of outgoing){
    const slot=`${shift.target}:${shift.personId}:${shift.day}`,origin=`${shift.source}:${shift.personId}:${shift.day}`;
    if(occupied.has(slot)||received.has(slot)&&received.get(slot)!==origin)throw Object.assign(Error(`${departmentLabel(shift.target)}, ${DAY_NAMES[shift.day]} : la case de cet employé est déjà occupée dans un brouillon ou un horaire publié. Libérez cette case avant d’y affecter le quart; aucune heure n’a été remplacée.`),{status:409});
    received.set(slot,origin);
  }
}
