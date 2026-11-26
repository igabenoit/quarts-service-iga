import {randomUUID,createHash} from 'node:crypto';
import {jsPDF} from 'jspdf';
import {installDocumentUploads} from './document-uploads.js';
import {sendPrivateBytes} from './private-response.js';
import {disciplineSchemaSQL} from './employee-discipline-schema.js';
import {disciplineSteps,nextDisciplineLevel} from './discipline-approval.js';

const base='/api/employee-files/discipline';
const types={verbal:'Avis verbal',written:'Avertissement écrit',suspension:'Suspension',other:'Autre mesure'};
const statuses={draft:'Brouillon',filed:'Au dossier',withdrawn:'Retirée'};
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const text=(value,max)=>{if(typeof value!=='string'||value.length>max)fail('Un champ est manquant ou trop long.');return value.trim();};

export async function installEmployeeDiscipline(app,{pool,auth,origin,wrap,transaction,directory,person,event,date}){
 if(pool&&!process.env.VERCEL)await pool.query(disciplineSchemaSQL);
 function management(a){if(!a.manager||!['gerant','direction'].includes(a.view))fail('Accès réservé à la direction et aux gérants autorisés.',403);}
 function permitted(a,e){return a.admin||a.manager&&Number(a.manager.personId)!==Number(e.personId)&&a.manager.departments.some(id=>e.departments.includes(Number(id)));}
 const departmentAllowed=(a,r)=>a.admin||r.department_id==null||a.manager.departments.map(Number).includes(Number(r.department_id));
 const approval=async(db,id)=>(await db.query('SELECT level,status,decision_actor,decision_note,decided_at,mail_status FROM employee_discipline_approvals WHERE revision_id=$1',[id])).rows[0]||null;
 async function employee(a,key){management(a);const e=person(a,await directory(),key);if(!permitted(a,e))fail('Dossier inaccessible.',404);return e;}
 async function current(a,id,db=pool){
  management(a);if(!uuid(id))fail('Mesure inaccessible.',404);
  const row=(await db.query('SELECT *,occurred_on::text AS occurred_on,follow_up_on::text AS follow_up_on FROM employee_file_discipline WHERE case_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0];
  if(!row||!departmentAllowed(a,row))fail('Mesure inaccessible.',404);const e=await employee(a,row.employee_key);return {row,e};
 }
 function fields(b,previous){
  const status=b.status;if(!['draft','filed','withdrawn'].includes(status)||!previous&&status==='withdrawn')fail('État invalide.');
  if(previous?.status==='withdrawn')fail('Cette mesure est retirée. Son historique reste conservé.',409);
  if(previous?.status==='filed'&&status==='draft')fail('Une mesure classée doit être corrigée ou retirée.');
  const reason=text(b.reason??'',2000);
  if((previous?.status==='filed'||status==='withdrawn')&&!reason)fail('Indiquez le motif de la correction ou du retrait.');
  if(status==='withdrawn')return {...previous,status,reason};
  const title=text(b.title,180),facts=text(b.facts??'',12000),expectations=text(b.expectations??'',6000);
  const occurred_on=date(b.occurredOn),follow_up_on=date(b.followUpOn),measure_type=b.measureType;
  if(!title||!occurred_on||!Object.hasOwn(types,measure_type))fail('Indiquez le titre, la date et le type de mesure.');
  if(status==='filed'&&!facts)fail('Décrivez les faits avant de classer la mesure.');
  return {title,facts,expectations,occurred_on,follow_up_on,measure_type,status,reason};
 }
 async function insert(db,a,caseId,key,data,previous){
  const id=previous?randomUUID():caseId,version=(previous?.version||0)+1;
  let level;
  if(data.status==='filed'){
   if((await db.query("SELECT 1 FROM employee_discipline_approvals WHERE employee_key=$1 AND status='pending'",[key])).rows.length)fail('Un avis attend déjà l’approbation de la direction.',409);
   level=await nextDisciplineLevel(db,key);if(level>11)fail('Dernier palier atteint.',409);
   data.measure_type=level<=3?'verbal':level<=5?'written':[6,7,9].includes(level)?'suspension':'other';
  }
  await db.query(`INSERT INTO employee_file_discipline(id,case_id,version,employee_key,occurred_on,measure_type,title,facts,expectations,follow_up_on,status,reason,actor,supersedes,department_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[id,caseId,version,key,data.occurred_on,data.measure_type,data.title,data.facts,data.expectations,data.follow_up_on,data.status,data.reason,JSON.stringify(a.audit),previous?.id||null,data.department_id??previous?.department_id??null]);
  if(level)await db.query('INSERT INTO employee_discipline_approvals(revision_id,employee_key,level) VALUES($1,$2,$3)',[id,key,level]);
  await event(db,a,'discipline.'+data.status,{caseId,version,revisionId:id});
  return {id:caseId,version};
 }
 app.get(base,auth,wrap(async(req,res)=>{
  management(req.ef);const dir=await directory();
  const employees=dir.employees.filter(e=>permitted(req.ef,e));
  if(req.query.employeeKey)await employee(req.ef,req.query.employeeKey);
  const keys=employees.filter(e=>!req.query.employeeKey||e.key===req.query.employeeKey).map(e=>e.key);
  const rows=(await pool.query(`SELECT DISTINCT ON(case_id) case_id AS id,id AS revision_id,department_id,employee_key,version,title,measure_type,occurred_on::text,follow_up_on::text,status,created_at
   FROM employee_file_discipline WHERE employee_key=ANY($1::text[]) ORDER BY case_id,version DESC`,[keys])).rows;
  const visible=rows.filter(r=>departmentAllowed(req.ef,r));
  const approvals=(await pool.query('SELECT revision_id,level,status,mail_status FROM employee_discipline_approvals WHERE revision_id=ANY($1::uuid[])',[visible.map(r=>r.revision_id)])).rows;
  res.json({measures:visible.map(r=>({...r,approval:approvals.find(a=>a.revision_id===r.revision_id)||null})).sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on)),employeeKeys:employees.map(e=>e.key),types,statuses,steps:disciplineSteps,canApprove:req.ef.admin&&req.ef.view==='direction'});
 }));
 app.post(base,auth,origin,wrap(async(req,res)=>{
  const e=await employee(req.ef,req.body?.employeeKey);if(!e.active||e.issue)fail('Vérifiez la fiche active et son rapprochement avant de créer une mesure.');
  const data=fields(req.body);
  const dep=Number(req.body.departmentId)||e.departments.find(id=>req.ef.admin||req.ef.manager.departments.map(Number).includes(Number(id)));
  if(!e.departments.includes(dep)||!departmentAllowed(req.ef,{department_id:dep}))fail('Département inaccessible.',403);
  data.department_id=dep;
  res.status(201).json(await transaction(db=>insert(db,req.ef,randomUUID(),e.key,data)));
 }));
 app.get(base+'/:id',auth,wrap(async(req,res)=>{
  const {row,e}=await current(req.ef,req.params.id);
  const history=(await pool.query(`SELECT d.*,d.occurred_on::text AS occurred_on,d.follow_up_on::text AS follow_up_on,
   CASE WHEN a.revision_id IS NOT NULL THEN jsonb_build_object('level',a.level,'status',a.status,'decision_actor',a.decision_actor,'decision_note',a.decision_note,'decided_at',a.decided_at) END AS approval
   FROM employee_file_discipline d LEFT JOIN employee_discipline_approvals a ON a.revision_id=d.id
   WHERE d.case_id=$1 ORDER BY d.version DESC`,[row.case_id])).rows;
  const attachments=(await pool.query('SELECT id,revision_id,name,size,sha256,actor,created_at FROM employee_file_discipline_attachments WHERE case_id=$1 ORDER BY created_at,id',[row.case_id])).rows;
  res.json({measure:row,approval:await approval(pool,row.id),employee:{key:e.key,name:e.name},history,attachments,types,statuses});
 }));
 app.post(base+'/:id/revisions',auth,origin,wrap(async(req,res)=>{
  res.status(201).json(await transaction(async db=>{
   const {row}=await current(req.ef,req.params.id,db);
   if(req.body?.version!==row.version)fail('Cette mesure a changé. Rechargez-la avant de poursuivre.',409);
   const review=await approval(db,row.id);
   if(review&&['pending','approved'].includes(review.status)){
    if(req.body.status!=='withdrawn'||!req.ef.admin||req.ef.view!=='direction')fail('Avis soumis : seule la direction peut le retirer. Consignez ensuite un nouvel avis au besoin.',409);
    if(review.status==='pending')await db.query("UPDATE employee_discipline_approvals SET status='cancelled',decision_actor=$2,decision_note=$3,decided_at=clock_timestamp() WHERE revision_id=$1",[row.id,JSON.stringify(req.ef.audit),text(req.body.reason??'',2000)]);
   }
   return insert(db,req.ef,row.case_id,row.employee_key,fields(req.body,row),row);
  }));
 }));
 app.post(base+'/:id/gradation',auth,origin,wrap(async(req,res)=>{
  if(!req.ef.admin||req.ef.view!=='direction')fail('La modification de la gradation est réservée à la direction.',403);
  const b=req.body||{},level=Number(b.level),note=text(b.note??'',2000);
  if(!Number.isInteger(level)||level<1||level>11||!note)fail('Choisissez un palier et indiquez le motif du changement.');
  const result=await transaction(async db=>{
   const {row}=await current(req.ef,req.params.id,db),review=await approval(db,row.id);
   if(row.version!==b.version)fail('Cet avis a changé. Rechargez-le avant de modifier sa gradation.',409);
   if(row.status!=='filed')fail('Seul un avis au dossier peut changer de gradation.',409);
   if(review?.status==='approved'&&review.level===level)fail('Ce palier est déjà approuvé.',409);
   const id=randomUUID(),version=row.version+1,type=level<=3?'verbal':level<=5?'written':[6,7,9].includes(level)?'suspension':'other';
   // Keep the original decision and content; the correction is a new immutable revision.
   await db.query(`INSERT INTO employee_file_discipline(id,case_id,version,employee_key,occurred_on,measure_type,title,facts,expectations,follow_up_on,status,reason,actor,supersedes,department_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'filed',$11,$12,$13,$14)`,[id,row.case_id,version,row.employee_key,row.occurred_on,type,row.title,row.facts,row.expectations,row.follow_up_on,'Modification de la gradation : '+note,JSON.stringify(req.ef.audit),row.id,row.department_id]);
   if(review?.status==='pending')await db.query("UPDATE employee_discipline_approvals SET status='cancelled',decision_actor=$2,decision_note=$3,decided_at=clock_timestamp() WHERE revision_id=$1",[row.id,JSON.stringify(req.ef.audit),'Remplacé par une gradation approuvée : '+note]);
   await db.query("INSERT INTO employee_discipline_approvals(revision_id,employee_key,level,status,decision_actor,decision_note,decided_at,mail_status) VALUES($1,$2,$3,'approved',$4,$5,clock_timestamp(),'not_required')",[id,row.employee_key,level,JSON.stringify(req.ef.audit),note]);
   await event(db,req.ef,'discipline.level-changed',{caseId:row.case_id,revisionId:id,previousRevisionId:row.id,fromLevel:review?.level??null,toLevel:level,note});
   return {id:row.case_id,version};
  });res.status(201).json(result);
 }));
 app.post(base+'/:id/baseline',auth,origin,wrap(async(req,res)=>{
  if(!req.ef.admin||req.ef.view!=='direction')fail('Classement réservé à la direction.',403);
  const b=req.body||{},level=Number(b.level),note=text(b.note??'',2000);
  if(!Number.isInteger(level)||level<1||level>11||!note)fail('Choisissez le palier historique et justifiez ce classement.');
  await transaction(async db=>{
   const {row}=await current(req.ef,req.params.id,db);
   if(row.version!==b.version||row.status!=='filed'||await approval(db,row.id))fail('Cet avis ne peut plus être classé comme historique.',409);
   if(await nextDisciplineLevel(db,row.employee_key)!==1||(await db.query("SELECT 1 FROM employee_discipline_approvals WHERE employee_key=$1 AND status='pending'",[row.employee_key])).rows.length)fail('Une gradation ou une approbation existe déjà pour cet employé.',409);
   await db.query("INSERT INTO employee_discipline_approvals(revision_id,employee_key,level,status,decision_actor,decision_note,decided_at,mail_status) VALUES($1,$2,$3,'approved',$4,$5,clock_timestamp(),'not_required')",[row.id,row.employee_key,level,JSON.stringify(req.ef.audit),note]);
   await event(db,req.ef,'discipline.baseline-approved',{caseId:row.case_id,revisionId:row.id,level,note});
  });res.json({ok:true});
 }));
 app.post(base+'/:id/decision',auth,origin,wrap(async(req,res)=>{
  if(!req.ef.admin||req.ef.view!=='direction')fail('L’approbation est réservée à la direction.',403);
  const b=req.body||{};if(!['approved','rejected'].includes(b.status))fail('Décision invalide.');const note=text(b.note??'',2000);
  if(b.status==='rejected'&&!note)fail('Précisez le motif du refus.');
  await transaction(async db=>{
   const {row}=await current(req.ef,req.params.id,db),review=await approval(db,row.id);
   if(b.version!==row.version||review?.status!=='pending')fail('Cet avis a changé ou a déjà été traité.',409);
   if(b.status==='approved'&&review.level!==await nextDisciplineLevel(db,row.employee_key))fail('La gradation a changé. Retirez cet avis et soumettez-le à nouveau.',409);
   await db.query('UPDATE employee_discipline_approvals SET status=$2,decision_actor=$3,decision_note=$4,decided_at=clock_timestamp() WHERE revision_id=$1',[row.id,b.status,JSON.stringify(req.ef.audit),note]);
   await event(db,req.ef,'discipline.'+b.status,{caseId:row.case_id,revisionId:row.id,level:review.level,note});
  });res.json({ok:true});
 }));
 app.get(base+'/:id/pdf',auth,wrap(async(req,res)=>{
  const {row,e}=await current(req.ef,req.params.id);const doc=new jsPDF();let y=20;
  const review=await approval(pool,row.id);
  function line(label,value){for(const part of doc.splitTextToSize(label+String(value||'—'),175)){if(y>275){doc.addPage();y=20;}doc.text(part,18,y);y+=6;}y+=4;}
  doc.setFontSize(16);line('', 'Mesure disciplinaire');doc.setFontSize(11);
  if(review){line('Gradation : ',disciplineSteps[review.level-1].label);line('Approbation : ',{pending:'En attente de la direction',approved:'Approuvée',rejected:'Refusée',cancelled:'Annulée'}[review.status]);if(review.decision_actor)line('Décision de : ',review.decision_actor.name);}
  for(const [label,value] of [['Employé : ',e.name],['État : ',statuses[row.status]],['Version : ',row.version],['Date : ',row.occurred_on],['Type : ',types[row.measure_type]],['Objet : ',row.title],['Faits : ',row.facts],['Attentes et suivi : ',row.expectations],['Suivi prévu : ',row.follow_up_on],['Motif de révision : ',row.reason],['Consigné par : ',row.actor.name],['Horodatage : ',new Date(row.created_at).toISOString()]])line(label,value);
  line('', 'Document de suivi. La présence au dossier ne constitue pas une signature ni une preuve de remise à l’employé.');
  res.type('application/pdf').set('Content-Disposition','attachment; filename="mesure-disciplinaire.pdf"');
  await sendPrivateBytes(res,Buffer.from(doc.output('arraybuffer')));
 }));
 async function attachmentTarget(db,req,metadata){
  const {row}=await current(req.ef,req.params.id,db);
  if(row.status==='withdrawn')fail('Cette mesure est retirée.',409);
  if(row.version!==metadata.version)fail('Cette mesure a changé. Rechargez-la avant de joindre le PDF.',409);
  return row;
 }
 if(pool)installDocumentUploads(app,{path:base+'/:id/attachments',auth,origin,wrap,transaction,pool,
  owner:req=>req.ef.audit.kind+':'+req.ef.audit.id,target:req=>'discipline:'+req.params.id,
  options:req=>({version:Number(req.query.version)}),authorize:attachmentTarget,
  save:async(db,req,row,bytes,name)=>{
   if(!name.toLowerCase().endsWith('.pdf')||bytes.subarray(0,5).toString()!=='%PDF-')fail('Joignez un fichier PDF valide.');
   const id=randomUUID(),sha=createHash('sha256').update(bytes).digest('hex');
   await db.query('INSERT INTO employee_file_discipline_attachments(id,case_id,revision_id,name,size,sha256,data,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,row.case_id,row.id,name,bytes.length,sha,bytes,JSON.stringify(req.ef.audit)]);
   await event(db,req.ef,'discipline.pdf.added',{caseId:row.case_id,version:row.version,attachmentId:id,sha256:sha});return id;
  }
 });
 app.get(base+'/:id/attachments/:fileId',auth,wrap(async(req,res)=>{
  const {row}=await current(req.ef,req.params.id);if(!uuid(req.params.fileId))fail('Pièce inaccessible.',404);
  const file=(await pool.query('SELECT name,data,sha256 FROM employee_file_discipline_attachments WHERE id=$1 AND case_id=$2',[req.params.fileId,row.case_id])).rows[0];
  if(!file)fail('Pièce inaccessible.',404);
  res.type('application/pdf').set({'X-Content-Type-Options':'nosniff','Content-Disposition':'attachment; filename="piece-disciplinaire.pdf"', 'X-Content-SHA256':file.sha256});
  await sendPrivateBytes(res,file.data);
 }));
}
