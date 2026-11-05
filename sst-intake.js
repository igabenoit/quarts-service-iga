import express from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {normalizeSST,sstFileMime} from './sst.js';

const validId=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const invalid=()=>{throw Error('SST_INTAKE_INVALID')};
export function validateSSTIntake(payload){
 if(payload?.format!=='iga-sst-intake-v1'||!validId(payload.id)||typeof payload.label!=='string'||!payload.label.trim()||payload.label.length>120||!Array.isArray(payload.records)||!Array.isArray(payload.documents)||!payload.records.length||payload.records.length>100||payload.documents.length>100)invalid();
 const recordKeys=new Set(),fileKeys=new Set(),used=new Set();let total=0;
 const records=payload.records.map(r=>{
  if(typeof r.key!=='string'||!r.key||r.key.length>100||recordKeys.has(r.key)||!Array.isArray(r.files)||r.files.some(k=>typeof k!=='string'||used.has(k)))invalid();
  recordKeys.add(r.key);for(const k of r.files){if(used.has(k))invalid();used.add(k)}
  if(r.departmentKey!==undefined&&r.departmentKey!==null&&(typeof r.departmentKey!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/.test(r.departmentKey)))invalid();
  // An import cannot silently bind an employee or close an individual training.
  if(r.employeeKey||r.departmentId||r.relatedId||r.kind==='training'||r.kind==='equipment')invalid();
  return {...r,normalized:normalizeSST({...r,employeeKey:null,departmentId:null,relatedId:null})};
 });
 for(const r of records){if(r.relatedKey&&(!recordKeys.has(r.relatedKey)||r.relatedKey===r.key))invalid();const seen=new Set([r.key]);let parent=r.relatedKey;while(parent){if(seen.has(parent))invalid();seen.add(parent);parent=records.find(x=>x.key===parent)?.relatedKey}}
 const documents=payload.documents.map(d=>{
  if(typeof d.key!=='string'||fileKeys.has(d.key)||!used.has(d.key)||typeof d.name!=='string'||!d.name||d.name.length>180||/[\x00-\x1f/\\]/.test(d.name)||typeof d.dataBase64!=='string'||!/^[a-f0-9]{64}$/.test(d.sha256))invalid();
  fileKeys.add(d.key);const data=Buffer.from(d.dataBase64,'base64');total+=data.length;
  if(!data.length||data.length>12*1024*1024||total>24*1024*1024||data.toString('base64')!==d.dataBase64||createHash('sha256').update(data).digest('hex')!==d.sha256)invalid();
  return {...d,data,mime:sstFileMime(data,d.name)};
 });
 if(fileKeys.size!==used.size)invalid();
 return {records,documents,digest:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
}
export async function importSSTIntake(pool,payload){
 const {records,documents,digest}=validateSSTIntake(payload),db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(835107)');
  const old=(await db.query('SELECT * FROM sst_imports WHERE id=$1',[payload.id])).rows[0];
  if(old){if(old.digest!==digest)invalid();await db.query('COMMIT');return {...old,alreadyImported:true}}
  const departments=(await db.query('SELECT id,code,schedule_key FROM schedule_leave_departments')).rows;
  const ids=new Map(records.map(r=>[r.key,randomUUID()])),reused=new Set();
  // Reuse an already prepared visit without changing any of its user-entered fields.
  for(const r of records)if(r.key==='visit'&&r.kind==='inspection'&&r.eventDate){const existing=(await db.query("SELECT id FROM sst_records WHERE kind='inspection' AND event_date=$1 AND title ILIKE '%CNESST%' AND archived_at IS NULL ORDER BY created_at LIMIT 1",[r.eventDate])).rows[0];if(existing){ids.set(r.key,existing.id);reused.add(r.key)}}
  let created=0;
  // Insert parents first, then add links so arbitrary payload ordering is safe.
  for(const r of records){if(reused.has(r.key))continue;const v=r.normalized,id=ids.get(r.key);const dept=r.departmentKey?departments.find(d=>d.schedule_key===r.departmentKey||d.code===r.departmentKey):null;if(r.departmentKey&&!dept)invalid();
   await db.query('INSERT INTO sst_records(id,kind,title,status,department_id,owner,event_date,due_date,details,fields) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,v.kind,v.title,v.status,dept?.id||null,v.owner,v.eventDate,v.dueDate,v.details,JSON.stringify(v.fields)]);created++;
  }
  const actor='Import documentaire demandé par l’administration';
  for(const r of records){if(reused.has(r.key))continue;const id=ids.get(r.key);if(r.relatedKey)await db.query('UPDATE sst_records SET related_id=$2 WHERE id=$1',[id,ids.get(r.relatedKey)]);const after=(await db.query('SELECT * FROM sst_records WHERE id=$1',[id])).rows[0];await db.query("INSERT INTO sst_events(record_id,actor,action,after_value) VALUES($1,$2,'record.created',$3)",[id,actor,JSON.stringify(after)])}
  for(const d of documents){const id=randomUUID(),recordId=ids.get(records.find(r=>r.files.includes(d.key)).key);await db.query('INSERT INTO sst_documents(id,record_id,name,mime,size,sha256,data) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,recordId,d.name,d.mime,d.data.length,d.sha256,d.data]);await db.query("INSERT INTO sst_events(record_id,document_id,actor,action,after_value) VALUES($1,$2,$3,'document.added',$4)",[recordId,id,actor,JSON.stringify({id,name:d.name,mime:d.mime,size:d.data.length,sha256:d.sha256})])}
  const result=(await db.query('INSERT INTO sst_imports(id,digest,label,record_count,document_count,report_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[payload.id,digest,payload.label,created,documents.length,ids.get('bilan')||null])).rows[0];await db.query('COMMIT');return {...result,alreadyImported:false};
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
export function installSSTIntake(app,pool,{admin,origin,route}){
 app.post('/api/sst/import',admin,origin,express.raw({type:'application/octet-stream',limit:'16mb'}),route(async(req,res)=>{
  let payload;try{if(!Buffer.isBuffer(req.body))throw Error();payload=JSON.parse(req.body.toString('utf8'))}catch{return res.status(400).json({error:'Choisissez le fichier de lot SST au format JSON.'})}
  let result;try{result=await importSSTIntake(pool,payload)}catch{return res.status(400).json({error:'Le lot n’a pas été importé. Vérifiez le fichier, les formats et les départements. Les dossiers existants sont conservés.'})}
  res.status(result.alreadyImported?200:201).json({alreadyImported:result.alreadyImported,records:result.record_count,documents:result.document_count,reportId:result.report_id,label:result.label});
 }));
}
