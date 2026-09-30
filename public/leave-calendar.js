export const LEAVE_ZONE = 'America/Toronto';
export function localDate(now) {
  return new Intl.DateTimeFormat('fr-CA', {timeZone:LEAVE_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
export function addDays(date,count) {
  const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);
}
export function weekOf(date) {
  const day=new Date(`${date}T12:00:00Z`).getUTCDay();return addDays(date,-(day===0?6:day-1));
}
export function deadlineForDate(date) {return addDays(weekOf(date),-4);}
export function isBeforeDeadline(date,now) {
  const today=localDate(now),deadline=deadlineForDate(date);
  if(today!==deadline)return today<deadline;
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:LEAVE_ZONE,hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
  return hour<9;
}
export function earliestLeaveDate(now) {
  const nextWeek=addDays(weekOf(localDate(now)),7);
  return isBeforeDeadline(nextWeek,now)?nextWeek:addDays(nextWeek,7);
}
