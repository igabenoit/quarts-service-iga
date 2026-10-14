import {installDepartmentMail} from './department-mail.js';
import {isScoped,ownsDepartment,assertDepartment} from './manager-access.js';
import crypto from 'node:crypto';
import {installEmployeePortal,saveEmployeeCode} from './employee-portal.js';
import {employeeAvailability} from './availability-rules.js';
import {normalizeEmail,loadContactDirectory} from './employee-contacts.js';
import {comparePeople,DEPARTMENT_STYLES,nameKey,isDate,monday,today,addDays,normalizeAvailability,normalizeDraft,blankCell,draftWarnings,publicSnapshot,totalMinutes,isTimedCell,mergeIncoming,validateAssignment} from './public/departments-core.js';
import {incomingFor,assertTransferSlots} from './department-transfers.js';
import {validatePhoto,transcribePhoto,applyPhotoRules,PHOTO_ANALYSIS_TIMEOUT_MS} from './department-photo.js';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const iso=v=>v instanceof Date?v.toISOString().slice(0,10):v?.slice(0,10)||'';
const integer=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):fail('Identifiant invalide.');
const week=v=>isDate(v)&&monday(v)===v?v:fail('Choisissez le lundi de la semaine.');
const endpoint=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error.status||400).json({error:error.status||!error.code?error.message:'Cette opération n’a pas pu être enregistrée.'});}};

