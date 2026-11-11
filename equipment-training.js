import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {buildTrainingReport,entryLabels,localDay} from './public/equipment-training-model.js';
import {normalizeTrainingSignatures} from './public/training-form-schema.js';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
function text(v,label,max=6000,required=true){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))fail('Vérifiez : '+label+'.');return v.trim();}
function day(v,required=true){if(!v&&!required)return '';if(typeof v!=='string'||!/^20\d\d-\d\d-\d\d$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)fail('Indiquez une date valide.');return v;}
const past=v=>{day(v);if(v>localDay(new Date()))fail('La date réelle ne peut pas être future.');return v;};
function strings(v,label,max=100){if(!Array.isArray(v)||!v.length||v.length>max||v.some(x=>typeof x!=='string'||!x.trim()||x.length>180)||new Set(v).size!==v.length)fail('Vérifiez : '+label+'.');return v.map(x=>x.trim());}

export function validateTrainingEntry(body,context){
 const {equipment,employees,entries,documents}=context,kind=body.kind,b=body.data||{};
 if(!Object.hasOwn(entryLabels,kind))fail('Type de saisie inconnu.');
 if(!equipment||equipment.kind!=='equipment'||equipment.archived_at)fail('Choisissez une fiche équipement active.');
 const tasks=strings(b.tasks,'tâches',20),employeeKeys=['guide','procedure'].includes(kind)?[]:strings(b.employeeKeys,'employés');
 if(employeeKeys.some(k=>!employees.some(e=>e.key===k)))fail('Employé absent du répertoire partagé.');
 const d={tasks,employeeKeys},enteredBy=text(b.enteredBy,'personne qui saisit',120);
 d.enteredBy=enteredBy;
 const document=id=>{const doc=documents.find(x=>x.id===id&&!x.archived_at);if(!doc)fail('Choisissez un original accessible dans la bibliothèque.');return doc;};
 const procedure=id=>{const p=entries.find(x=>x.id===id&&['guide','procedure'].includes(x.kind)&&x.equipment_id===equipment.id);if(!p||tasks.some(t=>!p.data.tasks.includes(t)))fail('Choisissez la fiche de référence ou la procédure couvrant les tâches de cet équipement.');if(!equipment.fields?.model||p.data.model!==equipment.fields.model)fail('Le modèle de l’équipement diffère de la procédure. Vérifiez la fiche équipement.');return p;};
 if(kind==='training_form'){
  if(tasks.length!==1||employeeKeys.length!==1)fail('Un formulaire porte sur une personne et une tâche.');
  if(!['draft','completed'].includes(b.status))fail('État du formulaire invalide.');
  if(b.guideRevision){
   const prior=entries.find(e=>e.id===body.supersedes);
   const guide=entries.find(e=>e.id===b.guideRevision&&e.kind==='guide'&&e.equipment_id===equipment.id&&e.data.tasks.includes(tasks[0]));
   if(!guide||(!documents.some(d=>d.id===guide.data.documentId&&!d.archived_at)&&prior?.data.guideRevision!==b.guideRevision))fail('La fiche de référence a changé. Actualisez le registre.',409);
   d.guideRevision=b.guideRevision;
  }
  const completed=b.status==='completed',signatures=normalizeTrainingSignatures(b.signatures);
  // A draft may contain planned dates. Check the chronology of the evidence at finalization.
  const formDate=value=>completed&&value?past(value):day(value,false);
  for(const k of ['explained','demonstrated','practiced','questions']){if(typeof b[k]!=='boolean')fail('Cochez les activités réalisées.');d[k]=b[k];}
  Object.assign(d,{status:b.status,date:day(b.date,false),trainer:text(b.trainer||'','formateur',120,completed),content:text(b.content||'','contenu réellement enseigné',6000,completed),reference:text(b.reference||'','document ou méthode utilisé',1000,completed),version:text(b.version||'','version',100,false),procedureId:'',observationDate:formDate(b.observationDate),supervisor:text(b.supervisor||'','superviseur',120,false),points:[],note:text(b.note||'','notes',3000,false),immediate:text(b.immediate||'','mesure immédiate',3000,false),owner:text(b.owner||'','responsable',120,false),dueDate:day(b.dueDate,false),signatures,employeeDate:formDate(b.employeeDate),trainerDate:formDate(b.trainerDate)});
  if(completed&&d.date>localDay(new Date()))fail('Cette formation est prévue dans le futur. Enregistrez le brouillon et finalisez-le après la formation.');
  if(completed&&!d.date)fail('Indiquez la date réelle de formation.');
  for(const [key,date] of [['employee',d.employeeDate],['trainer',d.trainerDate]]){
   if(completed&&!signatures[key].length)fail('Les deux signatures sont requises pour finaliser.');
   if(completed&&(!date||date<d.date))fail('Date de signature requise, au plus tôt à la date de formation.');
  }
  if(b.procedureId){const p=procedure(b.procedureId),criteria=p.data.criteria.filter(c=>c.task===tasks[0]);
   if(!Array.isArray(b.points)||b.points.length!==criteria.length||new Set(b.points.map(x=>x.id)).size!==criteria.length)fail('Renseignez tous les critères de cette procédure.');
   d.procedureId=p.id;d.points=criteria.map(c=>{const x=b.points.find(x=>x.id===c.id);if(!x||!['ok','review','unobserved'].includes(x.result))fail('Résultat pratique invalide.');return {...c,result:x.result,note:text(x.note||'','note',1500,false)};});
   if(completed&&d.points.some(x=>x.result!=='unobserved')&&(!d.observationDate||!d.supervisor))fail('Date réelle et superviseur requis pour les points observés.');
   if(completed&&d.points.some(x=>x.result==='review')&&(!d.immediate||!d.owner||!d.dueDate))fail('Précisez la mesure immédiate, le responsable et la date de suivi.');
   if(completed&&d.points.some(x=>x.result!=='unobserved')&&[d.employeeDate,d.trainerDate].some(date=>date<d.observationDate))fail('Les signatures doivent suivre les observations consignées.');
  }else if(b.points?.length)fail('Les critères pratiques exigent une procédure approuvée pour ce modèle.');
 }
 if(kind==='preparation'){
  if(employeeKeys.length!==1||tasks.length!==1)fail('Une fiche porte sur une personne et une tâche.');
  Object.assign(d,{date:day(b.date,false),trainer:text(b.trainer||'','formateur prévu',120,false),content:text(b.content||'','préparation',6000,false),reference:text(b.reference||'','référence à obtenir ou à vérifier',1000,false)});
 }
 if(kind==='assignment'){
  if(typeof b.active!=='boolean'||typeof b.replacement!=='boolean')fail('Précisez l’affectation et le remplacement.');
  Object.assign(d,{active:b.active,replacement:b.replacement,date:past(b.date),reason:text(b.reason||'','motif',1000,false)});
 }
 if(kind==='procedure'||kind==='guide'){
  document(b.documentId);const model=text(b.model,'modèle exact',250);if(model!==equipment.fields?.model)fail('Le modèle doit correspondre à celui de la fiche équipement.');
  if(kind==='procedure'&&b.approved!==true)fail('Confirmez que cette version est approuvée pour ce modèle.');
  if(!Array.isArray(b.criteria)||!b.criteria.length||b.criteria.length>100)fail('Indiquez les critères tirés de la procédure.');
  const criteria=b.criteria.map((c,i)=>({id:String(i+1),task:text(c.task,'tâche du critère',180),text:text(c.text,'critère',1000),reference:text(c.reference,'page / section',180)}));
  if(criteria.some(c=>!tasks.includes(c.task))||tasks.some(t=>!criteria.some(c=>c.task===t)))fail('Chaque tâche doit posséder ses propres critères.');
  Object.assign(d,{documentId:b.documentId,model,title:text(b.title,'titre',180),version:text(b.version,'version',100),date:past(b.date),criteria,approved:kind==='procedure',...(kind==='procedure'?{approvedBy:text(b.approvedBy,'approbateur',120)}:{})});
 }
 if(kind==='evidence'){
  document(b.documentId);const date=day(b.date,false);if(date)past(date);
  Object.assign(d,{documentId:b.documentId,date,provenance:text(b.provenance,'provenance',1500),module:text(b.module,'module ou contenu couvert',1500),uncertainty:text(b.uncertainty||'','incertitudes',2000,false)});
 }
 if(kind==='testimony'){
  if(!['exact','approximate','unknown'].includes(b.dateKind)||!['received','taught','observed'].includes(b.basis)||!['written','oral'].includes(b.mode))fail('Précisez la nature et la date du témoignage.');
  Object.assign(d,{declarant:text(b.declarant,'déclarant',120),capacity:text(b.capacity,'qualité du déclarant',180),basis:b.basis,mode:b.mode,dateKind:b.dateKind,date:b.dateKind==='exact'?past(b.date):'',period:b.dateKind==='approximate'?text(b.period,'période approximative',250):'',statement:text(b.statement,'déclaration personnelle',10000),uncertainty:text(b.uncertainty||'','incertitudes',3000,false)});
 }
 if(kind==='session'){
  const p=procedure(b.procedureId);
  if(!Array.isArray(b.attendance)||b.attendance.length!==employeeKeys.length||new Set(b.attendance.map(x=>x.employeeKey)).size!==employeeKeys.length)fail('Confirmez chaque présence séparément.');
  const attendance=b.attendance.map(x=>{if(!employeeKeys.includes(x.employeeKey)||!['confirmed','unconfirmed','absent'].includes(x.status))fail('Présence invalide.');return {employeeKey:x.employeeKey,status:x.status,confirmedBy:x.status==='confirmed'?text(x.confirmedBy,'personne confirmant la présence',120):'',note:text(x.note||'','note de présence',1000,false)};});
  const acknowledgements=Array.isArray(b.acknowledgements)?b.acknowledgements:[];
  if(acknowledgements.length>employeeKeys.length||new Set(acknowledgements.map(x=>x.employeeKey)).size!==acknowledgements.length)fail('Confirmations invalides.');
  const confirmations=acknowledgements.map(x=>{if(!employeeKeys.includes(x.employeeKey)||x.confirmed!==true||!attendance.some(a=>a.employeeKey===x.employeeKey&&a.status==='confirmed'))fail('La confirmation exige une présence confirmée.');const date= past(x.date);if(date<b.date)fail('La confirmation ne peut pas précéder la formation.');return {employeeKey:x.employeeKey,confirmed:true,date,collectedBy:text(x.collectedBy,'personne recueillant la confirmation',120)};});
  Object.assign(d,{date:past(b.date),trainer:text(b.trainer,'formateur',120),content:text(b.content,'contenu enseigné',6000),procedureId:p.id,attendance,...(confirmations.length?{acknowledgements:confirmations}:{})});
 }
 if(kind==='observation'){
  if(tasks.length!==1||employeeKeys.length!==1)fail('Une observation porte sur une personne et une tâche.');
  const p=procedure(b.procedureId),criteria=p.data.criteria.filter(c=>c.task===tasks[0]);
  if(!Array.isArray(b.points)||b.points.length!==criteria.length||new Set(b.points.map(x=>x.id)).size!==criteria.length)fail('Renseignez tous les points, y compris ceux non observés.');
  const points=criteria.map(c=>{const x=b.points.find(x=>x.id===c.id);if(!x||!['ok','review','unobserved'].includes(x.result))fail('Indiquez le résultat de chaque point.');return {...c,result:x.result,note:text(x.note||'','note',1500,false)};});
  const gap=points.some(x=>x.result==='review');
  Object.assign(d,{date:past(b.date),supervisor:text(b.supervisor,'superviseur',120),procedureId:p.id,points,note:text(b.note||'','observation',3000,false),immediate:text(b.immediate||'','mesure immédiate',3000,gap),owner:text(b.owner||'','responsable du suivi',120,gap),dueDate:day(b.dueDate,gap)});
 }
 if(kind==='confirmation'){
  const target=entries.find(e=>e.id===b.testimonyId&&e.kind==='testimony');if(!target||target.equipment_id!==equipment.id||entries.some(e=>e.supersedes===target.id))fail('Le témoignage a changé; ouvrez sa version actuelle.');
  if(JSON.stringify(tasks)!==JSON.stringify(target.data.tasks)||JSON.stringify(employeeKeys)!==JSON.stringify(target.data.employeeKeys))fail('La confirmation doit couvrir le témoignage exact.');
  if(b.confirmed!==true||b.declarant!==target.data.declarant||!['read_directly','read_back'].includes(b.method))fail('Le déclarant doit confirmer son propre texte après lecture ou relecture orale.');
  Object.assign(d,{testimonyId:target.id,declarant:target.data.declarant,method:b.method,confirmed:true,statementHash:createHash('sha256').update(target.data.statement).digest('hex'),date:localDay(new Date())});
 }
 if(kind==='followup'){
  const target=entries.find(e=>e.id===b.observationId&&(e.kind==='observation'||e.kind==='training_form'&&e.data.status==='completed'));if(!target||target.equipment_id!==equipment.id||JSON.stringify(tasks)!==JSON.stringify(target.data.tasks)||JSON.stringify(employeeKeys)!==JSON.stringify(target.data.employeeKeys)||!target.data.points.some(x=>x.result==='review'))fail('Observation avec écart introuvable.');
  Object.assign(d,{observationId:target.id,date:past(b.date),action:text(b.action,'mesure réalisée',3000),verification:text(b.verification,'vérification du suivi',3000),owner:text(b.owner,'responsable',120)});
 }
 return {kind,data:d};
}

