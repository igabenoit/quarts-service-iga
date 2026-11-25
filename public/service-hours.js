import {serviceShiftTiming} from './service-rules.js';

export const SERVICE_TOTAL_ROLES=['manager','supervisor','cashier','packer'];
export const isServiceTotalShift=shift=>SERVICE_TOTAL_ROLES.includes(shift.role);
const assignedShiftIds=assignments=>new Set(assignments.filter(a=>Number.isInteger(Number(a.employeeId))&&Number(a.employeeId)>0).map(a=>Number(a.shiftId)));

export function unassignedServiceShifts({shifts=[],assignments=[]}={}){
  const assignedIds=assignedShiftIds(assignments);
  return shifts.filter(shift=>isServiceTotalShift(shift)&&!assignedIds.has(Number(shift.id)));
}

// Count each need once, by the shift's function rather than the employee's job.
// Assignment changes move its paid minutes between assigned and still to fill.
export function serviceHoursSummary({shifts=[],assignments=[]}={}){
  const assignedIds=assignedShiftIds(assignments);
  const summary={plannedMinutes:0,assignedMinutes:0,unassignedMinutes:0,plannedCount:0,assignedCount:0,unassignedCount:0,trainingMinutes:0,
    byRole:Object.fromEntries(SERVICE_TOTAL_ROLES.map(role=>[role,{plannedMinutes:0,assignedMinutes:0,unassignedMinutes:0}]))};
  for(const shift of shifts.filter(isServiceTotalShift)){
    const paid=serviceShiftTiming(shift.startMinute,shift.endMinute,shift.absence).paidMinutes;
    const assigned=assignedIds.has(Number(shift.id)),role=summary.byRole[shift.role];
    summary.plannedMinutes+=paid;summary.plannedCount++;role.plannedMinutes+=paid;
    const bucket=assigned?'assignedMinutes':'unassignedMinutes';
    summary[bucket]+=paid;summary[assigned?'assignedCount':'unassignedCount']++;role[bucket]+=paid;
    if(shift.training)summary.trainingMinutes+=Math.max(0,Math.min(shift.trainingMinutes??paid,paid));
  }
  return summary;
}
