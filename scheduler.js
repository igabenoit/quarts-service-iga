export function canAssign(employee, shift, shifts, assigned = []) {
  if (!employee.active || employee.area !== shift.area) return false;
  if (shift.role === "support" || employee.role !== shift.role) return false;
  const windows = employee.availability?.[shift.dayIndex] || [];
  if (!windows.some(([start, end]) => start <= shift.startMinute && end >= shift.endMinute)) return false;
  const jobs = assigned.filter(a => a.employeeId === employee.id).map(a => shifts.find(s => s.id === a.shiftId)).filter(Boolean);
  if (jobs.some(s => s.dayIndex === shift.dayIndex)) return false;
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
  // Give each employee their requested hours in priority order before offering extra hours.
  for (const extra of [false, true]) for (const employee of rankedEmployees) {
    if (extra && !employee.allowExtraHours) continue;
    while (true) {
      const remaining = extra ? employee.maxMinutes - load(employee)
        : Math.min(employee.targetMinutes, employee.maxMinutes) - load(employee);
      const eligible = open.filter(s => s.paidMinutes <= remaining && canAssign(employee, s, shifts, assigned));
      if (!eligible.length) break;
      eligible.sort((a, b) => {
        const options = s => employees.filter(e => canAssign(e, s, shifts, assigned)).length;
        return options(a) - options(b) || a.dayIndex - b.dayIndex || a.startMinute - b.startMinute || a.id - b.id;
      });
      const shift = eligible[0];
      const assignment = { shiftId: shift.id, employeeId: employee.id };
      assigned.push(assignment);
      assignments.push(assignment);
      open.splice(open.indexOf(shift), 1);
    }
  }
  return { assignments, unfilled: shifts.filter(s => !assigned.some(a => a.shiftId === s.id)).map(s => s.id) };
}
