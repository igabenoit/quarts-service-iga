import {createHash} from 'node:crypto';
import {addDays, conflictsWithLeave, isDate} from './leave-rules.js';
import {profileAt,historyOf} from './availability-rules.js';

// The caller holds the scheduling advisory lock, inside the mutation transaction.
export async function readSchedule(client, weekStart) {
  const shifts=(await client.query(`SELECT id, area, role, day_index, start_minute, end_minute, break_minutes
    FROM schedule_shifts WHERE week_start=$1 ORDER BY id`,[weekStart])).rows;
  const assignments=(await client.query(`SELECT a.shift_id, a.employee_id FROM schedule_assignments a
    JOIN schedule_shifts s ON s.id=a.shift_id WHERE s.week_start=$1 ORDER BY a.shift_id`,[weekStart])).rows;
  return {shifts,assignments};
}

export async function backupBeforeRegeneration(client, weekStart) {
  const snapshot=await readSchedule(client,weekStart);
  await client.query(`INSERT INTO schedule_regeneration_backups (week_start,snapshot)
    VALUES ($1,$2::jsonb)`,[weekStart,JSON.stringify(snapshot)]);
}

// Stable even after PostgreSQL JSONB has reordered object keys.
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
const serialized=value=>JSON.stringify(canonical(value));
const digest=value=>createHash('sha256').update(serialized(value)).digest('hex');

export function restorationPreview(backup,current,{weekStart,employees,leaves,timeOff}) {
  const token=digest({backupId:String(backup.id),current,employees,leaves,timeOff});
  const issues=[];
  if(serialized(backup.snapshot.shifts)!==serialized(current.shifts))
    issues.push('Des besoins de quarts ont été ajoutés, supprimés ou modifiés depuis cette recréation. La restauration des affectations est bloquée pour éviter de les appliquer aux mauvais quarts.');
  const names=new Map(employees.map(e=>[String(e.id),e.name]));
  const shifts=new Map(backup.snapshot.shifts.map(s=>[String(s.id),s]));
  for(const a of backup.snapshot.assignments){
    const employee=employees.find(e=>String(e.id)===String(a.employee_id));
    const s=shifts.get(String(a.shift_id));
    if(!employee?.active){issues.push(`${employee?.name||'Un employé'} n’est plus actif.`);continue;}
    if(!s){issues.push('Un quart sauvegardé est introuvable.');continue;}
    if(historyOf(employee).length&&!profileAt(employee,addDays(weekStart,s.day_index)).availability[s.day_index]?.some(([a,b])=>a<=s.start_minute&&b>=s.end_minute))
      issues.push(`${employee.name} n’est plus disponible pour ce quart le ${addDays(weekStart,s.day_index)}. Révisez cette disponibilité avant de restaurer son affectation.`);
    const periods=leaves.filter(r=>String(r.employee_id)===String(a.employee_id)).flatMap(r=>r.periods);
    if(conflictsWithLeave({weekStart,dayIndex:s.day_index,startMinute:s.start_minute,endMinute:s.end_minute},periods)
      ||timeOff.some(r=>String(r.employee_id)===String(a.employee_id)&&r.day_index===s.day_index))
      issues.push(`${employee.name} a un congé le ${addDays(weekStart,s.day_index)}. Révisez ce congé avant de restaurer son affectation.`);
  }
  const before=new Map(current.assignments.map(a=>[String(a.shift_id),String(a.employee_id)]));
  const after=new Map(backup.snapshot.assignments.map(a=>[String(a.shift_id),String(a.employee_id)]));
  const changes=[];
  for(const id of new Set([...before.keys(),...after.keys()])){
    if(before.get(id)===after.get(id))continue;
    const shift=shifts.get(id)||current.shifts.find(s=>String(s.id)===id);
    changes.push({shiftId:id,date:addDays(weekStart,shift.day_index),startMinute:shift.start_minute,endMinute:shift.end_minute,
      current: names.get(before.get(id))||'À couvrir', restored:names.get(after.get(id))||'À couvrir'});
  }
  changes.sort((a,b)=>a.date.localeCompare(b.date)||a.startMinute-b.startMinute||Number(a.shiftId)-Number(b.shiftId));
  return {id:String(backup.id),createdAt:backup.created_at,token,changes,issues:[...new Set(issues)],canRestore:issues.length===0};
}

