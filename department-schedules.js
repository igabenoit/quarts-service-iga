import crypto from 'node:crypto';
import {employeeAvailability} from './availability-rules.js';
import {normalizeEmail,loadContactDirectory} from './employee-contacts.js';
import {DEPARTMENT_STYLES,nameKey,isDate,monday,today,addDays,normalizeAvailability,normalizeDraft,blankCell,draftWarnings,publicSnapshot,totalMinutes,isTimedCell} from './public/departments-core.js';
import {validatePhoto,transcribePhoto} from './department-photo.js';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const iso=v=>v instanceof Date?v.toISOString().slice(0,10):v?.slice(0,10)||'';
const integer=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):fail('Identifiant invalide.');
const week=v=>isDate(v)&&monday(v)===v?v:fail('Choisissez le lundi de la semaine.');
const endpoint=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error.status||400).json({error:error.status||!error.code?error.message:'Cette opération n’a pas pu être enregistrée.'});}};

export async function installDepartmentSchedules(app,pool,{requireManager,sameOrigin,requireStaff,fetchImpl=fetch}){
  await pool.query(`ALTER TABLE schedule_leave_departments ADD COLUMN IF NOT EXISTS schedule_key TEXT UNIQUE;
    CREATE TABLE IF NOT EXISTS schedule_store_people(id BIGSERIAL PRIMARY KEY,service_employee_id BIGINT UNIQUE,name TEXT NOT NULL,seniority_date DATE,birthday DATE,email TEXT NOT NULL DEFAULT '',employment_group TEXT NOT NULL DEFAULT 'regular' CHECK(employment_group IN('regular','part_time')),availability JSONB NOT NULL DEFAULT '{}',active BOOLEAN NOT NULL DEFAULT TRUE,source_note TEXT NOT NULL DEFAULT '',verified_at TIMESTAMPTZ,version INTEGER NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
    ALTER TABLE schedule_store_people ADD COLUMN IF NOT EXISTS job_title TEXT NOT NULL DEFAULT '';
    CREATE TABLE IF NOT EXISTS schedule_store_memberships(person_id BIGINT REFERENCES schedule_store_people(id),department_id BIGINT REFERENCES schedule_leave_departments(id),PRIMARY KEY(person_id,department_id));
    CREATE TABLE IF NOT EXISTS schedule_department_weeks(department_id BIGINT REFERENCES schedule_leave_departments(id),week_start DATE NOT NULL,draft JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 1,published JSONB,published_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(department_id,week_start));
    CREATE TABLE IF NOT EXISTS schedule_department_history(id BIGSERIAL PRIMARY KEY,department_id BIGINT NOT NULL,week_start DATE NOT NULL,revision INTEGER NOT NULL,draft JSONB NOT NULL,published JSONB,action TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE IF NOT EXISTS schedule_department_photos(id BIGSERIAL PRIMARY KEY,department_id BIGINT NOT NULL REFERENCES schedule_leave_departments(id),week_start DATE NOT NULL,name TEXT NOT NULL,data_url TEXT NOT NULL,candidate JSONB,state TEXT NOT NULL DEFAULT 'saved',attempts INTEGER NOT NULL DEFAULT 0,operation_id TEXT,started_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
    CREATE INDEX IF NOT EXISTS schedule_department_photo_week ON schedule_department_photos(department_id,week_start);`);
  const existing=(await pool.query('SELECT * FROM schedule_leave_departments')).rows;
  for(const style of DEPARTMENT_STYLES){
    let d=existing.find(d=>d.schedule_key===style.key)||existing.find(d=>nameKey(d.name)===nameKey(style.name));
    if(d)await pool.query('UPDATE schedule_leave_departments SET schedule_key=$1 WHERE id=$2 AND schedule_key IS NULL',[style.key,d.id]);
    else await pool.query('INSERT INTO schedule_leave_departments(name,schedule_key) VALUES($1,$2) ON CONFLICT(schedule_key) DO NOTHING',[style.name,style.key]);
  }
  await pool.query("UPDATE schedule_leave_departments SET schedule_key='service' WHERE code='service' AND schedule_key IS NULL");
  app.use('/api/departments',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const listDepartments=async client=>(await client.query('SELECT id,name,schedule_key AS key,active FROM schedule_leave_departments WHERE schedule_key IS NOT NULL ORDER BY name')).rows.map(d=>({...d,id:Number(d.id)}));
  const department=async(id,client=pool)=>{const d=(await listDepartments(client)).find(d=>d.id===integer(id));if(!d||d.key==='service')fail('Utilisez l’horaire Service pour ce département.');return d;};
  async function directory(client=pool,weekStart){
    await client.query("INSERT INTO schedule_store_people(service_employee_id,name) SELECT id,name FROM schedule_employees ON CONFLICT(service_employee_id) DO NOTHING");
    await client.query("INSERT INTO schedule_store_memberships(person_id,department_id) SELECT p.id,d.id FROM schedule_store_people p CROSS JOIN schedule_leave_departments d WHERE p.service_employee_id IS NOT NULL AND d.code='service' ON CONFLICT DO NOTHING");
    const records=(await client.query('SELECT p.*,e.name AS service_name,e.seniority AS service_seniority,e.active AS service_active,e.departed_at,e.availability AS service_availability,e.availability_history,e.target_minutes FROM schedule_store_people p LEFT JOIN schedule_employees e ON e.id=p.service_employee_id ORDER BY p.id')).rows;
    const memberships=(await client.query('SELECT * FROM schedule_store_memberships')).rows;
    const contacts=records.some(r=>r.service_employee_id)?await loadContactDirectory(client):{employees:[]};
    return records.map(r=>{
      const service=!!r.service_employee_id;
      const a=service?employeeAvailability({availability:r.service_availability,availability_history:r.availability_history,target_minutes:r.target_minutes},weekStart).availability:null;
      return {id:Number(r.id),serviceEmployeeId:r.service_employee_id?Number(r.service_employee_id):null,name:service?(r.service_name||r.name):r.name,jobTitle:r.job_title||'',seniorityDate:service?(!r.service_seniority||r.service_seniority==='9999-12-31'?'':r.service_seniority):iso(r.seniority_date),birthday:iso(r.birthday),email:service?contacts.employees.find(e=>e.id===Number(r.service_employee_id))?.email||r.email:r.email,group:r.employment_group,availability:service?Object.fromEntries(Array.from({length:7},(_,d)=>[d,(a[d]||[]).length?a[d].map(([s,e])=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}-${String(Math.floor(e/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')}`).join(', '):'0'])):normalizeAvailability(r.availability),active:service?Boolean(r.service_name&&r.service_active&&!r.departed_at):r.active,sourceNote:r.source_note,verifiedAt:r.verified_at,version:r.version,departments:memberships.filter(m=>Number(m.person_id)===Number(r.id)).map(m=>Number(m.department_id))};
    });
  }
  const peopleFor=async(id,client=pool,weekStart)=>(await directory(client,weekStart)).filter(p=>p.departments.includes(Number(id))).sort((a,b)=>(a.group===b.group?0:a.group==='regular'?-1:1)||(a.seniorityDate||'9999').localeCompare(b.seniorityDate||'9999')||a.name.localeCompare(b.name,'fr-CA'));
  const emptyDraft=people=>({manager:'',notes:'',rows:people.filter(p=>p.active).map(p=>({personId:p.id,cells:Array.from({length:7},blankCell)}))});
  async function getWeek(id,start,client=pool){
    const people=await peopleFor(id,client,start),row=(await client.query('SELECT * FROM schedule_department_weeks WHERE department_id=$1 AND week_start=$2',[id,start])).rows[0];
    return {department:await department(id,client),weekStart:start,people,draft:row?.draft||emptyDraft(people),revision:row?.revision||0,publishedAt:row?.published_at||null,published:row?.published||null};
  }
  async function transaction(fn){const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  async function saveWeek(client,current,draft,action,published=current.published){
    const revision=current.revision+1;
    if(current.revision)await client.query('INSERT INTO schedule_department_history(department_id,week_start,revision,draft,published,action) VALUES($1,$2,$3,$4,$5,$6)',[current.department.id,current.weekStart,current.revision,JSON.stringify(current.draft),JSON.stringify(current.published),action]);
    await client.query(`INSERT INTO schedule_department_weeks(department_id,week_start,draft,revision,published,published_at) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(department_id,week_start) DO UPDATE SET draft=EXCLUDED.draft,revision=EXCLUDED.revision,published=EXCLUDED.published,published_at=EXCLUDED.published_at,updated_at=clock_timestamp()`,[current.department.id,current.weekStart,JSON.stringify(draft),revision,published?JSON.stringify(published):null,action==='publish'?new Date():action==='unpublish'?null:current.publishedAt]);
    return {revision};
  }
  const checkRevision=(body,current)=>{if(!Number.isInteger(body.revision)||body.revision!==current.revision)fail('La feuille a changé. Rechargez-la avant d’enregistrer pour conserver les modifications récentes.',409);};
  async function warningsFor(current,client=pool){
    const warnings=draftWarnings(current.draft,current.people);
    const others=(await client.query('SELECT d.name,w.published FROM schedule_department_weeks w JOIN schedule_leave_departments d ON d.id=w.department_id WHERE week_start=$1 AND department_id<>$2 AND published IS NOT NULL',[current.weekStart,current.department.id])).rows;
    for(const row of current.draft.rows)for(const other of others){const match=other.published.rows.find(r=>r.personId===row.personId);if(match)for(let day=0;day<7;day++){const a=row.cells[day],b=match.cells[day];if(isTimedCell(a)&&isTimedCell(b)&&a.start<b.end&&b.start<a.end)warnings.push(`${current.people.find(p=>p.id===row.personId)?.name||'Employé retiré'} : chevauchement avec ${other.name}, le ${addDays(current.weekStart,day)}.`);}}
    const leaves=(await client.query("SELECT employee_name,periods,effective_periods FROM schedule_leave_requests WHERE department_id=$1 AND status='approved' AND is_test=FALSE AND archived_at IS NULL AND first_date<=$3 AND last_date>=$2",[current.department.id,current.weekStart,addDays(current.weekStart,6)])).rows;
    for(const row of current.draft.rows){const p=current.people.find(p=>p.id===row.personId);if(!p)continue;for(const leave of leaves.filter(l=>nameKey(l.employee_name)===nameKey(p.name)))for(let day=0;day<7;day++){const c=row.cells[day];if(isTimedCell(c)&&(leave.effective_periods||leave.periods).some(l=>l.date===addDays(current.weekStart,day)&&l.startMinute<c.end&&c.start<l.endMinute))warnings.push(`${p.name} : congé approuvé à vérifier le ${addDays(current.weekStart,day)}.`);}}
    const assignments=(await client.query('SELECT a.employee_id,s.day_index,s.start_minute,s.end_minute FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id WHERE s.week_start=$1',[current.weekStart])).rows;
    for(const row of current.draft.rows){const p=current.people.find(p=>p.id===row.personId);if(!p?.serviceEmployeeId)continue;for(const a of assignments.filter(a=>Number(a.employee_id)===p.serviceEmployeeId)){const c=row.cells[a.day_index];if(isTimedCell(c)&&c.start<a.end_minute&&a.start_minute<c.end)warnings.push(p.name+' : chevauchement avec un quart du Service, le '+addDays(current.weekStart,a.day_index)+'.');}}
    return [...new Set(warnings)];
  }
  app.get('/api/departments/meta',requireManager,endpoint(async(_req,res)=>res.json({departments:await listDepartments(pool),people:await directory(),visionConfigured:Boolean(process.env.OPENAI_API_KEY),publicPath:'/horaires-departements'})));
  app.post('/api/departments/people',requireManager,sameOrigin,endpoint(async(req,res)=>res.json(await savePerson(req.body))));
  app.put('/api/departments/people/:id',requireManager,sameOrigin,endpoint(async(req,res)=>res.json(await savePerson(req.body,integer(req.params.id)))));
  async function savePerson(body,id){return transaction(async client=>{
    const list=await directory(client),previous=id?list.find(p=>p.id===id):null;
    if(id&&!previous)fail('Employé introuvable.',404);
    if(previous&&body.version!==previous.version)fail('Cette fiche a changé. Rechargez le répertoire.',409);
    const name=String(body.name||'').trim(),email=normalizeEmail(body.email),source=String(body.sourceNote||'').trim();
    if(name.length<2||name.length>100||body.email&&!email||source.length>200)fail('Vérifiez le nom, le courriel et la source de l’ancienneté.');
    const titleValue=body.jobTitle===undefined?previous?.jobTitle||'':body.jobTitle;
    if(titleValue!==null&&typeof titleValue!=='string')fail('Le titre doit être du texte.');
    const jobTitle=(titleValue||'').trim().replace(/\s+/g,' ');
    if(jobTitle.length>80)fail('Le titre doit contenir au plus 80 caractères.');
    const seniority=body.seniorityDate||'',birthday=body.birthday||'';
    if([seniority,birthday].some(v=>v&&(!isDate(v)||v>today()||v<'1900-01-01')))fail('Indiquez des dates réelles, non futures.');
    if(seniority&&!previous?.serviceEmployeeId&&(!source||body.seniorityVerified!==true))fail('Confirmez la date d’ancienneté et indiquez sa source.');
    if(!['regular','part_time'].includes(body.group)||typeof body.active!=='boolean')fail('Statut d’emploi invalide.');
    const departments=await listDepartments(client),ids=Array.isArray(body.departments)?[...new Set(body.departments.map(Number))]:[];
    if(!ids.length||ids.some(id=>!departments.some(d=>d.id===id)))fail('Choisissez au moins un département.');
    if(!previous?.serviceEmployeeId&&ids.some(id=>departments.find(d=>d.id===id).key==='service'))fail('Ajoutez les employés du Service depuis leur section existante, puis utilisez leur fiche dans ce répertoire.');
    if(previous?.serviceEmployeeId){const serviceId=departments.find(d=>d.key==='service').id;if(!ids.includes(serviceId))ids.push(serviceId);}
    const availability=normalizeAvailability(body.availability||{});
    const args=[previous?.serviceEmployeeId?previous.name:name,previous?.serviceEmployeeId?null:seniority||null,birthday||null,email,body.group,JSON.stringify(availability),body.active,source,seniority&&body.seniorityVerified?new Date():null,jobTitle];
    let saved;
    if(id)saved=(await client.query('UPDATE schedule_store_people SET name=$1,seniority_date=$2,birthday=$3,email=$4,employment_group=$5,availability=$6,active=$7,source_note=$8,verified_at=$9,job_title=$10,version=version+1,updated_at=clock_timestamp() WHERE id=$11 RETURNING id',[...args,id])).rows[0];
    else{if(list.some(p=>nameKey(p.name)===nameKey(name))&&body.distinctPerson!==true)fail('Un nom identique existe déjà. Utilisez sa fiche pour ajouter un département, ou confirmez qu’il s’agit d’une autre personne.',409);saved=(await client.query('INSERT INTO schedule_store_people(name,seniority_date,birthday,email,employment_group,availability,active,source_note,verified_at,job_title) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',args)).rows[0];}
    if(previous?.serviceEmployeeId&&!(await client.query('SELECT 1 FROM schedule_employees WHERE id=$1',[previous.serviceEmployeeId])).rows.length)fail('La fiche Service a été annulée. Réactualisez le répertoire.',409);
    if(previous?.serviceEmployeeId)await client.query('INSERT INTO schedule_employee_contacts(employee_id,email) VALUES($1,$2) ON CONFLICT(employee_id) DO UPDATE SET email=EXCLUDED.email,updated_at=clock_timestamp()',[previous.serviceEmployeeId,email]);
    await client.query('DELETE FROM schedule_store_memberships WHERE person_id=$1',[saved.id]);for(const departmentId of ids)await client.query('INSERT INTO schedule_store_memberships(person_id,department_id) VALUES($1,$2)',[saved.id,departmentId]);
    return {ok:true,id:Number(saved.id)};
  });}
  app.get('/api/departments/:id/weeks/:week',requireManager,endpoint(async(req,res)=>{const current=await getWeek(integer(req.params.id),week(req.params.week));res.json({...current,warnings:await warningsFor(current)});}));
  app.put('/api/departments/:id/weeks/:week',requireManager,sameOrigin,endpoint(async(req,res)=>res.json(await transaction(async client=>{const current=await getWeek(integer(req.params.id),week(req.params.week),client);checkRevision(req.body,current);return saveWeek(client,current,normalizeDraft(req.body.draft,current.people),'save');}))));
  app.post('/api/departments/:id/weeks/:week/copy',requireManager,sameOrigin,endpoint(async(req,res)=>res.json(await transaction(async client=>{
    const id=integer(req.params.id),targetWeek=week(req.params.week),sourceWeek=week(req.body.sourceWeek);
    if(sourceWeek===targetWeek)fail('Choisissez une semaine différente de la semaine à copier.');
    const source=await getWeek(id,sourceWeek,client);
    if(!source.revision)fail('Enregistrez la semaine à copier avant de continuer.');
    if(!Number.isInteger(req.body.sourceRevision)||source.revision!==req.body.sourceRevision)fail('La semaine à copier a changé. Rechargez-la avant de recommencer.',409);
    const target=await getWeek(id,targetWeek,client);checkRevision(req.body,target);
    if(target.revision&&req.body.replaceConfirmed!==true)fail('Confirmez le remplacement du brouillon de la semaine choisie.');
    return saveWeek(client,target,normalizeDraft(source.draft,target.people),'copy');
  }))));
  app.post('/api/departments/:id/weeks/:week/publish',requireManager,sameOrigin,endpoint(async(req,res)=>res.json(await transaction(async client=>{
    const current=await getWeek(integer(req.params.id),week(req.params.week),client);checkRevision(req.body,current);
    const draft=normalizeDraft(current.draft,current.people);if(!draft.rows.length)fail('Ajoutez les employés et leurs heures avant de publier.');
    if(draft.rows.some(r=>r.cells.some(c=>c.kind==='review')))fail('Corrigez toutes les cases à vérifier avant de publier.');
    if(req.body.verified!==true)fail('Confirmez la vérification des noms, dates, heures et pauses.');
    const warnings=await warningsFor({...current,draft},client);if(warnings.length&&req.body.warningsReviewed!==true)fail('Vérifiez les disponibilités et les avertissements avant de publier.');
    return saveWeek(client,current,draft,'publish',publicSnapshot(draft,current.people));
  }))));
  app.post('/api/departments/:id/weeks/:week/unpublish',requireManager,sameOrigin,endpoint(async(req,res)=>res.json(await transaction(async client=>{const current=await getWeek(integer(req.params.id),week(req.params.week),client);checkRevision(req.body,current);return saveWeek(client,current,current.draft,'unpublish',null);}))));
  app.get('/api/departments/:id/weeks/:week/history',requireManager,endpoint(async(req,res)=>res.json({history:(await pool.query('SELECT id,revision,action,created_at FROM schedule_department_history WHERE department_id=$1 AND week_start=$2 ORDER BY id DESC LIMIT 30',[integer(req.params.id),week(req.params.week)])).rows})));
  app.post('/api/departments/:id/weeks/:week/restore',requireManager,sameOrigin,endpoint(async(req,res)=>res.json(await transaction(async client=>{
    const current=await getWeek(integer(req.params.id),week(req.params.week),client);checkRevision(req.body,current);
    const old=(await client.query('SELECT draft FROM schedule_department_history WHERE id=$1 AND department_id=$2 AND week_start=$3',[integer(req.body.historyId),current.department.id,current.weekStart])).rows[0];if(!old)fail('Version introuvable.',404);
    return saveWeek(client,current,normalizeDraft(old.draft,current.people),'restore');
  }))));
  app.post('/api/departments/photos',requireManager,sameOrigin,endpoint(async(req,res)=>{
    const d=await department(req.body.departmentId),start=week(req.body.weekStart),data=validatePhoto(req.body.dataUrl),name=String(req.body.name||'Photo').slice(0,120);
    const result=await transaction(async client=>{const count=(await client.query('SELECT COUNT(*)::int AS n FROM schedule_department_photos WHERE department_id=$1 AND week_start=$2',[d.id,start])).rows[0].n;if(count>=4)fail('Quatre photos sont déjà conservées pour cette semaine.');return (await client.query('INSERT INTO schedule_department_photos(department_id,week_start,name,data_url) VALUES($1,$2,$3,$4) RETURNING id',[d.id,start,name,data])).rows[0];});res.status(201).json({id:Number(result.id)});
  }));
  app.get('/api/departments/photos',requireManager,endpoint(async(req,res)=>res.json({photos:(await pool.query('SELECT id,name,state,created_at,candidate IS NOT NULL AS analyzed FROM schedule_department_photos WHERE department_id=$1 AND week_start=$2 ORDER BY id',[integer(req.query.departmentId),week(req.query.weekStart)])).rows})));
  app.get('/api/departments/photos/:id',requireManager,endpoint(async(req,res)=>{const p=(await pool.query('SELECT * FROM schedule_department_photos WHERE id=$1',[integer(req.params.id)])).rows[0];if(!p)fail('Photo introuvable.',404);res.json({id:Number(p.id),name:p.name,dataUrl:p.data_url,candidate:p.candidate,state:p.state});}));
  app.post('/api/departments/photos/:id/analyze',requireManager,sameOrigin,endpoint(async(req,res)=>{
    if(!process.env.OPENAI_API_KEY)fail('La transcription automatique attend la configuration de la connexion IA. Vous pouvez déjà comparer la photo et saisir les heures.',503);
    const id=integer(req.params.id),operation=crypto.randomUUID();
    const p=(await pool.query("UPDATE schedule_department_photos SET state='processing',operation_id=$2,started_at=clock_timestamp(),attempts=attempts+1 WHERE id=$1 AND attempts<5 AND (state<>'processing' OR started_at<clock_timestamp()-interval '3 minutes') RETURNING *",[id,operation])).rows[0];if(!p)fail('Photo indisponible, lecture déjà en cours ou limite de cinq essais atteinte.',409);
    try{const d=await department(p.department_id),people=await peopleFor(p.department_id);const candidate=await transcribePhoto({dataUrl:p.data_url,department:d.name,weekStart:iso(p.week_start),names:people.map(p=>p.name)},{fetchImpl});await pool.query("UPDATE schedule_department_photos SET state='ready',candidate=$3 WHERE id=$1 AND operation_id=$2",[id,operation,JSON.stringify(candidate)]);res.json({candidate});}
    catch(e){await pool.query("UPDATE schedule_department_photos SET state='saved' WHERE id=$1 AND operation_id=$2",[id,operation]);throw e;}
  }));
  app.post('/api/departments/photos/:id/apply',requireManager,sameOrigin,endpoint(async(req,res)=>res.json(await transaction(async client=>{
    const p=(await client.query('SELECT * FROM schedule_department_photos WHERE id=$1',[integer(req.params.id)])).rows[0];if(!p?.candidate)fail('Aucune transcription à appliquer.');
    const current=await getWeek(Number(p.department_id),iso(p.week_start),client);checkRevision(req.body,current);
    if(req.body.weekConfirmed!==true||req.body.replaceConfirmed!==true)fail('Vérifiez la semaine et confirmez le remplacement des journées des employés sélectionnés.');
    const mapping=req.body.mapping;if(!Array.isArray(mapping)||mapping.length!==p.candidate.rows.length||!mapping.length)fail('Reliez chaque ligne à un employé du répertoire.');
    const incoming=p.candidate.rows.map((row,i)=>({personId:integer(mapping[i]),cells:row.days}));
    const normalized=normalizeDraft({...current.draft,rows:incoming},current.people);
    const rows=current.draft.rows.filter(r=>!normalized.rows.some(n=>n.personId===r.personId)).concat(normalized.rows);
    return saveWeek(client,current,normalizeDraft({...current.draft,rows},current.people),'photo');
  }))));
  app.get('/api/leave/department-schedules',requireStaff,endpoint(async(_req,res)=>{
    const rows=(await pool.query('SELECT d.name,d.schedule_key AS key,w.department_id,w.week_start,w.published_at FROM schedule_department_weeks w JOIN schedule_leave_departments d ON d.id=w.department_id WHERE w.published IS NOT NULL ORDER BY w.week_start DESC,d.name LIMIT 100')).rows;
    const service=(await pool.query('SELECT week_start,token FROM schedule_public_links ORDER BY week_start DESC LIMIT 8')).rows;
    res.json({schedules:rows.map(r=>({departmentId:Number(r.department_id),name:r.name,key:r.key,weekStart:iso(r.week_start),publishedAt:r.published_at})),service:service.map(r=>({weekStart:iso(r.week_start),path:'/h/'+r.token}))});
  }));
  app.get('/api/leave/department-schedules/:id/:week',requireStaff,endpoint(async(req,res)=>{const d=await department(req.params.id),start=week(req.params.week);const row=(await pool.query('SELECT published,published_at FROM schedule_department_weeks WHERE department_id=$1 AND week_start=$2 AND published IS NOT NULL',[d.id,start])).rows[0];if(!row)fail('Cet horaire n’est pas publié.',404);res.json({department:d,weekStart:start,schedule:row.published,publishedAt:row.published_at});}));
  return {directory,getWeek,warningsFor};
}
