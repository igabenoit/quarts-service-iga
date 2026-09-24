import crypto from "node:crypto";
import express from "express";
import pg from "pg";
import { canAssign, generateAssignments } from "./scheduler.js";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === "production";

for (const key of ["DATABASE_URL", "SESSION_SECRET", "MANAGER_CODE"]) {
  if (!process.env[key]) throw new Error(`Variable requise absente: ${key}`);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: production ? { rejectUnauthorized: false } : false,
  max: 5,
});
const attempts = new Map();
const sessionSecret = process.env.SESSION_SECRET;

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
  ALTER TABLE schedule_shifts DROP CONSTRAINT IF EXISTS schedule_shifts_role_check;
  ALTER TABLE schedule_shifts ADD CONSTRAINT schedule_shifts_role_check
    CHECK (role IN ('cashier','supervisor','support','packer','orders'));
  ALTER TABLE schedule_employees DROP CONSTRAINT IF EXISTS schedule_employees_role_check;
  ALTER TABLE schedule_employees ADD CONSTRAINT schedule_employees_role_check
    CHECK (role IN ('cashier','supervisor','packer','orders'));
  ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS display_rank INTEGER;
  ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS assignment_rank INTEGER;
  ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS is_minor BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS allow_extra_hours BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE schedule_employees ADD COLUMN IF NOT EXISTS roles JSONB NOT NULL DEFAULT '[]'::jsonb;
  UPDATE schedule_employees SET roles=jsonb_build_array(role)
    WHERE jsonb_typeof(roles) <> 'array' OR NOT roles ? role;
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

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "250kb" }));
app.use((_request, response, next) => {
  response.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  });
  if (production) response.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}
