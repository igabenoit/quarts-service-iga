import express from 'express';
import {randomUUID,createHash} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const str=(v,n)=>{if(typeof v!=='string'||v.length>n)fail('Un champ est invalide ou trop long.');return v.trim()};
const date=v=>{if(!v)return null;if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)fail('Date invalide.');return v};
export function validateTemplate(b){
 if(b?.format!=='iga-sst-grid-template-v1'||!Array.isArray(b.pages)||b.pages.length<1||b.pages.length>60)fail('Modèle de grille invalide.');
 const ids=new Set();let total=0;
 const pages=b.pages.map((p,i)=>{if(p.number!==i+1||!Array.isArray(p.blocks)||p.blocks.length>200)fail('Page invalide.');return {number:p.number,title:str(p.title,180),blocks:p.blocks.map(x=>{if(!['item','heading','note'].includes(x.type))fail('Rubrique invalide.');const block={type:x.type,text:str(x.text,6000)};if(x.type==='item'){if(!/^[a-z0-9-]{1,60}$/.test(x.id)||ids.has(x.id))fail('Identifiant de question invalide.');ids.add(x.id);block.id=x.id;total++}return block})}});
 if(!total||total>1500)fail('Nombre de questions invalide.');
 return {title:str(b.title,180),sourceVersion:str(b.sourceVersion,300),pages};
}
export function validateRun(b,template){
 if(!['draft','progress','done'].includes(b?.status)||!b.data||typeof b.data!=='object'||Array.isArray(b.data))fail('Inspection invalide.');
 const d=b.data,answers={},valid=new Set(template.pages.flatMap(p=>p.blocks.filter(x=>x.type==='item').map(x=>x.id)));
 if(!d.answers||typeof d.answers!=='object'||Array.isArray(d.answers))fail('Réponses invalides.');
 for(const [id,a] of Object.entries(d.answers)){if(!valid.has(id)||!a||!['','yes','no','na'].includes(a.value))fail('Réponse invalide.');answers[id]={value:a.value,note:str(a.note||'',2000)}}
 if(!Array.isArray(d.actions)||d.actions.length>100)fail('Mesures correctives invalides.');
 const data={date:date(d.date),inspector:str(d.inspector||'',120),establishment:str(d.establishment||'',180),answers,actions:d.actions.map(a=>({finding:str(a.finding||'',3000),measure:str(a.measure||'',3000),owner:str(a.owner||'',120),due:date(a.due)}))};
 if(b.status==='done'){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(!data.date||data.date>today||!data.inspector||!data.establishment)fail('Pour terminer, indiquez la date réelle, l’inspecteur et l’établissement.');
 if([...valid].some(id=>!answers[id]?.value))fail('Répondez à chaque point (Oui, Non ou N/A) avant de terminer. Vous pouvez enregistrer un brouillon.');
 }
 return data;
}
export async function installInspectionGrid(app,pool,{admin,origin,route}){
 await pool.query(`CREATE TABLE IF NOT EXISTS sst_grid_templates(id UUID PRIMARY KEY,title TEXT NOT NULL,schema JSONB NOT NULL,document_id UUID NOT NULL REFERENCES sst_documents(id),digest TEXT UNIQUE NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
 CREATE TABLE IF NOT EXISTS sst_grid_runs(id UUID PRIMARY KEY REFERENCES sst_records(id),template_id UUID NOT NULL REFERENCES sst_grid_templates(id),data JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 1);`);
 const tx=async fn=>{const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(835107)');const result=await fn(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}};
 const event=(db,req,action,id,before,after)=>db.query('INSERT INTO sst_events(record_id,actor,action,before_value,after_value) VALUES($1,$2,$3,$4,$5)',[id,req.sstActor,action,before?JSON.stringify(before):null,JSON.stringify(after)]);
 app.get('/api/sst/grid/templates',admin,route(async(req,res)=>res.json({templates:(await pool.query('SELECT id,title,schema,document_id FROM sst_grid_templates ORDER BY created_at DESC')).rows})));
 app.post('/api/sst/grid/templates',admin,origin,express.raw({type:'application/octet-stream',limit:'16mb'}),route(async(req,res)=>{
 let b;try{b=JSON.parse(req.body.toString('utf8'))}catch{fail('Fichier de modèle illisible.')}
 const schema=validateTemplate(b);if(typeof b.pdfBase64!=='string'||b.pdfBase64.length>16*1024*1024)fail('Original PDF invalide.');
 const pdf=Buffer.from(b.pdfBase64,'base64');if(!pdf.subarray(0,1024).includes(Buffer.from('%PDF-'))||pdf.length>12*1024*1024)fail('Original PDF invalide.');
 const name=str(b.sourceName,180),sha=createHash('sha256').update(pdf).digest('hex'),digest=createHash('sha256').update(JSON.stringify(schema)+sha).digest('hex');
 const result=await tx(async db=>{
 const old=(await db.query('SELECT id FROM sst_grid_templates WHERE digest=$1',[digest])).rows[0];if(old)return old;
 const id=randomUUID(),recordId=randomUUID(),documentId=randomUUID();
 await db.query("INSERT INTO sst_records(id,kind,title,status,fields,details) VALUES($1,'document',$2,'open',$3,$4)",[recordId,schema.title+' · modèle original',JSON.stringify({reference:schema.sourceVersion}), 'Modèle de la grille d’inspection numérique. Original conservé.']);
 await db.query("INSERT INTO sst_documents(id,record_id,name,mime,size,sha256,data) VALUES($1,$2,$3,'application/pdf',$4,$5,$6)",[documentId,recordId,name,pdf.length,sha,pdf]);
 await db.query('INSERT INTO sst_grid_templates(id,title,schema,document_id,digest) VALUES($1,$2,$3,$4,$5)',[id,schema.title,JSON.stringify(schema),documentId,digest]);
 await event(db,req,'grid.template.imported',recordId,null,{id,documentId,sha256:sha,title:schema.title});return {id};});res.json(result);
 }));
 app.get('/api/sst/grid/runs',admin,route(async(req,res)=>res.json({runs:(await pool.query('SELECT g.id,g.template_id,g.revision,r.title,r.status,r.owner,r.event_date FROM sst_grid_runs g JOIN sst_records r ON r.id=g.id WHERE r.archived_at IS NULL ORDER BY r.event_date DESC NULLS LAST,r.updated_at DESC')).rows})));
 app.get('/api/sst/grid/runs/:id',admin,route(async(req,res)=>{if(!uuid(req.params.id))fail('Inspection introuvable.',404);const r=(await pool.query('SELECT g.*,r.status,r.owner,r.event_date,r.version AS record_version FROM sst_grid_runs g JOIN sst_records r ON r.id=g.id WHERE g.id=$1 AND r.archived_at IS NULL',[req.params.id])).rows[0];if(!r)fail('Inspection introuvable.',404);r.data.inspector=r.owner;r.data.date=r.event_date?String(r.event_date.toISOString?.().slice(0,10)||r.event_date).slice(0,10):null;res.json(r)}));
 app.post('/api/sst/grid/runs',admin,origin,express.raw({type:'application/octet-stream',limit:'2mb'}),route(async(req,res)=>{
 let b;try{b=JSON.parse(req.body.toString('utf8'))}catch{fail('Inspection illisible.')}if(!uuid(b?.id)||!uuid(b?.templateId))fail('Inspection invalide.');
 const result=await tx(async db=>{
 const template=(await db.query('SELECT schema FROM sst_grid_templates WHERE id=$1',[b.templateId])).rows[0];if(!template)fail('Modèle introuvable.',404);
 const data=validateRun(b,template.schema),old=(await db.query('SELECT g.*,r.version AS record_version,r.archived_at FROM sst_grid_runs g JOIN sst_records r ON r.id=g.id WHERE g.id=$1',[b.id])).rows[0];
 if(old&&(old.archived_at||old.revision!==b.revision||old.record_version!==b.recordVersion))fail('Cette inspection a changé. Vos réponses restent affichées. Rechargez la version enregistrée avant de réessayer.',409);
 if(old&&old.template_id!==b.templateId)fail('Le modèle de cette inspection ne peut pas être changé.');
 if(!old&&(b.revision!==0||b.recordVersion!==0))fail('Inspection introuvable.',409);
 const title=('Inspection SST · '+(data.date||'date à préciser')+' · '+(data.establishment||'établissement à préciser')).slice(0,180);
 const answered=Object.values(data.answers).filter(a=>a.value).length,non=Object.values(data.answers).filter(a=>a.value==='no').length;
 const fields={reference:template.schema.sourceVersion,findings:`Grille numérique : ${answered} points renseignés, ${non} réponse(s) Non. Ouvrir l’onglet Grille d’inspection pour consulter ou modifier les réponses.`};
 if(old){await db.query('UPDATE sst_grid_runs SET data=$2,revision=revision+1 WHERE id=$1',[b.id,JSON.stringify(data)]);await db.query('UPDATE sst_records SET title=$2,status=$3,owner=$4,event_date=$5,fields=$6,version=version+1,updated_at=clock_timestamp() WHERE id=$1',[b.id,title,b.status,data.inspector,data.date,JSON.stringify(fields)])}
 else{await db.query("INSERT INTO sst_records(id,kind,title,status,owner,event_date,fields) VALUES($1,'inspection',$2,$3,$4,$5,$6)",[b.id,title,b.status,data.inspector,data.date,JSON.stringify(fields)]);await db.query('INSERT INTO sst_grid_runs(id,template_id,data) VALUES($1,$2,$3)',[b.id,b.templateId,JSON.stringify(data)])}
 await event(db,req,old?'grid.updated':'grid.created',b.id,old?{data:old.data,revision:old.revision}:null,{data,status:b.status,templateId:b.templateId});
 return {id:b.id,revision:old?old.revision+1:1,recordVersion:old?old.record_version+1:1};});res.json(result);
 }));
}


