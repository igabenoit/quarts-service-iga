import {DAY_NAMES,addDays,nameKey} from './departments-core.js';

export function groupDepartmentEntries(entries,departments=[]){
  const rank=key=>{const index=departments.findIndex(d=>d.key===key);return index<0?departments.length:index;};
  const groups=new Map();
  for(const entry of entries){
    const keys=[...new Set(entry.departmentKeys)].sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b));
    const key=keys.join('|')||entry.department;
    if(!groups.has(key))groups.set(key,{key,departmentKeys:keys,name:keys.length?keys.map(k=>departments.find(d=>d.key===k)?.name||entry.department).join(' / '):entry.department,entries:[]});
    groups.get(key).entries.push(entry);
  }
  return [...groups.values()].sort((a,b)=>rank(a.departmentKeys[0])-rank(b.departmentKeys[0])||a.name.localeCompare(b.name,'fr-CA')).map(group=>({...group,count:group.entries.filter(e=>e.minutes!==null).length,minutes:group.entries.reduce((n,e)=>n+(e.minutes||0),0)}));
}

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
  for(const day of days){
    day.entries.sort((a,b)=>(a.start??0)-(b.start??0)||a.personName.localeCompare(b.personName,'fr-CA'));
    day.groups=groupDepartmentEntries(day.entries,data.publications);
  }
  const shifts=days.flatMap(d=>d.entries).filter(e=>e.minutes!==null);
  return {selected,matches,days,count:shifts.length,peopleCount:new Set(shifts.map(s=>s.personId)).size,minutes:shifts.reduce((n,s)=>n+s.minutes,0)};
}
