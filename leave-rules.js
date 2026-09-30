export const LATE_MESSAGE = 'Votre demande ne respecte pas le délai minimum de 10 jours. Veuillez vous adresser à votre gérante.';
export const LEAVE_ZONE = 'America/Toronto';
export function localDate(now) {
  return new Intl.DateTimeFormat('fr-CA', {timeZone: LEAVE_ZONE, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(now));
}
export function addDays(date, count) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0,10);
}
export function isDate(date) {
  return typeof date === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) === date;
}
export function weekOf(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return addDays(date, -(day === 0 ? 6 : day - 1));
}
function minute(time) {
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Heure invalide.');
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
    const start = item.allDay ? 0 : minute(item.startTime), end = item.allDay ? 1440 : minute(item.endTime);
    if (end <= start) throw new Error('L’heure de fin doit suivre l’heure de début. Séparez les périodes qui passent minuit.');
    for (let date = item.startDate; date <= item.endDate; date = addDays(date,1)) {
      if (periods.length >= 366) throw new Error('Maximum de 366 journées par demande.');
      periods.push({date, startMinute:start, endMinute:end, allDay:item.allDay});
    }
  }
  periods.sort((a,b)=>a.date.localeCompare(b.date)||a.startMinute-b.startMinute);
  for (let i=1;i<periods.length;i++) if (periods[i].date===periods[i-1].date && periods[i].startMinute<periods[i-1].endMinute) throw new Error('Deux périodes se chevauchent.');
  const earliest = addDays(localDate(now),10);
  return {email, reason, periods, late:periods[0].date < earliest, earliest};
}
export function conflictsWithLeave(shift, periods = []) {
  if (!shift.weekStart) return false;
  const date = addDays(shift.weekStart, shift.dayIndex);
  return periods.some(p=>p.date===date && p.startMinute<shift.endMinute && p.endMinute>shift.startMinute);
}
export function leaveStatistics(rows) {
  const counts = {total:rows.length,pending:0,approved:0,refused:0,cancelled:0,late:0,fullDays:0,partialHours:0};
  const employees = new Map(); let delay = 0, decided = 0;
  for (const r of rows) {
    counts[r.status]++;
    const person = employees.get(r.employee_name)||{name:r.employee_name,total:0,approved:0,late:0};
    person.total++; if (r.status==='approved') person.approved++; if (r.status==='late') person.late++; employees.set(r.employee_name,person);
    if (r.status==='approved') for (const p of r.periods) { if (p.allDay) counts.fullDays++; else counts.partialHours+=(p.endMinute-p.startMinute)/60; }
    if (r.decided_at) {delay += Math.max(0,new Date(r.decided_at)-new Date(r.submitted_at));decided++;}
  }
  return {...counts,averageResponseHours:decided?delay/decided/3600000:null,employees:[...employees.values()]};
}