export async function installEquipmentTraining(app,pool,service){
 const {admin,origin,route,directory}=service;
 await pool.query(`CREATE TABLE IF NOT EXISTS sst_training_entries(
 id UUID PRIMARY KEY,equipment_id UUID NOT NULL REFERENCES sst_records(id),kind TEXT NOT NULL,
 data JSONB NOT NULL,actor JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 supersedes UUID UNIQUE REFERENCES sst_training_entries(id),correction_reason TEXT NOT NULL DEFAULT '');
 CREATE INDEX IF NOT EXISTS sst_training_equipment ON sst_training_entries(equipment_id,created_at);
 CREATE TABLE IF NOT EXISTS sst_removed_training_entries(
 entry_id UUID PRIMARY KEY REFERENCES sst_training_entries(id),removed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
 CREATE OR REPLACE VIEW sst_visible_training_entries AS SELECT e.* FROM sst_training_entries e
 WHERE NOT EXISTS (SELECT 1 FROM sst_removed_training_entries r WHERE r.entry_id=e.id);
 CREATE OR REPLACE FUNCTION sst_training_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Training history is append-only'; END $$;
 DROP TRIGGER IF EXISTS sst_training_immutable_trigger ON sst_training_entries;
 CREATE TRIGGER sst_training_immutable_trigger BEFORE UPDATE OR DELETE ON sst_training_entries FOR EACH ROW EXECUTE FUNCTION sst_training_immutable();`);
 const read=async(db=pool)=>JSON.parse(JSON.stringify((await db.query('SELECT * FROM sst_visible_training_entries ORDER BY created_at,id')).rows));
 const docs=async(db=pool)=>(await db.query('SELECT id,record_id,name,mime,size,sha256,version,created_at,archived_at FROM sst_visible_documents ORDER BY created_at')).rows;
 app.get('/api/sst/equipment-training',admin,route(async(req,res)=>{
  const [dir,records,entries,documents]=await Promise.all([directory(),pool.query("SELECT * FROM sst_records WHERE kind='equipment' ORDER BY title"),read(),docs()]);
  res.json({...dir,equipment:records.rows,entries,documents,actor:req.sstIdentity||{kind:'admin',name:req.sstActor}});
 }));
 app.post('/api/sst/equipment-training/entries/:id/delete',admin,origin,route(async(req,res)=>{
  const id=req.params.id;
  if(!uuid(id))fail('Formation introuvable.',404);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(835107)');
   const {rows:[entry]}=await db.query('SELECT id,kind,equipment_id FROM sst_training_entries WHERE id=$1',[id]);
   if(!entry||!['training_form','preparation','session','evidence'].includes(entry.kind))fail('Formation ou pièce introuvable.',404);
   const removed=await db.query('SELECT 1 FROM sst_removed_training_entries WHERE entry_id=$1',[id]);
   if(!removed.rowCount){
    if((await db.query('SELECT 1 FROM sst_visible_training_entries WHERE supersedes=$1',[id])).rowCount)fail('Une nouvelle version existe. Actualisez le registre.',409);
    // Retire the whole revision chain so an earlier draft cannot become current again.
    await db.query(`WITH RECURSIVE versions AS (
     SELECT id,supersedes FROM sst_training_entries WHERE id=$1
     UNION ALL SELECT e.id,e.supersedes FROM sst_training_entries e JOIN versions v ON e.id=v.supersedes
    ) INSERT INTO sst_removed_training_entries(entry_id)
     SELECT id FROM versions UNION SELECT f.id FROM sst_training_entries f
     JOIN versions v ON f.data->>'observationId'=v.id::text WHERE f.kind='followup'
     ON CONFLICT DO NOTHING`,[id]);
    await db.query('INSERT INTO sst_events(record_id,actor,action,after_value) VALUES($1,$2,$3,$4)',[entry.equipment_id,req.sstActor,'equipment_training.deleted',JSON.stringify({id,kind:entry.kind})]);
   }
   await db.query('COMMIT');res.json({ok:true});
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release();}
 }));
 app.post('/api/sst/equipment-training/entries',admin,origin,route(async(req,res)=>{
  const b=req.body;if(!b||!uuid(b.id)||!uuid(b.equipmentId))fail('Identifiant de saisie invalide.');
  const dir=await directory(),db=await pool.connect();
  try{
   await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(835107)');
   if((await db.query('SELECT 1 FROM sst_removed_training_entries WHERE entry_id=$1',[b.id])).rowCount)fail('Cette saisie a été supprimée.',409);
   const entries=await read(db),equipment=(await db.query('SELECT * FROM sst_records WHERE id=$1',[b.equipmentId])).rows[0];
   const v=validateTrainingEntry(b,{equipment,employees:dir.employees,entries,documents:await docs(db)});
   const duplicate=entries.find(e=>e.id===b.id);
   if(duplicate){if(duplicate.kind!==v.kind||duplicate.equipment_id!==b.equipmentId||!isDeepStrictEqual(duplicate.data,v.data)||duplicate.supersedes!==(b.supersedes||null)||duplicate.correction_reason!==(b.correctionReason||'').trim())fail('Identifiant déjà utilisé pour une autre saisie.',409);await db.query('COMMIT');return res.json({entry:duplicate,replayed:true});}
   let reason='';if(b.supersedes){const prior=entries.find(e=>e.id===b.supersedes);if(!prior||prior.kind!==v.kind||prior.equipment_id!==b.equipmentId)fail('Original introuvable.');if(entries.some(e=>e.supersedes===prior.id))fail('Cette entrée a déjà été corrigée. Rechargez le registre.',409);if(['guide','procedure','confirmation','assignment'].includes(v.kind))fail('Ajoutez une nouvelle version ou une nouvelle affectation.');if(JSON.stringify(prior.data.tasks)!==JSON.stringify(v.data.tasks)||JSON.stringify(prior.data.employeeKeys)!==JSON.stringify(v.data.employeeKeys))fail('Une correction conserve les personnes et tâches originales.');if(v.kind==='training_form'){const clean=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['signatures','status','enteredBy',...(prior.data.status==='draft'?['date','observationDate','dueDate','employeeDate','trainerDate']:[])].includes(k)));if(!isDeepStrictEqual(clean(prior.data),clean(v.data)))for(const key of ['employee','trainer'])if(v.data.signatures[key].length&&isDeepStrictEqual(v.data.signatures[key],prior.data.signatures[key]))fail('Le contenu a changé : recueillez de nouvelles signatures.');}reason=text(b.correctionReason,'motif de correction',2000);}
   const actor=req.sstIdentity||{kind:'admin',name:req.sstActor};
   const entry=(await db.query('INSERT INTO sst_training_entries(id,equipment_id,kind,data,actor,supersedes,correction_reason) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[b.id,b.equipmentId,v.kind,JSON.stringify(v.data),JSON.stringify(actor),b.supersedes||null,reason])).rows[0];
   await db.query('INSERT INTO sst_events(record_id,actor,action,before_value,after_value) VALUES($1,$2,$3,$4,$5)',[b.equipmentId,req.sstActor,b.supersedes?'equipment_training.corrected':'equipment_training.'+v.kind,b.supersedes?JSON.stringify(entries.find(e=>e.id===b.supersedes)):null,JSON.stringify(entry)]);
   await db.query('COMMIT');res.status(201).json({entry});
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release();}
 }));
 app.get('/api/sst/equipment-training/report',admin,route(async(req,res)=>{
  const cutoff=day(req.query.cutoff),equipmentId=req.query.equipmentId||'',employeeKey=req.query.employeeKey||'';
  if(!equipmentId&&!employeeKey)fail('Choisissez un équipement ou un employé.');
  if(equipmentId&&!uuid(equipmentId))fail('Équipement invalide.');
  const dir=await directory();if(employeeKey&&!dir.employees.some(e=>e.key===employeeKey))fail('Employé introuvable.');
  const db=await pool.connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const entries=await read(db),documents=await docs(db),equipment=(await db.query("SELECT id,title,fields,department_id FROM sst_records WHERE kind='equipment'")).rows;if(equipmentId&&!equipment.some(e=>e.id===equipmentId))fail('Équipement introuvable.');const report=buildTrainingReport(entries,documents,{cutoff,equipmentId,employeeKey});await db.query('COMMIT');res.json({...report,...dir,equipment});}catch(e){await db.query('ROLLBACK');throw e}finally{db.release();}
 }));
}
