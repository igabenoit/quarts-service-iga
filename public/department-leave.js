import {addDays,isTimedCell,normalizeCell,blankCell,cellMinutes,cellBreakMinutes,timeLabel} from './departments-core.js';
import {workingIntervals} from './shift-absence.js';

const minute=date=>Date.parse(date+'T00:00:00Z')/60000;
const merge=spans=>spans.sort((a,b)=>a[0]-b[0]).reduce((out,[a,b])=>{
  const last=out.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else out.push([a,b]);return out;
},[]);
export function leaveSpans(periods,date,start=0,end=1440){
  const origin=minute(date);
  return merge((periods||[]).map(p=>[minute(p.date)+p.startMinute-origin,minute(p.date)+p.endMinute-origin])
    .filter(([a,b])=>a<end&&b>start).map(([a,b])=>[Math.max(a,start),Math.min(b,end)]));
}
export function leaveLabel(periods,date){
  const spans=leaveSpans(periods,date);
  return !spans.length?'':spans.length===1&&spans[0][0]===0&&spans[0][1]===1440?'Congé approuvé · journée bloquée':
    'Congé approuvé · '+spans.map(([a,b])=>timeLabel(a)+'–'+timeLabel(b)).join(', ');
}
export function assertLeaveCell(cell,periods,date,name='Cet employé'){
  if(!isTimedCell(cell))return;
  const spans=leaveSpans(periods,date,cell.start,cell.end);
  if(workingIntervals(cell.start,cell.end,cell.absence).some(([a,b])=>spans.some(([s,e])=>a<e&&s<b)))
    throw Object.assign(Error(`${name} : congé approuvé le ${date}. Choisissez des heures hors du congé ou un autre employé.`),{status:409});
}
export function assertDepartmentLeave(draft,leaves,weekStart,people){
  for(const row of draft?.rows||[])row.cells.forEach((cell,day)=>assertLeaveCell(cell,leaves[row.personId],addDays(weekStart,day),people.find(p=>p.id===row.personId)?.name));
}
// Project approved absences without altering the saved plan. Cancellation and
// corrections can then restore it, including a manager's original exception.
export function projectLeaveCell(cell,periods,date){
  if(!isTimedCell(cell)){
    const spans=leaveSpans(periods,date);
    return cell.kind==='blank'&&spans.length===1&&spans[0][0]===0&&spans[0][1]===1440?{...blankCell(),kind:'note',note:'Congé approuvé'}:cell;
  }
  const overlaps=leaveSpans(periods,date,cell.start,cell.end);
  if(!overlaps.length)return cell;
  const spans=merge([...overlaps,...(cell.absence?[[cell.absence.start,cell.absence.end]]:[])]);
  const released=()=>({...blankCell(),kind:'note',note:spans.length>1?'Congé approuvé · quart à réattribuer':'Congé approuvé'});
  // The cell model can express one absence. Do not silently remove the worked
  // gap between disjoint absences to make them fit that model.
  if(spans.length>1||spans[0][0]===cell.start&&spans[0][1]===cell.end)return released();
  const [start,end]=spans[0],next={...cell,absence:{start,end,includesMeal:cell.absence?.includesMeal===true}};
  // An explicit paid total cannot override hours removed by approved leave.
  delete next.paidMinutesOverride;
  if(cellMinutes(next)<0)next.absence.includesMeal=end-start>=cellBreakMinutes(next);
  if(next.trainingMinutes){next.trainingMinutes=Math.min(next.trainingMinutes,Math.max(0,cellMinutes(next)));if(!next.trainingMinutes)delete next.trainingMinutes;}
  try{return normalizeCell(next);}catch{return released();}
}
export const projectDepartmentLeave=(draft,leaves,weekStart)=>draft?{...draft,rows:draft.rows.map(row=>({...row,cells:row.cells.map((cell,day)=>projectLeaveCell(cell,leaves[row.personId],addDays(weekStart,day)))}))}:draft;

// Only the freshly read server copy supplies the base; client metadata is never
// trusted. Edits outside the automatic adjustment remain ordinary saved edits.
export function preserveLeaveBases(draft,stored,leaves,weekStart){
  return {...draft,rows:draft.rows.map(row=>({...row,cells:row.cells.map((cell,day)=>{
    const base=stored?.rows.find(r=>r.personId===row.personId)?.cells[day];if(!base)return cell;
    const projected=projectLeaveCell(base,leaves[row.personId],addDays(weekStart,day));
    return JSON.stringify(normalizeCell(cell))===JSON.stringify(normalizeCell(projected))?base:cell;
  })}))};
}
