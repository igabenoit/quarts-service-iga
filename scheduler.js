export function canAssign(employee, shift, shifts, assigned = []) {
  if (!employee.active || employee.area !== shift.area) return false;
  if (shift.role === "support" || employee.role !== shift.role) return false;
  const windows = employee.availability?.[shift.dayIndex] || [];
  if (!windows.some(([start, end]) => start <= shift.startMinute && end >= shift.endMinute)) return false;
  const jobs = assigned.filter(a => a.employeeId === employee.id).map(a => shifts.find(s => s.id === a.shiftId)).filter(Boolean);
  if (jobs.some(s => s.dayIndex === shift.dayIndex)) return false;
  const minutes = jobs.reduce((sum, s) => sum + s.paidMinutes, 0);
  return minutes + shift.paidMinutes <= employee.maxMinutes;
}

export function generateAssignments(shifts, employees, existing = []) {
  const assigned = [...existing];
  const assignments = [];
  const unfilled = [];
  const eligible = (employee, shift) => canAssign(employee, shift, shifts, assigned);
  const ranked = [...shifts].filter(s => !assigned.some(a => a.shiftId === s.id))
    .sort((a, b) => {
      const count = s => employees.filter(e => eligible(e, s)).length;
      return count(a) - count(b) || a.dayIndex - b.dayIndex || a.startMinute - b.startMinute;
    });
  for (const shift of ranked) {
    const candidates = employees.filter(e => eligible(e, shift));
    candidates.sort((a, b) => {
      const load = e => assigned.filter(x => x.employeeId === e.id).reduce((sum, x) => sum + (shifts.find(s => s.id === x.shiftId)?.paidMinutes || 0), 0);
      const aGap = Math.max(0, a.targetMinutes - load(a));
      const bGap = Math.max(0, b.targetMinutes - load(b));
      return (bGap > 0) - (aGap > 0) || a.seniority.localeCompare(b.seniority) || load(a) - load(b) || a.id - b.id;
    });
    if (!candidates.length) { unfilled.push(shift.id); continue; }
    const assignment = { shiftId: shift.id, employeeId: candidates[0].id };
    assigned.push(assignment);
    assignments.push(assignment);
  }
  return { assignments, unfilled };
}
