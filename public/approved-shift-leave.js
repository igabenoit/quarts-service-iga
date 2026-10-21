import {addDays} from './leave-calendar.js';
import {serviceShiftTiming} from './service-rules.js';

// Keep the manual exception separately so cancelling a leave or changing the
// employee removes only the absence created by the approved request.
export function shiftWithApprovedLeave(shift, periods=[], employeeId=null) {
  const previous=shift.approvedLeaveAbsence;
  const base=previous?previous.baseAbsence:shift.absence;
  const withAbsence=(absence,approvedLeaveAbsence=null)=>({...shift,absence:absence||null,
    approvedLeaveAbsence,...serviceShiftTiming(shift.startMinute,shift.endMinute,absence)});
  if(!shift.weekStart)return shift;
  const date=addDays(shift.weekStart,shift.dayIndex);
  const overlaps=periods.filter(p=>p.date===date&&p.startMinute<shift.endMinute&&p.endMinute>shift.startMinute);
  if(!overlaps.length)return previous?withAbsence(base):shift;
  const restored=previous?withAbsence(base):shift;
  // Full-day requests still require a replacement, including when an older
  // manual exception happens to cover the entire shift.
  if(overlaps.some(p=>p.allDay))return restored;
  const spans=overlaps.map(p=>[Math.max(p.startMinute,shift.startMinute),Math.min(p.endMinute,shift.endMinute)]);
  if(base)spans.push([base.start,base.end]);
  spans.sort((a,b)=>a[0]-b[0]);
  let [start,end]=spans[0];
  for(const [a,b] of spans.slice(1)){
    // The shift model supports one absence. Never deduct the worked interval
    // between two separate requests just to fit that model.
    if(a>end)return restored;
    end=Math.max(end,b);
  }
  if(start===shift.startMinute&&end===shift.endMinute)return restored;
  if(base&&start===base.start&&end===base.end)return restored;
  const meal=serviceShiftTiming(shift.startMinute,shift.endMinute).breakMinutes;
  const includesMeal=!!(base?.includesMeal||(previous&&Number(previous.employeeId)===Number(employeeId)&&shift.absence?.includesMeal))&&end-start>=meal;
  const absence={start,end,includesMeal};
  try{return withAbsence(absence,{employeeId:Number(employeeId),baseAbsence:base||null});}
  catch{return restored;}
}

const plainAbsence=absence=>absence?{start:absence.start,end:absence.end,includesMeal:absence.includesMeal}:null;
export const storedShiftAbsence=shift=>shift.absence?{...plainAbsence(shift.absence),
  ...(shift.approvedLeaveAbsence?{approvedLeave:{employeeId:Number(shift.approvedLeaveAbsence.employeeId),baseAbsence:plainAbsence(shift.approvedLeaveAbsence.baseAbsence)}}:{})}:null;

// Only carry provenance across an edit if the manager kept the same absence
// interval. The meal choice remains editable; a different interval is manual.
export function editedShiftLeave(shift, existing) {
  if(existing?.absence?.approvedLeave&&shift.absence&&
    shift.absence.start===existing.absence.start&&shift.absence.end===existing.absence.end)
    return {...shift,approvedLeaveAbsence:existing.absence.approvedLeave};
  return shift;
}
