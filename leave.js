import {installLeaveAccess} from './leave-access.js';
import {installDepartments} from './leave-departments.js';
import {installNotifications} from './leave-notifications.js';
import {normalizeLeave, earliestLeaveDate, addDays, isDate, leaveStatistics, conflictsWithLeave, LATE_MESSAGE} from './leave-rules.js';

export async function approvedLeave(pool, weekStart) {
  const result = await pool.query(`SELECT employee_id, periods FROM schedule_leave_requests
    WHERE status='approved' AND is_test=FALSE AND first_date<=$2 AND last_date>=$1`, [weekStart,addDays(weekStart,6)]);
  return result.rows;
}
export async function installLeave(app, pool, {requireManager,sameOrigin,hasStaffAccess}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_leave_requests (
    id BIGSERIAL PRIMARY KEY, submission_key UUID NOT NULL UNIQUE,
    employee_id BIGINT REFERENCES schedule_employees(id), employee_name TEXT NOT NULL,
    email TEXT NOT NULL, reason TEXT NOT NULL, periods JSONB NOT NULL,
    first_date DATE NOT NULL, last_date DATE NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','refused','cancelled','late')),
    is_test BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    decided_at TIMESTAMPTZ, decision_note TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS schedule_leave_dates_idx ON schedule_leave_requests(first_date,last_date);
  CREATE TABLE IF NOT EXISTS schedule_leave_events (
    id BIGSERIAL PRIMARY KEY, request_id BIGINT NOT NULL REFERENCES schedule_leave_requests(id),
    status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  );`);
  app.use('/api/leave',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const departments=await installDepartments(app,pool,{requireManager,sameOrigin});
  const requireStoreStaff=await installLeaveAccess(app,pool,{requireManager,sameOrigin});
  const mail=await installNotifications(app,pool,{requireManager,sameOrigin});
  async function staff(request,response,next) {
    try {
      if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) return response.status(404).json({error:'Lien invalide.'});
      const link = await pool.query('SELECT access_code_hash FROM schedule_public_links WHERE token=$1',[request.params.token]);
      if (!link.rowCount || !hasStaffAccess(request,request.params.token,link.rows[0].access_code_hash)) return response.status(401).json({error:'Ouvrez votre lien d’horaire et entrez le code commun pour accéder au formulaire.'});
      next();
    } catch {response.status(500).json({error:'Impossible de vérifier l’accès.'});}
  }
  const noStore=(_req,res,next)=>{res.set('Cache-Control','no-store');next();};
  app.use('/api/leave', noStore);
  const formInfo = (test,store=false) => async (_req,res)=>{
    try {
      const clock = (await pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
      const people = store ? [] : test ? [{id:null,name:'Employé test'}] : (await pool.query('SELECT id,name FROM schedule_employees WHERE active=TRUE ORDER BY name')).rows;
      res.set('Cache-Control','no-store').json({departments:(await departments.list()).filter(d=>d.active).map(d=>({id:d.id,name:d.name,isService:d.code==='service'})),nameEntry:store?'manual':'list',employees:people,earliest:earliestLeaveDate(clock),isTest:test,timeZone:'America/Toronto'});
    } catch {res.status(500).json({error:'Impossible de charger le formulaire.'});}
  };
  app.get('/api/public-schedules/:token/leave-form',staff,formInfo(false));
  app.get('/api/leave/test-form',requireManager,formInfo(true));
  app.get('/api/leave/form',requireStoreStaff,formInfo(false,true));
  const submit = (isTest,store=false) => async (req,res)=>{
    const client = await pool.connect();
    try {
      const b=req.body||{};
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(b.submissionKey||'')) return res.status(400).json({error:'Veuillez actualiser le formulaire.'});
      const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      let leave;
      try {leave=normalizeLeave(b,now);} catch(error) {return res.status(400).json({error:error.message});}
      const employeeId=(isTest||store)?null:Number(b.employeeId);
      if (!isTest && !store && (!Number.isSafeInteger(employeeId)||employeeId<=0)) return res.status(400).json({error:'Sélectionnez votre nom.'});
      const name=typeof b.employeeName==='string'?b.employeeName.trim():'';
      if(store&&(name.length<2||name.length>100))return res.status(400).json({error:'Indiquez votre prénom et votre nom (2 à 100 caractères).'});
      const employee=store?{rows:[{name}],rowCount:1}:isTest?{rows:[{name:'Employé test'}],rowCount:1}:await client.query('SELECT name FROM schedule_employees WHERE id=$1 AND active=TRUE',[employeeId]);
      if (!employee.rowCount) return res.status(400).json({error:'Employé introuvable ou inactif.'});
      if((store||isTest&&b.departmentId)&&(!Number.isSafeInteger(Number(b.departmentId))||Number(b.departmentId)<=0))return res.status(400).json({error:'Sélectionnez un département actif.'});
      const department=store||isTest&&b.departmentId?(await client.query('SELECT * FROM schedule_leave_departments WHERE id=$1 AND active=TRUE',[b.departmentId])).rows[0]:(await client.query("SELECT * FROM schedule_leave_departments WHERE code='service' AND active=TRUE")).rows[0];
      if(!department)return res.status(400).json({error:'Sélectionnez un département actif.'});
      await client.query('BEGIN');
      if(store){
        await client.query('SELECT pg_advisory_xact_lock(8675310)');
        const recent=await client.query("SELECT count(*)::int AS count FROM schedule_leave_requests WHERE lower(email)=lower($1) AND is_test=FALSE AND submitted_at>clock_timestamp()-interval '1 hour' AND submission_key<>$2",[leave.email,b.submissionKey]);
        if(recent.rows[0].count>=10){await client.query('ROLLBACK');return res.status(429).json({error:'Plusieurs demandes ont déjà été reçues pour ce courriel. Réessayez plus tard ou contactez la gérante.'});}
      }
      const saved=await client.query(`INSERT INTO schedule_leave_requests
        (submission_key,employee_id,employee_name,email,reason,periods,first_date,last_date,status,is_test,submitted_at,department_id,department_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (submission_key) DO NOTHING RETURNING *`,
        [b.submissionKey,employeeId,employee.rows[0].name,leave.email,leave.reason,JSON.stringify(leave.periods),leave.periods[0].date,leave.periods.at(-1).date,leave.late?'late':'pending',isTest,now,department.id,department.name]);
      const row=saved.rows[0]||(await client.query('SELECT * FROM schedule_leave_requests WHERE submission_key=$1',[b.submissionKey])).rows[0];
      if (String(row.department_id)!==String(department.id)||row.employee_name!==employee.rows[0].name||(!store&&String(row.employee_id)!==String(employeeId))||row.is_test!==isTest||row.email!==leave.email||row.reason!==leave.reason||JSON.stringify(row.periods.map(p=>[p.date,p.startMinute,p.endMinute,p.allDay]))!==JSON.stringify(leave.periods.map(p=>[p.date,p.startMinute,p.endMinute,p.allDay]))) {
        await client.query('ROLLBACK'); return res.status(409).json({error:'Cette tentative a déjà été enregistrée avec un autre contenu. Actualisez le formulaire.'});
      }
      if(saved.rowCount) await client.query('INSERT INTO schedule_leave_events (request_id,status) VALUES ($1,$2)',[row.id,row.status]);
      if(saved.rowCount)await mail.queue(client,row.id);
      await client.query('COMMIT');
      mail.run().catch(()=>{});
      res.set('Cache-Control','no-store').status(row.status==='late'?422:201).json({id:row.id,submittedAt:row.submitted_at,status:row.status,isTest,
        message:row.status==='late'?LATE_MESSAGE:'Votre demande a été reçue. Elle doit être approuvée par votre gérante.'});
    } catch(error) {
      await client.query('ROLLBACK').catch(()=>{}); console.error('Leave submission failed',error.code||'unknown');
      res.status(500).json({error:'L’envoi n’a pas pu être confirmé. Réessayez sans fermer le formulaire.'});
    } finally {client.release();}
  };
  app.post('/api/public-schedules/:token/leave-requests',sameOrigin,staff,submit(false));
  app.post('/api/leave/submit',requireStoreStaff,sameOrigin,submit(false,true));
  app.post('/api/leave/test-requests',requireManager,sameOrigin,submit(true));
  app.get('/api/leave/requests',requireManager,async(req,res)=>{
    try {
      const test=req.query.test==='true';
      const start=req.query.start||'2000-01-01',end=req.query.end||'2099-12-31';
      if(!isDate(start)||!isDate(end)||end<start)return res.status(400).json({error:'Période invalide.'});
      const rows=(await pool.query(`SELECT r.*,m.status AS notification_status,m.error AS notification_error FROM schedule_leave_requests r LEFT JOIN schedule_leave_mail m ON m.request_id=r.id WHERE is_test=$1
        AND first_date<=$3 AND last_date>=$2 ORDER BY submitted_at DESC,r.id DESC`,[test,start,end])).rows.filter(r=>r.periods.some(p=>p.date>=start&&p.date<=end)&&(!req.query.department||String(r.department_id)===req.query.department));
      const events=(await pool.query(`SELECT e.* FROM schedule_leave_events e JOIN schedule_leave_requests r ON r.id=e.request_id
        WHERE r.is_test=$1 AND r.first_date<=$3 AND r.last_date>=$2 ORDER BY e.created_at,e.id`,[test,start,end])).rows;
      res.json({requests:rows.map(r=>({...r,submission_key:undefined,events:events.filter(e=>e.request_id===r.id)})),statistics:leaveStatistics(rows)});
    } catch {res.status(500).json({error:'Impossible de charger les demandes.'});}
  });
  app.get('/api/leave/week/:weekStart',requireManager,async(req,res)=>{
    if(!isDate(req.params.weekStart))return res.status(400).json({error:'Semaine invalide.'});
    try {res.json({leaves:await approvedLeave(pool,req.params.weekStart)});}catch{res.status(500).json({error:'Impossible de charger les congés approuvés.'});}
  });
  app.patch('/api/leave/requests/:id',requireManager,sameOrigin,async(req,res)=>{
    const client=await pool.connect();
    try {
      const b=req.body||{},note=typeof b.note==='string'?b.note.trim():'';
      if(!['approved','refused','cancelled'].includes(b.status)||!Number.isSafeInteger(b.version)||note.length>1000) return res.status(400).json({error:'Décision invalide.'});
      if(b.status!=='approved'&&!note)return res.status(400).json({error:'Précisez la raison de votre décision.'});
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
      const row=(await client.query('SELECT * FROM schedule_leave_requests WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
      if(!row){await client.query('ROLLBACK');return res.status(404).json({error:'Demande introuvable.'});}
      if(row.version!==b.version){await client.query('ROLLBACK');return res.status(409).json({error:'Cette demande a changé. Actualisez le suivi.'});}
      if(!((row.status==='pending'&&['approved','refused','cancelled'].includes(b.status))||(row.status==='approved'&&b.status==='cancelled'))){await client.query('ROLLBACK');return res.status(400).json({error:'Cette demande ne permet plus cette décision. Les demandes hors délai doivent être traitées directement avec la gérante.'});}
      if(b.status==='approved'&&!row.is_test){
        const dept=(await client.query('SELECT code FROM schedule_leave_departments WHERE id=$1',[row.department_id])).rows[0];
        if(!row.employee_id&&dept?.code==='service'){
          const linked=(await client.query('SELECT id FROM schedule_employees WHERE id=$1 AND active=TRUE',[Number.isSafeInteger(b.employeeId)?b.employeeId:null])).rows[0];
          if(!linked){await client.query('ROLLBACK');return res.status(400).json({error:'Pour un congé au Service, reliez le nom déclaré à un employé de l’horaire avant d’approuver.'});}
          row.employee_id=linked.id;
          await client.query('UPDATE schedule_leave_requests SET employee_id=$1 WHERE id=$2',[linked.id,row.id]);
        }
        const conflicts=(await client.query(`SELECT s.* FROM schedule_shifts s JOIN schedule_assignments a ON a.shift_id=s.id
          WHERE a.employee_id=$1 AND s.week_start<=$3 AND s.week_start+6>=$2`,[row.employee_id,row.first_date,row.last_date])).rows;
        if(conflicts.some(s=>conflictsWithLeave({weekStart:typeof s.week_start==='string'?s.week_start.slice(0,10):s.week_start.toISOString().slice(0,10),dayIndex:s.day_index,startMinute:s.start_minute,endMinute:s.end_minute},row.periods))){
          await client.query('ROLLBACK');return res.status(409).json({error:'Un quart déjà attribué chevauche ce congé. Réattribuez ou retirez ce quart dans l’horaire, puis approuvez la demande.'});
        }
        const other=(await client.query(`SELECT periods FROM schedule_leave_requests WHERE employee_id=$1 AND status='approved' AND is_test=FALSE AND first_date<=$3 AND last_date>=$2`,[row.employee_id,row.first_date,row.last_date])).rows;
        if(other.some(o=>o.periods.some(p=>row.periods.some(q=>p.date===q.date&&p.startMinute<q.endMinute&&q.startMinute<p.endMinute)))){await client.query('ROLLBACK');return res.status(409).json({error:'Cette période chevauche un congé déjà approuvé.'});}
      }
      await client.query(`UPDATE schedule_leave_requests SET status=$1,decision_note=$2,decided_at=clock_timestamp(),version=version+1 WHERE id=$3`,[b.status,note,row.id]);
      await client.query('INSERT INTO schedule_leave_events (request_id,status,note) VALUES ($1,$2,$3)',[row.id,b.status,note]);
      await client.query('COMMIT');res.json({ok:true});
    } catch(error){await client.query('ROLLBACK').catch(()=>{});res.status(500).json({error:'Impossible d’enregistrer la décision.'});}finally{client.release();}
  });
  app.get('/h/:token/conges',(_req,res)=>res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}).sendFile('conges.html',{root:'public'}));
}
