// Runs inside the publication migration transaction, while week_start is still unique.
export async function migrateServiceStoreWeeks(client) {
  const legacy = await client.query(`SELECT 1 FROM pg_constraint
    WHERE conrelid='schedule_weeks'::regclass AND contype='p' AND cardinality(conkey)=1`);
  if (!legacy.rows.length) return;
  const children = ['schedule_shifts','schedule_time_off','schedule_day_exceptions',
    'schedule_schedule_views','schedule_public_links','schedule_service_publications','schedule_regeneration_backups'];
  for (const table of children) {
    if (!(await client.query('SELECT to_regclass($1) AS relation',[table])).rows[0].relation) continue;
    await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS store_id text;
      UPDATE ${table} c SET store_id=w.store_id FROM schedule_weeks w WHERE c.week_start=w.week_start AND c.store_id IS NULL;
      ALTER TABLE ${table} ALTER COLUMN store_id SET NOT NULL, ALTER COLUMN store_id SET DEFAULT 'principal';
      ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_week_start_fkey`);
    if (table !== 'schedule_public_links') await client.query(`ALTER TABLE ${table} ADD FOREIGN KEY (week_start,store_id)
      REFERENCES schedule_weeks(week_start,store_id) ON DELETE CASCADE`);
  }
  for (const table of ['schedule_public_links','schedule_service_publications','schedule_weeks']) {
    await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_pkey, ADD PRIMARY KEY (week_start, store_id)`);
  }
  if ((await client.query("SELECT to_regclass('schedule_undo_rows') AS relation")).rows[0].relation) {
    await client.query(`ALTER TABLE schedule_undo_actions ADD COLUMN IF NOT EXISTS store_id text;
      UPDATE schedule_undo_actions a SET store_id=w.store_id FROM schedule_weeks w
      WHERE a.week_start=w.week_start AND a.store_id IS NULL AND EXISTS (
        SELECT 1 FROM schedule_undo_rows r WHERE r.action_id=a.id
        AND r.table_name IN ('schedule_weeks','schedule_shifts','schedule_assignments','schedule_time_off','schedule_day_exceptions'))`);
    await client.query(`UPDATE schedule_undo_rows r SET
      row_key=CASE WHEN table_name='schedule_weeks' THEN row_key||jsonb_build_object('store_id',w.store_id) ELSE row_key END,
      before_row=before_row||jsonb_build_object('store_id',w.store_id),
      after_row=after_row||jsonb_build_object('store_id',w.store_id)
      FROM schedule_weeks w WHERE r.table_name IN ('schedule_weeks','schedule_shifts','schedule_time_off','schedule_day_exceptions')
      AND w.week_start=(coalesce(r.after_row,r.before_row)->>'week_start')::date`);
  }
}

export async function managerStores(pool,manager) {
  const sql = manager.kind==='account'
    ? `SELECT coalesce(e.store_id,'principal') AS id FROM schedule_store_people p
       LEFT JOIN schedule_employees e ON e.id=p.service_employee_id WHERE p.id=$1`
    : 'SELECT id FROM schedule_stores ORDER BY id';
  const result = await pool.query(sql,manager.kind==='account'?[manager.personId]:[]);
  return result.rows.map(row=>row.id);
}
