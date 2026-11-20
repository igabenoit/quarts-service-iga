import {addDays,nameKey} from './public/departments-core.js';

export function leavePersonIds(request,people){
  const root=id=>{const seen=new Set();let person=people.find(p=>p.id===Number(id));
    while(person?.portalPersonId&&!seen.has(person.id)){seen.add(person.id);const parent=people.find(p=>p.id===person.portalPersonId);if(!parent)break;person=parent;}
    return person?.id;
  };
  let identities=[];
  if(request.person_id)identities=[root(request.person_id)];
  else if(request.employee_id)identities=people.filter(p=>p.serviceEmployeeId===Number(request.employee_id)).map(p=>root(p.id));
  else {
    // Older manager-entered requests may have no ID. Match only an unambiguous
    // person in the originating department; never guess between homonyms.
    identities=[...new Set(people.filter(p=>p.departments.includes(Number(request.department_id))&&nameKey(p.name)===nameKey(request.employee_name)).map(p=>root(p.id)))];
    if(identities.length!==1)return [];
  }
  return people.filter(p=>identities.includes(root(p.id))).map(p=>p.id);
}
export async function approvedDepartmentLeaves(client,weekStart,people){
  // Include next Monday: a Sunday night shift can overlap its approved leave.
  const {rows}=await client.query(`SELECT person_id,employee_id,employee_name,department_id,periods,effective_periods
    FROM schedule_leave_requests WHERE status='approved' AND is_test=FALSE AND archived_at IS NULL
    AND first_date<=$2 AND last_date>=$1`,[weekStart,addDays(weekStart,7)]);
  const leaves={};
  for(const request of rows)for(const id of leavePersonIds(request,people))
    (leaves[id]??=[]).push(...(request.effective_periods??request.periods).map(p=>({date:p.date,startMinute:p.startMinute,endMinute:p.endMinute})));
  return leaves;
}
