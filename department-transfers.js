import {DAY_NAMES,departmentLabel,isTimedCell,shiftAssignment,timeLabel,addDays} from './public/departments-core.js';
import {buffetKey,usesBuffetRule} from './public/department-buffet.js';

// Use explicit identity links, never a name match, to join an employee's records.
export const personIdentity=(id,people)=>{const p=people.find(p=>p.id===Number(id));return p?.portalPersonId||Number(id);};
export function relatedFor(weeks,key,people,members,{published=false}={}){
  const related=[];
  for(const source of weeks){
    if(source.key===key)continue;
    for(const row of (published?source.published:source.draft)?.rows||[]){
      const person=members.find(p=>personIdentity(p.id,people)===personIdentity(row.personId,people));if(!person)continue;
      row.cells.forEach((cell,day)=>{
        // Incoming transfers already appear once through mergeIncoming.
        if(!isTimedCell(cell)||cell.workDepartment===key)return;
        related.push({personId:person.id,day,cell,sourceDepartment:source.key,sourceDepartmentId:Number(source.department_id)});
      });
    }
  }
  return related;
}

export function crossDepartmentWarnings(current,display,others,people){
  const minute=(date,n=0)=>Date.parse(String(date instanceof Date?date.toISOString():date).slice(0,10)+'T00:00:00Z')/60000+Number(n),warnings=new Set();
  for(const row of display.rows)row.cells.forEach((c,day)=>{
    if(!isTimedCell(c))return;
    const date=addDays(current.weekStart,day),start=minute(date,c.start),end=minute(date,c.end);
    for(const other of others){
      const otherWeek=String(other.week_start instanceof Date?other.week_start.toISOString():other.week_start).slice(0,10);
      if(otherWeek===current.weekStart&&(c.sourceDepartment||current.department.key)===other.key)continue;
      const seen=new Set();
      for(const [state,schedule] of [['brouillon',other.draft],['publié',other.published]])for(const match of schedule?.rows||[]){
        if(personIdentity(match.personId,people)!==personIdentity(row.personId,people))continue;
        match.cells.forEach((cell,d)=>{
          if(!isTimedCell(cell))return;
          const person=people.find(p=>p.id===row.personId);
          if(otherWeek===current.weekStart&&usesBuffetRule(person,c,current.department.key)&&usesBuffetRule(person,cell,other.key)&&buffetKey(row.personId,day,c)===buffetKey(row.personId,d,cell))return;
          const signature=JSON.stringify([d,cell]);if(seen.has(signature))return;seen.add(signature);
          if(start>=minute(otherWeek,d*1440+cell.end)||minute(otherWeek,d*1440+cell.start)>=end)return;
          const name=people.find(p=>p.id===row.personId)?.name||'Employé retiré';
          warnings.add(`${name} : chevauchement avec ${departmentLabel(cell.workDepartment||other.key)}, le ${date} — ${shiftAssignment(c,current.department.key)} (${timeLabel(c.start)}–${timeLabel(c.end)}) et ${shiftAssignment(cell,other.key)} (${timeLabel(cell.start)}–${timeLabel(cell.end)}, ${state} du ${addDays(otherWeek,d)}).`);
        });
      }
    }
  });
  return [...warnings];
}

// A received shift is projected from its source, never stored as a second editable shift.
export function incomingFor(weeks,key,{published=false}={}){
  const incoming=[];
  for(const week of weeks){
    if(week.key===key)continue;
    const schedule=published?week.published:week.draft;
    for(const row of schedule?.rows||[])row.cells.forEach((cell,day)=>{
      if(!isTimedCell(cell)||cell.workDepartment!==key)return;
      incoming.push({personId:row.personId,day,cell,sourceDepartment:week.key,sourceDepartmentId:Number(week.department_id),sourceRevision:week.revision,publishedAt:week.published_at,
        ...(published?{person:{name:row.name,jobTitle:row.jobTitle||'',specification:row.specification||'',group:row.group}}:{})});
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