export async function installDepartmentSchedules(app,pool,{requireManager,sameOrigin,requireStaff,fetchImpl=fetch,photoTimeoutMs=PHOTO_ANALYSIS_TIMEOUT_MS+5000}){
  await pool.query(`ALTER TABLE schedule_leave_departments ADD COLUMN IF NOT EXISTS schedule_key TEXT UNIQUE;
    CREATE TABLE IF NOT EXISTS schedule_store_people(id BIGSERIAL PRIMARY KEY,service_employee_id BIGINT UNIQUE,name TEXT NOT NULL,seniority_date DATE,birthday DATE,email TEXT NOT NULL DEFAULT '',employment_group TEXT NOT NULL DEFAULT 'regular' CHECK(employment_group IN('regular','part_time')),availability JSONB NOT NULL DEFAULT '{}',active BOOLEAN NOT NULL DEFAULT TRUE,source_note TEXT NOT NULL DEFAULT '',verified_at TIMESTAMPTZ,version INTEGER NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
    ALTER TABLE schedule_store_people ADD COLUMN IF NOT EXISTS job_title TEXT NOT NULL DEFAULT '';
    ALTER TABLE schedule_store_people ADD COLUMN IF NOT EXISTS specification TEXT NOT NULL DEFAULT '';
    CREATE TABLE IF NOT EXISTS schedule_store_memberships(person_id BIGINT REFERENCES schedule_store_people(id),department_id BIGINT REFERENCES schedule_leave_departments(id),PRIMARY KEY(person_id,department_id));
    ALTER TABLE schedule_store_memberships ADD COLUMN IF NOT EXISTS display_order INTEGER;
    CREATE TABLE IF NOT EXISTS schedule_department_weeks(department_id BIGINT REFERENCES schedule_leave_departments(id),week_start DATE NOT NULL,draft JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 1,published JSONB,published_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(department_id,week_start));
    CREATE TABLE IF NOT EXISTS schedule_department_history(id BIGSERIAL PRIMARY KEY,department_id BIGINT NOT NULL,week_start DATE NOT NULL,revision INTEGER NOT NULL,draft JSONB NOT NULL,published JSONB,action TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE IF NOT EXISTS schedule_department_photos(id BIGSERIAL PRIMARY KEY,department_id BIGINT NOT NULL REFERENCES schedule_leave_departments(id),week_start DATE NOT NULL,name TEXT NOT NULL,data_url TEXT NOT NULL,candidate JSONB,state TEXT NOT NULL DEFAULT 'saved',attempts INTEGER NOT NULL DEFAULT 0,operation_id TEXT,started_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
    ALTER TABLE schedule_department_photos ADD COLUMN IF NOT EXISTS attempt_limit INTEGER NOT NULL DEFAULT 5;
    ALTER TABLE schedule_department_photos ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';
    ALTER TABLE schedule_department_photos ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS schedule_department_photo_week ON schedule_department_photos(department_id,week_start);`);
  const employeePortal=await installEmployeePortal(app,pool,{sameOrigin,requireManager});
  const existing=(await pool.query('SELECT * FROM schedule_leave_departments')).rows;
  for(const style of DEPARTMENT_STYLES){
    let d=existing.find(d=>d.schedule_key===style.key)||existing.find(d=>nameKey(d.name)===nameKey(style.name));
    if(d)await pool.query('UPDATE schedule_leave_departments SET schedule_key=$1 WHERE id=$2 AND schedule_key IS NULL',[style.key,d.id]);
    else await pool.query('INSERT INTO schedule_leave_departments(name,schedule_key) VALUES($1,$2) ON CONFLICT(schedule_key) DO NOTHING',[style.name,style.key]);
  }
  await pool.query("UPDATE schedule_leave_departments SET schedule_key='service' WHERE code='service' AND schedule_key IS NULL");
  await installDepartmentMail(app,pool,{requireManager,sameOrigin,fetchImpl});
  app.use('/api/departments',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const listDepartments=async client=>(await client.query('SELECT id,name,schedule_key AS key,active FROM schedule_leave_departments WHERE schedule_key IS NOT NULL ORDER BY name')).rows.map(d=>({...d,id:Number(d.id)}));
  const department=async(id,client=pool)=>{const d=(await listDepartments(client)).find(d=>d.id===integer(id));if(!d||d.key==='service')fail('Utilisez l’horaire Service pour ce département.');return d;};
  async function directory(client=pool,weekStart){
    await client.query("INSERT INTO schedule_store_people(service_employee_id,name) SELECT id,name FROM schedule_employees ON CONFLICT(service_employee_id) DO NOTHING");
    await client.query("INSERT INTO schedule_store_memberships(person_id,department_id) SELECT p.id,d.id FROM schedule_store_people p CROSS JOIN schedule_leave_departments d WHERE p.service_employee_id IS NOT NULL AND d.code='service' ON CONFLICT DO NOTHING");
    const records=(await client.query('SELECT p.*,e.name AS service_name,e.seniority AS service_seniority,e.active AS service_active,e.departed_at,e.availability AS service_availability,e.availability_history,e.target_minutes FROM schedule_store_people p LEFT JOIN schedule_employees e ON e.id=p.service_employee_id ORDER BY p.id')).rows;
    const memberships=(await client.query('SELECT * FROM schedule_store_memberships')).rows;
    const contacts=records.some(r=>r.service_employee_id)?await loadContactDirectory(client):{employees:[]};
    const people=records.map(r=>{
      const service=!!r.service_employee_id;
      const a=service?employeeAvailability({availability:r.service_availability,availability_history:r.availability_history,target_minutes:r.target_minutes},weekStart).availability:null;
      return {id:Number(r.id),serviceEmployeeId:r.service_employee_id?Number(r.service_employee_id):null,name:service?(r.service_name||r.name):r.name,jobTitle:r.job_title||'',specification:r.specification||'',seniorityDate:service?(!r.service_seniority||r.service_seniority==='9999-12-31'?'':r.service_seniority):iso(r.seniority_date),birthday:iso(r.birthday),employeeCode:r.employee_code||'',email:service?contacts.employees.find(e=>e.id===Number(r.service_employee_id))?.email||r.email:r.email,group:r.employment_group,availability:service?Object.fromEntries(Array.from({length:7},(_,d)=>[d,(a[d]||[]).length?a[d].map(([s,e])=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}-${String(Math.floor(e/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')}`).join(', '):'0'])):normalizeAvailability(r.availability),active:service?Boolean(r.service_name&&r.service_active&&!r.departed_at):r.active,sourceNote:r.source_note,verifiedAt:r.verified_at,version:r.version,displayPriorities:Object.fromEntries(memberships.filter(m=>Number(m.person_id)===Number(r.id)&&m.display_order!==null).map(m=>[m.department_id,Number(m.display_order)])),departments:memberships.filter(m=>Number(m.person_id)===Number(r.id)).map(m=>Number(m.department_id))};
    });
    // Compact the visible ranks, including changes inherited from Service.
    for(const departmentId of new Set(memberships.map(m=>Number(m.department_id))))for(const group of ['regular','part_time']){
      const members=people.filter(p=>p.active&&p.group===group&&p.departments.includes(departmentId)).sort((a,b)=>comparePeople(a,b,departmentId));
      for(const p of people.filter(p=>!p.active))delete p.displayPriorities[departmentId];
      members.forEach((p,i)=>p.displayPriorities[departmentId]=i+1);
    }
    return people;
  }
  const peopleFor=async(id,client=pool,weekStart)=>(await directory(client,weekStart)).filter(p=>p.departments.includes(Number(id))).sort((a,b)=>comparePeople(a,b,id));
  const emptyDraft=people=>({manager:'',notes:'',rows:people.filter(p=>p.active).map(p=>({personId:p.id,cells:Array.from({length:7},blankCell)}))});
  const transferWeeks=async(start,client=pool)=>(await client.query('SELECT w.*,d.schedule_key AS key,d.name FROM schedule_department_weeks w JOIN schedule_leave_departments d ON d.id=w.department_id WHERE w.week_start=$1',[start])).rows;
  async function getWeek(id,start,client=pool){
    const members=await peopleFor(id,client,start),d=await department(id,client),weeks=await transferWeeks(start,client),row=weeks.find(w=>Number(w.department_id)===Number(id));
    const incoming=incomingFor(weeks,d.key),guestIds=new Set(incoming.map(i=>i.personId)),people=[...members];
    if(guestIds.size)for(const p of await directory(client,start))if(guestIds.has(p.id)&&!people.some(m=>m.id===p.id))people.push({...p,visiting:true});
    return {department:d,weekStart:start,people,incoming,draft:row?.draft||emptyDraft(members),revision:row?.revision||0,publishedAt:row?.published_at||null,published:row?.published||null};
  }
  async function transaction(fn){const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  async function saveWeek(client,current,draft,action,published=current.published){
    for(const row of draft.rows)for(const cell of row.cells)validateAssignment(cell,current.department.key);
    const weeks=await transferWeeks(current.weekStart,client),changed={department_id:current.department.id,key:current.department.key,draft,published};
    assertTransferSlots([...weeks.filter(w=>Number(w.department_id)!==current.department.id),changed]);
    const revision=current.revision+1;
    if(current.revision)await client.query('INSERT INTO schedule_department_history(department_id,week_start,revision,draft,published,action) VALUES($1,$2,$3,$4,$5,$6)',[current.department.id,current.weekStart,current.revision,JSON.stringify(current.draft),JSON.stringify(current.published),action]);
    await client.query(`INSERT INTO schedule_department_weeks(department_id,week_start,draft,revision,published,published_at) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(department_id,week_start) DO UPDATE SET draft=EXCLUDED.draft,revision=EXCLUDED.revision,published=EXCLUDED.published,published_at=EXCLUDED.published_at,updated_at=clock_timestamp()`,[current.department.id,current.weekStart,JSON.stringify(draft),revision,published?JSON.stringify(published):null,action==='publish'?new Date():action==='unpublish'?null:current.publishedAt]);
    return {revision};
  }
  const checkRevision=(body,current)=>{if(!Number.isInteger(body.revision)||body.revision!==current.revision)fail('La feuille a changé. Rechargez-la avant d’enregistrer pour conserver les modifications récentes.',409);};
  async function warningsFor(current,client=pool){
    const display=mergeIncoming(current.draft,current.incoming);
    const warnings=draftWarnings(display,current.people);
    // Compare real intervals, including Sunday nights across the week boundary.
    const minute=(date,n=0)=>Date.parse(iso(date)+'T00:00:00Z')/60000+Number(n);
    const overlaps=(start,end,otherStart,otherEnd)=>start<otherEnd&&otherStart<end;
    const previous=addDays(current.weekStart,-7),next=addDays(current.weekStart,7);
    const others=(await client.query('SELECT d.name,d.schedule_key AS key,w.week_start,w.published FROM schedule_department_weeks w JOIN schedule_leave_departments d ON d.id=w.department_id WHERE week_start BETWEEN $1 AND $2 AND (week_start<>$3 OR department_id<>$4) AND published IS NOT NULL',[previous,next,current.weekStart,current.department.id])).rows;
    for(const row of display.rows)for(let day=0;day<7;day++){
      const c=row.cells[day];if(!isTimedCell(c))continue;
      const date=addDays(current.weekStart,day),start=minute(date,c.start),end=minute(date,c.end);
      for(const other of others){
        if(iso(other.week_start)===current.weekStart&&(c.sourceDepartment||current.department.key)===other.key)continue;
        const match=other.published.rows.find(r=>r.personId===row.personId);if(!match)continue;
        if(match.cells.some((cell,d)=>isTimedCell(cell)&&overlaps(start,end,minute(other.week_start,d*1440+cell.start),minute(other.week_start,d*1440+cell.end))))warnings.push((current.people.find(p=>p.id===row.personId)?.name||'Employé retiré')+' : chevauchement avec '+other.name+', le '+date+'.');
      }
    }
    const relevantKeys=[...new Set([current.department.key,...display.rows.flatMap(r=>r.cells.flatMap(c=>[c.workDepartment,c.sourceDepartment].filter(Boolean)))])];
    const leaves=(await client.query("SELECT l.employee_name,l.periods,l.effective_periods,d.schedule_key AS key FROM schedule_leave_requests l JOIN schedule_leave_departments d ON d.id=l.department_id WHERE d.schedule_key=ANY($1::text[]) AND l.status='approved' AND l.is_test=FALSE AND l.archived_at IS NULL AND l.first_date<=$3 AND l.last_date>=$2",[relevantKeys,current.weekStart,next])).rows;
    const assignments=(await client.query('SELECT a.employee_id,s.week_start,s.day_index,s.start_minute,s.end_minute FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id WHERE s.week_start BETWEEN $1 AND $2',[previous,next])).rows;
    for(const row of display.rows){
      const p=current.people.find(p=>p.id===row.personId);if(!p)continue;
      for(let day=0;day<7;day++){
        const c=row.cells[day];if(!isTimedCell(c))continue;
        const date=addDays(current.weekStart,day),start=minute(date,c.start),end=minute(date,c.end);
        for(const leave of leaves.filter(l=>nameKey(l.employee_name)===nameKey(p.name)&&[current.department.key,c.workDepartment,c.sourceDepartment].includes(l.key)))for(const period of leave.effective_periods||leave.periods){
          if(overlaps(start,end,minute(period.date,period.startMinute),minute(period.date,period.endMinute)))warnings.push(p.name+' : congé approuvé à vérifier le '+period.date+'.');
        }
        if(p.serviceEmployeeId&&assignments.some(a=>Number(a.employee_id)===p.serviceEmployeeId&&overlaps(start,end,minute(a.week_start,a.day_index*1440+a.start_minute),minute(a.week_start,a.day_index*1440+a.end_minute))))warnings.push(p.name+' : chevauchement avec un quart du Service, le '+date+'.');
      }
    }
    return [...new Set(warnings)];
  }
  app.get('/api/departments/meta',requireManager,endpoint(async(req,res)=>res.json({departments:(await listDepartments(pool)).filter(d=>ownsDepartment(req,d.id)),people:(await directory()).filter(p=>p.departments.some(id=>ownsDepartment(req,id))),visionConfigured:Boolean(process.env.OPENAI_API_KEY),publicPath:'/horaires-departements',account:req.manager||{kind:'admin'}})));
  app.post('/api/departments/personal-import',requireManager,sameOrigin,endpoint(async(req,res)=>{
    if(isScoped(req))fail('Import réservé à l’administration.',403);
    const entries=req.body?.entries;if(!Array.isArray(entries)||!entries.length||entries.length>300)fail('Liste invalide.');
    res.json(await transaction(async client=>{
      const people=await directory(client),ids=new Set(),codes=new Set();
      for(const entry of entries){
        if(Object.keys(entry).some(k=>!['id','version','employeeCode','birthday'].includes(k)))fail('Seuls le code et la date de naissance sont acceptés.');
        const person=people.find(p=>p.id===entry.id);if(!person||ids.has(entry.id))fail('Fiche absente ou répétée.');ids.add(entry.id);
        if(person.version!==entry.version)fail('Une fiche a changé. Recommencez la vérification.',409);
        if(typeof entry.employeeCode!=='string'||!/^\d{6}$/.test(entry.employeeCode)||codes.has(entry.employeeCode))fail('Code invalide ou répété.');codes.add(entry.employeeCode);
        if(typeof entry.birthday!=='string'||!isDate(entry.birthday)||entry.birthday>today()||entry.birthday<'1900-01-01')fail('Date de naissance invalide.');
        await saveEmployeeCode(client,entry.id,entry.employeeCode);
        await client.query('UPDATE schedule_store_people SET birthday=$1,version=version+1,updated_at=clock_timestamp() WHERE id=$2',[entry.birthday,entry.id]);
      }
      return {updated:entries.length};
    }));
  }));
  app.post('/api/departments/people',requireManager,sameOrigin,endpoint(async(req,res)=>res.json(await savePerson(req.body,undefined,req))));
  app.put('/api/departments/people/:id',requireManager,sameOrigin,endpoint(async(req,res)=>res.json(await savePerson(req.body,integer(req.params.id),req))));
  async function savePerson(body,id,req){return transaction(async client=>{
    const list=await directory(client),previous=id?list.find(p=>p.id===id):null;
    if(id&&!previous)fail('Employé introuvable.',404);
    if(isScoped(req)){
      for(const departmentId of body.departments||[])assertDepartment(req,departmentId);
      if(previous&&!previous.departments.every(departmentId=>ownsDepartment(req,departmentId)))fail('Cette fiche est commune à plusieurs départements. L’administration doit modifier les renseignements partagés; vous pouvez gérer ses quarts dans votre département.',403);
    }
    if(previous&&body.version!==previous.version)fail('Cette fiche a changé. Rechargez le répertoire.',409);
    const name=String(body.name||'').trim(),email=normalizeEmail(body.email),source=String(body.sourceNote||'').trim();
    if(name.length<2||name.length>100||body.email&&!email||source.length>200)fail('Vérifiez le nom, le courriel et la source de l’ancienneté.');
    const titleValue=body.jobTitle===undefined?previous?.jobTitle||'':body.jobTitle;
    if(titleValue!==null&&typeof titleValue!=='string')fail('Le titre doit être du texte.');
    const jobTitle=(titleValue||'').trim().replace(/\s+/g,' ');
    if(jobTitle.length>80)fail('Le titre doit contenir au plus 80 caractères.');
    const specValue=body.specification===undefined?previous?.specification||'':body.specification;
    if(specValue!==null&&typeof specValue!=='string')fail('La spécification doit être du texte.');
    const specification=(specValue||'').trim().replace(/\s+/g,' ');
    if(specification.length>80)fail('La spécification doit contenir au plus 80 caractères.');
    const seniority=body.seniorityDate||'',birthday=body.birthday||'';
    if([seniority,birthday].some(v=>v&&(!isDate(v)||v>today()||v<'1900-01-01')))fail('Indiquez des dates réelles, non futures.');
    if(seniority&&!previous?.serviceEmployeeId&&(!source||body.seniorityVerified!==true))fail('Confirmez la date d’ancienneté et indiquez sa source.');
    if(!['regular','part_time'].includes(body.group)||typeof body.active!=='boolean')fail('Statut d’emploi invalide.');
    const departments=await listDepartments(client),ids=Array.isArray(body.departments)?[...new Set(body.departments.map(Number))]:[];
    if(!ids.length||ids.some(id=>!departments.some(d=>d.id===id)))fail('Choisissez au moins un département.');
    if(!previous?.serviceEmployeeId&&ids.some(id=>departments.find(d=>d.id===id).key==='service'))fail('Ajoutez les employés du Service depuis leur section existante, puis utilisez leur fiche dans ce répertoire.');
    if(previous?.serviceEmployeeId){const serviceId=departments.find(d=>d.key==='service').id;if(!ids.includes(serviceId))ids.push(serviceId);}
    const availability=normalizeAvailability(body.availability||{});
    const args=[previous?.serviceEmployeeId?previous.name:name,previous?.serviceEmployeeId?null:seniority||null,birthday||null,email,body.group,JSON.stringify(availability),body.active,source,seniority&&body.seniorityVerified?new Date():null,jobTitle,specification];
    let saved;
    if(id)saved=(await client.query('UPDATE schedule_store_people SET name=$1,seniority_date=$2,birthday=$3,email=$4,employment_group=$5,availability=$6,active=$7,source_note=$8,verified_at=$9,job_title=$10,specification=$11,version=version+1,updated_at=clock_timestamp() WHERE id=$12 RETURNING id',[...args,id])).rows[0];
    else{if(list.some(p=>nameKey(p.name)===nameKey(name))&&body.distinctPerson!==true)fail('Un nom identique existe déjà. Utilisez sa fiche pour ajouter un département, ou confirmez qu’il s’agit d’une autre personne.',409);saved=(await client.query('INSERT INTO schedule_store_people(name,seniority_date,birthday,email,employment_group,availability,active,source_note,verified_at,job_title,specification) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',args)).rows[0];}
    await saveEmployeeCode(client,saved.id,body.employeeCode);
    if(previous?.serviceEmployeeId&&!(await client.query('SELECT 1 FROM schedule_employees WHERE id=$1',[previous.serviceEmployeeId])).rows.length)fail('La fiche Service a été annulée. Réactualisez le répertoire.',409);
    if(previous?.serviceEmployeeId)await client.query('INSERT INTO schedule_employee_contacts(employee_id,email) VALUES($1,$2) ON CONFLICT(employee_id) DO UPDATE SET email=EXCLUDED.email,updated_at=clock_timestamp()',[previous.serviceEmployeeId,email]);
    const priorities=body.displayPriorities??{};
    if(typeof priorities!=='object'||Array.isArray(priorities)||Object.entries(priorities).some(([key,value])=>!ids.includes(Number(key))||!Number.isSafeInteger(value)||value<1))fail('La priorité doit être un rang entier à partir de 1 dans un département sélectionné.');
    await client.query('DELETE FROM schedule_store_memberships WHERE person_id=$1 AND NOT (department_id=ANY($2::bigint[]))',[saved.id,ids]);
    for(const departmentId of ids)await client.query('INSERT INTO schedule_store_memberships(person_id,department_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[saved.id,departmentId]);
    const personId=Number(saved.id),active=previous?.serviceEmployeeId?previous.active:body.active;
    const changed=new Set();
    for(const departmentId of new Set([...(previous?.departments||[]),...ids])){
      if(departments.find(d=>d.id===departmentId)?.key==='service')continue;
      for(const group of ['regular','part_time']){
        const members=list.filter(p=>p.id!==personId&&p.active&&p.group===group&&p.departments.includes(departmentId)).sort((a,b)=>comparePeople(a,b,departmentId));
        if(active&&body.group===group&&ids.includes(departmentId)){
          const retained=previous?.active&&previous.group===group&&previous.departments.includes(departmentId);
          const rank=priorities[departmentId]??(retained?previous.displayPriorities[departmentId]:members.length+1);
          members.splice(Math.min(rank-1,members.length),0,{id:personId});
        }
        for(const [index,p] of members.entries()){
          await client.query('UPDATE schedule_store_memberships SET display_order=$3 WHERE person_id=$1 AND department_id=$2',[p.id,departmentId,index+1]);
          if(p.id!==personId&&p.displayPriorities[departmentId]!==index+1)changed.add(p.id);
        }
      }
      if(!active)await client.query('UPDATE schedule_store_memberships SET display_order=NULL WHERE person_id=$1 AND department_id=$2',[personId,departmentId]);
    }
    // A stale employee form must not silently undo another manager's move.
    if(changed.size)await client.query('UPDATE schedule_store_people SET version=version+1,updated_at=clock_timestamp() WHERE id=ANY($1::bigint[])',[[...changed]]);
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
    const draft=normalizeDraft(current.draft,current.people);if(!draft.rows.length&&!current.incoming.length)fail('Ajoutez les employés et leurs heures avant de publier.');
    if(draft.rows.some(r=>r.cells.some(c=>c.kind==='review')))fail('Corrigez toutes les cases à vérifier avant de publier.');
    if(req.body.verified!==true)fail('Confirmez la vérification des noms, dates, heures et pauses.');
    const warnings=await warningsFor({...current,draft},client);if(warnings.length&&req.body.warningsReviewed!==true)fail('Vérifiez les disponibilités et les avertissements avant de publier.');
    return saveWeek(client,current,draft,'publish',publicSnapshot(draft,current.people,current.department.id));
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
  const photoState=p=>{const attempts=Number(p.attempts),attemptLimit=Number(p.attempt_limit),remainingAttempts=Math.max(0,attemptLimit-attempts),elapsedSeconds=p.started_at?Math.max(0,Math.floor((Date.now()-new Date(p.started_at).getTime())/1000)):0,retryAfterSeconds=p.state==='processing'&&p.started_at?Math.max(0,300-elapsedSeconds):0;return {id:Number(p.id),name:p.name,state:p.state,phase:p.phase||'reading',attempts,attemptLimit,remainingAttempts,busy:retryAfterSeconds>0,elapsedSeconds,retryAfterSeconds,lastError:p.last_error||'',candidate:applyPhotoRules(p.candidate)};};
  async function readPhoto(id,withImage=false){
    // A restart must not leave a photo permanently marked as processing, nor erase a saved proposal.
    await pool.query("UPDATE schedule_department_photos SET state=CASE WHEN candidate IS NULL THEN 'saved' ELSE 'ready' END,phase='',operation_id=NULL,last_error='La lecture a été interrompue ou a dépassé le délai de cinq minutes. Toute proposition déjà reçue est conservée. Vous pouvez la vérifier ou relancer la lecture.' WHERE id=$1 AND state='processing' AND (started_at IS NULL OR started_at<clock_timestamp()-interval '5 minutes')",[id]);
    const columns='id,name,state,phase,attempts,attempt_limit,started_at,last_error,candidate';
    const p=(await pool.query(`SELECT ${columns}${withImage?',data_url':''} FROM schedule_department_photos WHERE id=$1`,[id])).rows[0];if(!p)fail('Photo introuvable. Actualisez la liste des photos.',404);return p;
  }
  const photoBlocked=p=>{const state=photoState(p);if(state.busy)fail('Une lecture de cette photo est déjà en cours. Cliquez sur « Actualiser la lecture » pour récupérer son résultat. Une reprise sera possible dans au plus '+state.retryAfterSeconds+' secondes si la lecture a été interrompue.',409);if(!state.remainingAttempts)fail('Les '+state.attemptLimit+' essais autorisés pour cette photo ont été utilisés, y compris les lectures échouées. Cliquez sur « Autoriser 5 essais de plus » pour pouvoir la relire.',409);fail('L’état de la photo a changé. Actualisez la lecture avant de réessayer.',409);};
  app.get('/api/departments/photos',requireManager,endpoint(async(req,res)=>res.json({photos:(await pool.query('SELECT id,name,state,created_at,candidate IS NOT NULL AS analyzed FROM schedule_department_photos WHERE department_id=$1 AND week_start=$2 ORDER BY id',[integer(req.query.departmentId),week(req.query.weekStart)])).rows})));
  app.get('/api/departments/photos/:id',requireManager,endpoint(async(req,res)=>{const p=await readPhoto(integer(req.params.id),true);res.json({...photoState(p),dataUrl:p.data_url});}));
  app.get('/api/departments/photos/:id/status',requireManager,endpoint(async(req,res)=>res.json(photoState(await readPhoto(integer(req.params.id))))));
  app.post('/api/departments/photos/:id/extend-attempts',requireManager,sameOrigin,endpoint(async(req,res)=>{
    const id=integer(req.params.id);if(!Number.isSafeInteger(req.body.attemptLimit)||req.body.attemptLimit<5)fail('Actualisez la lecture avant d’autoriser de nouveaux essais.');
    const p=(await pool.query("UPDATE schedule_department_photos SET attempt_limit=attempt_limit+5 WHERE id=$1 AND attempt_limit=$2 AND attempts>=attempt_limit AND (state<>'processing' OR started_at IS NULL OR started_at<clock_timestamp()-interval '5 minutes') RETURNING *",[id,req.body.attemptLimit])).rows[0];
    if(!p){const current=await readPhoto(id);if(photoState(current).busy)photoBlocked(current);fail('Des essais sont déjà disponibles ou le compteur a changé. Actualisez la lecture.',409);}
    res.json(photoState(p));
  }));
  app.post('/api/departments/photos/:id/analyze',requireManager,sameOrigin,endpoint(async(req,res)=>{
    if(!process.env.OPENAI_API_KEY)fail('La transcription automatique attend la configuration de la connexion IA. Vous pouvez déjà comparer la photo et saisir les heures.',503);
    const id=integer(req.params.id),operation=crypto.randomUUID();
    const p=(await pool.query("UPDATE schedule_department_photos SET state='processing',phase='reading',operation_id=$2,started_at=clock_timestamp(),attempts=attempts+1,last_error='' WHERE id=$1 AND attempts<attempt_limit AND (state<>'processing' OR started_at IS NULL OR started_at<clock_timestamp()-interval '5 minutes') RETURNING *",[id,operation])).rows[0];if(!p)photoBlocked(await readPhoto(id));
    async function run(){
      let timer;
      try{
        const work=(async()=>{
          const d=await department(p.department_id),people=await peopleFor(p.department_id);
          return transcribePhoto({dataUrl:p.data_url,department:d.name,weekStart:iso(p.week_start),names:people.map(p=>p.name)},{fetchImpl,onFirstPass:async first=>{
            const proposal={...first,warnings:['Première lecture conservée : la seconde vérification n’est pas encore terminée. Comparez chaque case à la photo.',...first.warnings],analysis:{...first.analysis,verification:'partial'}};
            const saved=await pool.query("UPDATE schedule_department_photos SET candidate=$3,phase='verifying' WHERE id=$1 AND operation_id=$2 RETURNING id",[id,operation,JSON.stringify(proposal)]);
            if(!saved.rowCount)fail('Une autre lecture a repris cette photo. Actualisez la lecture pour récupérer le résultat courant.',409);
          }});
        })();
        const candidate=await Promise.race([work,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('La lecture a dépassé le délai prévu. Toute proposition déjà reçue est conservée; vérifiez-la ci-dessous avant de relancer.')),photoTimeoutMs);})]);
        const saved=await pool.query("UPDATE schedule_department_photos SET state='ready',phase='',candidate=$3,last_error='',operation_id=NULL WHERE id=$1 AND operation_id=$2 RETURNING id",[id,operation,JSON.stringify(candidate)]);
        if(!saved.rowCount)fail('Une autre lecture a repris cette photo. Actualisez la lecture pour récupérer le résultat courant.',409);
        return candidate;
      }catch(e){await pool.query("UPDATE schedule_department_photos SET state=CASE WHEN candidate IS NULL THEN 'saved' ELSE 'ready' END,phase='',last_error=$3,operation_id=NULL WHERE id=$1 AND operation_id=$2",[id,operation,String(e.message||'La lecture a échoué. Réessayez plus tard.').slice(0,600)]);throw e;}
      finally{clearTimeout(timer);}
    }
    if(req.body.background===true){
      res.status(202).json(photoState(p));
      // The job and its saved result are independent of the browser's HTTP connection.
      void run().catch(()=>{}); // User-facing failure is persisted by run(), then returned by /status.
    }else res.json({candidate:await run()}); // Compatibility with an already-open older page.
  }));
  app.post('/api/departments/photos/:id/apply',requireManager,sameOrigin,endpoint(async(req,res)=>res.json(await transaction(async client=>{
    const p=(await client.query('SELECT * FROM schedule_department_photos WHERE id=$1',[integer(req.params.id)])).rows[0];if(p?.candidate)p.candidate=applyPhotoRules(p.candidate);if(!p?.candidate)fail('Aucune transcription à appliquer.');
    if(photoState(p).busy)fail('Une lecture de cette photo est encore en cours. Actualisez la lecture lorsqu’elle est terminée avant de reporter la proposition.',409);
    if(req.body.departmentId!==undefined&&Number(req.body.departmentId)!==Number(p.department_id)||req.body.weekStart!==undefined&&req.body.weekStart!==iso(p.week_start))fail('Cette photo appartient à un autre département ou à une autre semaine. Rouvrez-la depuis sa feuille avant de reporter.',409);
    const current=await getWeek(Number(p.department_id),iso(p.week_start),client);checkRevision(req.body,current);
    if(req.body.weekConfirmed!==true||req.body.replaceConfirmed!==true)fail('Vérifiez la semaine et confirmez le remplacement des journées des employés sélectionnés.');
    const mapping=req.body.mapping;if(!Array.isArray(mapping)||mapping.length!==p.candidate.rows.length||!mapping.length)fail('Reliez chaque ligne à un employé du répertoire.');
    const missing=p.candidate.rows.filter((_row,i)=>mapping[i]!==null&&!current.people.some(person=>person.id===Number(mapping[i])));if(missing.length)fail('Choisissez la fiche employé, ou « Ne pas reporter cette ligne », pour : '+missing.map(row=>row.name||'Nom illisible').join(', ')+'.');
    const ids=mapping.filter(id=>id!==null).map(Number);if(!ids.length)fail('Sélectionnez au moins un employé à reporter.');
    const duplicate=ids.find((id,i)=>ids.indexOf(id)!==i);if(duplicate)fail('La fiche de '+current.people.find(person=>person.id===duplicate).name+' est sélectionnée sur plusieurs lignes. Chaque ligne doit correspondre à un employé différent.');
    const incoming=p.candidate.rows.flatMap((row,i)=>mapping[i]===null?[]:[{personId:integer(mapping[i]),cells:row.days}]);
    const normalized=normalizeDraft({...current.draft,rows:incoming},current.people);
    const rows=current.draft.rows.filter(r=>!normalized.rows.some(n=>n.personId===r.personId)).concat(normalized.rows);
    return saveWeek(client,current,normalizeDraft({...current.draft,rows},current.people),'photo');
  }))));
  app.get('/api/leave/department-schedules',employeePortal.requireEmployee,endpoint(async(req,res)=>{
    const rows=(await pool.query('SELECT d.name,d.schedule_key AS key,w.department_id,w.week_start,w.published_at,w.published FROM schedule_department_weeks w JOIN schedule_leave_departments d ON d.id=w.department_id WHERE w.published IS NOT NULL ORDER BY w.week_start DESC,d.name LIMIT 100')).rows;
    const departments=await listDepartments(pool),schedules=new Map();
    for(const r of rows){
      if(req.employee&&!r.published.rows.some(row=>row.personId===Number(req.employee.id)))continue;
      const keys=new Set([r.key,...r.published.rows.flatMap(row=>row.cells.filter(c=>isTimedCell(c)&&c.workDepartment).map(c=>c.workDepartment))]);
      for(const key of keys){const d=departments.find(d=>d.key===key);if(!d)continue;const k=iso(r.week_start)+':'+d.id,previous=schedules.get(k);if(!previous||new Date(previous.publishedAt)<new Date(r.published_at))schedules.set(k,{departmentId:d.id,name:d.name,key,weekStart:iso(r.week_start),publishedAt:r.published_at});}
    }
    const service=(await pool.query('SELECT week_start,token FROM schedule_public_links ORDER BY week_start DESC LIMIT 8')).rows;
    res.json({schedules:[...schedules.values()].sort((a,b)=>b.weekStart.localeCompare(a.weekStart)||a.name.localeCompare(b.name,'fr-CA')),service:(req.employee&&!req.employee.service_employee_id?[]:service).map(r=>({weekStart:iso(r.week_start),path:'/h/'+r.token}))});
  }));
  app.get('/api/leave/department-schedules/:id/:week',employeePortal.requireEmployee,endpoint(async(req,res)=>{
    const d=await department(req.params.id),start=week(req.params.week),weeks=await transferWeeks(start),row=weeks.find(w=>Number(w.department_id)===d.id),incoming=incomingFor(weeks,d.key,{published:true});
    if(!row?.published&&!incoming.length)fail('Cet horaire n’est pas publié.',404);
    const schedule=mergeIncoming(row?.published||{rows:[],notes:''},incoming),dates=[row?.published_at,...incoming.map(i=>i.publishedAt)].filter(Boolean).map(v=>new Date(v).getTime());
    const publishedAt=new Date(Math.max(...dates)).toISOString();
    if(req.employee){
      schedule.rows=schedule.rows.filter(r=>r.personId===Number(req.employee.id));
      if(!schedule.rows.length)fail('Aucun horaire personnel disponible pour cette semaine.',404);
      schedule.notes=''; // Team notes may mention other employees.
      for(const r of schedule.rows)r.birthdayMonthDay=iso(req.employee.birthday).slice(5);
      await pool.query(`INSERT INTO schedule_department_views(department_id,week_start,person_id,published_at) VALUES($1,$2,$3,$4) ON CONFLICT(department_id,week_start,person_id,published_at) DO UPDATE SET last_viewed_at=clock_timestamp(),view_count=schedule_department_views.view_count+1`,[d.id,start,req.employee.id,publishedAt]);
    }
    res.json({department:d,weekStart:start,schedule,publishedAt});
  }));
  app.get('/api/departments/:id/weeks/:week/views',requireManager,endpoint(async(req,res)=>{
    assertDepartment(req,integer(req.params.id));const current=await getWeek(req.params.id,week(req.params.week));
    const views=(await pool.query('SELECT * FROM schedule_department_views WHERE department_id=$1 AND week_start=$2 AND published_at=$3',[current.department.id,current.weekStart,current.publishedAt])).rows;
    res.json({publishedAt:current.publishedAt,employees:(current.published?.rows||[]).map(r=>{const v=views.find(v=>Number(v.person_id)===r.personId);return {name:r.name,personId:r.personId,lastViewedAt:v?.last_viewed_at||null,count:v?.view_count||0};})});
  }));
  return {directory,getWeek,warningsFor,employeePortal};
}