function sign(value) { return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url"); }
function issueSession() {
  const payload = Buffer.from(JSON.stringify({ role: "manager", expiresAt: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
function readSession(request) {
  const token = parseCookies(request.headers.cookie).schedule_session;
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.role === "manager" && session.expiresAt >= Date.now() ? session : null;
  } catch { return null; }
}
function secureEqual(left, right) {
  const a = crypto.createHash("sha256").update(String(left)).digest();
  const b = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}
function requireManager(request, response, next) {
  if (!readSession(request)) return response.status(401).json({ error: "Accès gestionnaire requis." });
  next();
}
function sameOrigin(request, response, next) {
  const origin = request.get("origin");
  if (origin && new URL(origin).host !== request.get("host")) return response.status(403).json({ error: "Requête refusée." });
  next();
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")); }
function isoDate(value) { return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10); }
function addDays(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function parseMinutes(value, name, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} invalide.`);
  return number;
}
function normalizeShift(body) {
  const role = String(body.role || "");
  if (!["cashier", "supervisor", "support", "packer", "orders"].includes(role)) throw new Error("Fonction invalide.");
  const startMinute = parseMinutes(body.startMinute, "Heure de début", 0, 1439);
  const endMinute = parseMinutes(body.endMinute, "Heure de fin", 1, 1440);
  const breakMinutes = parseMinutes(body.breakMinutes ?? 0, "Pause", 0, 240);
  if (endMinute <= startMinute || endMinute - startMinute <= breakMinutes) throw new Error("Le quart et la pause sont incompatibles.");
  return {
    role,
    area: role === "packer" ? "packer" : "front",
    startMinute,
    endMinute,
    breakMinutes,
    sourceDepartment: String(body.sourceDepartment || "").trim().slice(0, 80),
    notes: String(body.notes || "").trim().slice(0, 300),
  };
}
async function ensureWeek(weekStart, client = pool) {
  await client.query(`INSERT INTO schedule_weeks (week_start) VALUES ($1) ON CONFLICT DO NOTHING`, [weekStart]);
}
function mapWeek(row) {
  return {
    weekStart: isoDate(row.week_start),
    cashierBudgetMinutes: Number(row.cashier_budget_minutes),
    packerBudgetMinutes: Number(row.packer_budget_minutes),
    notes: row.notes,
  };
}
function mapShift(row) {
  return {
    id: Number(row.id), weekStart: isoDate(row.week_start), area: row.area, role: row.role,
    dayIndex: Number(row.day_index), startMinute: Number(row.start_minute), endMinute: Number(row.end_minute),
    breakMinutes: Number(row.break_minutes), paidMinutes: Number(row.end_minute) - Number(row.start_minute) - Number(row.break_minutes),
    sourceDepartment: row.source_department, notes: row.notes,
  };
}

function normalizeEmployee(body) {
  const name = String(body.name || "").trim().slice(0, 100);
  const role = String(body.role || "");
  if (!name || !["cashier", "supervisor", "packer", "orders"].includes(role)) throw new Error("Nom ou fonction invalide.");
  const allowedRoles = ["cashier", "supervisor", "packer", "orders"];
  if (body.roles !== undefined && !Array.isArray(body.roles)) throw new Error("Fonctions invalides.");
  if (body.roles?.some(value => !allowedRoles.includes(value))) throw new Error("Fonctions invalides.");
  const roles = [...new Set([role, ...(body.roles || [])])];
  const availability = {};
  for (let day = 0; day < 7; day++) {
    const windows = body.availability?.[day] || [];
    if (!Array.isArray(windows) || windows.length > 3) throw new Error("Disponibilités invalides.");
    availability[day] = windows.map(window => {
      if (!Array.isArray(window) || window.length !== 2) throw new Error("Disponibilités invalides.");
      const start = parseMinutes(window[0], "Début", 0, 1439);
      const end = parseMinutes(window[1], "Fin", 1, 1440);
      if (start >= end) throw new Error("Disponibilités invalides.");
      return [start, end];
    });
  }
  const targetMinutes = parseMinutes(body.targetMinutes ?? 0, "Heures souhaitées", 0, 3000);
  const maxMinutes = parseMinutes(body.maxMinutes ?? 2400, "Maximum", 0, 3600);
  if (targetMinutes > maxMinutes) throw new Error("La cible dépasse le maximum.");
  const isMinor = body.isMinor === true;
  if (isMinor && targetMinutes > 1020) throw new Error("Un employé de 17 ans ou moins ne peut pas demander plus de 17 h par semaine.");
  const seniority = validDate(body.seniority) ? body.seniority : "9999-12-31";
  return { name, role, roles, area: role === "packer" ? "packer" : "front", seniority,
    targetMinutes, maxMinutes, availability, notes: String(body.notes || "").slice(0, 300),
    active: body.active !== false, isMinor, allowExtraHours: body.allowExtraHours === true };
}
function desiredRank(value, fallback) {
  return value === undefined || value === null || value === ""
    ? fallback : parseMinutes(value, "Rang", 1, 500);
}
async function reorderEmployees(client, role, column, movedId, requestedRank) {
  const result = await client.query(`SELECT id FROM schedule_employees WHERE role=$1
    ORDER BY ${column}, seniority, id FOR UPDATE`, [role]);
  const ids = result.rows.map(row => Number(row.id)).filter(id => id !== movedId);
  if (movedId !== null) ids.splice(Math.min(requestedRank - 1, ids.length), 0, movedId);
  for (let i = 0; i < ids.length; i++) {
    await client.query(`UPDATE schedule_employees SET ${column}=$1 WHERE id=$2`, [i + 1, ids[i]]);
  }
}
function mapEmployee(row) {
  return { id: Number(row.id), name: row.name, role: row.role,
    roles: [...new Set([row.role, ...(Array.isArray(row.roles) ? row.roles : [])])], area: row.area,
    seniority: row.seniority, targetMinutes: row.target_minutes, maxMinutes: row.max_minutes,
    availability: row.availability, notes: row.notes, active: row.active,
    displayRank: row.display_rank, assignmentRank: row.assignment_rank,
    isMinor: row.is_minor, allowExtraHours: row.allow_extra_hours };
}

app.get("/api/employees", requireManager, async (_request, response) => {
  try {
    const result = await pool.query("SELECT * FROM schedule_employees ORDER BY role, display_rank, seniority, name");
    response.json({ employees: result.rows.map(mapEmployee) });
  } catch { response.status(500).json({ error: "Impossible de charger les employés." }); }
});
app.post("/api/employees/import", requireManager, sameOrigin, async (request, response) => {
  const client = await pool.connect();
  try {
    const people = request.body?.employees;
    if (!Array.isArray(people) || people.length < 1 || people.length > 250) throw new Error("Liste invalide.");
    const normalized = people.map(normalizeEmployee);
    if (new Set(normalized.map(e => e.name.toLocaleLowerCase("fr-CA"))).size !== normalized.length) throw new Error("Noms en double.");
    await client.query("BEGIN");
    const count = await client.query("SELECT COUNT(*)::int AS count FROM schedule_employees");
    if (count.rows[0].count) throw new Error("La liste existe déjà. Modifiez les employés individuellement.");
    for (const e of normalized) await client.query(
      `INSERT INTO schedule_employees (name,area,role,roles,seniority,target_minutes,max_minutes,availability,notes,active,is_minor,allow_extra_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [e.name,e.area,e.role,JSON.stringify(e.roles),e.seniority,e.targetMinutes,e.maxMinutes,JSON.stringify(e.availability),e.notes,e.active,e.isMinor,e.allowExtraHours]);
    for (const role of ["supervisor","cashier","packer","orders"]) {
      await client.query(`WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY seniority, id) AS position
        FROM schedule_employees WHERE role=$1
      ) UPDATE schedule_employees e SET display_rank=ranked.position, assignment_rank=ranked.position
        FROM ranked WHERE e.id=ranked.id`, [role]);
    }
    await client.query("COMMIT");
    response.status(201).json({ count: normalized.length });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    response.status(400).json({ error: error.message || "Import impossible." });
  } finally { client.release(); }
});
app.post("/api/employees", requireManager, sameOrigin, async (request, response) => {
  const client = await pool.connect();
  try {
    const e = normalizeEmployee(request.body || {});
    await client.query("BEGIN");
    const result = await client.query(`INSERT INTO schedule_employees (name,area,role,roles,seniority,target_minutes,max_minutes,availability,notes,active,is_minor,allow_extra_hours)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [e.name,e.area,e.role,JSON.stringify(e.roles),e.seniority,e.targetMinutes,e.maxMinutes,JSON.stringify(e.availability),e.notes,e.active,e.isMinor,e.allowExtraHours]);
    const id = Number(result.rows[0].id);
    const count = await client.query("SELECT COUNT(*)::int AS count FROM schedule_employees WHERE role=$1", [e.role]);
    await reorderEmployees(client,e.role,"display_rank",id,desiredRank(request.body?.displayRank,count.rows[0].count));
    await reorderEmployees(client,e.role,"assignment_rank",id,desiredRank(request.body?.assignmentRank,count.rows[0].count));
    const saved = await client.query("SELECT * FROM schedule_employees WHERE id=$1", [id]);
    await client.query("COMMIT");
    response.status(201).json({ employee: mapEmployee(saved.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    response.status(400).json({ error: error.message });
  } finally { client.release(); }
});
app.put("/api/employees/:id", requireManager, sameOrigin, async (request, response) => {
  const client = await pool.connect();
  try {
    const e = normalizeEmployee(request.body || {});
    await client.query("BEGIN");
    const before = await client.query("SELECT * FROM schedule_employees WHERE id=$1 FOR UPDATE", [request.params.id]);
    if (!before.rowCount) { await client.query("ROLLBACK"); return response.status(404).json({ error: "Employé introuvable." }); }
    await client.query(`UPDATE schedule_employees SET name=$1,area=$2,role=$3,roles=$4,seniority=$5,target_minutes=$6,max_minutes=$7,
      availability=$8,notes=$9,active=$10,is_minor=$11,allow_extra_hours=$12 WHERE id=$13 RETURNING *`,
      [e.name,e.area,e.role,JSON.stringify(e.roles),e.seniority,e.targetMinutes,e.maxMinutes,JSON.stringify(e.availability),e.notes,e.active,e.isMinor,e.allowExtraHours,request.params.id]);
    const id = Number(request.params.id), old = before.rows[0];
    if (old.role !== e.role) {
      await reorderEmployees(client,old.role,"display_rank",null,1);
      await reorderEmployees(client,old.role,"assignment_rank",null,1);
    }
    const count = await client.query("SELECT COUNT(*)::int AS count FROM schedule_employees WHERE role=$1", [e.role]);
    const fallbackDisplay = old.role===e.role ? old.display_rank : count.rows[0].count;
    const fallbackAssignment = old.role===e.role ? old.assignment_rank : count.rows[0].count;
    await reorderEmployees(client,e.role,"display_rank",id,desiredRank(request.body?.displayRank,fallbackDisplay));
    await reorderEmployees(client,e.role,"assignment_rank",id,desiredRank(request.body?.assignmentRank,fallbackAssignment));
    const saved = await client.query("SELECT * FROM schedule_employees WHERE id=$1", [id]);
    await client.query("COMMIT");
    response.json({ employee: mapEmployee(saved.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    response.status(400).json({ error: error.message });
  } finally { client.release(); }
});
app.get("/api/weeks/:weekStart/assignments", requireManager, async (request, response) => {
  try {
    const result = await pool.query(`SELECT a.shift_id, a.employee_id FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id
      WHERE s.week_start=$1`, [request.params.weekStart]);
    response.json({ assignments: result.rows.map(r => ({ shiftId:Number(r.shift_id), employeeId:Number(r.employee_id) })) });
  } catch { response.status(500).json({ error: "Impossible de charger l’horaire." }); }
});
app.get("/api/weeks/:weekStart/time-off", requireManager, async (request, response) => {
  try {
    if (!validDate(request.params.weekStart)) throw new Error("Semaine invalide.");
    const result = await pool.query("SELECT employee_id, day_index FROM schedule_time_off WHERE week_start=$1", [request.params.weekStart]);
    response.json({ timeOff: result.rows.map(r=>({employeeId:Number(r.employee_id),dayIndex:Number(r.day_index)})) });
  } catch { response.status(400).json({ error:"Impossible de charger les congés demandés." }); }
});
app.get("/api/weeks/:weekStart/day-exceptions", requireManager, async (request, response) => {
  try {
    if (!validDate(request.params.weekStart)) throw new Error("Semaine invalide.");
    const result = await pool.query("SELECT employee_id FROM schedule_day_exceptions WHERE week_start=$1", [request.params.weekStart]);
    response.json({ employeeIds: result.rows.map(row => Number(row.employee_id)) });
  } catch { response.status(400).json({ error: "Impossible de charger les exceptions de jours." }); }
});
app.put("/api/weeks/:weekStart/employees/:id/day-exception", requireManager, sameOrigin, async (request, response) => {
  try {
    const employeeId = Number(request.params.id), weekStart = request.params.weekStart;
    if (!validDate(weekStart) || !Number.isInteger(employeeId) || employeeId <= 0 || typeof request.body?.allowed !== "boolean")
      throw new Error("Exception de jours invalide.");
    await ensureWeek(weekStart);
    if (request.body.allowed) await pool.query(`INSERT INTO schedule_day_exceptions (week_start,employee_id)
      VALUES ($1,$2) ON CONFLICT DO NOTHING`, [weekStart,employeeId]);
    else await pool.query("DELETE FROM schedule_day_exceptions WHERE week_start=$1 AND employee_id=$2", [weekStart,employeeId]);
    response.json({ allowed: request.body.allowed });
  } catch (error) { response.status(400).json({ error: error.message }); }
});
app.put("/api/weeks/:weekStart/employees/:id/time-off", requireManager, sameOrigin, async (request, response) => {
  const client = await pool.connect();
  try {
    const weekStart = request.params.weekStart, employeeId = Number(request.params.id);
    const days = [...new Set(request.body?.days || [])];
    if (!validDate(weekStart) || !Number.isInteger(employeeId) || employeeId<=0
      || !Array.isArray(request.body?.days) || days.some(d=>!Number.isInteger(d)||d<0||d>6))
      throw new Error("Congés demandés invalides.");
    await client.query("BEGIN");
    await ensureWeek(weekStart,client);
    const employee = await client.query("SELECT id FROM schedule_employees WHERE id=$1 FOR UPDATE", [employeeId]);
    if (!employee.rowCount) throw new Error("Employé introuvable.");
    await client.query("DELETE FROM schedule_time_off WHERE week_start=$1 AND employee_id=$2", [weekStart,employeeId]);
    for (const day of days) await client.query(
      "INSERT INTO schedule_time_off (week_start,employee_id,day_index) VALUES ($1,$2,$3)",
      [weekStart,employeeId,day]);
    if (days.length) await client.query(`DELETE FROM schedule_assignments a USING schedule_shifts s
      WHERE a.shift_id=s.id AND a.employee_id=$1 AND s.week_start=$2 AND s.day_index=ANY($3::int[])`,
      [employeeId,weekStart,days]);
    await client.query("COMMIT");
    response.json({ days });
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    response.status(400).json({ error:error.message });
  } finally { client.release(); }
});
app.put("/api/shifts/:id/assignment", requireManager, sameOrigin, async (request, response) => {
  try {
    const id = Number(request.params.id), employeeId = Number(request.body?.employeeId);
    const shiftResult = await pool.query("SELECT * FROM schedule_shifts WHERE id=$1", [id]);
    if (!shiftResult.rowCount) return response.status(404).json({ error: "Quart introuvable." });
    if (request.body?.employeeId === null) {
      await pool.query("DELETE FROM schedule_assignments WHERE shift_id=$1", [id]);
      return response.json({ ok:true });
    }
    const people = await pool.query("SELECT * FROM schedule_employees WHERE id=$1", [employeeId]);
    if (!people.rowCount) throw new Error("Employé introuvable.");
    const s = mapShift(shiftResult.rows[0]), e = mapEmployee(people.rows[0]);
    e.allowSixOrSevenDays = !!(await pool.query("SELECT 1 FROM schedule_day_exceptions WHERE week_start=$1 AND employee_id=$2", [s.weekStart,employeeId])).rowCount;
    const leave = await pool.query(`SELECT 1 FROM schedule_time_off
      WHERE week_start=$1 AND employee_id=$2 AND day_index=$3`, [s.weekStart,employeeId,s.dayIndex]);
    if (leave.rowCount) throw new Error("Congé demandé pour cette journée.");
    const current = await pool.query(`SELECT a.shift_id, a.employee_id FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id
      WHERE s.week_start=$1 AND a.shift_id<>$2`, [s.weekStart,id]);
    const all = await pool.query("SELECT * FROM schedule_shifts WHERE week_start=$1", [s.weekStart]);
    if (!canAssign(e,s,all.rows.map(mapShift),current.rows.map(r=>({shiftId:Number(r.shift_id),employeeId:Number(r.employee_id)}))))
      throw new Error("Disponibilité, fonction, maximum de cinq jours, maximum d’heures, limite des 17 ans et moins ou autre quart incompatible.");
    await pool.query(`INSERT INTO schedule_assignments (shift_id,employee_id) VALUES ($1,$2)
      ON CONFLICT (shift_id) DO UPDATE SET employee_id=EXCLUDED.employee_id`, [id,employeeId]);
    response.json({ ok:true });
  } catch (error) { response.status(400).json({ error:error.message }); }
});
app.post("/api/weeks/:weekStart/generate", requireManager, sameOrigin, async (request, response) => {
  const client = await pool.connect();
  try {
    if (!validDate(request.params.weekStart)) throw new Error("Semaine invalide.");
    await client.query("BEGIN");
    const shifts = (await client.query("SELECT * FROM schedule_shifts WHERE week_start=$1 ORDER BY id FOR UPDATE", [request.params.weekStart])).rows.map(mapShift);
    const employees = (await client.query("SELECT * FROM schedule_employees")).rows.map(mapEmployee);
    const exceptions = (await client.query("SELECT employee_id FROM schedule_day_exceptions WHERE week_start=$1", [request.params.weekStart])).rows;
    for (const e of employees) e.allowSixOrSevenDays = exceptions.some(x => Number(x.employee_id) === e.id);
    const leaves = (await client.query("SELECT employee_id, day_index FROM schedule_time_off WHERE week_start=$1", [request.params.weekStart])).rows;
    for (const leave of leaves) {
      const employee=employees.find(e=>e.id===Number(leave.employee_id));
      if (employee) employee.availability={...employee.availability,[leave.day_index]:[]};
    }
    if (request.body?.replaceAll === true) {
      await client.query(`DELETE FROM schedule_assignments WHERE shift_id IN
        (SELECT id FROM schedule_shifts WHERE week_start=$1)`, [request.params.weekStart]);
    }
    const current = (await client.query(`SELECT a.shift_id, a.employee_id FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id
      WHERE s.week_start=$1`, [request.params.weekStart])).rows.map(r=>({shiftId:Number(r.shift_id),employeeId:Number(r.employee_id)}));
    const result = generateAssignments(shifts, employees, current);
    for (const a of result.assignments) await client.query("INSERT INTO schedule_assignments (shift_id,employee_id) VALUES ($1,$2)", [a.shiftId,a.employeeId]);
    await client.query("COMMIT");
    response.json({ ...result, preserved:current.length });
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    response.status(400).json({ error:error.message || "Génération impossible." });
  } finally { client.release(); }
});

app.get("/health", (_request, response) => response.json({ ok: true }));
app.post("/api/login", sameOrigin, (request, response) => {
  const ip = request.ip || "unknown";
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, since: now };
  if (now - entry.since > 15 * 60 * 1000) { entry.count = 0; entry.since = now; }
  if (entry.count >= 10) return response.status(429).json({ error: "Trop d’essais. Attendez 15 minutes." });
  if (!secureEqual(String(request.body?.code || "").trim(), process.env.MANAGER_CODE)) {
    entry.count += 1; attempts.set(ip, entry);
    return response.status(401).json({ error: "Code incorrect." });
  }
  attempts.delete(ip);
  response.setHeader("Set-Cookie", `schedule_session=${encodeURIComponent(issueSession())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${production ? "; Secure" : ""}`);
  response.json({ role: "manager" });
});
app.post("/api/logout", sameOrigin, (_request, response) => {
  response.setHeader("Set-Cookie", `schedule_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production ? "; Secure" : ""}`);
  response.json({ ok: true });
});
app.get("/api/session", (request, response) => response.json({ role: readSession(request)?.role || null }));

app.get("/api/weeks/:weekStart", requireManager, async (request, response) => {
  try {
    const { weekStart } = request.params;
    if (!validDate(weekStart)) return response.status(400).json({ error: "Date invalide." });
    await ensureWeek(weekStart);
    const [weekResult, shiftsResult] = await Promise.all([
      pool.query("SELECT * FROM schedule_weeks WHERE week_start=$1", [weekStart]),
      pool.query("SELECT * FROM schedule_shifts WHERE week_start=$1 ORDER BY area, day_index, start_minute, id", [weekStart]),
    ]);
    response.json({ week: mapWeek(weekResult.rows[0]), shifts: shiftsResult.rows.map(mapShift) });
  } catch (error) {
    console.error("GET week", error);
    response.status(500).json({ error: "Impossible de charger la semaine." });
  }
});

app.put("/api/weeks/:weekStart", requireManager, sameOrigin, async (request, response) => {
  try {
    const { weekStart } = request.params;
    if (!validDate(weekStart)) return response.status(400).json({ error: "Date invalide." });
    const cashierBudgetMinutes = parseMinutes(request.body?.cashierBudgetMinutes, "Budget caisse", 0, 100000);
    const packerBudgetMinutes = parseMinutes(request.body?.packerBudgetMinutes, "Budget emballeurs", 0, 100000);
    const notes = String(request.body?.notes || "").trim().slice(0, 1000);
    await ensureWeek(weekStart);
    const result = await pool.query(`UPDATE schedule_weeks SET cashier_budget_minutes=$1, packer_budget_minutes=$2, notes=$3, updated_at=NOW() WHERE week_start=$4 RETURNING *`, [cashierBudgetMinutes, packerBudgetMinutes, notes, weekStart]);
    response.json({ week: mapWeek(result.rows[0]) });
  } catch (error) {
    response.status(400).json({ error: error.message || "Paramètres invalides." });
  }
});

app.post("/api/weeks/:weekStart/shifts", requireManager, sameOrigin, async (request, response) => {
  const client = await pool.connect();
  try {
    const { weekStart } = request.params;
    if (!validDate(weekStart)) throw new Error("Date invalide.");
    const shift = normalizeShift(request.body || {});
    const days = [...new Set(Array.isArray(request.body?.days) ? request.body.days.map(Number) : [])];
    if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Choisissez au moins une journée.");
    await client.query("BEGIN");
    await ensureWeek(weekStart, client);
    const created = [];
    for (const dayIndex of days) {
      const result = await client.query(`INSERT INTO schedule_shifts (week_start, area, role, day_index, start_minute, end_minute, break_minutes, source_department, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [weekStart, shift.area, shift.role, dayIndex, shift.startMinute, shift.endMinute, shift.breakMinutes, shift.sourceDepartment, shift.notes]);
      created.push(mapShift(result.rows[0]));
    }
    await client.query("COMMIT");
    response.status(201).json({ shifts: created });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    response.status(400).json({ error: error.message || "Quart invalide." });
  } finally { client.release(); }
});

app.put("/api/shifts/:id", requireManager, sameOrigin, async (request, response) => {
  try {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Quart invalide.");
    const shift = normalizeShift(request.body || {});
    const dayIndex = parseMinutes(request.body?.dayIndex, "Journée", 0, 6);
    const result = await pool.query(`UPDATE schedule_shifts SET area=$1, role=$2, day_index=$3, start_minute=$4, end_minute=$5, break_minutes=$6, source_department=$7, notes=$8, updated_at=NOW() WHERE id=$9 RETURNING *`, [shift.area, shift.role, dayIndex, shift.startMinute, shift.endMinute, shift.breakMinutes, shift.sourceDepartment, shift.notes, id]);
    if (!result.rowCount) return response.status(404).json({ error: "Quart introuvable." });
    response.json({ shift: mapShift(result.rows[0]) });
  } catch (error) { response.status(400).json({ error: error.message || "Quart invalide." }); }
});

app.delete("/api/shifts/:id", requireManager, sameOrigin, async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ error: "Quart invalide." });
  await pool.query("DELETE FROM schedule_shifts WHERE id=$1", [id]);
  response.json({ ok: true });
});

