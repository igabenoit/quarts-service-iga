import {blankCell,cellMinutes} from './departments-core.js';

export const buffetKey=(personId,day,c)=>JSON.stringify([personId,day,c.start,c.end,cellMinutes(c)]);
export const usesBuffetRule=(person,c,key)=>person?.buffetPamPriority&&c.kind==='buffet'&&['pam','charcuterie'].includes(c.workDepartment||key);

// This is a display/accounting projection. Source shifts stay editable in their own sheets.
export function prepareSharedDraft(draft,related=[],people=[],key){
  const rows=draft.rows.map(r=>({...r,cells:r.cells.map(c=>({...c})),accountingCells:[]}));
  for(const item of related)if(!rows.some(r=>r.personId===item.personId))rows.push({personId:item.personId,cells:Array.from({length:7},blankCell),accountingCells:[]});
  const plan=new Map();
  for(const row of rows){
    const person=people.find(p=>p.id===row.personId);if(!person?.buffetPamPriority)continue;
    const entries=[...row.cells.map((cell,day)=>({cell,day,source:key})),...related.filter(i=>i.personId===row.personId).map(i=>({...i,source:i.sourceDepartment}))];
    let remaining=24*60;
    for(const item of entries.filter(i=>usesBuffetRule(person,i.cell,i.source)).sort((a,b)=>a.day-b.day||a.cell.start-b.cell.start)){
      const id=buffetKey(row.personId,item.day,item.cell);if(plan.has(id))continue;
      const minutes=cellMinutes(item.cell),pam=Math.min(remaining,minutes);remaining-=pam;
      plan.set(id,{key:id,pam,charcuterie:minutes-pam});
    }
    row.cells=row.cells.map((c,day)=>usesBuffetRule(person,c,key)?{...c,buffetAllocation:plan.get(buffetKey(row.personId,day,c)),departmentMinutes:plan.get(buffetKey(row.personId,day,c))[key]||0}:c);
  }
  const ownKeys=new Set(rows.flatMap(r=>r.cells.filter(c=>c.buffetAllocation).map(c=>c.buffetAllocation.key))),seen=new Set(),projected=[];
  for(const item of related){
    const person=people.find(p=>p.id===item.personId),allocation=usesBuffetRule(person,item.cell,item.sourceDepartment)?plan.get(buffetKey(item.personId,item.day,item.cell)):null;
    if(allocation&&(ownKeys.has(allocation.key)||seen.has(allocation.key)))continue;
    if(allocation)seen.add(allocation.key);
    const cell=allocation?{...item.cell,buffetAllocation:allocation,departmentMinutes:allocation[key]||0}:item.cell;
    projected.push({...item,cell});
    if(allocation)rows.find(r=>r.personId===item.personId).accountingCells.push(cell);
  }
  return {draft:{...draft,rows},related:projected};
}
