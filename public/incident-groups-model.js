// Only explicit, audited membership groups events; names/dates alone never merge records.
export function incidentGroups(records,matches=records){
 const matched=new Set(matches.map(r=>r.id)),map=new Map();
 for(const row of records.filter(r=>r.kind==='incident')){const key=row.event_group_id||row.id;if(!map.has(key))map.set(key,[]);map.get(key).push(row);}
 return [...map.entries()].filter(([,rows])=>rows.some(r=>matched.has(r.id))).map(([id,rows])=>({id,rows,primary:rows.find(r=>r.id===id)||rows[0]})).sort((a,b)=>{
  const day=g=>g.rows.map(r=>String(r.event_date||'').slice(0,10)).sort().at(-1);return day(b).localeCompare(day(a))||a.primary.title.localeCompare(b.primary.title,'fr-CA');
 });
}
export const eventTitle=group=>group.rows.length>1?group.primary.title.replace(/^(Déclaration|Enquête historique)\s*·/i,'Événement ·'):group.primary.title;
