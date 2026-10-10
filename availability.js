import {createHash} from 'node:crypto';
import {beginUndo} from './undo.js';
import {addDays,isDate} from './leave-rules.js';
import {normalizeAvailability,localDate,minimumEffectiveDate,historyOf,appendAvailability,profileAt,RULE_VERSION,MAX_TARGET} from './availability-rules.js';
import {installAvailabilityMail} from './availability-mail.js';
import {nameKey} from './employee-contacts.js';
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
async function externalHistory(client,departmentId,employeeNameKey){
  return (await client.query(`SELECT id,status,effective_date::text AS effective_date FROM schedule_availability_requests
    WHERE department_id=$1 AND employee_name_key=$2 AND employee_id IS NULL AND is_test=FALSE AND status IN ('pending','approved')
    ORDER BY effective_date,id`,[departmentId,employeeNameKey])).rows;
}
function externalMinimum(rows,today){const last=rows.filter(r=>r.status==='approved').at(-1);return last&&addDays(last.effective_date,28)>today?addDays(last.effective_date,28):today;}
export const availabilityRevision=(row,date=localDate())=>createHash('sha256').update(JSON.stringify(stable([row.availability,row.target_minutes,historyOf(row),profileAt(row,date)]))).digest('hex');
export async function saveAvailabilityHistory(client,id,history){
  const last=history.at(-1);
  await client.query('UPDATE schedule_employees SET availability=$1::jsonb,target_minutes=$2,availability_history=$3::jsonb WHERE id=$4',[JSON.stringify(last.availability),last.targetMinutes,JSON.stringify(history),id]);
}
export async function recordManualAvailability(client,row,normalized,body){
  if(historyOf(row).length&&body.availabilityRevision!==availabilityRevision(row))throw new Error('Les disponibilités ont changé. Actualisez la page avant d’enregistrer cette fiche.');
  const today=localDate((await client.query('SELECT clock_timestamp() AS now')).rows[0].now),current=profileAt(row,today);
  if(same(current.availability,normalized.availability)&&current.targetMinutes===normalized.targetMinutes)return historyOf(row);
  if(historyOf(row).some(v=>v.effectiveDate>today))throw new Error('Une disponibilité future est déjà approuvée. Annulez-la dans le suivi des disponibilités avant de changer cette grille.');
  return appendAvailability(row,{effectiveDate:today,availability:normalized.availability,targetMinutes:normalized.targetMinutes,source:'manager'});
}
export async function availabilityConflicts(pool,today){
  const rows=(await pool.query(`SELECT a.employee_id,e.name,e.availability,e.target_minutes,e.availability_history,s.id,s.week_start::text,s.day_index,s.start_minute,s.end_minute
    FROM schedule_assignments a JOIN schedule_employees e ON e.id=a.employee_id JOIN schedule_shifts s ON s.id=a.shift_id WHERE s.week_start+s.day_index >= $1::date ORDER BY s.week_start,s.day_index,e.name`,[today])).rows;
  return rows.filter(r=>historyOf(r).length&&!profileAt(r,addDays(r.week_start,r.day_index)).availability[r.day_index]?.some(([a,b])=>a<=r.start_minute&&b>=r.end_minute)).map(r=>({employeeId:Number(r.employee_id),name:r.name,shiftId:Number(r.id),date:addDays(r.week_start,r.day_index),startMinute:r.start_minute,endMinute:r.end_minute}));
}
export async function installAvailability(app,pool,{requireManager,sameOrigin,requireStaff}){
  await pool.query(`ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS availability_history JSONB NOT NULL DEFAULT '[]'::jsonb;
    CREATE TABLE IF NOT EXISTS schedule_availability_requests (
    id BIGSERIAL PRIMARY KEY,submission_key UUID NOT NULL UNIQUE,employee_id BIGINT REFERENCES schedule_employees(id),employee_name TEXT NOT NULL,email TEXT NOT NULL,
    effective_date DATE NOT NULL,target_minutes INTEGER NOT NULL,availability JSONB NOT NULL,acknowledged BOOLEAN NOT NULL CHECK(acknowledged),rule_version TEXT NOT NULL,
    comments TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','refused','cancelled')),is_test BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),decided_at TIMESTAMPTZ,decision_note TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1);
    CREATE UNIQUE INDEX IF NOT EXISTS schedule_availability_one_pending ON schedule_availability_requests(employee_id) WHERE status='pending' AND is_test=FALSE;
    CREATE TABLE IF NOT EXISTS schedule_availability_events (id BIGSERIAL PRIMARY KEY,request_id BIGINT NOT NULL REFERENCES schedule_availability_requests(id),status TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());`);
  await pool.query(`ALTER TABLE schedule_availability_requests ADD COLUMN IF NOT EXISTS department_id BIGINT REFERENCES schedule_leave_departments(id);
    ALTER TABLE schedule_availability_requests ADD COLUMN IF NOT EXISTS department_name TEXT NOT NULL DEFAULT 'Service';
    ALTER TABLE schedule_availability_requests ADD COLUMN IF NOT EXISTS employee_name_key TEXT NOT NULL DEFAULT '';
    UPDATE schedule_availability_requests SET department_id=(SELECT id FROM schedule_leave_departments WHERE code='service') WHERE department_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS schedule_availability_external_pending ON schedule_availability_requests(department_id,employee_name_key)
      WHERE employee_id IS NULL AND employee_name_key<>'' AND status='pending' AND is_test=FALSE;`);
  // Preserve undo snapshots created before departments were available on this form.
  await pool.query(`DO $$ BEGIN IF to_regclass('schedule_undo_rows') IS NOT NULL THEN
    UPDATE schedule_undo_rows SET
      before_row=CASE WHEN before_row IS NOT NULL AND NOT before_row ? 'department_id' THEN before_row||jsonb_build_object('department_id',(SELECT id FROM schedule_leave_departments WHERE code='service'),'department_name','Service','employee_name_key','') ELSE before_row END,
      after_row=CASE WHEN after_row IS NOT NULL AND NOT after_row ? 'department_id' THEN after_row||jsonb_build_object('department_id',(SELECT id FROM schedule_leave_departments WHERE code='service'),'department_name','Service','employee_name_key','') ELSE after_row END
      WHERE table_name='schedule_availability_requests';
    END IF; END $$;`);
  const mail=await installAvailabilityMail(pool);
  const base='/api/leave/availability';
  const info=test=>async(_req,res)=>{try{
    const today=localDate((await pool.query('SELECT clock_timestamp() AS now')).rows[0].now);
    const staff=test?[{id:0,name:'Employé test',max_minutes:MAX_TARGET}]: (await pool.query('SELECT * FROM schedule_employees WHERE active=TRUE AND departed_at IS NULL ORDER BY name')).rows;
    const pending=test?[]:(await pool.query("SELECT employee_id FROM schedule_availability_requests WHERE status='pending' AND is_test=FALSE")).rows;
    const departments=(await pool.query('SELECT id,name,code FROM schedule_leave_departments WHERE active=TRUE ORDER BY name,id')).rows.map(d=>({id:Number(d.id),name:d.name,isService:d.code==='service'}));
    res.json({today,isTest:test,ruleVersion:RULE_VERSION,departments,employees:staff.map(e=>({id:Number(e.id),name:e.name,maxHours:Math.min(e.max_minutes,e.is_minor?1020:MAX_TARGET)/60,minEffectiveDate:minimumEffectiveDate(e,today),pending:pending.some(p=>String(p.employee_id)===String(e.id))}))});
  }catch{res.status(500).json({error:'Impossible de charger le formulaire de disponibilités.'});}};
  app.get(base+'/form',requireStaff,info(false));app.get(base+'/test-form',requireManager,info(true));
  const submit=test=>async(req,res)=>{
    const client=await pool.connect();
    try{
      const b=req.body||{};
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(b.submissionKey||''))throw new Error('Actualisez le formulaire avant de l’envoyer.');
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
      const duplicate=(await client.query('SELECT * FROM schedule_availability_requests WHERE submission_key=$1',[b.submissionKey])).rows[0];
      const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now,today=localDate(now);
      if(!Number.isSafeInteger(Number(b.departmentId))||Number(b.departmentId)<=0)throw new Error('Choisissez un département actif.');
      const department=(await client.query('SELECT * FROM schedule_leave_departments WHERE id=$1 AND active=TRUE FOR SHARE',[Number(b.departmentId)])).rows[0];
      if(!department)throw new Error('Choisissez un département actif.');
      const service=department.code==='service';
      if(!service&&b.employeeId!=null)throw new Error('Inscrivez votre nom pour le département choisi, sans sélectionner une fiche du Service.');
      const e=!service?{id:null,name:typeof b.employeeName==='string'?b.employeeName.trim():'',max_minutes:MAX_TARGET}:test?{id:null,name:'Employé test',max_minutes:MAX_TARGET}:(await client.query('SELECT * FROM schedule_employees WHERE id=$1 AND active=TRUE AND departed_at IS NULL FOR UPDATE',[Number.isSafeInteger(b.employeeId)?b.employeeId:null])).rows[0];
      if(!e)throw new Error('Choisissez un employé actif dans la liste.');
      const data=normalizeAvailability(b,{today:duplicate?localDate(duplicate.submitted_at):today,maxMinutes:Math.min(e.max_minutes,e.is_minor?1020:MAX_TARGET)});
      if(data.employeeName!==e.name)throw new Error('Le nom ne correspond plus à la fiche choisie. Actualisez la liste.');
      if(duplicate){
        if(String(duplicate.department_id)!==String(department.id)||duplicate.is_test!==test||String(duplicate.employee_id)!==String(e.id)||duplicate.employee_name!==data.employeeName||duplicate.email!==data.email||String(duplicate.effective_date instanceof Date?duplicate.effective_date.toISOString().slice(0,10):duplicate.effective_date)!==data.effectiveDate||duplicate.target_minutes!==data.targetMinutes||!same(duplicate.availability,data.availability)||duplicate.comments!==data.comments)throw new Error('Cette référence a déjà servi à une autre demande. Actualisez le formulaire.');
        await client.query('COMMIT');return res.json({id:duplicate.id,isTest:test,status:duplicate.status,message:'Cette demande a déjà été reçue. Aucun doublon créé.'});
      }
      if(!test&&service){
        if(data.effectiveDate<minimumEffectiveDate(e,today))throw new Error('La dernière disponibilité doit être maintenue pendant 4 semaines. Première date possible : '+minimumEffectiveDate(e,today)+'.');
        if((await client.query("SELECT id FROM schedule_availability_requests WHERE employee_id=$1 AND status='pending' AND is_test=FALSE",[e.id])).rows.length)throw new Error('Une demande de disponibilité est déjà en attente. Contactez la gestion pour la corriger.');
      }
      const employeeNameKey=service?'':nameKey(data.employeeName);
      if(!test&&!service){
        const previous=await externalHistory(client,department.id,employeeNameKey),minimum=externalMinimum(previous,today);
        if(previous.some(r=>r.status==='pending'))throw new Error('Une demande de disponibilité est déjà en attente pour ce nom et ce département. Contactez votre responsable pour la corriger.');
        if(data.effectiveDate<minimum)throw new Error('La dernière disponibilité doit être maintenue pendant 4 semaines. Première date possible : '+minimum+'.');
      }
      const r=(await client.query(`INSERT INTO schedule_availability_requests(submission_key,employee_id,employee_name,email,effective_date,target_minutes,availability,acknowledged,rule_version,comments,is_test,department_id,department_name,employee_name_key)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,TRUE,$8,$9,$10,$11,$12,$13) RETURNING id`,[b.submissionKey,e.id,e.name,data.email,data.effectiveDate,data.targetMinutes,JSON.stringify(data.availability),RULE_VERSION,data.comments,test,department.id,department.name,employeeNameKey])).rows[0];
      await client.query("INSERT INTO schedule_availability_events(request_id,status) VALUES($1,'pending')",[r.id]);await mail.queue(client,r.id,'submitted');
      await client.query('COMMIT');mail.run().catch(()=>{});res.status(201).json({id:r.id,isTest:test,status:'pending',message:service?'Demande reçue. Vos disponibilités seront modifiées après approbation, à la date effective indiquée.':'Demande reçue pour le département '+department.name+'. Elle sera transmise par courriel au responsable selon les réglages des congés, pour approbation.'});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});res.status(400).json({error:error.code?'Impossible d’enregistrer la demande. Actualisez le formulaire et réessayez.':error.message});}finally{client.release();}
  };
  app.post(base+'/submit',requireStaff,sameOrigin,submit(false));app.post(base+'/test-submit',requireManager,sameOrigin,submit(true));
  app.get(base+'/requests',requireManager,async(req,res)=>{try{
    const today=localDate((await pool.query('SELECT clock_timestamp() AS now')).rows[0].now);
    const rows=(await pool.query(`SELECT r.*,r.effective_date::text AS effective_date,
      s.status AS notification_status,s.error AS notification_error,a.status AS confirmation_status,a.error AS confirmation_error,d.mail_enabled AS department_mail_enabled
      FROM schedule_availability_requests r
      LEFT JOIN schedule_leave_departments d ON d.id=r.department_id
      LEFT JOIN LATERAL(SELECT status,error FROM schedule_availability_mail WHERE request_id=r.id AND kind='submitted' ORDER BY id DESC LIMIT 1)s ON TRUE
      LEFT JOIN LATERAL(SELECT status,error FROM schedule_availability_mail WHERE request_id=r.id AND kind='approved' ORDER BY id DESC LIMIT 1)a ON TRUE
      WHERE r.is_test=$1 ORDER BY r.submitted_at DESC,r.id DESC`,[req.query.test==='true'])).rows;
    const events=(await pool.query('SELECT e.* FROM schedule_availability_events e JOIN schedule_availability_requests r ON r.id=e.request_id WHERE r.is_test=$1 ORDER BY e.created_at,e.id',[req.query.test==='true'])).rows;
    const employees=(await pool.query('SELECT id,availability,target_minutes,availability_history FROM schedule_employees')).rows;
    res.json({today,requests:rows.map(r=>({...r,submission_key:undefined,currentProfile:employees.find(e=>String(e.id)===String(r.employee_id))?profileAt(employees.find(e=>String(e.id)===String(r.employee_id)),today):null,events:events.filter(e=>String(e.request_id)===String(r.id))})),conflicts:req.query.test==='true'?[]:await availabilityConflicts(pool,today)});
  }catch{res.status(500).json({error:'Impossible de charger le suivi des disponibilités.'});}});
  app.patch(base+'/requests/:id',requireManager,sameOrigin,async(req,res)=>{
    const client=await pool.connect();try{
      const b=req.body||{},note=typeof b.note==='string'?b.note.trim():'';
      if(!['approved','refused','cancelled'].includes(b.status)||!Number.isInteger(b.version)||note.length>1000)throw new Error('Décision invalide.');
      if(b.status!=='approved'&&!note)throw new Error('Indiquez une raison pour refuser ou annuler.');
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');await beginUndo(client,'Disponibilité : '+{approved:'approuver',refused:'refuser',cancelled:'annuler'}[b.status],null,req);
      const r=(await client.query('SELECT *,effective_date::text AS effective_date FROM schedule_availability_requests WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
      if(!r||r.version!==b.version)throw new Error('Cette demande a changé ou est introuvable. Actualisez le suivi.');
      if(!((r.status==='pending')||(r.status==='approved'&&b.status==='cancelled')))throw new Error('Cette demande ne permet plus cette décision.');
      if(!r.is_test&&r.employee_id){
        const e=(await client.query('SELECT * FROM schedule_employees WHERE id=$1 FOR UPDATE',[r.employee_id])).rows[0];
        if(!e)throw new Error('Fiche employé introuvable.');
        if(b.status==='approved'){
          if(!e.active||e.departed_at)throw new Error('Cet employé n’est plus actif.');
          normalizeAvailability({employeeName:r.employee_name,email:r.email,effectiveDate:r.effective_date,targetMinutes:r.target_minutes,availability:r.availability,acknowledged:r.acknowledged,comments:r.comments},{today:localDate(r.submitted_at),maxMinutes:Math.min(e.max_minutes,e.is_minor?1020:MAX_TARGET)});
          if(r.effective_date<minimumEffectiveDate(e,localDate(r.submitted_at)))throw new Error('Une autre modification impose maintenant une date effective au plus tôt le '+minimumEffectiveDate(e,localDate(r.submitted_at))+'.');
          const history=appendAvailability(e,{effectiveDate:r.effective_date,availability:r.availability,targetMinutes:r.target_minutes,source:'request',requestId:String(r.id)});
          await saveAvailabilityHistory(client,e.id,history);
        }else if(r.status==='approved'){
          const history=historyOf(e);if(String(history.at(-1)?.requestId)!==String(r.id))throw new Error('Une modification plus récente existe. Annulez-la d’abord pour préserver l’historique.');
          await saveAvailabilityHistory(client,e.id,history.slice(0,-1));
        }
      }
      if(!r.is_test&&!r.employee_id){
        const previous=await externalHistory(client,r.department_id,r.employee_name_key);
        if(b.status==='approved'){
          normalizeAvailability({employeeName:r.employee_name,email:r.email,effectiveDate:r.effective_date,targetMinutes:r.target_minutes,availability:r.availability,acknowledged:r.acknowledged,comments:r.comments},{today:localDate(r.submitted_at)});
          const minimum=externalMinimum(previous,localDate(r.submitted_at));
          if(r.effective_date<minimum)throw new Error('La dernière disponibilité doit être maintenue pendant 4 semaines. Première date possible : '+minimum+'.');
        }else if(r.status==='approved'&&String(previous.filter(p=>p.status==='approved').at(-1)?.id)!==String(r.id))throw new Error('Une modification plus récente existe. Annulez-la d’abord pour préserver l’historique.');
      }
      await client.query('UPDATE schedule_availability_requests SET status=$1,decision_note=$2,decided_at=clock_timestamp(),version=version+1 WHERE id=$3',[b.status,note,r.id]);
      await client.query('INSERT INTO schedule_availability_events(request_id,status,note) VALUES($1,$2,$3)',[r.id,b.status,note]);
      if(b.status==='approved')await mail.queue(client,r.id,'approved');
      await client.query('COMMIT');mail.run().catch(()=>{});res.json({ok:true});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});res.status(409).json({error:error.code?'Impossible d’enregistrer la décision. Aucun changement conservé.':error.message});}finally{client.release();}
  });
  for(const [url,file] of [['/disponibilites','disponibilites.html'],['/disponibilites-test','disponibilites.html'],['/disponibilites-gestion','disponibilites-gestion.html']])app.get(url,(_req,res)=>res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}).sendFile(file,{root:'public'}));
}
