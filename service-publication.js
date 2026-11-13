import {serviceShiftTiming} from './public/service-rules.js';
import {migrateServiceStoreWeeks} from './service-store-weeks.js';

// Published data is independent of the editable Service tables. Never include
// personal credentials, email addresses, internal notes or availability here.
export async function serviceSnapshot(client,week,store='principal'){
  const employees=(await client.query(`SELECT e.id,e.name,e.role,e.display_rank FROM schedule_employees e
    JOIN schedule_weeks w ON w.store_id=e.store_id WHERE w.week_start=$1 AND e.active AND e.departed_at IS NULL
    AND w.store_id=$2 ORDER BY e.id`,[week,store])).rows;
  const mismatch=await client.query(`SELECT 1 FROM schedule_assignments a JOIN schedule_employees e ON e.id=a.employee_id
    JOIN schedule_shifts s ON s.id=a.shift_id
    WHERE s.week_start=$1 AND s.store_id=$2 AND e.store_id<>s.store_id LIMIT 1`,[week,store]);
  if(mismatch.rowCount)throw Object.assign(Error('Un quart est attribué à un employé d’un autre magasin.'),{status:409});
  const shifts=(await client.query(`SELECT s.id,s.week_start,s.area,s.role,s.training,s.training_minutes,s.day_index,s.start_minute,s.end_minute,s.break_minutes,s.absence,s.source_department,a.employee_id
    FROM schedule_shifts s LEFT JOIN schedule_assignments a ON a.shift_id=s.id WHERE s.week_start=$1 AND s.store_id=$2 ORDER BY s.id`,[week,store])).rows;
  return {employees,shifts};
}
export async function publishServiceWeek(client,week,store='principal'){
  const snapshot=await serviceSnapshot(client,week,store);
  const previous=(await client.query('SELECT snapshot=$2::jsonb AS unchanged FROM schedule_service_publications WHERE week_start=$1 AND store_id=$3',[week,JSON.stringify(snapshot),store])).rows[0];
  if(previous?.unchanged)return null;
  await client.query(`INSERT INTO schedule_service_publications(week_start,snapshot,store_id) VALUES($1,$2,$3)
    ON CONFLICT(week_start,store_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,published_at=clock_timestamp()`,[week,JSON.stringify(snapshot),store]);
  return previous?'updated':'published';
}
export async function installServicePublications(pool){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
    // Existing single-store installations retain their employees and published links.
    await client.query(`CREATE TABLE IF NOT EXISTS schedule_stores(id text PRIMARY KEY CHECK (length(trim(id))>0));
      INSERT INTO schedule_stores(id) VALUES ('principal') ON CONFLICT DO NOTHING;
      ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS store_id text NOT NULL DEFAULT 'principal' REFERENCES schedule_stores(id);
      ALTER TABLE schedule_weeks ADD COLUMN IF NOT EXISTS store_id text NOT NULL DEFAULT 'principal' REFERENCES schedule_stores(id);
      CREATE UNIQUE INDEX IF NOT EXISTS schedule_week_store ON schedule_weeks(week_start, store_id);
      ALTER TABLE schedule_public_links ADD COLUMN IF NOT EXISTS store_id text NOT NULL DEFAULT 'principal';
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='schedule_public_links'::regclass AND conname='publication_week_store') THEN
          ALTER TABLE schedule_public_links ADD CONSTRAINT publication_week_store
            FOREIGN KEY(week_start,store_id) REFERENCES schedule_weeks(week_start,store_id) ON DELETE CASCADE;
        END IF;
      END $$;
      CREATE OR REPLACE VIEW schedule_employee_links AS
        SELECT l.token,l.week_start,e.id AS employee_id,l.store_id FROM schedule_public_links l
        JOIN schedule_employees e ON e.store_id=l.store_id;`);
    await client.query(`CREATE TABLE IF NOT EXISTS schedule_service_publications(
      week_start DATE PRIMARY KEY REFERENCES schedule_weeks(week_start) ON DELETE CASCADE,
      snapshot JSONB NOT NULL,published_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp())`);
    // One-time preservation of what employees could already see. Existing
    // snapshots are never refreshed on restart or during an ordinary edit.
    await migrateServiceStoreWeeks(client);
    const legacy=(await client.query(`SELECT l.week_start,l.store_id FROM schedule_public_links l
      LEFT JOIN schedule_service_publications p USING(week_start,store_id) WHERE p.week_start IS NULL`)).rows;
    for(const row of legacy)await publishServiceWeek(client,row.week_start,row.store_id);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
export async function readServicePublication(client,week,store=null){
  const rows=(await client.query(`SELECT p.snapshot,p.published_at FROM schedule_service_publications p
    JOIN schedule_public_links l USING(week_start,store_id) WHERE p.week_start=$1
    AND ($2::text IS NULL OR p.store_id=$2) ORDER BY p.published_at DESC,p.store_id`,[week,store])).rows;
  if(rows.length<2)return rows[0]||null;
  return {published_at:rows[0].published_at,snapshot:{employees:rows.flatMap(p=>p.snapshot.employees),shifts:rows.flatMap(p=>p.snapshot.shifts)}};
}
export async function publishedServiceResult(client,week,store=null){
  const publication=await readServicePublication(client,week,store);if(!publication)return null;
  const active=new Set((await client.query(`SELECT e.id FROM schedule_employees e
    JOIN schedule_weeks w ON w.store_id=e.store_id
    LEFT JOIN schedule_store_people p ON p.service_employee_id=e.id
    WHERE w.week_start=$1 AND ($2::text IS NULL OR w.store_id=$2) AND ((e.active AND e.departed_at IS NULL AND p.employment_ended_on IS NULL)
      OR p.employment_ended_on>$1::date)`,[week,store])).rows.map(r=>Number(r.id)));
  return {kind:'service',data:{weekStart:week,employees:publication.snapshot.employees.filter(e=>active.has(Number(e.id))).map(e=>({
    id:Number(e.id),name:e.name,role:e.role,rank:e.display_rank,
    shifts:publication.snapshot.shifts.filter(s=>Number(s.employee_id)===Number(e.id)).map(s=>({dayIndex:Number(s.day_index),startMinute:Number(s.start_minute),endMinute:Number(s.end_minute),role:s.role,training:!!s.training,trainingMinutes:s.training_minutes??null,...serviceShiftTiming(Number(s.start_minute),Number(s.end_minute),s.absence)}))
  }))}};
}
