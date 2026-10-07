import {conflictsWithLeave} from './leave-rules.js';

// Call inside a transaction holding the scheduler's advisory lock (8675309).
// Keep shift requirements and every unaffected assignment intact.
export async function releaseLeaveConflicts(client, {weekStart=null, requestId=null}={}) {
  if (!weekStart && !requestId) throw new Error('Une semaine ou une demande est requise.');
  const candidates=(await client.query(`SELECT s.id, s.week_start, s.day_index,
    s.start_minute, s.end_minute, a.employee_id, r.id AS request_id, r.periods
    FROM schedule_assignments a
    JOIN schedule_shifts s ON s.id=a.shift_id
    JOIN schedule_leave_requests r ON r.employee_id=a.employee_id
    WHERE r.status='approved' AND r.is_test=FALSE AND r.archived_at IS NULL
      AND r.first_date<=s.week_start+6 AND r.last_date>=s.week_start
      AND ($1::date IS NULL OR s.week_start=$1::date)
      AND ($2::bigint IS NULL OR r.id=$2::bigint)
    FOR UPDATE OF a`,[weekStart,requestId])).rows;
  const conflicts=new Map();
  for (const row of candidates) {
    const shift={weekStart:typeof row.week_start==='string'?row.week_start.slice(0,10):row.week_start.toISOString().slice(0,10),
      dayIndex:Number(row.day_index),startMinute:Number(row.start_minute),endMinute:Number(row.end_minute)};
    if(conflictsWithLeave(shift,row.periods)) conflicts.set(String(row.id),{...shift,
      shiftId:Number(row.id),employeeId:Number(row.employee_id),requestId:Number(row.request_id)});
  }
  if(!conflicts.size)return [];
  const deleted=await client.query('DELETE FROM schedule_assignments WHERE shift_id=ANY($1::bigint[]) RETURNING shift_id',[[...conflicts.keys()]]);
  const released=deleted.rows.map(row=>conflicts.get(String(row.shift_id)));
  for(const id of new Set(released.map(s=>s.requestId))) {
    const shifts=released.filter(s=>s.requestId===id);
    const note=`Horaire ajusté : ${shifts.length} quart(s) remis à couvrir pour ce congé. Autres affectations conservées. Quarts : ${shifts.map(s=>s.shiftId).join(', ')}.`;
    await client.query("INSERT INTO schedule_leave_events (request_id,status,note) VALUES ($1,'approved',$2)",[id,note]);
  }
  return released;
}
