import {DAY_NAMES,addDays,nameKey} from './departments-core.js';

export function storeSelection(data,{department='',search='',personId=null}={}){
  const selected=personId?data.employees.find(p=>p.id===Number(personId)):null;
  const matches=data.employees.filter(p=>(!department||p.departmentKeys.includes(department)||p.days.some(d=>d.entries.some(c=>c.departmentKeys.includes(department))))&&nameKey(p.name).includes(nameKey(search)));
  const people=selected?[selected]:matches;
  const days=DAY_NAMES.map((name,i)=>({name,date:addDays(data.weekStart,i),entries:[]}));
  for(const person of people)person.days.forEach((day,index)=>{
    for(const entry of day.entries){
      if(!selected&&(entry.minutes===null||department&&!entry.departmentKeys.includes(department)))continue;
      days[index].entries.push({...entry,personId:person.id,personName:person.name});
    }
  });
  for(const day of days)day.entries.sort((a,b)=>(a.start??0)-(b.start??0)||a.personName.localeCompare(b.personName,'fr-CA'));
  const shifts=days.flatMap(d=>d.entries).filter(e=>e.minutes!==null);
  return {selected,matches,days,count:shifts.length,peopleCount:new Set(shifts.map(s=>s.personId)).size,minutes:shifts.reduce((n,s)=>n+s.minutes,0)};
}
