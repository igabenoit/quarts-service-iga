import {shiftWithApprovedLeave} from './public/approved-shift-leave.js';
import {conflictsWithLeave} from "./leave-rules.js";
import {defaultServiceRole} from './service-role-defaults.js';
const hoursText = minutes => `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${String(minutes % 60).padStart(2, "0")}` : ""}`;

export function assignmentConflict(employee, shift, shifts, assigned = []) {
  shift=shiftWithApprovedLeave(shift,employee.leavePeriods,employee.id);
  if (conflictsWithLeave(shift,employee.leavePeriods)) return "Un congé approuvé chevauche ce quart.";
  if (!employee.active) return "Cet employé est inactif.";
  if (shift.role === "support") return "Ce quart est réservé à l’aide d’un autre département.";
  if (![employee.role,...(employee.roles||[])].includes(defaultServiceRole(shift.role,employee.role))) return "Ce poste ne fait pas partie des fonctions de cet employé.";
  const windows = employee.availability?.[shift.dayIndex] || [];
  if (!windows.some(([start, end]) => start <= shift.startMinute && end >= shift.endMinute))
    return `Les disponibilités de cet employé ne couvrent pas le quart complet de ${hoursText(shift.startMinute)} à ${hoursText(shift.endMinute)}.`;
  const jobs = assigned.filter(a => a.employeeId === employee.id).map(a => shifts.find(s => s.id === a.shiftId)).filter(Boolean).map(s=>shiftWithApprovedLeave(s,employee.leavePeriods,employee.id));
  const sameDay = jobs.find(s => s.dayIndex === shift.dayIndex);
  if (sameDay) return `Cet employé a déjà un quart ce jour-là, de ${hoursText(sameDay.startMinute)} à ${hoursText(sameDay.endMinute)}. Un seul quart par jour est permis.`;
  if (!employee.allowSixOrSevenDays && jobs.length >= 5)
    return "Cet employé travaille déjà cinq jours cette semaine. Pour ajouter une journée, activez l’exception de 6 ou 7 jours dans sa fiche pour cette semaine.";
  const minutes = jobs.reduce((sum, s) => sum + s.paidMinutes, 0);
  const total = minutes + shift.paidMinutes;
  if (employee.isMinor && total > 17 * 60)
    return `Ce quart porterait la semaine à ${hoursText(total)}, au-delà de la limite de 17 h pour un employé de 17 ans ou moins.`;
  if (employee.isMinor && shift.dayIndex < 5 && jobs.filter(s => s.dayIndex < 5).length >= 2)
    return "Cet employé de 17 ans ou moins a déjà deux jours travaillés du lundi au vendredi.";
  if (!(total <= employee.maxMinutes))
    return `Ce quart porterait la semaine à ${hoursText(total)}, au-delà du « Maximum / semaine » de ${hoursText(employee.maxMinutes)}. L’autorisation de dépasser les heures souhaitées ne change pas ce maximum. Ajustez-le dans la fiche de l’employé pour autoriser ce total.`;
  return null;
}

export function canAssign(employee, shift, shifts, assigned = []) {
  return assignmentConflict(employee, shift, shifts, assigned) === null;
}

export function generateAssignments(shifts, employees, existing = []) {
  const assigned = [...existing];
  const assignments = [];
  const open = shifts.filter(s => s.role !== "support" && !assigned.some(a => a.shiftId === s.id));
  const load = employee => assigned.filter(a => a.employeeId === employee.id)
    .reduce((sum, a) => {const shift=shifts.find(s=>s.id===a.shiftId);return sum+(shift?shiftWithApprovedLeave(shift,employee.leavePeriods,employee.id).paidMinutes:0);}, 0);
  const rankedEmployees = [...employees].sort((a, b) =>
    (a.seniority || '9999-12-31').localeCompare(b.seniority || '9999-12-31')
    || (a.assignmentRank ?? 9999) - (b.assignmentRank ?? 9999) || a.id - b.id);
  // Compare longest paid shifts first, then the next longest, within the ceiling.
  // The senior employee chooses before junior employees in the same pass.
  function prefer(candidate, best) {
    const a=candidate.jobs.map(s=>s.paidMinutes).sort((a,b)=>b-a);
    const b=best.jobs.map(s=>s.paidMinutes).sort((a,b)=>b-a);
    for(let i=0;i<Math.max(a.length,b.length);i++) {
      if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0);
    }
    return candidate.managerMinutes>best.managerMinutes;
  }
  function bestShifts(employee, limit, primaryOnly) {
    if (limit <= 0) return [];
    const currentJobs = assigned.filter(a => a.employeeId === employee.id)
      .map(a => shifts.find(s => s.id === a.shiftId)).filter(Boolean).map(s=>shiftWithApprovedLeave(s,employee.leavePeriods,employee.id));
    const maxDays = employee.allowSixOrSevenDays ? 7 : 5;
    const maxWeekdays = employee.isMinor ? 2 : 5;
    const existingWeekdays = currentJobs.filter(s => s.dayIndex < 5).length;
    const candidates=open.filter(s=>!primaryOnly || defaultServiceRole(s.role,employee.role)===employee.role).sort((a,b)=>a.dayIndex-b.dayIndex || a.startMinute-b.startMinute || a.id-b.id).map(s=>shiftWithApprovedLeave(s,employee.leavePeriods,employee.id));
    const choices = Array.from({ length: 7 }, (_, day) => candidates.filter(s =>
      s.dayIndex === day && s.paidMinutes <= limit && canAssign(employee, s, shifts, assigned)));
    const memo = new Map();
    function solve(day, remaining, daysUsed, weekdaysUsed) {
      if (day === 7 || remaining <= 0) return { minutes: 0, managerMinutes: 0, jobs: [] };
      const key = `${day}:${remaining}:${daysUsed}:${weekdaysUsed}`;
      if (memo.has(key)) return memo.get(key);
      let best = solve(day + 1, remaining, daysUsed, weekdaysUsed);
      if (daysUsed < maxDays && (day >= 5 || weekdaysUsed < maxWeekdays)) {
        for (const shift of choices[day]) {
          if (shift.paidMinutes > remaining) continue;
          const rest = solve(day + 1, remaining - shift.paidMinutes,
            daysUsed + 1, weekdaysUsed + (day < 5 ? 1 : 0));
          const minutes = shift.paidMinutes + rest.minutes;
          // At equal hours, keep the manager on her dedicated copied needs.
          const managerMinutes = rest.managerMinutes + (employee.role==='manager'&&shift.role==='manager'?shift.paidMinutes:0);
          const candidate={ minutes, managerMinutes, jobs: [shift, ...rest.jobs] };
          if (prefer(candidate,best)) best = candidate;
        }
      }
      memo.set(key, best);
      return best;
    }
    return solve(0, limit, currentJobs.length, existingWeekdays).jobs;
  }
  // Everyone gets a primary-classification pass before any cross-role filling.
  // Requested hours for everyone precede optional extra hours.
  for (const extra of [false, true]) for (const primaryOnly of [true,false]) for (const employee of rankedEmployees) {
    if (extra && !employee.allowExtraHours) continue;
    const ceiling = Math.min(extra ? employee.maxMinutes : employee.targetMinutes,
      employee.maxMinutes, employee.isMinor ? 17 * 60 : Infinity);
    for (const shift of bestShifts(employee, ceiling - load(employee), primaryOnly)) {
      const assignment = { shiftId: shift.id, employeeId: employee.id };
      assigned.push(assignment);
      assignments.push(assignment);
      open.splice(open.findIndex(s=>s.id===shift.id), 1);
    }
  }
  return { assignments, unfilled: shifts.filter(s => !assigned.some(a => a.shiftId === s.id)).map(s => s.id) };
}
