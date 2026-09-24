export function canAssign(employee, shift, shifts, assigned = []) {
  if (!employee.active || employee.area !== shift.area) return false;
  if (shift.role === "support" || employee.role !== shift.role) return false;
  const windows = employee.availability?.[shift.dayIndex] || [];
  if (!windows.some(([start, end]) => start <= shift.startMinute && end >= shift.endMinute)) return false;
  const jobs = assigned.filter(a => a.employeeId === employee.id).map(a => shifts.find(s => s.id === a.shiftId)).filter(Boolean);
  if (jobs.some(s => s.dayIndex === shift.dayIndex)) return false;
  if (!employee.allowSixOrSevenDays && jobs.length >= 5) return false;
  const minutes = jobs.reduce((sum, s) => sum + s.paidMinutes, 0);
  if (employee.isMinor && (minutes + shift.paidMinutes > 17 * 60 ||
    (shift.dayIndex < 5 && jobs.filter(s => s.dayIndex < 5).length >= 2))) return false;
  return minutes + shift.paidMinutes <= employee.maxMinutes;
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
