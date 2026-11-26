import {installCampusTraining,campusLink} from './campus-training.js';
import {randomUUID} from 'node:crypto';
import {installDocumentUploads} from './document-uploads.js';
import {sstFileMime} from './sst.js';
import {sendPrivateBytes} from './private-response.js';
import {normalizeEmail} from './employee-contacts.js';
import {tuacSender} from './tuac-reminders.js';

export const trainingSchemaSQL=`
CREATE TABLE IF NOT EXISTS training_lists(id uuid PRIMARY KEY,department_id bigint NOT NULL,title text NOT NULL,items jsonb NOT NULL,version integer NOT NULL DEFAULT 1,archived boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS training_plans(id uuid PRIMARY KEY,employee_key text NOT NULL,employee_name text NOT NULL,department_id bigint NOT NULL,list_id uuid NOT NULL REFERENCES training_lists(id),title text NOT NULL,items jsonb NOT NULL,due_date date NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(employee_key,list_id));
CREATE TABLE IF NOT EXISTS training_events(id bigserial PRIMARY KEY,plan_id uuid REFERENCES training_plans(id),action text NOT NULL,actor jsonb NOT NULL,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS training_files(id uuid PRIMARY KEY,plan_id uuid NOT NULL REFERENCES training_plans(id),item_id uuid NOT NULL,name text NOT NULL,mime text NOT NULL,data bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS training_settings(department_id bigint PRIMARY KEY,recipients jsonb NOT NULL DEFAULT '[]',reminders boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS training_mail(id uuid PRIMARY KEY,dedupe text UNIQUE NOT NULL,department_id bigint NOT NULL,payload jsonb NOT NULL,status text NOT NULL DEFAULT 'pending',started_at timestamptz,last_at timestamptz,sent_at timestamptz,provider_id text,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX IF NOT EXISTS training_plan_department ON training_plans(department_id);
CREATE INDEX IF NOT EXISTS training_event_plan ON training_events(plan_id,id);
CREATE INDEX IF NOT EXISTS training_file_plan ON training_files(plan_id);
`;
export const trainingPrivateSQL=['training_lists','training_plans','training_events','training_files','training_settings','training_mail'].map(t=>`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY; REVOKE ALL ON ${t} FROM PUBLIC; DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON ${t} FROM anon; END IF; IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON ${t} FROM authenticated; END IF; END $$;`).join('\n');
const fail=(m,s=400)=>{throw Object.assign(Error(m),{status:s});};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const txt=(v,max=180)=>typeof v==='string'?v.trim().slice(0,max):'';
const json=JSON.stringify;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const scope=(a,dep)=>a.admin||a.manager?.departments?.map(Number).includes(Number(dep));
const allowed=a=>{if(!a.manager||!['direction','gerant'].includes(a.view))fail('Accès réservé à la gestion.',403);};
const admin=a=>{allowed(a);if(!a.admin)fail('Réservé à la direction.',403);};
export const progress=p=>({done:p.items.filter(i=>i.status==='done').length,total:p.items.length,late:p.due_date<today()&&p.items.some(i=>i.status!=='done')});
export async function trainingMailSettings(pool,sourcePool){
 const [departments,stored]=await Promise.all([sourcePool.query('SELECT id,recipient,active FROM schedule_leave_departments'),pool.query('SELECT * FROM training_settings')]);
 return departments.rows.filter(d=>d.active).map(d=>{
  const saved=stored.rows.find(s=>Number(s.department_id)===Number(d.id)),email=normalizeEmail(d.recipient),directoryRecipients=email?[email]:[],custom=saved?.recipients?.length>0;
  return {department_id:d.id,version:saved?.version||0,recipients:custom?saved.recipients:directoryRecipients,directoryRecipients,inherited:!custom,reminders:saved?saved.reminders:directoryRecipients.length>0};
 });
}
function mailPayload(department,plans,recipients,subject){return {from:tuacSender(),to:recipients,subject:subject+' — '+department,text:'Bonjour,\n\n'+plans.map(p=>{const n=progress(p);return p.employee_name+' — '+p.title+' : '+n.done+'/'+n.total+' terminées. Échéance : '+p.due_date;}).join('\n')+'\n\nConsulter les fiches et mettre à jour les formations :\nhttps://quartservice.igabenoit.com/formations\n\nConnectez-vous avec votre accès de gérant habituel.\n\nIGA Famille Benoit 300-425'};}

