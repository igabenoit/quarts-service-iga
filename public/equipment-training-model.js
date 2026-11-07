// Pure projections shared by the API, browser and isolated tests. No inferred qualification.
export const entryLabels={training_form:'Formulaire de formation',preparation:'Fiche de formation à préparer',assignment:'Affectation',procedure:'Procédure approuvée',evidence:'Pièce existante',testimony:'Témoignage',session:'Formation donnée',observation:'Observation pratique',confirmation:'Confirmation du déclarant',followup:'Suivi réalisé'};
export const iso=v=>v?String(v).slice(0,10):'';
export const localDay=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
export function effective(entries,cutoff='9999-12-31'){
 const visible=entries.filter(e=>localDay(e.created_at)<=cutoff),replaced=new Set(visible.map(e=>e.supersedes).filter(Boolean));
 return visible.filter(e=>!replaced.has(e.id));
}
export const covers=(e,employee,task)=>e.data.employeeKeys?.includes(employee)&&e.data.tasks?.includes(task);
export function observationResult(e){if(!e)return 'À vérifier';const points=e.data.points||[];return points.some(p=>p.result==='review')?'Écarts à revoir':points.some(p=>p.result==='unobserved')||!points.length?'Observation partielle':'Points observés satisfaisants';}
export const isPractical=e=>e.kind==='observation'||e.kind==='training_form'&&e.data.status==='completed'&&Boolean(e.data.procedureId&&e.data.observationDate)&&e.data.points.some(p=>p.result!=='unobserved');
export const practicalDate=e=>e.kind==='training_form'?e.data.observationDate:e.data.date;
export function registerRows(entries,cutoff='9999-12-31'){
 const live=effective(entries,cutoff),assignments=new Map();
 for(const e of live.filter(e=>e.kind==='assignment').sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)))for(const employee of e.data.employeeKeys)for(const task of e.data.tasks)assignments.set([e.equipment_id,employee,task].join('|'),{e,employee,task});
 return [...assignments.values()].filter(x=>x.e.data.active).map(({e,employee,task})=>{
  const related=live.filter(x=>x.equipment_id===e.equipment_id&&covers(x,employee,task));
  const observations=related.filter(x=>isPractical(x)&&practicalDate(x)<=cutoff).sort((a,b)=>practicalDate(b).localeCompare(practicalDate(a))||b.created_at.localeCompare(a.created_at));
  const last=observations[0]||null;
  const open=related.filter(x=>isPractical(x)&&x.data.points.some(p=>p.result==='review')&&!live.some(f=>f.kind==='followup'&&f.data.observationId===x.id));
  return {equipmentId:e.equipment_id,employeeKey:employee,task,replacement:e.data.replacement,assignment:e,documents:related.filter(x=>x.kind==='evidence'),testimonies:related.filter(x=>x.kind==='testimony'),sessions:related.filter(x=>x.kind==='session'||x.kind==='training_form'&&x.data.status==='completed'),last,result:observationResult(last),open};
 });
}
export function buildTrainingReport(entries,documents,{equipmentId='',employeeKey='',cutoff}){
 const matches=e=>(!equipmentId||e.equipment_id===equipmentId)&&(!employeeKey||e.data.employeeKeys?.includes(employeeKey));
 const matched=entries.filter(matches),procedureIds=new Set(matched.map(e=>e.data.procedureId).filter(Boolean));
 const scoped=entries.filter(e=>matches(e)||procedureIds.has(e.id)),before=scoped.filter(e=>localDay(e.created_at)<=cutoff),since=scoped.filter(e=>localDay(e.created_at)>cutoff);
 const docIds=new Set(scoped.filter(e=>e.kind==='evidence'||e.kind==='procedure').map(e=>e.data.documentId));
 const current=registerRows(entries).filter(r=>(!equipmentId||r.equipmentId===equipmentId)&&(!employeeKey||r.employeeKey===employeeKey));
 return {cutoff,generatedAt:new Date().toISOString(),scope:{equipmentId,employeeKey},beforeState:registerRows(entries,cutoff).filter(r=>(!equipmentId||r.equipmentId===equipmentId)&&(!employeeKey||r.employeeKey===employeeKey)),current,
  before,statementsSince:since.filter(e=>e.kind==='testimony'||e.kind==='confirmation'),interventionsSince:since.filter(e=>!['testimony','confirmation','evidence'].includes(e.kind)),documentsSince:since.filter(e=>e.kind==='evidence'),
  index:documents.filter(d=>docIds.has(d.id)).map(d=>({...d,datedBefore:scoped.some(e=>e.kind==='evidence'&&e.data.documentId===d.id&&e.data.date&&e.data.date<=cutoff),depositedBefore:localDay(d.created_at)<=cutoff})),entries:scoped,open:effective(entries).filter(e=>matches(e)&&isPractical(e)&&e.data.points.some(p=>p.result==='review')&&!effective(entries).some(f=>f.kind==='followup'&&f.data.observationId===e.id)).flatMap(e=>e.data.employeeKeys.flatMap(employeeKey=>e.data.tasks.map(task=>({employeeKey,task,equipmentId:e.equipment_id,entry:e}))))};
}