export async function installScheduleBackup(app,pool,{requireManager,sameOrigin}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_regeneration_backups (
    id BIGSERIAL PRIMARY KEY, week_start DATE NOT NULL REFERENCES schedule_weeks(week_start) ON DELETE CASCADE,
    snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    restored_at TIMESTAMPTZ, replaced_snapshot JSONB
  ); CREATE INDEX IF NOT EXISTS schedule_regeneration_backups_week_idx ON schedule_regeneration_backups(week_start,id DESC);`);

  async function operation(req,res,restore){
    res.set('Cache-Control','no-store');
    const weekStart=req.params.weekStart;
    if(!isDate(weekStart)||new Date(`${weekStart}T12:00:00Z`).getUTCDay()!==1)return res.status(400).json({error:'Semaine invalide.'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(8675309)');
      const backup=(await client.query(`SELECT * FROM schedule_regeneration_backups WHERE week_start=$1 ORDER BY id DESC LIMIT 1 FOR UPDATE`,[weekStart])).rows[0];
      if(!backup||backup.restored_at){
        await client.query('COMMIT');
        return restore?res.status(409).json({error:'Aucune recréation à annuler pour cette semaine.'}):res.json({backup:null});
      }
      const current=await readSchedule(client,weekStart);
      const employees=(await client.query('SELECT id,name,active,availability,target_minutes,availability_history FROM schedule_employees ORDER BY id')).rows;
      const leaves=(await client.query(`SELECT employee_id,COALESCE(effective_periods,periods) AS periods FROM schedule_leave_requests
        WHERE status='approved' AND is_test=FALSE AND archived_at IS NULL AND first_date<=$2 AND last_date>=$1 ORDER BY id`,[weekStart,addDays(weekStart,6)])).rows;
      const timeOff=(await client.query('SELECT employee_id,day_index FROM schedule_time_off WHERE week_start=$1 ORDER BY employee_id,day_index',[weekStart])).rows;
      const preview=restorationPreview(backup,current,{weekStart,employees,leaves,timeOff});
      if(!restore){await client.query('COMMIT');return res.json({backup:preview});}
      if(req.body?.token!==preview.token||String(req.body?.backupId)!==String(backup.id)){
        await client.query('ROLLBACK');return res.status(409).json({error:'L’horaire ou les congés ont changé. Fermez puis rouvrez l’aperçu avant de restaurer.'});
      }
      if(!preview.canRestore){await client.query('ROLLBACK');return res.status(409).json({error:preview.issues.join(' ')});}
      await client.query(`DELETE FROM schedule_assignments WHERE shift_id IN (SELECT id FROM schedule_shifts WHERE week_start=$1)`,[weekStart]);
      for(const a of backup.snapshot.assignments)await client.query('INSERT INTO schedule_assignments (shift_id,employee_id) VALUES ($1,$2)',[a.shift_id,a.employee_id]);
      await client.query(`UPDATE schedule_regeneration_backups SET restored_at=clock_timestamp(),replaced_snapshot=$1::jsonb WHERE id=$2`,[JSON.stringify(current),backup.id]);
      await client.query('COMMIT');
      res.json({ok:true,restoredAssignments:backup.snapshot.assignments.length});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});res.status(500).json({error:'Impossible de restaurer ou de charger la sauvegarde. Aucun changement enregistré.'});}
    finally{client.release();}
  }
  app.get('/api/weeks/:weekStart/regeneration-backup',requireManager,(req,res)=>operation(req,res,false));
  app.post('/api/weeks/:weekStart/regeneration-backup/restore',requireManager,sameOrigin,(req,res)=>operation(req,res,true));
}
