const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function trainingDraftGroups({entries,employees,equipment}){
 const replaced=new Set(entries.map(e=>e.supersedes).filter(Boolean));
 const groups=new Map();
 for(const entry of entries){
  if(entry.kind!=='training_form'||entry.data.status!=='draft'||replaced.has(entry.id))continue;
  const key=entry.data.employeeKeys[0];
  if(!groups.has(key))groups.set(key,{key,name:employees.find(e=>e.key===key)?.name||key,drafts:[]});
  groups.get(key).drafts.push({entry,equipment:equipment.find(e=>e.id===entry.equipment_id)?.title||'Équipement indisponible',task:entry.data.tasks.join(', ')});
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'fr')).map(g=>({...g,drafts:g.drafts.sort((a,b)=>a.equipment.localeCompare(b.equipment,'fr')||a.task.localeCompare(b.task,'fr'))}));
}
export function trainingDraftInventory(state){
 const groups=trainingDraftGroups(state),count=groups.reduce((n,g)=>n+g.drafts.length,0);
 return `<section class="et-card et-drafts" aria-label="Brouillons en cours par employé"><h2>Brouillons en cours par employé <span>(${count})</span></h2><p>Tous les appareils et toutes les tâches, indépendamment des filtres ci-dessous.</p>${groups.length?groups.map(g=>`<section><h3>${esc(g.name)} · ${g.drafts.length} brouillon(s)</h3><ul>${g.drafts.map(d=>`<li><div><strong>${esc(d.equipment)}</strong><p>${esc(d.task)}${d.entry.data.trainer?' · Formateur : '+esc(d.entry.data.trainer):''}</p></div><button type="button" class="button secondary" data-open-form="${esc(d.entry.id)}" aria-label="${esc('Reprendre — '+g.name+' — '+d.equipment+' — '+d.task)}">Reprendre le brouillon</button></li>`).join('')}</ul></section>`).join(''):'<p>Aucun brouillon de formation en cours.</p>'}</section>`;
}
