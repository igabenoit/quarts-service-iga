import {normalizeEmail} from './employee-contacts.js';
import {normalizeSupervision} from './public/supervision-schema.js';
import {normalizeWelcome,welcomeContent,validateWelcomeCompletion} from './public/welcome-form-schema.js';
import express from 'express';
import {randomUUID,createHash} from 'node:crypto';
import {normalizeIncidentReport} from './public/incident-report-schema.js';

export const SST_KINDS=['training','equipment','incident','meeting','inspection','action','document'];
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const text=(v,max=5000)=>typeof v==='string'?v.trim().slice(0,max):'';
const day=v=>{if(!v)return null;if(typeof v!=='string'||!/^20\d\d-\d\d-\d\d$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)fail('Vérifiez les dates.');return v};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export function normalizeSST(body){
 if(!SST_KINDS.includes(body?.kind)||!['draft','open','progress','done'].includes(body?.status)||typeof body.title!=='string'||!body.title.trim()||body.title.length>180)fail('Indiquez le type, le titre et le statut du dossier.');
 const fields={};for(const key of ['meetingType','trainer','participants','location','model','serial','procedure','findings','reportedFacts','analysis','verification','outcome','reference']){if(body.fields?.[key]!==undefined){if(typeof body.fields[key]!=='string'||body.fields[key].length>6000)fail('Un renseignement est trop long.');fields[key]=body.fields[key].trim();}}
 if(body.fields?.accidentReport!==undefined){if(body.kind!=='incident')fail('Le rapport d’enquête doit rester dans un incident.');fields.accidentReport=normalizeIncidentReport(body.fields.accidentReport);if(body.status==='done'&&!body.employeeKey)fail('Associez le rapport à un employé avant de le consolider.');}
 if(body.fields?.welcomeForm!==undefined){if(body.kind!=='training'||!['draft','done'].includes(body.status))fail('Type ou état du formulaire d’accueil invalide.');fields.welcomeForm=normalizeWelcome(body.fields.welcomeForm);if(!body.employeeKey)fail('Choisissez le travailleur.');if(body.status==='done')validateWelcomeCompletion(fields.welcomeForm,body.employeeKey);if((body.eventDate||'')!==fields.welcomeForm.signatureDate)fail('La date du dossier doit correspondre à la date de signature.');}
 if(body.fields?.supervision!==undefined){
  if(body.kind!=='inspection')fail('La grille doit être enregistrée comme inspection.');
  fields.supervision=normalizeSupervision(body.fields.supervision);
 }
 if(fields.meetingType&&!['Comité SST','Réunion SST','Réunion SIMDUT'].includes(fields.meetingType))fail('Choisissez Comité SST, Réunion SST ou Réunion SIMDUT.');
 const eventDate=day(body.eventDate),dueDate=day(body.dueDate);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(body.status==='done'&&['training','action','meeting','inspection'].includes(body.kind)&&(!eventDate||eventDate>today))fail('Pour un dossier réalisé ou fermé, indiquez une date réelle qui n’est pas dans le futur.');
 if(body.kind==='incident'&&body.status==='done'&&eventDate>today)fail('La date d’un événement consolidé ne peut pas être dans le futur.');
 if(body.employeeKey!==null&&body.employeeKey!==undefined&&!/^(service|store):[1-9]\d*$/.test(body.employeeKey))fail('Employé invalide.');
 if(body.departmentId!==null&&body.departmentId!==undefined&&(!Number.isSafeInteger(body.departmentId)||body.departmentId<1))fail('Département invalide.');
 if(body.relatedId!==null&&body.relatedId!==undefined&&!uuid(body.relatedId))fail('Dossier lié invalide.');
 if(body.kind==='training'&&!fields.welcomeForm&&body.status==='done'&&(!body.employeeKey||!eventDate||!fields.trainer||!fields.verification))fail('Pour une formation réalisée, précisez l’employé, la date, le formateur et comment la compréhension ou la compétence a été vérifiée.');
 if(body.kind==='action'&&body.status==='done'&&(!eventDate||!fields.verification))fail('Précisez la date de réalisation et la vérification du correctif.');
 return {kind:body.kind,title:body.title.trim(),status:body.status,eventDate,dueDate,employeeKey:body.employeeKey||null,departmentId:body.departmentId||null,relatedId:body.relatedId||null,owner:text(body.owner,120),details:text(body.details,10000),fields};
}
export async function sstDirectory(pool){
 const [service,store,members,departments]=await Promise.all([
  pool.query('SELECT id,name,active,departed_at FROM schedule_employees ORDER BY name'),
  pool.query('SELECT id,service_employee_id,portal_person_id,name,active,job_title FROM schedule_store_people ORDER BY name'),
  pool.query('SELECT person_id,department_id FROM schedule_store_memberships'),
  pool.query('SELECT id,name,code,active FROM schedule_leave_departments ORDER BY name')]);
 const root=id=>{let p=store.rows.find(p=>Number(p.id)===Number(id));const seen=new Set();while(p?.portal_person_id&&!seen.has(Number(p.id))){seen.add(Number(p.id));p=store.rows.find(x=>Number(x.id)===Number(p.portal_person_id))}return p};
 const linkedRoots=new Set(),employees=[];
 for(const e of service.rows){const p=store.rows.find(p=>Number(p.service_employee_id)===Number(e.id)),r=p?root(p.id):null;if(r)linkedRoots.add(Number(r.id));const ids=store.rows.filter(p=>Number(root(p.id)?.id)===Number(r?.id)).map(p=>Number(p.id));const deps=[...new Set(members.rows.filter(m=>ids.includes(Number(m.person_id))).map(m=>Number(m.department_id)))];const serviceDept=departments.rows.find(d=>d.code==='service');if(serviceDept&&!deps.includes(Number(serviceDept.id)))deps.push(Number(serviceDept.id));employees.push({key:'service:'+e.id,name:e.name,active:e.active&&!e.departed_at,departments:deps,source:'Quarts Service',jobTitle:p?.job_title||''});}
 for(const p of store.rows)if(!p.service_employee_id&&!p.portal_person_id&&!linkedRoots.has(Number(p.id)))employees.push({key:'store:'+p.id,name:p.name,active:p.active,departments:members.rows.filter(m=>Number(m.person_id)===Number(p.id)).map(m=>Number(m.department_id)),source:'Horaires des départements',jobTitle:p.job_title||''});
 return {employees:employees.sort((a,b)=>a.name.localeCompare(b.name,'fr')),departments:departments.rows.map(d=>({...d,id:Number(d.id)}))};
}
export function sstFileMime(bytes,name){
 let mime='';if(bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))mime='application/pdf';else if(bytes.subarray(0,3).equals(Buffer.from([255,216,255])))mime='image/jpeg';else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')mime='image/webp';else if(bytes.subarray(0,2).toString()==='PK'&&/\.(docx|xlsx|pptx)$/i.test(name))mime='application/octet-stream';else if(bytes.subarray(0,4).equals(Buffer.from([208,207,17,224]))&&/\.(doc|xls)$/i.test(name))mime='application/octet-stream';if(!mime)fail('Formats acceptés : PDF, photos JPG/PNG/WebP et documents Word, Excel ou PowerPoint.');
 return mime;
}
export async function installSST(app,pool,{identity}){
 let employeeFiles=null;
 const sharedFiles=async()=>{if(!employeeFiles)return {records:[],documents:[]};try{return await employeeFiles.list();}catch{return {records:[],documents:[],warning:'Le coffre des dossiers employés est indisponible. Ses pièces SST ne sont pas affichées.'};}};
 const schemaDb=await pool.connect();
 try{await schemaDb.query('BEGIN');await schemaDb.query('SELECT pg_advisory_xact_lock(835107)');await schemaDb.query(`CREATE TABLE IF NOT EXISTS sst_records(
  id UUID PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN('training','equipment','incident','meeting','inspection','action','document')),
  title TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('draft','open','progress','done')),
  employee_key TEXT,employee_name TEXT NOT NULL DEFAULT '',department_id BIGINT REFERENCES schedule_leave_departments(id),
  related_id UUID REFERENCES sst_records(id),owner TEXT NOT NULL DEFAULT '',event_date DATE,due_date DATE,
  details TEXT NOT NULL DEFAULT '',fields JSONB NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),archived_at TIMESTAMPTZ);
 ALTER TABLE sst_records ADD COLUMN IF NOT EXISTS event_group_id UUID REFERENCES sst_records(id);
 CREATE INDEX IF NOT EXISTS sst_records_event_group ON sst_records(event_group_id);
 CREATE TABLE IF NOT EXISTS sst_documents(
  id UUID PRIMARY KEY,record_id UUID REFERENCES sst_records(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,data BYTEA NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),archived_at TIMESTAMPTZ);
 CREATE UNIQUE INDEX IF NOT EXISTS sst_document_unique ON sst_documents(sha256,COALESCE(record_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE archived_at IS NULL;
 CREATE TABLE IF NOT EXISTS sst_events(id BIGSERIAL PRIMARY KEY,record_id UUID REFERENCES sst_records(id),document_id UUID REFERENCES sst_documents(id),actor TEXT NOT NULL,action TEXT NOT NULL,before_value JSONB,after_value JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
 CREATE TABLE IF NOT EXISTS sst_mail_recipients(email TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS sst_imports(id UUID PRIMARY KEY,digest TEXT NOT NULL,label TEXT NOT NULL,record_count INTEGER NOT NULL,document_count INTEGER NOT NULL,report_id UUID REFERENCES sst_records(id),imported_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
 CREATE INDEX IF NOT EXISTS sst_records_kind ON sst_records(kind,archived_at);CREATE INDEX IF NOT EXISTS sst_events_record ON sst_events(record_id,id);`);await schemaDb.query('COMMIT')}catch(error){await schemaDb.query('ROLLBACK');throw error}finally{schemaDb.release()}
 const admin=async(req,res,next)=>{try{const who=await identity(req);if(!who)return res.status(401).json({error:'Connectez-vous avec le compte administrateur de Quarts Service.'});if(who.kind!=='admin')return res.status(403).json({error:'Cet espace SST est réservé à l’administration.'});req.sstActor=who.name||'Administration';req.sstIdentity={kind:who.kind,name:who.name||'Administration',...(who.id?{id:who.id}:{})};res.set('Cache-Control','no-store');next()}catch{res.status(503).json({error:'Accès SST temporairement indisponible.'})}};
 const origin=(req,res,next)=>{if(req.get('origin')!==`${req.protocol}://${req.get('host')}`||req.get('x-sst-request')!=='1')return res.status(403).json({error:'Rechargez l’espace SST avant de réessayer.'});next()};
 const route=fn=>async(req,res)=>{try{await fn(req,res)}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Le dossier n’a pas pu être enregistré. Les données existantes sont conservées.'})}};
 const tx=async fn=>{const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(835107)');const result=await fn(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}};
 const record=async(db,id)=>{if(!uuid(id))fail('Dossier introuvable.',404);const r=(await db.query('SELECT * FROM sst_records WHERE id=$1',[id])).rows[0];if(!r)fail('Dossier introuvable.',404);return r};
 const audit=(db,req,action,before,after,recordId=null,documentId=null)=>db.query('INSERT INTO sst_events(record_id,document_id,actor,action,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[recordId,documentId,req.sstActor,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null]);
 app.get('/api/sst/access',admin,(_req,res)=>res.json({active:true}));
 app.get('/api/sst/state',admin,route(async(_req,res)=>{const [directory,records,docs,imports]=await Promise.all([sstDirectory(pool),pool.query('SELECT * FROM sst_records ORDER BY updated_at DESC'),pool.query('SELECT id,record_id,name,mime,size,sha256,version,created_at,archived_at FROM sst_documents ORDER BY created_at DESC'),pool.query('SELECT id,label,record_count,document_count,report_id,imported_at FROM sst_imports ORDER BY imported_at DESC')]);const shared=await sharedFiles();res.json({...directory,records:[...records.rows,...shared.records],documents:[...docs.rows,...shared.documents],imports:imports.rows,sharedFilesWarning:shared.warning||null})}));
 const incidentBatch=async(db,items)=>{
  if(!Array.isArray(items)||!items.length||items.length>500||items.some(x=>!uuid(x?.id)||!Number.isSafeInteger(x.version)||x.version<1)||new Set(items.map(x=>x.id)).size!==items.length)fail('Sélection de dossiers invalide.');
  const rows=[];for(const item of items){const row=await record(db,item.id);if(row.kind!=='incident'||row.archived_at)fail('Sélectionnez uniquement des fiches actives d’incidents et enquêtes.');if(row.version!==item.version)fail('Une fiche a changé. Actualisez avant de recommencer.',409);rows.push(row);}return rows;
 };
 app.post('/api/sst/incidents/followup',admin,origin,route(async(req,res)=>{
  const {status,owner,records}=req.body||{};
  if(status===undefined&&owner===undefined)fail('Choisissez un état ou un responsable.');
  if(status!==undefined&&!['draft','progress','done'].includes(status))fail('État invalide.');
  if(owner!==undefined&&(typeof owner!=='string'||owner.trim().length>120))fail('Responsable invalide.');
  const count=await tx(async db=>{const rows=await incidentBatch(db,records);for(const before of rows){
   const nextStatus=status??before.status,nextOwner=owner===undefined?before.owner:owner.trim();
   if(nextStatus===before.status&&nextOwner===before.owner)continue;
   // Administrative classification never alters the factual report, dates or signatures.
   await db.query('UPDATE sst_records SET status=$2,owner=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1',[before.id,nextStatus,nextOwner]);
   await audit(db,req,'incident.followup.updated',before,await record(db,before.id),before.id);
  }return rows.length;});res.json({count});
 }));
 app.post('/api/sst/incidents/group',admin,origin,route(async(req,res)=>{
  const {records,anchorId,operation}=req.body||{};if(!['group','ungroup'].includes(operation))fail('Opération invalide.');
  const count=await tx(async db=>{const rows=await incidentBatch(db,records),ids=rows.map(r=>r.id);
   if(operation==='group'&&(rows.length<2||!ids.includes(anchorId)))fail('Sélectionnez au moins deux fiches et une fiche principale.');
   for(const groupId of new Set(rows.map(r=>r.event_group_id).filter(Boolean))){const members=(await db.query('SELECT id FROM sst_records WHERE event_group_id=$1',[groupId])).rows;if(members.some(r=>!ids.includes(r.id)))fail('Incluez toutes les fiches du regroupement existant avant de le modifier.',409);}
   for(const before of rows){const groupId=operation==='group'?anchorId:null;if(before.event_group_id===groupId)continue;
    await db.query('UPDATE sst_records SET event_group_id=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1',[before.id,groupId]);
    await audit(db,req,operation==='group'?'incident.grouped':'incident.ungrouped',before,await record(db,before.id),before.id);
   }return rows.length;});res.json({count});
 }));
 app.post('/api/sst/records',admin,origin,route(async(req,res)=>{
  const v=normalizeSST(req.body),directory=await sstDirectory(pool),person=directory.employees.find(p=>p.key===v.employeeKey);
  if(v.employeeKey&&!person)fail('Cet employé ne figure plus dans le répertoire.');if(v.departmentId&&!directory.departments.some(d=>d.id===v.departmentId))fail('Département introuvable.');
  const id=await tx(async db=>{let before=null;if(req.body.id){before=await record(db,req.body.id);if(before.archived_at)fail('Restaurez ce dossier avant de le modifier.',409);if(req.body.version!==before.version)fail('Ce dossier a changé. Actualisez avant de réessayer.',409);if(v.kind!==before.kind)fail('Le type de dossier ne peut pas être changé.');}
   const previousWelcome=before?.fields?.welcomeForm;
   if(previousWelcome){
    const next=v.fields.welcomeForm;if(!next)fail('Ouvrez le formulaire d’accueil pour conserver son contenu.');
    if(before.status==='done'&&(typeof req.body.correctionReason!=='string'||req.body.correctionReason.trim().length<5||req.body.correctionReason.length>1000))fail('Indiquez le motif de la correction (5 à 1000 caractères).');
    const changed=before.employee_key!==v.employeeKey||welcomeContent(previousWelcome,before.status==='done')!==welcomeContent(next,before.status==='done');
    if(changed&&previousWelcome.signature.length&&JSON.stringify(previousWelcome.signature)===JSON.stringify(next.signature))fail('Le contenu a changé : une nouvelle signature du travailleur est nécessaire.');
   }
   const previousReport=before?.fields?.accidentReport,newReport=v.fields.accidentReport;
   if(previousReport){
    if(!newReport)fail('Ouvrez le rapport d’enquête pour modifier ce dossier sans perdre son formulaire.');
    if(typeof req.body.correctionReason!=='string'||req.body.correctionReason.trim().length<5||req.body.correctionReason.length>1000)fail('Indiquez le motif de la correction du rapport (5 à 1000 caractères).');
    const content=report=>JSON.stringify({answers:report.answers,causes:report.causes,measures:report.measures});
    const previousDate=before.event_date instanceof Date?before.event_date.toISOString().slice(0,10):String(before.event_date||'').slice(0,10);
    const changed=content(previousReport)!==content(newReport)||before.employee_key!==v.employeeKey||previousDate!==(v.eventDate||'');
    if(changed)for(const [key,strokes] of Object.entries(previousReport.signatures||{}))if(strokes.length&&JSON.stringify(strokes)===JSON.stringify(newReport.signatures[key]))fail('Le rapport a changé. Effacez les anciennes signatures et faites signer la nouvelle version.');
   }
   if(v.relatedId){const related=await record(db,v.relatedId);if(related.archived_at||related.id===req.body.id)fail('Choisissez un dossier lié actif différent.');}
   const id=before?.id||randomUUID(),values=[v.title,v.status,v.employeeKey,person?.name||'',v.departmentId,v.relatedId,v.owner,v.eventDate,v.dueDate,v.details,JSON.stringify(v.fields),id];
   if(before)await db.query('UPDATE sst_records SET title=$1,status=$2,employee_key=$3,employee_name=$4,department_id=$5,related_id=$6,owner=$7,event_date=$8,due_date=$9,details=$10,fields=$11,version=version+1,updated_at=clock_timestamp() WHERE id=$12',values);
   else await db.query('INSERT INTO sst_records(title,status,employee_key,employee_name,department_id,related_id,owner,event_date,due_date,details,fields,id,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[...values,v.kind]);
   const after=await record(db,id);await audit(db,req,before?'record.updated':'record.created',before,previousReport||previousWelcome&&before.status==='done'?{...after,correction_reason:req.body.correctionReason.trim()}:after,id);return id;});res.json({id});
 }));
 app.post('/api/sst/records/:id/archive',admin,origin,route(async(req,res)=>{if(typeof req.body?.archived!=='boolean')fail('État invalide.');await tx(async db=>{const before=await record(db,req.params.id);if(before.version!==req.body.version)fail('Ce dossier a changé. Actualisez.',409);await db.query('UPDATE sst_records SET archived_at=CASE WHEN $1 THEN clock_timestamp() ELSE NULL END,version=version+1,updated_at=clock_timestamp() WHERE id=$2',[req.body.archived,before.id]);await audit(db,req,req.body.archived?'record.archived':'record.restored',before,await record(db,before.id),before.id)});res.json({ok:true})}));
 app.get('/api/sst/history',admin,route(async(req,res)=>{if(req.query.id&&!uuid(req.query.id))fail('Dossier invalide.');const events=await pool.query('SELECT * FROM sst_events WHERE ($1::uuid IS NULL OR record_id=$1) ORDER BY id DESC LIMIT 300',[req.query.id||null]);res.json({events:events.rows})}));
 app.post('/api/sst/documents',admin,origin,express.raw({type:'application/octet-stream',limit:'12mb'}),route(async(req,res)=>{
  const bytes=req.body;if(!Buffer.isBuffer(bytes)||bytes.length===0)fail('Choisissez un fichier non vide.');
  let name;try{name=decodeURIComponent(req.get('x-filename')||'document').replaceAll('\\','/').split('/').at(-1).replace(/[\r\n\x00-\x1f]/g,'').slice(0,180)}catch{fail('Nom de fichier invalide.')}
  if(!name)fail('Nom de fichier invalide.');
  const mime=sstFileMime(bytes,name);
  const id=await tx(async db=>{const recordId=req.query.recordId||null;if(recordId&&(await record(db,recordId)).archived_at)fail('Ce dossier est archivé.',409);const sha=createHash('sha256').update(bytes).digest('hex');const duplicate=(await db.query('SELECT id FROM sst_documents WHERE sha256=$1 AND record_id IS NOT DISTINCT FROM $2::uuid AND archived_at IS NULL',[sha,recordId])).rows[0];if(duplicate)return duplicate.id;
   const id=randomUUID();await db.query('INSERT INTO sst_documents(id,record_id,name,mime,size,sha256,data) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,recordId,name,mime,bytes.length,sha,bytes]);await audit(db,req,'document.added',null,{id,name,mime,size:bytes.length,sha256:sha},recordId,id);return id});res.status(201).json({id});
 }));
 app.get('/api/sst/documents/:id',admin,route(async(req,res)=>{if(!uuid(req.params.id))fail('Document introuvable.',404);const r=(await pool.query('SELECT * FROM sst_documents WHERE id=$1',[req.params.id])).rows[0]||(employeeFiles?await employeeFiles.read(req.params.id):null);if(!r)fail('Document introuvable.',404);res.set({'Content-Type':r.mime,'Content-Disposition':`${r.mime==='application/octet-stream'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(r.name)}`,'Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'self'",'X-Frame-Options':'SAMEORIGIN','X-Content-Type-Options':'nosniff'});res.send(Buffer.from(r.data))}));
 const configuredRecipients=()=>(process.env.SST_MAIL_RECIPIENTS||'').split(',').map(normalizeEmail).filter(Boolean);
 app.get('/api/sst/mail-recipients',admin,route(async(req,res)=>{
  const {rows}=await pool.query('SELECT email FROM sst_mail_recipients ORDER BY email');
  res.json({addresses:[...new Set([...configuredRecipients(),...rows.map(r=>r.email)])].sort()});
 }));
 app.post('/api/sst/mail-recipients',admin,origin,route(async(req,res)=>{
  const who=await identity(req);
  if(who?.kind!=='admin'||who.authentication!=='passkey'||!who.personId)fail('Connectez-vous avec votre clé de direction pour autoriser une adresse.',403);
  const email=normalizeEmail(req.body?.email);
  if(!email)fail('Indiquez une adresse courriel valide.');
  await tx(async db=>{
   const added=await db.query('INSERT INTO sst_mail_recipients(email) VALUES($1) ON CONFLICT DO NOTHING RETURNING email',[email]);
   if(added.rowCount)await audit(db,req,'mail.recipient.approved',null,{email,personId:who.personId});
  });
  res.json({email});
 }));
 app.post('/api/sst/documents/:id/email',admin,origin,route(sendDocument));
 app.post('/api/sst/first-aid/email',admin,origin,route(sendDocument));
 app.post('/api/sst/document-pdf/email',admin,origin,express.raw({type:'application/pdf',limit:'12mb'}),route(sendDocument));
 async function sendDocument(req,res){
  const firstAid=req.path.endsWith('/first-aid/email');
  const generated=!req.params.id&&!firstAid;
  let pdf;
  if(generated){
   if(!Buffer.isBuffer(req.body)||req.body.subarray(0,5).toString()!=='%PDF-')fail('PDF invalide.');
   const name=decodeURIComponent(req.get('X-SST-Filename')||'');
   if(!/^[^\x00-\x1f/\\]{1,150}\.pdf$/i.test(name))fail('Nom du PDF invalide.');
   pdf={name,data:req.body};
  }
  const id=firstAid?'first-aid':generated?createHash('sha256').update(pdf.data).digest('hex'):req.params.id;
  const to=normalizeEmail(generated?decodeURIComponent(req.get('X-SST-Recipient')||''):req.body?.to);
  const requestId=generated?req.get('X-SST-Request-Id'):req.body?.requestId;
  if((!firstAid&&!generated&&!uuid(id))||!uuid(requestId)||!to)fail('Vérifiez le document et l’adresse courriel.');
  if(!configuredRecipients().includes(to)&&!(await pool.query('SELECT 1 FROM sst_mail_recipients WHERE email=$1',[to])).rowCount)fail('Cette adresse ne figure pas dans la liste des destinataires SST autorisés.',403);
  if(!process.env.RESEND_API_KEY)fail('Le service courriel du magasin est indisponible.',503);
  if(firstAid){
   const response=await fetch('https://drive.usercontent.google.com/download?id=1bP7lzM0T6TwjbvQHjURwtflQfOZaEvGE&export=download',{signal:AbortSignal.timeout(15000)});
   if(!response.ok)fail('Le modèle de premiers soins est indisponible.',503);
   const data=Buffer.from(await response.arrayBuffer());
   if(data.length>12*1024*1024||data.subarray(0,5).toString()!=='%PDF-')fail('Le modèle de premiers soins est indisponible.',503);
   pdf={name:'Registre de premiers soins vierge.pdf',data};
  }
  const file=pdf||(await pool.query('SELECT name,data FROM sst_documents WHERE id=$1',[id])).rows[0]||(employeeFiles?await employeeFiles.read(id):null);
  if(!file)fail('Document introuvable.',404);
  const payload={
   from:process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM||'Quarts Service <onboarding@resend.dev>',
   to:[to], subject:'Document SST · IGA Extra Famille Benoit',
   text:'Bonjour, vous trouverez en pièce jointe le document transmis par le magasin IGA Extra Famille Benoit.',
   attachments:[{filename:file.name,content:Buffer.from(file.data).toString('base64')}]
  };
  await audit(pool,req,'document.email.requested',null,{id,to,requestId});
  try {
   const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20000),
    headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'sst-'+requestId+'-'+createHash('sha256').update(id+to).digest('hex')},
    body:JSON.stringify(payload)});
   if(!response.ok||!(await response.json()).id)throw Error('mail');
  } catch {fail('Envoi non confirmé par le service courriel. Vérifiez l’adresse puis réessayez.',502);}
  await audit(pool,req,'document.email.accepted',null,{id,to,requestId});
  res.json({ok:true});
 }
 app.post('/api/sst/documents/:id/move',admin,origin,route(async(req,res)=>{if(!uuid(req.params.id)||!uuid(req.body?.recordId))fail('Dossier invalide.');await tx(async db=>{const before=(await db.query('SELECT id,record_id,name,sha256,version,archived_at FROM sst_documents WHERE id=$1',[req.params.id])).rows[0];if(!before)fail('Document introuvable.',404);if(before.version!==req.body.version)fail('Ce document a changé. Actualisez.',409);const target=(await db.query('SELECT id FROM sst_records WHERE id=$1 AND archived_at IS NULL',[req.body.recordId])).rows[0];if(!target)fail('Dossier introuvable.',404);if(before.record_id===target.id)return;const duplicate=(await db.query('SELECT id FROM sst_documents WHERE record_id=$1 AND sha256=$2 AND archived_at IS NULL AND id<>$3',[target.id,before.sha256,before.id])).rows[0];if(duplicate)fail('Cette preuve existe déjà dans ce dossier.',409);const after=(await db.query('UPDATE sst_documents SET record_id=$2,version=version+1 WHERE id=$1 RETURNING id,record_id,name,sha256,version,archived_at',[before.id,target.id])).rows[0];await audit(db,req,'document.moved',before,after,before.record_id,before.id);await audit(db,req,'document.moved',before,after,target.id,before.id)});res.json({ok:true})}));
 app.post('/api/sst/documents/:id/archive',admin,origin,route(async(req,res)=>{if(!uuid(req.params.id)||typeof req.body?.archived!=='boolean')fail('Document invalide.');await tx(async db=>{const before=(await db.query('SELECT id,record_id,name,sha256,version,archived_at FROM sst_documents WHERE id=$1',[req.params.id])).rows[0];if(!before)fail('Document introuvable.',404);if(before.version!==req.body.version)fail('Ce document a changé. Actualisez.',409);if(!req.body.archived){const other=(await db.query('SELECT id FROM sst_documents WHERE sha256=$1 AND record_id IS NOT DISTINCT FROM $2::uuid AND archived_at IS NULL AND id<>$3',[before.sha256,before.record_id,before.id])).rows[0];if(other)fail('Une copie active existe déjà pour ce dossier.',409)}await db.query('UPDATE sst_documents SET archived_at=CASE WHEN $1 THEN clock_timestamp() ELSE NULL END,version=version+1 WHERE id=$2',[req.body.archived,before.id]);await audit(db,req,req.body.archived?'document.archived':'document.restored',before,{...before,archived:req.body.archived},before.record_id,before.id)});res.json({ok:true})}));
 // Separate administrative export: no original file contents, no changes to records.
 app.get('/api/sst/audit-export',admin,route(async(_req,res)=>{
  const shared=employeeFiles?await employeeFiles.list():{records:[],documents:[]};
  const result=await tx(async db=>{
   const records=(await db.query('SELECT id,title,kind,created_at,updated_at,version,archived_at FROM sst_records ORDER BY created_at')).rows;
   const documents=(await db.query('SELECT id,record_id,name,created_at,version,archived_at,sha256 FROM sst_documents ORDER BY created_at')).rows;
   const events=(await db.query('SELECT * FROM sst_events ORDER BY id')).rows;
   const equipmentTrainingEntries=(await db.query('SELECT id,created_at FROM sst_training_entries ORDER BY created_at,id')).rows;
   const metadata=(r)=>({id:r.id,title:r.title,name:r.name,record_id:r.record_id,created_at:r.created_at,updated_at:r.updated_at,version:r.version,archived_at:r.archived_at});
   return {records:[...records,...shared.records.map(metadata)],documents:[...documents,...shared.documents.map(metadata)],events,equipmentTrainingEntries};
  });
  res.attachment('SST-historique-des-saisies-'+new Date().toISOString().slice(0,10)+'.json');
  res.json({format:'iga-sst-audit-v1',exportedAt:new Date().toISOString(),...result});
 }));
 app.get('/api/sst/export',admin,route(async(_req,res)=>{const shared=employeeFiles?await employeeFiles.list():{records:[],documents:[]};const db=await pool.connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const [directory,records,documents,events,imports]=await Promise.all([sstDirectory(db),db.query('SELECT * FROM sst_records ORDER BY created_at'),db.query('SELECT id,record_id,name,mime,size,sha256,version,created_at,archived_at FROM sst_documents ORDER BY created_at'),db.query('SELECT * FROM sst_events ORDER BY id'),db.query('SELECT * FROM sst_imports ORDER BY imported_at')]);const gridTemplates=(await db.query('SELECT * FROM sst_grid_templates ORDER BY created_at')).rows,gridRuns=(await db.query('SELECT * FROM sst_grid_runs ORDER BY id')).rows;const equipmentTrainingEntries=(await db.query('SELECT * FROM sst_training_entries ORDER BY created_at,id')).rows;const preventionRevisions=(await db.query('SELECT * FROM sst_prevention_revisions ORDER BY created_at')).rows;records.rows.push(...shared.records);documents.rows.push(...shared.documents);res.attachment('SST-sauvegarde-'+new Date().toISOString().slice(0,10)+'.json');res.type('application/json');res.write(JSON.stringify({format:'iga-sst-v1',exportedAt:new Date().toISOString(),...directory,records:records.rows,events:events.rows,imports:imports.rows,gridTemplates,gridRuns,equipmentTrainingEntries,preventionRevisions}).slice(0,-1)+',"documents":[');for(const [i,d] of documents.rows.entries()){const raw=(await db.query('SELECT data FROM sst_documents WHERE id=$1',[d.id])).rows[0]?.data||(employeeFiles?await employeeFiles.read(d.id):null)?.data;if(!raw)throw Error('Original partagé indisponible');res.write((i?',':'')+JSON.stringify({...d,dataBase64:Buffer.from(raw).toString('base64')}))}res.end(']}');await db.query('COMMIT')}catch(e){await db.query('ROLLBACK');if(res.headersSent)res.destroy();else throw e}finally{db.release()}}));
 return {directory:()=>sstDirectory(pool),admin,origin,route,registerEmployeeFiles:adapter=>{employeeFiles=adapter;}};
}


