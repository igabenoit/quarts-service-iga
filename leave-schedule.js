import {conflictsWithLeave} from './leave-rules.js';
import {shiftWithApprovedLeave} from './public/approved-shift-leave.js';
import {saveShiftLeave} from './approved-shift-leave.js';

// Call inside a transaction holding the scheduler's advisory lock (8675309).
// Keep shift requirements and every unaffected assignment intact.
export async function applyApprovedLeave(client, {weekStart=null, requestId=null}={}) {
  if (!weekStart && !requestId) throw new Error('Une semaine ou une demande est requise.');
  const candidates=(await client.query(`SELECT s.id, s.week_start, s.day_index,
    s.start_minute, s.end_minute, s.absence, a.employee_id, r.id AS request_id, COALESCE(r.effective_periods, r.periods, '[]'::jsonb) AS periods
    FROM schedule_assignments a
    JOIN schedule_shifts s ON s.id=a.shift_id
    LEFT JOIN schedule_leave_requests r ON r.employee_id=a.employee_id
      AND r.status='approved' AND r.is_test=FALSE AND r.archived_at IS NULL
      AND r.first_date<=s.week_start+6 AND r.last_date>=s.week_start
    WHERE ($1::date IS NULL OR s.week_start=$1::date)
      AND ($2::bigint IS NULL OR EXISTS (SELECT 1 FROM schedule_leave_requests requested
        WHERE requested.id=$2 AND requested.employee_id=a.employee_id
          AND requested.first_date<=s.week_start+6 AND requested.last_date>=s.week_start
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(requested.effective_periods,requested.periods)) p
            WHERE p->>'date'=to_char(s.week_start+s.day_index,'YYYY-MM-DD')
              AND (p->>'startMinute')::integer<s.end_minute AND (p->>'endMinute')::integer>s.start_minute)))
    FOR UPDATE OF a`,[weekStart,requestId])).rows;
  const grouped=new Map();
  for(const row of candidates){
    const key=String(row.id);
    if(!grouped.has(key))grouped.set(key,{row,periods:[],requestIds:new Set()});
    const group=grouped.get(key);
    group.periods.push(...row.periods);
    if(row.request_id)group.requestIds.add(row.request_id);
  }
  const released=[],adjusted=[];
  for(const {row,periods,requestIds} of grouped.values()){
    const before={id:Number(row.id),weekStart:typeof row.week_start==='string'?row.week_start.slice(0,10):row.week_start.toISOString().slice(0,10),
      absence:row.absence?{start:row.absence.start,end:row.absence.end,includesMeal:row.absence.includesMeal}:null,
      approvedLeaveAbsence:row.absence?.approvedLeave,
      dayIndex:Number(row.day_index),startMinute:Number(row.start_minute),endMinute:Number(row.end_minute)};
    const shift=shiftWithApprovedLeave(before,periods,row.employee_id);
    const record={shiftId:before.id,employeeId:Number(row.employee_id)};
    if(conflictsWithLeave(shift,periods)){
      await client.query('DELETE FROM schedule_assignments WHERE shift_id=ANY($1::bigint[]) RETURNING shift_id',[[String(before.id)]]);
      await saveShiftLeave(client,before,shiftWithApprovedLeave(before));
      released.push(record);
    }else{
      await saveShiftLeave(client,before,shift);
      if(JSON.stringify(before.absence)!==JSON.stringify(shift.absence))adjusted.push(record);
    }
    if(released.includes(record)||adjusted.includes(record))for(const id of requestIds){
      const note=released.includes(record)?`Quart ${before.id} remis à couvrir pour ce congé.`:
        `Quart ${before.id} conservé; absence partielle à ses frais et heures ajustées.`;
      await client.query("INSERT INTO schedule_leave_events (request_id,status,note) VALUES ($1,'approved',$2)",[id,note]);
    }
  }
  return {released,adjusted};
}
