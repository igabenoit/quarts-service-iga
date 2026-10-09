import {conflictsWithLeave} from "./leave-rules.js";
const hoursText = minutes => `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${String(minutes % 60).padStart(2, "0")}` : ""}`;

export function assignmentConflict(employee, shift, shifts, assigned = []) {
  if (conflictsWithLeave(shift,employee.leavePeriods)) return "Un congé approuvé chevauche ce quart.";
  if (!employee.active) return "Cet employé est inactif.";
  if (shift.role === "support") return "Ce quart est réservé à l’aide d’un autre département.";
  if (!(employee.roles || [employee.role]).includes(shift.role)) return "Ce poste ne fait pas partie des fonctions de cet employé.";
  const windows = employee.availability?.[shift.dayIndex] || [];
  if (!windows.some(([start, end]) => start <= shift.startMinute && end >= shift.endMinute))
    return `Les disponibilités de cet employé ne couvrent pas le quart complet de ${hoursText(shift.startMinute)} à ${hoursText(shift.endMinute)}.`;
  const jobs = assigned.filter(a => a.employeeId === employee.id).map(a => shifts.find(s => s.id === a.shiftId)).filter(Boolean);
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
    .reduce((sum, a) => sum + (shifts.find(s => s.id === a.shiftId)?.paidMinutes || 0), 0);
  const rankedEmployees = [...employees].sort((a, b) =>
    (a.assignmentRank ?? 9999) - (b.assignmentRank ?? 9999)
    || a.seniority.localeCompare(b.seniority) || a.id - b.id);
  // Find the combination of available shifts closest to the employee's target.
  // A greedy pick of three four-hour shifts can leave a three-hour gap even
  // when another combination would reach the requested hours exactly.
  function bestShifts(employee, limit) {
    if (limit <= 0) return [];
    const currentJobs = assigned.filter(a => a.employeeId === employee.id)
      .map(a => shifts.find(s => s.id === a.shiftId)).filter(Boolean);
    const maxDays = employee.allowSixOrSevenDays ? 7 : 5;
    const maxWeekdays = employee.isMinor ? 2 : 5;
    const existingWeekdays = currentJobs.filter(s => s.dayIndex < 5).length;
    const choices = Array.from({ length: 7 }, (_, day) => open.filter(s =>
      s.dayIndex === day && s.paidMinutes <= limit && canAssign(employee, s, shifts, assigned)));
    const memo = new Map();
    function solve(day, remaining, daysUsed, weekdaysUsed) {
      if (day === 7 || remaining <= 0) return { minutes: 0, jobs: [] };
      const key = `${day}:${remaining}:${daysUsed}:${weekdaysUsed}`;
      if (memo.has(key)) return memo.get(key);
      let best = solve(day + 1, remaining, daysUsed, weekdaysUsed);
      if (daysUsed < maxDays && (day >= 5 || weekdaysUsed < maxWeekdays)) {
        for (const shift of choices[day]) {
          if (shift.paidMinutes > remaining) continue;
          const rest = solve(day + 1, remaining - shift.paidMinutes,
            daysUsed + 1, weekdaysUsed + (day < 5 ? 1 : 0));
          const minutes = shift.paidMinutes + rest.minutes;
          if (minutes > best.minutes) best = { minutes, jobs: [shift, ...rest.jobs] };
        }
      }
      memo.set(key, best);
      return best;
    }
    return solve(0, limit, currentJobs.length, existingWeekdays).jobs;
  }
  // Complete the senior employee's requested hours before moving to the next.
  for (const extra of [false, true]) for (const employee of rankedEmployees) {
    if (extra && !employee.allowExtraHours) continue;
    const ceiling = Math.min(extra ? employee.maxMinutes : employee.targetMinutes,
      employee.maxMinutes, employee.isMinor ? 17 * 60 : Infinity);
    for (const shift of bestShifts(employee, ceiling - load(employee))) {
      const assignment = { shiftId: shift.id, employeeId: employee.id };
      assigned.push(assignment);
      assignments.push(assignment);
      open.splice(open.indexOf(shift), 1);
    }
  }
  return { assignments, unfilled: shifts.filter(s => !assigned.some(a => a.shiftId === s.id)).map(s => s.id) };
}
