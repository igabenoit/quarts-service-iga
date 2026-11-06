import express from 'express';
import {randomUUID,createHash} from 'node:crypto';

export const SST_KINDS=['training','equipment','incident','meeting','inspection','action','document'];
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const text=(v,max=5000)=>typeof v==='string'?v.trim().slice(0,max):'';
const day=v=>{if(!v)return null;if(typeof v!=='string'||!/^20\d\d-\d\d-\d\d$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)fail('Vérifiez les dates.');return v};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export function normalizeSST(body){
 if(!SST_KINDS.includes(body?.kind)||!['draft','open','progress','done'].includes(body?.status)||typeof body.title!=='string'||!body.title.trim()||body.title.length>180)fail('Indiquez le type, le titre et le statut du dossier.');
 const fields={};for(const key of ['trainer','participants','location','model','serial','procedure','findings','reportedFacts','analysis','verification','outcome','reference']){if(body.fields?.[key]!==undefined){if(typeof body.fields[key]!=='string'||body.fields[key].length>6000)fail('Un renseignement est trop long.');fields[key]=body.fields[key].trim();}}
 const eventDate=day(body.eventDate),dueDate=day(body.dueDate);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(body.status==='done'&&['training','action','meeting','inspection','incident'].includes(body.kind)&&(!eventDate||eventDate>today))fail('Pour un dossier réalisé ou fermé, indiquez une date réelle qui n’est pas dans le futur.');
 if(body.employeeKey!==null&&body.employeeKey!==undefined&&!/^(service|store):[1-9]\d*$/.test(body.employeeKey))fail('Employé invalide.');
 if(body.departmentId!==null&&body.departmentId!==undefined&&(!Number.isSafeInteger(body.departmentId)||body.departmentId<1))fail('Département invalide.');
 if(body.relatedId!==null&&body.relatedId!==undefined&&!uuid(body.relatedId))fail('Dossier lié invalide.');
 if(body.kind==='training'&&body.status==='done'&&(!body.employeeKey||!eventDate||!fields.trainer||!fields.verification))fail('Pour une formation réalisée, précisez l’employé, la date, le formateur et comment la compréhension ou la compétence a été vérifiée.');
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
 const schemaDb=await pool.connect();
 try{await schemaDb.query('BEGIN');await schemaDb.query('SELECT pg_advisory_xact_lock(835107)');await schemaDb.query(`CREATE TABLE IF NOT EXISTS sst_records(
  id UUID PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN('training','equipment','incident','meeting','inspection','action','document')),
  title TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('draft','open','progress','done')),
  employee_key TEXT,employee_name TEXT NOT NULL DEFAULT '',department_id BIGINT REFERENCES schedule_leave_departments(id),
  related_id UUID REFERENCES sst_records(id),owner TEXT NOT NULL DEFAULT '',event_date DATE,due_date DATE,
  details TEXT NOT NULL DEFAULT '',fields JSONB NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),archived_at TIMESTAMPTZ);
 CREATE TABLE IF NOT EXISTS sst_documents(
  id UUID PRIMARY KEY,record_id UUID REFERENCES sst_records(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,data BYTEA NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),archived_at TIMESTAMPTZ);
 CREATE UNIQUE INDEX IF NOT EXISTS sst_document_unique ON sst_documents(sha256,COALESCE(record_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE archived_at IS NULL;
 CREATE TABLE IF NOT EXISTS sst_events(id BIGSERIAL PRIMARY KEY,record_id UUID REFERENCES sst_records(id),document_id UUID REFERENCES sst_documents(id),actor TEXT NOT NULL,action TEXT NOT NULL,before_value JSONB,after_value JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
 CREATE TABLE IF NOT EXISTS sst_imports(id UUID PRIMARY KEY,digest TEXT NOT NULL,label TEXT NOT NULL,record_count INTEGER NOT NULL,document_count INTEGER NOT NULL,report_id UUID REFERENCES sst_records(id),imported_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
 CREATE INDEX IF NOT EXISTS sst_records_kind ON sst_records(kind,archived_at);CREATE INDEX IF NOT EXISTS sst_events_record ON sst_events(record_id,id);`);await schemaDb.query('COMMIT')}catch(error){await schemaDb.query('ROLLBACK');throw error}finally{schemaDb.release()}
 const admin=async(req,res,next)=>{try{const who=await identity(req);if(!who)return res.status(401).json({error:'Connectez-vous avec le compte administrateur de Quarts Service.'});if(who.kind!=='admin')return res.status(403).json({error:'Cet espace SST est réservé à l’administration.'});req.sstActor=who.name||'Administration';res.set('Cache-Control','no-store');next()}catch{res.status(503).json({error:'Accès SST temporairement indisponible.'})}};
 const origin=(req,res,next)=>{if(req.get('origin')!==`${req.protocol}://${req.get('host')}`||req.get('x-sst-request')!=='1')return res.status(403).json({error:'Rechargez l’espace SST avant de réessayer.'});next()};
 const route=fn=>async(req,res)=>{try{await fn(req,res)}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Le dossier n’a pas pu être enregistré. Les données existantes sont conservées.'})}};
 const tx=async fn=>{const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(835107)');const result=await fn(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}};
 const record=async(db,id)=>{if(!uuid(id))fail('Dossier introuvable.',404);const r=(await db.query('SELECT * FROM sst_records WHERE id=$1',[id])).rows[0];if(!r)fail('Dossier introuvable.',404);return r};
 const audit=(db,req,action,before,after,recordId=null,documentId=null)=>db.query('INSERT INTO sst_events(record_id,document_id,actor,action,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[recordId,documentId,req.sstActor,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null]);
 app.get('/api/sst/access',admin,(_req,res)=>res.json({active:true}));
 app.get('/api/sst/state',admin,route(async(_req,res)=>{const [directory,records,docs,imports]=await Promise.all([sstDirectory(pool),pool.query('SELECT * FROM sst_records ORDER BY updated_at DESC'),pool.query('SELECT id,record_id,name,mime,size,sha256,version,created_at,archived_at FROM sst_documents ORDER BY created_at DESC'),pool.query('SELECT id,label,record_count,document_count,report_id,imported_at FROM sst_imports ORDER BY imported_at DESC')]);res.json({...directory,records:records.rows,documents:docs.rows,imports:imports.rows})}));
 app.post('/api/sst/records',admin,origin,route(async(req,res)=>{
  const v=normalizeSST(req.body),directory=await sstDirectory(pool),person=directory.employees.find(p=>p.key===v.employeeKey);
  if(v.employeeKey&&!person)fail('Cet employé ne figure plus dans le répertoire.');if(v.departmentId&&!directory.departments.some(d=>d.id===v.departmentId))fail('Département introuvable.');
  const id=await tx(async db=>{let before=null;if(req.body.id){before=await record(db,req.body.id);if(before.archived_at)fail('Restaurez ce dossier avant de le modifier.',409);if(req.body.version!==before.version)fail('Ce dossier a changé. Actualisez avant de réessayer.',409);if(v.kind!==before.kind)fail('Le type de dossier ne peut pas être changé.');}
   if(v.relatedId){const related=await record(db,v.relatedId);if(related.archived_at||related.id===req.body.id)fail('Choisissez un dossier lié actif différent.');}
   const id=before?.id||randomUUID(),values=[v.title,v.status,v.employeeKey,person?.name||'',v.departmentId,v.relatedId,v.owner,v.eventDate,v.dueDate,v.details,JSON.stringify(v.fields),id];
   if(before)await db.query('UPDATE sst_records SET title=$1,status=$2,employee_key=$3,employee_name=$4,department_id=$5,related_id=$6,owner=$7,event_date=$8,due_date=$9,details=$10,fields=$11,version=version+1,updated_at=clock_timestamp() WHERE id=$12',values);
   else await db.query('INSERT INTO sst_records(title,status,employee_key,employee_name,department_id,related_id,owner,event_date,due_date,details,fields,id,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[...values,v.kind]);
   const after=await record(db,id);await audit(db,req,before?'record.updated':'record.created',before,after,id);return id;});res.json({id});
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
 app.get('/api/sst/documents/:id',admin,route(async(req,res)=>{if(!uuid(req.params.id))fail('Document introuvable.',404);const r=(await pool.query('SELECT * FROM sst_documents WHERE id=$1',[req.params.id])).rows[0];if(!r)fail('Document introuvable.',404);res.set({'Content-Type':r.mime,'Content-Disposition':`${r.mime==='application/octet-stream'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(r.name)}`,'Content-Security-Policy':r.mime==='application/pdf'?"frame-ancestors 'self'":"sandbox; default-src 'none'",'X-Frame-Options':'SAMEORIGIN','X-Content-Type-Options':'nosniff'});res.send(Buffer.from(r.data))}));
 app.post('/api/sst/documents/:id/archive',admin,origin,route(async(req,res)=>{if(!uuid(req.params.id)||typeof req.body?.archived!=='boolean')fail('Document invalide.');await tx(async db=>{const before=(await db.query('SELECT id,record_id,name,sha256,version,archived_at FROM sst_documents WHERE id=$1',[req.params.id])).rows[0];if(!before)fail('Document introuvable.',404);if(before.version!==req.body.version)fail('Ce document a changé. Actualisez.',409);if(!req.body.archived){const other=(await db.query('SELECT id FROM sst_documents WHERE sha256=$1 AND record_id IS NOT DISTINCT FROM $2::uuid AND archived_at IS NULL AND id<>$3',[before.sha256,before.record_id,before.id])).rows[0];if(other)fail('Une copie active existe déjà pour ce dossier.',409)}await db.query('UPDATE sst_documents SET archived_at=CASE WHEN $1 THEN clock_timestamp() ELSE NULL END,version=version+1 WHERE id=$2',[req.body.archived,before.id]);await audit(db,req,req.body.archived?'document.archived':'document.restored',before,{...before,archived:req.body.archived},before.record_id,before.id)});res.json({ok:true})}));
 app.get('/api/sst/export',admin,route(async(_req,res)=>{const db=await pool.connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const [directory,records,documents,events,imports]=await Promise.all([sstDirectory(db),db.query('SELECT * FROM sst_records ORDER BY created_at'),db.query('SELECT id,record_id,name,mime,size,sha256,version,created_at,archived_at FROM sst_documents ORDER BY created_at'),db.query('SELECT * FROM sst_events ORDER BY id'),db.query('SELECT * FROM sst_imports ORDER BY imported_at')]);res.attachment('SST-sauvegarde-'+new Date().toISOString().slice(0,10)+'.json');res.type('application/json');res.write(JSON.stringify({format:'iga-sst-v1',exportedAt:new Date().toISOString(),...directory,records:records.rows,events:events.rows,imports:imports.rows}).slice(0,-1)+',"documents":[');for(const [i,d] of documents.rows.entries()){const raw=(await db.query('SELECT data FROM sst_documents WHERE id=$1',[d.id])).rows[0].data;res.write((i?',':'')+JSON.stringify({...d,dataBase64:Buffer.from(raw).toString('base64')}))}res.end(']}');await db.query('COMMIT')}catch(e){await db.query('ROLLBACK');if(res.headersSent)res.destroy();else throw e}finally{db.release()}}));
 return {directory:()=>sstDirectory(pool),admin,origin,route};
}