export async function installTrainingTracker(app,{pool,sourcePool,auth,origin,wrap,transaction,directory,date}){
 if(pool&&!process.env.VERCEL)await pool.query(trainingSchemaSQL+trainingPrivateSQL);
 const base='/api/employee-files/formations';
 const audit=(db,a,action,data,planId=null)=>db.query('INSERT INTO training_events(plan_id,action,actor,data) VALUES($1,$2,$3,$4)',[planId,action,json(a.audit),json(data)]);
 async function plan(a,id,db=pool){allowed(a);if(!uuid(id))fail('Parcours introuvable.',404);const p=(await db.query('SELECT *,due_date::text AS due_date FROM training_plans WHERE id=$1',[id])).rows[0];if(!p||!scope(a,p.department_id))fail('Parcours inaccessible.',404);const dir=await directory();const e=dir.employees.find(e=>e.key===p.employee_key);if(!a.admin&&(!e||!e.departments.map(Number).includes(Number(p.department_id))))fail('Cet employé a changé de département.',403);return p;}
 installCampusTraining(app,{base,pool,sourcePool,auth,origin,wrap,transaction,directory,plan,audit});
 async function references(department){return (await sourcePool.query(`SELECT d.id,d.name,r.title FROM sst_visible_documents d JOIN sst_records r ON r.id=d.record_id WHERE r.kind='equipment' AND r.department_id=$1 AND r.archived_at IS NULL AND d.archived_at IS NULL AND d.mime='application/pdf' ORDER BY r.title,d.name`,[department])).rows;}
 app.get(base,auth,wrap(async(req,res)=>{
  const a=req.ef;allowed(a);const dir=await directory(),deps=dir.departments.filter(d=>scope(a,d.id)),ids=deps.map(d=>Number(d.id));
  const employees=dir.employees.filter(e=>e.active&&e.departments.some(d=>ids.includes(Number(d)))).map(({key,name,departments,jobTitle})=>({key,name,departments,jobTitle}));
  const plans=(await pool.query('SELECT *,due_date::text AS due_date FROM training_plans ORDER BY training_plans.due_date,employee_name')).rows.filter(p=>ids.includes(Number(p.department_id))&&(a.admin||employees.some(e=>e.key===p.employee_key&&e.departments.map(Number).includes(Number(p.department_id)))));
  const lists=(await pool.query('SELECT * FROM training_lists ORDER BY title')).rows.filter(p=>ids.includes(Number(p.department_id)));
  const settings=(await trainingMailSettings(pool,sourcePool)).filter(p=>ids.includes(Number(p.department_id)));
  const mail=(await pool.query('SELECT id,department_id,status,created_at,sent_at,payload->\'to\' AS recipients,payload->>\'subject\' AS subject FROM training_mail ORDER BY created_at DESC LIMIT 200')).rows.filter(p=>ids.includes(Number(p.department_id))).slice(0,30);
  res.json({canManage:a.admin,departments:deps,employees,lists,plans:plans.map(p=>({...p,progress:progress(p)})),settings,mail});
 }));
 app.get(base+'/references/:department',auth,wrap(async(req,res)=>{admin(req.ef);res.json({documents:await references(Number(req.params.department))});}));
 app.post(base+'/lists',auth,origin,wrap(async(req,res)=>{
  admin(req.ef);const b=req.body||{},dep=Number(b.departmentId),dir=await directory();if(!dir.departments.some(d=>Number(d.id)===dep))fail('Choisissez un département.');
  if(!txt(b.title)||!Array.isArray(b.items)||!b.items.length||b.items.length>60||b.items.some(i=>!txt(i.title)))fail('Ajoutez un titre et au moins une formation.');
  const docs=await references(dep);const items=b.items.map(i=>({id:uuid(i.id)?i.id:randomUUID(),title:txt(i.title),documentId:i.documentId||null,...(i.platform==='campus'?{platform:'campus',url:campusLink(i.url)}:{})}));
  if(new Set(items.map(i=>i.id)).size!==items.length||items.some(i=>i.documentId&&!docs.some(d=>d.id===i.documentId)))fail('Vérifiez les fiches de ce département.');
  const id=await transaction(async db=>{const id=b.id||randomUUID();if(!uuid(id))fail('Liste invalide.');if(b.id){const prior=(await db.query('SELECT * FROM training_lists WHERE id=$1',[id])).rows[0];if(!prior||prior.version!==b.version)fail('Cette liste a changé. Actualisez.',409);if(Number(prior.department_id)!==dep)fail('Le département ne peut pas être modifié.');await db.query('UPDATE training_lists SET title=$2,items=$3,version=version+1,archived=$4 WHERE id=$1',[id,txt(b.title),json(items),b.archived===true]);}else await db.query('INSERT INTO training_lists(id,department_id,title,items) VALUES($1,$2,$3,$4)',[id,dep,txt(b.title),json(items)]);await audit(db,req.ef,'list.saved',{id,departmentId:dep,title:txt(b.title),items});return id;});res.json({id});
 }));
 app.post(base+'/assign',auth,origin,wrap(async(req,res)=>{
  const a=req.ef;allowed(a);const b=req.body||{},due=date(b.dueDate);if(!due||!uuid(b.listId)||!Array.isArray(b.employeeKeys)||!b.employeeKeys.length||b.employeeKeys.length>300)fail('Choisissez la liste, les employés et une échéance.');
  const dir=await directory();const result=await transaction(async db=>{const list=(await db.query('SELECT * FROM training_lists WHERE id=$1',[b.listId])).rows[0];if(!list||list.archived||!scope(a,list.department_id))fail('Liste inaccessible.',403);
   const selected=[...new Set(b.employeeKeys)].map(key=>dir.employees.find(e=>e.key===key&&e.active&&e.departments.map(Number).includes(Number(list.department_id))));if(selected.some(e=>!e))fail('Un employé ne fait pas partie de ce département.');
   const created=[],skipped=[];for(const e of selected){const id=randomUUID(),items=list.items.map(i=>({...i,status:'todo',completedDate:'',trainer:'',note:''}));const r=await db.query('INSERT INTO training_plans(id,employee_key,employee_name,department_id,list_id,title,items,due_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(employee_key,list_id) DO NOTHING RETURNING *,due_date::text AS due_date',[id,e.key,e.name,list.department_id,list.id,list.title,json(items),due]);if(!r.rows.length){skipped.push(e.name);continue;}created.push(r.rows[0]);await audit(db,a,'assigned',{listId:list.id,listVersion:list.version,dueDate:due},id);}
   let queued=false;if(b.notify&&created.length){const settings=(await trainingMailSettings(db,sourcePool)).find(s=>Number(s.department_id)===Number(list.department_id));if(!settings?.recipients?.length)fail('Configurez le courriel du gérant ou décochez l’envoi.');if(!process.env.RESEND_API_KEY)fail('Le service courriel est indisponible.',503);const payload=mailPayload(dir.departments.find(d=>Number(d.id)===Number(list.department_id)).name,created,settings.recipients,'Formations à suivre');await db.query('INSERT INTO training_mail(id,dedupe,department_id,payload) VALUES($1,$2,$3,$4)',[randomUUID(),'assignment:'+created[0].id,list.department_id,json(payload)]);queued=true;}return {assigned:created.length,skipped,queued};});res.json(result);
 }));
 app.get(base+'/plans/:id',auth,wrap(async(req,res)=>{const p=await plan(req.ef,req.params.id);res.json({plan:p,files:(await pool.query('SELECT id,item_id,name,created_at FROM training_files WHERE plan_id=$1 ORDER BY created_at',[p.id])).rows,history:(await pool.query('SELECT action,actor,data,created_at FROM training_events WHERE plan_id=$1 ORDER BY id DESC LIMIT 100',[p.id])).rows});}));
 app.post(base+'/plans/:id',auth,origin,wrap(async(req,res)=>{
  const b=req.body||{};await transaction(async db=>{const p=await plan(req.ef,req.params.id,db);if(p.version!==b.version)fail('Un autre utilisateur a modifié ce parcours. Actualisez avant de continuer.',409);
   if(b.itemId){const item=p.items.find(i=>i.id===b.itemId);if(!item||!['todo','doing','done'].includes(b.status))fail('Formation ou statut invalide.');const completed=b.status==='done'?date(b.completedDate):null;if(b.status==='done'&&(!completed||completed>today()||!txt(b.trainer)))fail('Indiquez la date réelle (non future) et la personne ayant donné la formation.');Object.assign(item,{status:b.status,completedDate:completed||'',trainer:txt(b.trainer),note:txt(b.note,2000)});}
   else if(!b.dueDate)fail('Aucune modification.');const due=b.dueDate?date(b.dueDate):p.due_date;
   await db.query('UPDATE training_plans SET items=$2,due_date=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1',[p.id,json(p.items),due]);await audit(db,req.ef,b.itemId?'progress.updated':'deadline.updated',{item:b.itemId?p.items.find(i=>i.id===b.itemId):null,dueDate:due},p.id);
  });res.json({ok:true});
 }));
 app.get(base+'/documents/:id',auth,wrap(async(req,res)=>{
  allowed(req.ef);if(!uuid(req.params.id))fail('Fiche introuvable.',404);
  const doc=(await sourcePool.query("SELECT d.name,d.mime,d.data,r.department_id FROM sst_visible_documents d JOIN sst_records r ON r.id=d.record_id WHERE d.id=$1 AND r.kind='equipment' AND d.archived_at IS NULL AND r.archived_at IS NULL",[req.params.id])).rows[0];
  if(!doc||!scope(req.ef,doc.department_id))fail('Fiche inaccessible.',404);res.type(doc.mime).set({'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(doc.name),'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});await sendPrivateBytes(res,doc.data);
 }));
 async function target(db,req){const p=await plan(req.ef,req.params.id,db);if(!p.items.some(i=>i.id===req.params.itemId))fail('Formation introuvable.',404);return p;}
 if(pool)installDocumentUploads(app,{path:base+'/plans/:id/items/:itemId/files',auth,origin,wrap,transaction,pool,owner:req=>req.ef.audit.kind+':'+req.ef.audit.id,target:req=>'training:'+req.params.id+':'+req.params.itemId,options:()=>({}),authorize:target,save:async(db,req,p,bytes,name)=>{const mime=sstFileMime(bytes,name);if(!['application/pdf','image/jpeg','image/png'].includes(mime))fail('Joignez un PDF, une photo JPEG ou PNG.');const id=randomUUID();await db.query('INSERT INTO training_files(id,plan_id,item_id,name,mime,data) VALUES($1,$2,$3,$4,$5,$6)',[id,p.id,req.params.itemId,name,mime,bytes]);await audit(db,req.ef,'proof.added',{itemId:req.params.itemId,fileId:id,name},p.id);return id;}});
 app.get(base+'/plans/:id/files/:fileId',auth,wrap(async(req,res)=>{const p=await plan(req.ef,req.params.id);if(!uuid(req.params.fileId))fail('Preuve introuvable.',404);const file=(await pool.query('SELECT name,mime,data FROM training_files WHERE id=$1 AND plan_id=$2',[req.params.fileId,p.id])).rows[0];if(!file)fail('Preuve introuvable.',404);res.type(file.mime).set({'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(file.name),'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});await sendPrivateBytes(res,file.data);}));
 app.post(base+'/settings',auth,origin,wrap(async(req,res)=>{admin(req.ef);const b=req.body||{},dep=Number(b.departmentId),dir=await directory();const recipients=Array.isArray(b.recipients)?[...new Set(b.recipients.map(normalizeEmail))]:[];if(!dir.departments.some(d=>Number(d.id)===dep)||recipients.length>10||recipients.some(e=>!e))fail('Vérifiez les adresses courriel.');await transaction(async db=>{const old=(await db.query('SELECT version FROM training_settings WHERE department_id=$1',[dep])).rows[0];if((old?.version||0)!==b.version)fail('Ces réglages ont changé. Actualisez.',409);await db.query('INSERT INTO training_settings(department_id,recipients,reminders) VALUES($1,$2,$3) ON CONFLICT(department_id) DO UPDATE SET recipients=EXCLUDED.recipients,reminders=EXCLUDED.reminders,version=training_settings.version+1',[dep,json(recipients),b.reminders===true]);await audit(db,req.ef,'settings.saved',{departmentId:dep,recipients,reminders:b.reminders===true});});res.json({ok:true});}));
 app.post(base+'/notify',auth,origin,wrap(async(req,res)=>{allowed(req.ef);const b=req.body||{},dep=Number(b.departmentId);if(!scope(req.ef,dep)||!uuid(b.requestId))fail('Envoi inaccessible.',403);if(!process.env.RESEND_API_KEY)fail('Service courriel indisponible.',503);const dir=await directory();await transaction(async db=>{const existing=(await db.query('SELECT department_id FROM training_mail WHERE id=$1',[b.requestId])).rows[0];if(existing){if(Number(existing.department_id)!==dep)fail('Référence déjà utilisée.',409);return;}const s=(await trainingMailSettings(db,sourcePool)).find(s=>Number(s.department_id)===dep);if(!s?.recipients?.length)fail('La direction doit configurer le courriel du gérant.');const plans=(await db.query('SELECT *,due_date::text AS due_date FROM training_plans WHERE department_id=$1',[dep])).rows.filter(p=>dir.employees.some(e=>e.key===p.employee_key&&e.active&&e.departments.map(Number).includes(dep)));if(!plans.length)fail('Aucun parcours actif à communiquer.');await db.query('INSERT INTO training_mail(id,dedupe,department_id,payload) VALUES($1,$2,$3,$4)',[b.requestId,'manual:'+b.requestId,dep,json(mailPayload(dir.departments.find(d=>Number(d.id)===dep).name,plans,s.recipients,'Suivi des formations'))]);});res.json({queued:true});}));
}