app.post("/api/weeks/:weekStart/copy-previous", requireManager, sameOrigin, async (request, response) => {
  const client = await pool.connect();
  try {
    const { weekStart } = request.params;
    if (!validDate(weekStart)) throw new Error("Date invalide.");
    const previous = addDays(weekStart, -7);
    await client.query("BEGIN");
    await ensureWeek(weekStart, client);
    const count = await client.query("SELECT COUNT(*)::int AS count FROM schedule_shifts WHERE week_start=$1", [weekStart]);
    if (count.rows[0].count > 0) throw new Error("La semaine contient déjà des quarts.");
    const previousWeek = await client.query("SELECT * FROM schedule_weeks WHERE week_start=$1", [previous]);
    if (!previousWeek.rowCount) throw new Error("La semaine précédente est vide.");
    const previousCount = await client.query("SELECT COUNT(*)::int AS count FROM schedule_shifts WHERE week_start=$1", [previous]);
    if (previousCount.rows[0].count === 0) throw new Error("La semaine précédente ne contient aucun quart.");
    await client.query(`UPDATE schedule_weeks SET cashier_budget_minutes=$1, packer_budget_minutes=$2, notes='', updated_at=NOW() WHERE week_start=$3`, [previousWeek.rows[0].cashier_budget_minutes, previousWeek.rows[0].packer_budget_minutes, weekStart]);
    await client.query(`INSERT INTO schedule_shifts (week_start, area, role, day_index, start_minute, end_minute, break_minutes, source_department, notes, sort_order) SELECT $1, area, role, day_index, start_minute, end_minute, break_minutes, source_department, notes, sort_order FROM schedule_shifts WHERE week_start=$2`, [weekStart, previous]);
    await client.query("COMMIT");
    response.json({ copiedFrom: previous });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    response.status(400).json({ error: error.message || "Copie impossible." });
  } finally { client.release(); }
});

app.use(express.static("public", { extensions: ["html"] }));
app.use((_request, response) => response.status(404).json({ error: "Page introuvable." }));
app.listen(port, () => console.log(`Quarts Service IGA sur le port ${port}`));
