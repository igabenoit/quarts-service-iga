import {serviceShiftTiming} from './public/service-rules.js';

// Published data is independent of the editable Service tables. Never include
// personal credentials, email addresses, internal notes or availability here.
export async function serviceSnapshot(client,week){
  const employees=(await client.query('SELECT id,name,role,display_rank FROM schedule_employees WHERE active AND departed_at IS NULL ORDER BY id')).rows;
  const shifts=(await client.query(`SELECT s.id,s.week_start,s.area,s.role,s.day_index,s.start_minute,s.end_minute,s.break_minutes,s.absence,s.source_department,a.employee_id
    FROM schedule_shifts s LEFT JOIN schedule_assignments a ON a.shift_id=s.id WHERE s.week_start=$1 ORDER BY s.id`,[week])).rows;
  return {employees,shifts};
}
export async function publishServiceWeek(client,week){
  const snapshot=await serviceSnapshot(client,week);
  const previous=(await client.query('SELECT snapshot=$2::jsonb AS unchanged FROM schedule_service_publications WHERE week_start=$1',[week,JSON.stringify(snapshot)])).rows[0];
  if(previous?.unchanged)return null;
  await client.query(`INSERT INTO schedule_service_publications(week_start,snapshot) VALUES($1,$2)
    ON CONFLICT(week_start) DO UPDATE SET snapshot=EXCLUDED.snapshot,published_at=clock_timestamp()`,[week,JSON.stringify(snapshot)]);
  return previous?'updated':'published';
}
export async function installServicePublications(pool){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
    await client.query(`CREATE TABLE IF NOT EXISTS schedule_service_publications(
      week_start DATE PRIMARY KEY REFERENCES schedule_weeks(week_start) ON DELETE CASCADE,
      snapshot JSONB NOT NULL,published_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp())`);
    // One-time preservation of what employees could already see. Existing
    // snapshots are never refreshed on restart or during an ordinary edit.
    const legacy=(await client.query(`SELECT l.week_start FROM schedule_public_links l
      LEFT JOIN schedule_service_publications p USING(week_start) WHERE p.week_start IS NULL`)).rows;
    for(const row of legacy)await publishServiceWeek(client,row.week_start);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
export async function readServicePublication(client,week){
  return (await client.query(`SELECT p.snapshot,p.published_at FROM schedule_service_publications p
    JOIN schedule_public_links l USING(week_start) WHERE p.week_start=$1`,[week])).rows[0]||null;
}
export async function publishedServiceResult(client,week){
  const publication=await readServicePublication(client,week);if(!publication)return null;
  const active=new Set((await client.query('SELECT id FROM schedule_employees WHERE active AND departed_at IS NULL')).rows.map(r=>Number(r.id)));
  return {kind:'service',data:{weekStart:week,employees:publication.snapshot.employees.filter(e=>active.has(Number(e.id))).map(e=>({
    id:Number(e.id),name:e.name,role:e.role,rank:e.display_rank,
    shifts:publication.snapshot.shifts.filter(s=>Number(s.employee_id)===Number(e.id)).map(s=>({dayIndex:Number(s.day_index),startMinute:Number(s.start_minute),endMinute:Number(s.end_minute),role:s.role,...serviceShiftTiming(Number(s.start_minute),Number(s.end_minute),s.absence)}))
  }))}};
}
