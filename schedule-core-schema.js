export async function installCoreSchema(pool){
await pool.query(`
  CREATE TABLE IF NOT EXISTS schedule_weeks (
    week_start DATE PRIMARY KEY,
    cashier_budget_minutes INTEGER NOT NULL DEFAULT 26580 CHECK (cashier_budget_minutes >= 0),
    packer_budget_minutes INTEGER NOT NULL DEFAULT 11820 CHECK (packer_budget_minutes >= 0),
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS schedule_shifts (
    id BIGSERIAL PRIMARY KEY,
    week_start DATE NOT NULL REFERENCES schedule_weeks(week_start) ON DELETE CASCADE,
    area TEXT NOT NULL CHECK (area IN ('front', 'packer')),
    role TEXT NOT NULL CHECK (role IN ('cashier', 'supervisor', 'support', 'packer')),
    day_index INTEGER NOT NULL CHECK (day_index BETWEEN 0 AND 6),
    start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
    end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
    break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 240),
    source_department TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_minute > start_minute),
    CHECK (end_minute - start_minute > break_minutes)
  );

  CREATE INDEX IF NOT EXISTS schedule_shifts_week_idx
  ON schedule_shifts (week_start, area, day_index, start_minute);
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS schedule_employees (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    area TEXT NOT NULL CHECK (area IN ('front','packer')),
    role TEXT NOT NULL CHECK (role IN ('cashier','supervisor','packer')),
    seniority TEXT NOT NULL DEFAULT '9999-12-31',
    target_minutes INTEGER NOT NULL DEFAULT 0,
    max_minutes INTEGER NOT NULL DEFAULT 2400,
    availability JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE
  );
  CREATE TABLE IF NOT EXISTS schedule_assignments (
    shift_id BIGINT PRIMARY KEY REFERENCES schedule_shifts(id) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES schedule_employees(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);
await pool.query(`
  ALTER TABLE schedule_shifts ADD COLUMN IF NOT EXISTS training BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE schedule_shifts ADD COLUMN IF NOT EXISTS training_minutes INTEGER;
  UPDATE schedule_shifts s SET training=TRUE, role=COALESCE((
    SELECT e.role FROM schedule_assignments a JOIN schedule_employees e ON e.id=a.employee_id WHERE a.shift_id=s.id
  ),'cashier') WHERE s.role='training';
  UPDATE schedule_shifts SET area='packer' WHERE training AND role='packer' AND area<>'packer';
  ALTER TABLE schedule_shifts DROP CONSTRAINT IF EXISTS schedule_shifts_role_check;
  ALTER TABLE schedule_shifts ADD CONSTRAINT schedule_shifts_role_check
    CHECK (role IN ('cashier','supervisor','support','packer','orders','manager'));
  ALTER TABLE schedule_employees DROP CONSTRAINT IF EXISTS schedule_employees_role_check;
  ALTER TABLE schedule_employees ADD CONSTRAINT schedule_employees_role_check
    CHECK (role IN ('cashier','supervisor','packer','orders','manager'));
  ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS display_rank INTEGER;
  ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS assignment_rank INTEGER;
  ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS is_minor BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS allow_extra_hours BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS roles JSONB NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS departed_at TIMESTAMPTZ;
  UPDATE schedule_employees SET roles=jsonb_build_array(role)
    WHERE jsonb_typeof(roles) <> 'array' OR NOT (roles ? role);
`);
await pool.query(`
  WITH ranks AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY role ORDER BY seniority, id)
      + COALESCE((SELECT MAX(display_rank) FROM schedule_employees existing WHERE existing.role = missing.role), 0) AS position
    FROM schedule_employees missing WHERE display_rank IS NULL
  )
  UPDATE schedule_employees e SET display_rank = ranks.position FROM ranks WHERE e.id = ranks.id;
  WITH ranks AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY role ORDER BY seniority, id)
      + COALESCE((SELECT MAX(assignment_rank) FROM schedule_employees existing WHERE existing.role = missing.role), 0) AS position
    FROM schedule_employees missing WHERE assignment_rank IS NULL
  )
  UPDATE schedule_employees e SET assignment_rank = ranks.position FROM ranks WHERE e.id = ranks.id;
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS schedule_time_off (
    week_start DATE NOT NULL REFERENCES schedule_weeks(week_start) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES schedule_employees(id) ON DELETE CASCADE,
    day_index INTEGER NOT NULL CHECK (day_index BETWEEN 0 AND 6),
    PRIMARY KEY (week_start, employee_id, day_index)
  );
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS schedule_day_exceptions (
    week_start DATE NOT NULL REFERENCES schedule_weeks(week_start) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES schedule_employees(id) ON DELETE CASCADE,
    PRIMARY KEY (week_start, employee_id)
  );
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS schedule_public_links (
    week_start DATE PRIMARY KEY REFERENCES schedule_weeks(week_start) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    access_code_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS schedule_schedule_views (
    week_start DATE NOT NULL REFERENCES schedule_weeks(week_start) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES schedule_employees(id) ON DELETE CASCADE,
    first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    view_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (week_start, employee_id)
  );
`);

await pool.query('ALTER TABLE schedule_shifts ADD COLUMN IF NOT EXISTS absence JSONB');
}
