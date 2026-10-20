import {absenceLabel} from './shift-absence.js';
import {addDays,monday,today,isDate,DAY_NAMES,departmentLabel,isTimedCell,cellDetail,cellMinutes,cellLabel,timeLabel} from './departments-core.js';
import {serviceShiftTiming} from './service-rules.js';
export const PORTAL_PATH='/horaires-departements';
export function fullDate(date){return new Intl.DateTimeFormat('fr-CA',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));}
export const weekRange=week=>`${fullDate(week)} au ${fullDate(addDays(week,6))}`;
export function weekInfo(week,date=today()){
  const current=monday(date),next=addDays(current,7);
  const kind=week===current?'current':week===next?'next':week<current?'past':'future';
  const title={current:'Cette semaine',next:'Semaine prochaine',past:'Ancienne semaine',future:'Semaine à venir'}[kind];
  const note={current:'C’est l’horaire de la semaine en cours.',next:'Attention : cet horaire commence lundi prochain.',past:'Attention : cet horaire est passé. Ce n’est pas la semaine en cours.',future:'Attention : cet horaire concerne une semaine ultérieure.'}[kind];
  return {kind,title,note,range:weekRange(week)};
}
export function availableWeeks(list){return [...new Set([...(list.schedules||[]),...(list.service||[])].map(s=>s.weekStart).filter(isDate))].sort().reverse();}
export function selectedWeek(previous,list,previousToday,reset=false){
  const date=list.today||today(),current=monday(date);
  if(reset||!previous||!previousToday||monday(previousToday)!==current)return current;
  return [current,addDays(current,7),...availableWeeks(list)].includes(previous)?previous:current;
}
// Incoming transfers are another view of their source shift, not a second shift.
export function personalDays(week,results){
  const days=DAY_NAMES.map((name,index)=>({name,date:addDays(week,index),entries:[]}));
  const seenBuffet=new Set();
  const origins=new Set(results.filter(r=>r.kind==='department').map(r=>r.data.department.key));
  const roles={manager:'Gérante',supervisor:'Supervision',orders:'Commandes téléphoniques',cashier:'Caisse',packer:'Emballage',support:'Aide autre département'};
  for(const result of results){
    const data=result.data;
    if(data.weekStart!==week)throw Error('La semaine reçue ne correspond pas à la semaine choisie. Actualise le portail.');
    for(const person of result.kind==='service'?data.employees:data.schedule.rows)for(const day of days)if(person.birthdayMonthDay===day.date.slice(5))day.birthday=true;
    if(result.kind==='service'){
      for(const person of data.employees)for(const s of person.shifts)days[s.dayIndex].entries.push({department:'Service',departmentKeys:['service'],hours:`${timeLabel(s.startMinute)} – ${timeLabel(s.endMinute)}`,detail:[roles[s.role]||s.role,absenceLabel(s.absence)].filter(Boolean).join(' · '),minutes:serviceShiftTiming(s.startMinute,s.endMinute,s.absence).paidMinutes,start:s.startMinute,end:s.endMinute,birthday:person.birthdayMonthDay});
    }else{
      for(const row of data.schedule.rows)row.cells.forEach((c,index)=>{
        if(c.sourceDepartment&&origins.has(c.sourceDepartment)||c.kind==='blank')return;
        if(c.buffetAllocation){if(seenBuffet.has(c.buffetAllocation.key))return;seenBuffet.add(c.buffetAllocation.key);}
        const timed=isTimedCell(c);
        const department=c.buffetAllocation?[c.buffetAllocation.pam&&'Prêt-à-manger',c.buffetAllocation.charcuterie&&'Charcuterie'].filter(Boolean).join(' / '):departmentLabel(c.workDepartment||data.department.key);
        const departmentKeys=c.buffetAllocation?[c.buffetAllocation.pam&&'pam',c.buffetAllocation.charcuterie&&'charcuterie'].filter(Boolean):[c.workDepartment||data.department.key];
        days[index].entries.push({department,departmentKeys,hours:timed?`${timeLabel(c.start)} – ${timeLabel(c.end)}`:c.kind==='off'?'Congé':cellLabel(c),detail:timed?(c.post==='cut_fruit'?'Fruits coupés':cellDetail({...c,workDepartment:undefined})):'',minutes:timed?cellMinutes(c):null,birthday:row.birthdayMonthDay,start:c.start,end:c.end});
      });
    }
  }
  for(const day of days){
    if(day.entries.some(c=>c.minutes!==null))day.entries=day.entries.filter(c=>c.minutes!==null);
    day.entries.sort((a,b)=>(a.start??0)-(b.start??0));
  }
  return days;
}
