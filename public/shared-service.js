import {blankCell,isTimedCell,cellMinutes,departmentLabel,shiftAssignment} from './departments-core.js';
import {serviceShiftTiming} from './service-rules.js';

// Read-only projections: each department retains its own portion and accounting.
export function serviceWeekProjection(shifts,people,departmentId,{published=false,publishedAt=null}={}){
  const rows=[];
  for(const s of shifts){
    const person=people.find(p=>p.serviceEmployeeId===Number(s.employee_id));if(!person)continue;
    const cells=Array.from({length:7},blankCell),start=Number(s.start_minute),end=Number(s.end_minute);
    cells[Number(s.day_index)]={kind:'shift',start,end,breakMinutes:serviceShiftTiming(start,end).breakMinutes,...(s.absence?{absence:s.absence}:{paidMinutesOverride:serviceShiftTiming(start,end).paidMinutes}),note:''};
    rows.push({personId:person.id,cells});
  }
  return {key:'service',department_id:departmentId,draft:{rows},published:published?{rows}:null,published_at:publishedAt};
}
export function departmentPortionsForService(weeks,people){
  const result=[],seen=new Set();
  const canonical=p=>p.portalPersonId||p.id;
  for(const week of weeks.filter(w=>w.key!=='service'))for(const row of week.draft?.rows||[]){
    const source=people.find(p=>p.id===row.personId);if(!source)continue;
    const service=people.find(p=>p.serviceEmployeeId&&canonical(p)===canonical(source));if(!service)continue;
    row.cells.forEach((c,day)=>{
      if(!isTimedCell(c))return;
      const department=c.workDepartment||week.key,id=JSON.stringify([service.serviceEmployeeId,day,c.start,c.end,department]);
      if(seen.has(id))return;seen.add(id);
      result.push({employeeId:service.serviceEmployeeId,dayIndex:day,startMinute:c.start,endMinute:c.end,paidMinutes:cellMinutes(c),department,kind:c.kind,post:c.post,label:shiftAssignment(c,week.key)});
    });
  }
  return result;
}
export function serviceDayPortions(data,employeeId,day){
  const ids=new Set(data.assignments.filter(a=>a.employeeId===employeeId).map(a=>a.shiftId));
  const own=data.shifts.filter(s=>ids.has(s.id)&&s.dayIndex===day);
  if(!own.length)return [];
  return (data.relatedDepartments||[]).filter(p=>p.employeeId===employeeId&&p.dayIndex===day).map(p=>({...p,external:true,role:'department',sourceDepartment:p.label||departmentLabel(p.department)}));
}
