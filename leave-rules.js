import {addDays,weekOf,localDate,earliestLeaveDate,deadlineForDate,isBeforeDeadline} from './public/leave-calendar.js';
export {addDays,weekOf,localDate,earliestLeaveDate} from './public/leave-calendar.js';
export const LATE_MESSAGE = 'Votre demande est hors délai. Elle devait être reçue avant 9 h le jeudi précédant la semaine du congé. Veuillez vous adresser à votre gérante.';
export function isDate(date) {
  return typeof date === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) === date;
}

function minute(time,allowEnd=false) {
  if(allowEnd&&time==='24:00')return 1440;
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(time)) throw new Error('Choisissez une heure aux 15 minutes (ex. 8 h 00, 8 h 15, 8 h 30).');
  const [h,m] = time.split(':').map(Number); return h*60+m;
}
export function normalizeLeave(body, now) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 1000) throw new Error('Indiquez le motif (1 à 1 000 caractères).');
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Adresse courriel invalide.');
  if (!Array.isArray(body.periods) || !body.periods.length || body.periods.length > 31) throw new Error('Ajoutez de 1 à 31 périodes.');
  const periods = [];
  for (const item of body.periods) {
    if (!item || !isDate(item.startDate) || !isDate(item.endDate) || item.endDate < item.startDate || typeof item.allDay !== 'boolean') throw new Error('Vérifiez les dates de début et de fin.');
    const start = item.allDay ? 0 : minute(item.startTime), end = item.allDay ? 1440 : minute(item.endTime,true);
    if (end <= start) throw new Error('L’heure de fin doit suivre l’heure de début. Séparez les périodes qui passent minuit.');
    for (let date = item.startDate; date <= item.endDate; date = addDays(date,1)) {
      if (periods.length >= 366) throw new Error('Maximum de 366 journées par demande.');
      periods.push({date, startMinute:start, endMinute:end, allDay:item.allDay});
    }
  }
  periods.sort((a,b)=>a.date.localeCompare(b.date)||a.startMinute-b.startMinute);
  for (let i=1;i<periods.length;i++) if (periods[i].date===periods[i-1].date && periods[i].startMinute<periods[i-1].endMinute) throw new Error('Deux périodes se chevauchent.');
  const earliest = earliestLeaveDate(now);
  return {email, reason, periods, late:!isBeforeDeadline(periods[0].date,now), earliest, deadline:deadlineForDate(periods[0].date)};
}
// Preserve the submitted request while approving only time not already covered.
export function uncoveredLeavePeriods(periods, approved) {
  return periods.flatMap(period => {
    let parts = [{...period}];
    for (const covered of approved) {
      if (covered.date !== period.date) continue;
      parts = parts.flatMap(p => {
        if (covered.endMinute <= p.startMinute || covered.startMinute >= p.endMinute) return [p];
        const remaining = [];
        if (covered.startMinute > p.startMinute) remaining.push({...p, endMinute:covered.startMinute, allDay:false});
        if (covered.endMinute < p.endMinute) remaining.push({...p, startMinute:covered.endMinute, allDay:false});
        return remaining;
      });
    }
    return parts;
  });
}
export function conflictsWithLeave(shift, periods = []) {
  if (!shift.weekStart) return false;
  const date = addDays(shift.weekStart, shift.dayIndex);
  return periods.some(p=>p.date===date && p.startMinute<shift.endMinute && p.endMinute>shift.startMinute);
}
export function leaveStatistics(rows) {
  const counts = {total:rows.length,pending:0,approved:0,refused:0,cancelled:0,late:0,fullDays:0,partialHours:0};
  const employees = new Map(),departments = new Map(); let delay = 0, decided = 0;
  for (const r of rows) {
    counts[r.status]++;
    const departmentName=r.department_name||'Service';
    const departmentKey=String(r.department_id||departmentName);
    const dep=departments.get(departmentKey)||{name:departmentName,total:0,pending:0,approved:0,late:0};
    dep.total++;if(r.status==='pending')dep.pending++;if(r.status==='approved')dep.approved++;if(r.status==='late')dep.late++;departments.set(departmentKey,dep);
    const personKey=departmentKey+':'+((r.email||'').trim().toLowerCase()+':'+r.employee_name.trim().toLocaleLowerCase('fr-CA'));
    const person = employees.get(personKey)||{name:r.employee_name,department:departmentName,total:0,approved:0,late:0};
    person.total++; if (r.status==='approved') person.approved++; if (r.status==='late') person.late++; employees.set(personKey,person);
    if (r.status==='approved') for (const p of (r.effective_periods ?? r.periods)) { if (p.allDay) counts.fullDays++; else counts.partialHours+=(p.endMinute-p.startMinute)/60; }
    if (r.decided_at) {delay += Math.max(0,new Date(r.decided_at)-new Date(r.submitted_at));decided++;}
  }
  return {...counts,averageResponseHours:decided?delay/decided/3600000:null,employees:[...employees.values()],departments:[...departments.values()]};
}