export async function sendTrainingMail(pool,sourcePool,{fetchImpl=fetch,env=process.env}={}){
 if(!pool||!env.RESEND_API_KEY)return;
 // One digest per department and ISO week. No real mail is created without configured recipients.
 const settings=(await trainingMailSettings(pool,sourcePool)).filter(s=>s.reminders);
 for(const s of settings){if(!s.recipients.length)continue;const plans=(await pool.query("SELECT *,due_date::text AS due_date,to_char(clock_timestamp() AT TIME ZONE 'America/Toronto','IYYY-IW') AS week FROM training_plans WHERE department_id=$1 AND due_date<(clock_timestamp() AT TIME ZONE 'America/Toronto')::date AND EXISTS(SELECT 1 FROM jsonb_array_elements(items) i WHERE i->>'status'<>'done')",[s.department_id])).rows;if(!plans.length)continue;
  const {sstDirectory}=await import('./sst.js');const dir=await sstDirectory(sourcePool),active=plans.filter(p=>dir.employees.some(e=>e.key===p.employee_key&&e.active&&e.departments.map(Number).includes(Number(s.department_id))));if(!active.length)continue;
  const payload=mailPayload(dir.departments.find(d=>Number(d.id)===Number(s.department_id))?.name||'Département',active,[...new Set([...s.recipients,'igabenoit@gmail.com'])],'Rappel — formations en retard');await pool.query('INSERT INTO training_mail(id,dedupe,department_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(dedupe) DO NOTHING',[randomUUID(),'overdue:'+s.department_id+':'+plans[0].week,s.department_id,json(payload)]);
 }
 await pool.query("UPDATE training_mail SET status='review' WHERE status IN ('pending','sending') AND started_at<clock_timestamp()-interval '20 hours'");
 const jobs=(await pool.query("SELECT id FROM training_mail WHERE status IN ('pending','sending') AND (last_at IS NULL OR last_at<clock_timestamp()-interval '2 minutes') ORDER BY created_at LIMIT 10")).rows;
 let failures=0;for(const j of jobs){const row=(await pool.query("UPDATE training_mail SET status='sending',started_at=COALESCE(started_at,clock_timestamp()),last_at=clock_timestamp() WHERE id=$1 AND status IN ('pending','sending') AND (last_at IS NULL OR last_at<clock_timestamp()-interval '2 minutes') RETURNING payload",[j.id])).rows[0];if(!row)continue;try{const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'training-'+j.id},body:json(row.payload)});const result=await response.json();if(!response.ok||!result.id)throw Error('provider');await pool.query("UPDATE training_mail SET status='sent',sent_at=clock_timestamp(),provider_id=$2 WHERE id=$1",[j.id,result.id]);}catch{failures++;}}
 if(failures)throw Error('Courriels de formation non confirmés : '+failures);
}
