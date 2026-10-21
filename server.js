import {errorCode,installHealth,logEvent,requestDiagnostics,startupPhase} from './runtime-diagnostics.js';
import {installSalesForecasts} from './sales-forecasts.js';
import {installServiceChat} from './service-chat.js';
import {createServiceChatPush} from './service-chat-push.js';
import {installClothing} from './clothing.js';
import {shiftWithApprovedLeave,storedShiftAbsence,editedShiftLeave} from './public/approved-shift-leave.js';
import {saveShiftLeave} from './approved-shift-leave.js';
import {serviceShiftTiming} from './public/service-rules.js';
import {publishServiceWeek,publishedServiceResult} from './service-publication.js';
import {serviceRevision,assertServiceRevision,commitServiceTransaction} from './service-concurrency.js';
import {installPdfAssets} from './pdf-assets.js';
import {installManagerAccess} from './manager-access.js';
import crypto from "node:crypto";
import {employeeAvailability,localDate} from "./availability-rules.js";
import {availabilityRevision,recordManualAvailability,saveAvailabilityHistory} from "./availability.js";
import {beginUndo,installUndo} from "./undo.js";
import {recordDeparture} from './employee-status.js';
import express from "express";
import pg from "pg";
import {saveEmployeeCode} from './employee-portal.js';
import {installDepartmentSchedules} from './department-schedules.js';
import {installLeave, approvedLeave} from "./leave.js";
import {conflictsWithLeave} from "./leave-rules.js";
import { assignmentConflict, generateAssignments } from "./scheduler.js";
import {backupBeforeRegeneration,finishRegenerationBackup,installScheduleBackup} from './schedule-backup.js';
import {applyServiceRoleDefault,copyServiceShifts} from './service-role-defaults.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === "production";

startupPhase('configuration');
for (const key of ["DATABASE_URL", "SESSION_SECRET", "MANAGER_CODE"]) {
  if (!process.env[key]) throw Object.assign(new Error(`Variable requise absente: ${key}`),{code:'MISSING_'+key});
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: production ? { rejectUnauthorized: false } : false,
  max: 5,
  connectionTimeoutMillis: 3000,
});
pool.on('error',error=>logEvent('database_pool_error',{code:errorCode(error)},'error'));
startupPhase('schema_core');
const attempts = new Map();
const scheduleAccessAttempts = new Map();
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
app.disable("x-powered-by");
startupPhase('http_setup');
app.use(requestDiagnostics);
app.set("trust proxy", 1);
app.use('/api/departments/photos',requireManager,sameOrigin,express.json({limit:'12mb'}));
app.use('/api/departments/document-mail',requireManager,sameOrigin,express.json({limit:'13mb'}));
app.use(express.json({ limit: "250kb" }));
let chatPush=null;
app.use(['/api/logout','/api/employee-portal/logout'],sameOrigin,async(req,res,next)=>{
  if(req.method!=='POST')return next();
  try{await chatPush?.logout(req,res);next();}
  catch{res.status(503).json({error:'Impossible de désactiver les notifications de cet appareil. Réessaie avant de te déconnecter.'});}
});
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
function issueSession(identity = {}) {
  const payload = Buffer.from(JSON.stringify({ ...identity, role: "manager", expiresAt: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
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
function staffCodeHash(code) { return crypto.createHmac("sha256", sessionSecret).update(`staff-code:${code}`).digest("hex"); }
function staffAccessCookie(token, codeHash) {
  const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
  return `${token}.${expires}.${sign(`staff-access:${token}:${codeHash}:${expires}`)}`;
}
function hasStaffAccess(request, token, codeHash) {
  const cookie = parseCookies(request.headers.cookie).schedule_view || "";
  const [issuedToken, expires, signature] = cookie.split(".");
  return issuedToken === token && /^\d{13}$/.test(expires || "") && Number(expires) > Date.now()
    && typeof signature === "string" && secureEqual(signature, sign(`staff-access:${token}:${codeHash}:${expires}`));
}
async function requireManager(request, response, next) {
  try { await managerAccess.authorize(request); next(); }
  catch(error) { response.status(error.status||500).json({error:error.status?error.message:'Impossible de vérifier l’accès.'}); }
}
startupPhase('schema_manager_access');
const managerAccess=await installManagerAccess(app,pool,{readSession,issueSession,sameOrigin,production});
function sameOrigin(request, response, next) {
  const origin = request.get("origin");
  if (origin && new URL(origin).host !== request.get("host")) return response.status(403).json({ error: "Requête refusée." });
  next();
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value; }
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
  if (!["cashier", "supervisor", "support", "packer", "orders", "manager"].includes(role)) throw new Error("Fonction invalide.");
  const startMinute = parseMinutes(body.startMinute, "Heure de début", 0, 1439);
  const endMinute = parseMinutes(body.endMinute, "Heure de fin", 1, 1440);
  const {breakMinutes,absence} = serviceShiftTiming(startMinute,endMinute,body.absence);
  return {
    role,
    area: role === "packer" ? "packer" : "front",
    startMinute,
    endMinute,
    breakMinutes, absence:absence||null,
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
    ...serviceShiftTiming(Number(row.start_minute),Number(row.end_minute),row.absence),
    ...(row.absence?.approvedLeave?{approvedLeaveAbsence:row.absence.approvedLeave}:{}),
    sourceDepartment: row.source_department, notes: row.notes,
  };
}

function normalizeEmployee(body) {
  const name = String(body.name || "").trim().slice(0, 100);
  const role = String(body.role || "");
  if (!name || !["cashier", "supervisor", "packer", "orders", "manager"].includes(role)) throw new Error("Nom ou fonction invalide.");
  const allowedRoles = ["cashier", "supervisor", "packer", "orders", "manager"];
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
async function saveServicePersonal(client,id,body){
  if(body.employeeCode===undefined&&body.birthday===undefined)return;
  const birthday=body.birthday;
  if(birthday!==undefined&&(typeof birthday!=='string'||birthday&&(!validDate(birthday)||birthday>new Date().toISOString().slice(0,10)||birthday<'1900-01-01')))throw Error('Date de naissance invalide.');
  await client.query('INSERT INTO schedule_store_people(service_employee_id,name) SELECT id,name FROM schedule_employees WHERE id=$1 ON CONFLICT(service_employee_id) DO NOTHING',[id]);
  const person=(await client.query('SELECT id FROM schedule_store_people WHERE service_employee_id=$1',[id])).rows[0];
  await saveEmployeeCode(client,person.id,body.employeeCode);
  if(birthday!==undefined)await client.query('UPDATE schedule_store_people SET birthday=$1,version=version+1 WHERE id=$2',[birthday||null,person.id]);
}
function mapEmployee(row,weekStart=null) {
  const profile=employeeAvailability(row,{weekStart:typeof weekStart==='string'&&validDate(weekStart)?weekStart:null});
  return { id: Number(row.id), name: row.name, role: row.role, employeeCode:row.employee_code||'',birthday:row.birthday?isoDate(row.birthday):'',
    roles: [...new Set([row.role, ...(Array.isArray(row.roles) ? row.roles : [])])], area: row.area,
    seniority: row.seniority, targetMinutes: row.target_minutes, maxMinutes: row.max_minutes,
    availability: row.availability, notes: row.notes, active: row.active && !row.departed_at, departedAt: row.departed_at,
    displayRank: row.display_rank, assignmentRank: row.assignment_rank,
    isMinor: row.is_minor, allowExtraHours: row.allow_extra_hours, ...profile, availabilityRevision:availabilityRevision(row) };
}

app.get("/api/employees", requireManager, async (request, response) => {
  try {
    if(request.query.weekStart&&!validDate(request.query.weekStart))return response.status(400).json({error:"Semaine invalide."});
    const result = await pool.query("SELECT e.*,p.employee_code,p.birthday FROM schedule_employees e LEFT JOIN schedule_store_people p ON p.service_employee_id=e.id ORDER BY e.role, e.display_rank, e.seniority, e.name");
    response.json({ employees: result.rows.map(row=>mapEmployee(row,request.query.weekStart)) });
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
    await beginUndo(client,"Importer les employés",request.params.weekStart||null,request);
    const count = await client.query("SELECT COUNT(*)::int AS count FROM schedule_employees");
    if (count.rows[0].count) throw new Error("La liste existe déjà. Modifiez les employés individuellement.");
    for (const e of normalized) await client.query(
      `INSERT INTO schedule_employees (name,area,role,roles,seniority,target_minutes,max_minutes,availability,notes,active,is_minor,allow_extra_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [e.name,e.area,e.role,JSON.stringify(e.roles),e.seniority,e.targetMinutes,e.maxMinutes,JSON.stringify(e.availability),e.notes,e.active,e.isMinor,e.allowExtraHours]);
    for (const role of ["manager","supervisor","cashier","packer","orders"]) {
      await client.query(`WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY seniority, id) AS position
        FROM schedule_employees WHERE role=$1
      ) UPDATE schedule_employees e SET display_rank=ranked.position, assignment_rank=ranked.position
        FROM ranked WHERE e.id=ranked.id`, [role]);
    }
    await commitServiceTransaction(client,request);
    response.status(201).json({ count: normalized.length });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    response.status(error.status||400).json({ error: error.message || "Import impossible." });
  } finally { client.release(); }
});
app.post("/api/employees", requireManager, sameOrigin, async (request, response) => {
  const client = await pool.connect();
  try {
    const e = normalizeEmployee(request.body || {});
    await client.query("BEGIN");
    await beginUndo(client,"Ajouter un employé",request.params.weekStart||null,request);
    const result = await client.query(`INSERT INTO schedule_employees (name,area,role,roles,seniority,target_minutes,max_minutes,availability,notes,active,is_minor,allow_extra_hours)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [e.name,e.area,e.role,JSON.stringify(e.roles),e.seniority,e.targetMinutes,e.maxMinutes,JSON.stringify(e.availability),e.notes,e.active,e.isMinor,e.allowExtraHours]);
    const id = Number(result.rows[0].id);
    const count = await client.query("SELECT COUNT(*)::int AS count FROM schedule_employees WHERE role=$1", [e.role]);
    await reorderEmployees(client,e.role,"display_rank",id,desiredRank(request.body?.displayRank,count.rows[0].count));
    await reorderEmployees(client,e.role,"assignment_rank",id,desiredRank(request.body?.assignmentRank,count.rows[0].count));
    await saveServicePersonal(client,id,request.body);
    const saved = await client.query("SELECT e.*,p.employee_code,p.birthday FROM schedule_employees e LEFT JOIN schedule_store_people p ON p.service_employee_id=e.id WHERE e.id=$1", [id]);
    await commitServiceTransaction(client,request);
    response.status(201).json({ employee: mapEmployee(saved.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    response.status(error.status||400).json({ error: error.message });
  } finally { client.release(); }
});
app.put("/api/employees/:id", requireManager, sameOrigin, async (request, response) => {
  const client = await pool.connect();
  try {
    const e = normalizeEmployee(request.body || {});
    await client.query("BEGIN");
    await beginUndo(client,"Modifier un employé",request.params.weekStart||null,request);
    await client.query("SELECT pg_advisory_xact_lock(8675309)");
    const before = await client.query("SELECT * FROM schedule_employees WHERE id=$1 FOR UPDATE", [request.params.id]);
    if (!before.rowCount) { await client.query("ROLLBACK"); return response.status(404).json({ error: "Employé introuvable." }); }
    if(before.rows[0].departed_at){await client.query('ROLLBACK');return response.status(409).json({error:'Cet employé a été retiré pour un départ définitif. Sa fiche ne peut plus être modifiée.'});}
    const availabilityHistory=await recordManualAvailability(client,before.rows[0],e,request.body||{});
    if(availabilityHistory.some(v=>v.effectiveDate>=localDate()&&v.targetMinutes>Math.min(e.maxMinutes,e.isMinor?1020:3000)))throw new Error("Une disponibilité approuvée demande plus d’heures que ce nouveau maximum. Révisez d’abord la demande.");
    await client.query(`UPDATE schedule_employees SET name=$1,area=$2,role=$3,roles=$4,seniority=$5,target_minutes=$6,max_minutes=$7,
      availability=$8,notes=$9,active=$10,is_minor=$11,allow_extra_hours=$12 WHERE id=$13 RETURNING *`,
      [e.name,e.area,e.role,JSON.stringify(e.roles),e.seniority,e.targetMinutes,e.maxMinutes,JSON.stringify(e.availability),e.notes,e.active,e.isMinor,e.allowExtraHours,request.params.id]);
    if(availabilityHistory.length)await saveAvailabilityHistory(client,Number(request.params.id),availabilityHistory);
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
    await saveServicePersonal(client,id,request.body);
    const saved = await client.query("SELECT e.*,p.employee_code,p.birthday FROM schedule_employees e LEFT JOIN schedule_store_people p ON p.service_employee_id=e.id WHERE e.id=$1", [id]);
    await commitServiceTransaction(client,request);
    response.json({ employee: mapEmployee(saved.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    response.status(error.status||400).json({ error: error.message });
  } finally { client.release(); }
});
app.post('/api/employees/:id/departure',requireManager,sameOrigin,async(request,response)=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const employee=await recordDeparture(client,Number(request.params.id),request);
    await commitServiceTransaction(client,request);response.json({employee:mapEmployee(employee)});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});response.status(error.status||400).json({error:error.message});}
  finally{client.release();}
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
  const client=await pool.connect();
  try {
    const employeeId = Number(request.params.id), weekStart = request.params.weekStart;
    if (!validDate(weekStart) || !Number.isInteger(employeeId) || employeeId <= 0 || typeof request.body?.allowed !== "boolean")
      throw new Error("Exception de jours invalide.");
    await client.query('BEGIN');
    await beginUndo(client,'Modifier l’exception de jours',weekStart,request);
    await ensureWeek(weekStart,client);
    if (request.body.allowed) await client.query(`INSERT INTO schedule_day_exceptions (week_start,employee_id)
      VALUES ($1,$2) ON CONFLICT DO NOTHING`, [weekStart,employeeId]);
    else await client.query("DELETE FROM schedule_day_exceptions WHERE week_start=$1 AND employee_id=$2", [weekStart,employeeId]);
    await commitServiceTransaction(client,request);
    response.json({ allowed: request.body.allowed });
  } catch (error) {await client.query('ROLLBACK').catch(()=>{}); response.status(error.status||400).json({ error: error.message }); }
  finally{client.release();}
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
    await beginUndo(client,"Modifier les congés manuels",request.params.weekStart||null,request);
    await client.query("SELECT pg_advisory_xact_lock(8675309)");
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
    await commitServiceTransaction(client,request);
    response.json({ days });
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    response.status(error.status||400).json({ error:error.message });
  } finally { client.release(); }
});
app.put("/api/shifts/:id/assignment", requireManager, sameOrigin, async (request, response) => {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(8675309)");
    const id = Number(request.params.id), employeeId = Number(request.body?.employeeId);
    const shiftResult = await client.query("SELECT * FROM schedule_shifts WHERE id=$1", [id]);
    if (!shiftResult.rowCount) throw new Error("Quart introuvable.");
    await beginUndo(client,"Modifier une affectation",isoDate(shiftResult.rows[0].week_start),request);
    if (request.body?.employeeId === null) {
      await client.query("DELETE FROM schedule_assignments WHERE shift_id=$1", [id]);
      const before=mapShift(shiftResult.rows[0]);
      const shift=await saveShiftLeave(client,before,shiftWithApprovedLeave(before));
      await commitServiceTransaction(client,request);
      return response.json({ ok:true,shift });
    }
    const people = await client.query("SELECT * FROM schedule_employees WHERE id=$1", [employeeId]);
    if (!people.rowCount) throw new Error("Employé introuvable.");
    const before = mapShift(shiftResult.rows[0]), e = mapEmployee(people.rows[0],before.weekStart);
    let s=before;
    e.leavePeriods=(await approvedLeave(client,s.weekStart)).filter(r=>Number(r.employee_id)===employeeId).flatMap(r=>r.periods);
    s=shiftWithApprovedLeave(s,e.leavePeriods,employeeId);
    if(conflictsWithLeave(s,e.leavePeriods)) throw new Error("Un congé approuvé chevauche ce quart.");
    e.allowSixOrSevenDays = !!(await client.query("SELECT 1 FROM schedule_day_exceptions WHERE week_start=$1 AND employee_id=$2", [s.weekStart,employeeId])).rowCount;
    const leave = await client.query(`SELECT 1 FROM schedule_time_off
      WHERE week_start=$1 AND employee_id=$2 AND day_index=$3`, [s.weekStart,employeeId,s.dayIndex]);
    if (leave.rowCount) throw new Error("Congé demandé pour cette journée.");
    const current = await client.query(`SELECT a.shift_id, a.employee_id FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id
      WHERE s.week_start=$1 AND a.shift_id<>$2`, [s.weekStart,id]);
    const all = await client.query("SELECT * FROM schedule_shifts WHERE week_start=$1", [s.weekStart]);
    const conflict = assignmentConflict(e,s,all.rows.map(mapShift),current.rows.map(r=>({shiftId:Number(r.shift_id),employeeId:Number(r.employee_id)})));
    if (conflict) throw new Error(conflict);
    await client.query(`INSERT INTO schedule_assignments (shift_id,employee_id) VALUES ($1,$2)
      ON CONFLICT (shift_id) DO UPDATE SET employee_id=EXCLUDED.employee_id`, [id,employeeId]);
    await saveShiftLeave(client,before,s);
    const savedShift=await applyServiceRoleDefault(client,s,e);
    await commitServiceTransaction(client,request);
    response.json({ ok:true,shift:savedShift });
  } catch (error) { await client.query("ROLLBACK").catch(()=>{}); response.status(error.status||400).json({ error:error.message }); } finally { client.release(); }
});
app.post("/api/weeks/:weekStart/generate", requireManager, sameOrigin, async (request, response) => {
  const client = await pool.connect();
  try {
    if (!validDate(request.params.weekStart)) throw new Error("Semaine invalide.");
    await client.query("BEGIN");
    await beginUndo(client,request.body?.replaceAll===true?"Recréer selon les priorités":"Attribuer les quarts libres",request.params.weekStart||null,request);
    await client.query("SELECT pg_advisory_xact_lock(8675309)");
    const shifts = (await client.query("SELECT * FROM schedule_shifts WHERE week_start=$1 ORDER BY id FOR UPDATE", [request.params.weekStart])).rows.map(mapShift);
    const employees = (await client.query("SELECT * FROM schedule_employees")).rows.map(row=>mapEmployee(row,request.params.weekStart));
    const approved=await approvedLeave(client,request.params.weekStart);
    for(const e of employees) e.leavePeriods=approved.filter(r=>Number(r.employee_id)===e.id).flatMap(r=>r.periods);
    const exceptions = (await client.query("SELECT employee_id FROM schedule_day_exceptions WHERE week_start=$1", [request.params.weekStart])).rows;
    for (const e of employees) e.allowSixOrSevenDays = exceptions.some(x => Number(x.employee_id) === e.id);
    const leaves = (await client.query("SELECT employee_id, day_index FROM schedule_time_off WHERE week_start=$1", [request.params.weekStart])).rows;
    for (const leave of leaves) {
      const employee=employees.find(e=>e.id===Number(leave.employee_id));
      if (employee) employee.availability={...employee.availability,[leave.day_index]:[]};
    }
    let backupId;
    if (request.body?.replaceAll === true) {
      backupId=await backupBeforeRegeneration(client,request.params.weekStart);
      await client.query(`DELETE FROM schedule_assignments WHERE shift_id IN
        (SELECT id FROM schedule_shifts WHERE week_start=$1)`, [request.params.weekStart]);
    }
    const current = (await client.query(`SELECT a.shift_id, a.employee_id FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id
      WHERE s.week_start=$1`, [request.params.weekStart])).rows.map(r=>({shiftId:Number(r.shift_id),employeeId:Number(r.employee_id)}));
    const result = generateAssignments(shifts, employees, current);
    for(const shift of shifts.filter(s=>!current.some(a=>a.shiftId===s.id))){
      const employee=employees.find(e=>e.id===result.assignments.find(a=>a.shiftId===shift.id)?.employeeId);
      await saveShiftLeave(client,shift,shiftWithApprovedLeave(shift,employee?.leavePeriods,employee?.id));
    }
    for (const a of result.assignments) {
      await client.query("INSERT INTO schedule_assignments (shift_id,employee_id) VALUES ($1,$2)", [a.shiftId,a.employeeId]);
      await applyServiceRoleDefault(client,shifts.find(s=>s.id===a.shiftId),employees.find(e=>e.id===a.employeeId));
    }
    if(backupId)await finishRegenerationBackup(client,backupId,request.params.weekStart);
    await commitServiceTransaction(client,request);
    response.json({ ...result, preserved:current.length });
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    response.status(error.status||400).json({ error:error.message || "Génération impossible." });
  } finally { client.release(); }
});

startupPhase('schema_leave');
const leaveAccess=await installLeave(app,pool,{requireManager,sameOrigin,hasStaffAccess});
startupPhase('schema_departments');
const departmentService=await installDepartmentSchedules(app,pool,{requireManager,sameOrigin,requireStaff:leaveAccess.requireStaff});
const employeePortal=departmentService.employeePortal;
startupPhase('schema_chat_push');
chatPush=await installServiceChat(app,pool,{employeePortal,managerAccess,sameOrigin,
  pushFactory:pool=>createServiceChatPush(pool,{secret:sessionSecret})});
startupPhase('schema_clothing');
await installClothing(app,pool,{requireManager,sameOrigin,requireStaff:leaveAccess.requireStaff});
startupPhase('schema_backups');
await installScheduleBackup(app,pool,{requireManager,sameOrigin});
startupPhase('schema_undo');
await installUndo(app,pool,{requireManager,sameOrigin});
app.get("/conges-test", (_req,res)=>res.sendFile("conges.html",{root:"public"}));

installHealth(app,pool);
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
app.get("/api/session", async (request, response) => {
  try { const user=await managerAccess.identity(request);const service=(await pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0];if(user)user.serviceAccess=user.kind==='admin'||user.departments.includes(Number(service?.id));response.set('Cache-Control','no-store').json({role:user?'manager':null,user}); }
  catch { response.status(500).json({error:'Impossible de vérifier la connexion.'}); }
});

app.get("/api/weeks/:weekStart/share-link", requireManager, async (request, response) => {
  try {
    if (!validDate(request.params.weekStart)) return response.status(400).json({ error: "Semaine invalide." });
    const result = await pool.query("SELECT token FROM schedule_public_links WHERE week_start=$1", [request.params.weekStart]);
    response.set("Cache-Control", "no-store").json({ path: result.rowCount ? `/h/${result.rows[0].token}` : null });
  } catch { response.status(500).json({ error: "Impossible de charger le lien." }); }
});
app.put("/api/weeks/:weekStart/share-link", requireManager, sameOrigin, async (request, response) => {
  const client=await pool.connect();
  try {
    if (!validDate(request.params.weekStart)) return response.status(400).json({ error: "Semaine invalide." });
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
    await assertServiceRevision(client,request.params.weekStart,request);
    await ensureWeek(request.params.weekStart,client);
    const token = crypto.randomBytes(32).toString("base64url");
    const result = await client.query(`INSERT INTO schedule_public_links (week_start,token,access_code_hash) VALUES ($1,$2,$3)
      ON CONFLICT (week_start) DO UPDATE SET week_start=EXCLUDED.week_start RETURNING token`, [request.params.weekStart,token,'']);
    const notification=await publishServiceWeek(client,request.params.weekStart);
    if(notification)await chatPush.enqueueSchedule(client,request.params.weekStart,notification);
    await commitServiceTransaction(client,request);
    chatPush.kick();
    response.set("Cache-Control", "no-store").json({ path: `/h/${result.rows[0].token}`,notification });
  } catch(error) { await client.query('ROLLBACK').catch(()=>{});response.status(error.status||500).json({ error: error.status?error.message:"Impossible de publier cette semaine. Réessayez." }); }finally{client.release();}
});
app.delete("/api/weeks/:weekStart/share-link", requireManager, sameOrigin, async (request, response) => {
  const client=await pool.connect();
  try {
    if (!validDate(request.params.weekStart)) return response.status(400).json({ error: "Semaine invalide." });
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
    await assertServiceRevision(client,request.params.weekStart,request);
    await client.query('DELETE FROM schedule_public_links WHERE week_start=$1',[request.params.weekStart]);
    await commitServiceTransaction(client,request);response.json({ok:true});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});response.status(error.status||500).json({error:error.status?error.message:'Impossible de désactiver le lien.'});}finally{client.release();}
});

app.get("/api/weeks/:weekStart/schedule-views", requireManager, async (request, response) => {
  try {
    if (!validDate(request.params.weekStart)) return response.status(400).json({ error: "Semaine invalide." });
    const result = await pool.query(`SELECT e.id, e.name, e.role, v.first_viewed_at, v.last_viewed_at, v.view_count
      FROM schedule_employees e
      LEFT JOIN schedule_schedule_views v ON v.employee_id=e.id AND v.week_start=$1
      WHERE EXISTS (SELECT 1 FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id
        WHERE a.employee_id=e.id AND s.week_start=$1)
      ORDER BY (v.last_viewed_at IS NOT NULL), e.role, e.name`, [request.params.weekStart]);
    response.set("Cache-Control", "no-store").json({ employees: result.rows });
  } catch { response.status(500).json({ error: "Impossible de charger les consultations." }); }
});

app.get("/api/public-schedules/:token", employeePortal.requireEmployee, async (request, response) => {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) return response.status(404).json({ error: "Lien invalide." });
    const link = await pool.query("SELECT week_start,access_code_hash FROM schedule_public_links WHERE token=$1", [request.params.token]);
    if (!link.rowCount) return response.status(404).json({ error: "Lien désactivé ou invalide." });
    if (!request.employee.service_employee_id)
      return response.status(401).json({ error: "Code requis." });
    const weekStart = isoDate(link.rows[0].week_start);
    const publication=await publishedServiceResult(pool,weekStart);
    if(!publication)return response.status(404).json({error:'Cet horaire n’est pas publié.'});
    const employees=publication.data.employees.filter(e=>e.id===Number(request.employee.service_employee_id)).map(e=>({...e,birthdayMonthDay:request.employee.birthday?isoDate(request.employee.birthday).slice(5):''}));
    response.set({ "Cache-Control":"no-store", "X-Robots-Tag":"noindex, nofollow" }).json({ weekStart, employees });
  } catch { response.status(500).json({ error: "Impossible de charger l’horaire." }); }
});
app.post("/api/public-schedules/:token/views", sameOrigin, employeePortal.requireEmployee, async (request, response) => {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) return response.status(404).json({ error: "Lien invalide." });
    const link = await pool.query("SELECT week_start,access_code_hash FROM schedule_public_links WHERE token=$1", [request.params.token]);
    if (!link.rowCount) return response.status(404).json({ error: "Lien désactivé ou invalide." });
    if (!request.employee.service_employee_id)
      return response.status(401).json({ error: "Code requis." });
    const employeeId = Number(request.employee.service_employee_id);
    if (!Number.isSafeInteger(employeeId) || employeeId <= 0) return response.status(400).json({ error: "Employé invalide." });
    const weekStart = isoDate(link.rows[0].week_start);
    const employee = await pool.query(`SELECT 1 FROM schedule_employees e WHERE e.id=$1 AND
      (e.active=TRUE OR EXISTS (SELECT 1 FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id
        WHERE a.employee_id=e.id AND s.week_start=$2))`, [employeeId, weekStart]);
    if (!employee.rowCount) return response.status(404).json({ error: "Employé introuvable." });
    await pool.query(`INSERT INTO schedule_schedule_views (week_start,employee_id) VALUES ($1,$2)
      ON CONFLICT (week_start,employee_id) DO UPDATE SET last_viewed_at=NOW(),
      view_count=schedule_schedule_views.view_count+1`, [weekStart, employeeId]);
    response.set("Cache-Control", "no-store").json({ ok:true });
  } catch { response.status(500).json({ error: "Impossible d’enregistrer la consultation." }); }
});
app.post("/api/public-schedules/:token/access", sameOrigin, employeePortal.login);
app.get("/h/:token", (request, response) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) return response.status(404).send("Lien invalide.");
  response.set({ "Cache-Control":"no-store", "X-Robots-Tag":"noindex, nofollow" });
  response.redirect(302,"/horaires-departements");
});

installSalesForecasts(app,{requireManager});

app.get("/api/weeks/:weekStart", requireManager, async (request, response) => {
  const client=await pool.connect();
  try {
    const {weekStart}=request.params;
    if(!validDate(weekStart)||new Date(weekStart+'T12:00:00Z').getUTCDay()!==1)return response.status(400).json({error:'Choisissez une semaine commençant un lundi valide.'});
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
    await ensureWeek(weekStart,client);
    const week=(await client.query('SELECT * FROM schedule_weeks WHERE week_start=$1',[weekStart])).rows[0];
    const shifts=(await client.query('SELECT * FROM schedule_shifts WHERE week_start=$1 ORDER BY area,day_index,start_minute,id',[weekStart])).rows.map(mapShift);
    const employees=(await client.query('SELECT e.*,p.employee_code,p.birthday FROM schedule_employees e LEFT JOIN schedule_store_people p ON p.service_employee_id=e.id ORDER BY e.role,e.display_rank,e.seniority,e.name')).rows.map(row=>mapEmployee(row,weekStart));
    const assignments=(await client.query('SELECT a.shift_id,a.employee_id FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id WHERE s.week_start=$1',[weekStart])).rows.map(r=>({shiftId:Number(r.shift_id),employeeId:Number(r.employee_id)}));
    const timeOff=(await client.query('SELECT employee_id,day_index FROM schedule_time_off WHERE week_start=$1',[weekStart])).rows.map(r=>({employeeId:Number(r.employee_id),dayIndex:Number(r.day_index)}));
    const dayExceptions=(await client.query('SELECT employee_id FROM schedule_day_exceptions WHERE week_start=$1',[weekStart])).rows.map(r=>Number(r.employee_id));
    const approvedLeaves=await approvedLeave(client,weekStart),relatedDepartments=await departmentService.serviceRelated(weekStart,client);
    const link=(await client.query('SELECT token FROM schedule_public_links WHERE week_start=$1',[weekStart])).rows[0];
    const revision=await serviceRevision(client,weekStart);
    await client.query('COMMIT');
    response.set({'Cache-Control':'no-store','X-Service-Revision':revision}).json({week:mapWeek(week),shifts,employees,assignments,timeOff,dayExceptions,approvedLeaves,relatedDepartments,sharePath:link?'/h/'+link.token:null,revision});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});logEvent('week_read_failed',{code:errorCode(error)},'error');response.status(500).json({error:'Impossible de charger la semaine. Réessayez.'});}
  finally{client.release();}
});

app.put("/api/weeks/:weekStart", requireManager, sameOrigin, async (request, response) => {
  const client=await pool.connect();
  try {
    const { weekStart } = request.params;
    if (!validDate(weekStart)) return response.status(400).json({ error: "Date invalide." });
    const cashierBudgetMinutes = parseMinutes(request.body?.cashierBudgetMinutes, "Budget caisse", 0, 100000);
    const packerBudgetMinutes = parseMinutes(request.body?.packerBudgetMinutes, "Budget emballeurs", 0, 100000);
    const notes = String(request.body?.notes || "").trim().slice(0, 1000);
    await client.query('BEGIN');
    await beginUndo(client,'Modifier les budgets ou notes',weekStart,request);
    await ensureWeek(weekStart,client);
    const result = await client.query(`UPDATE schedule_weeks SET cashier_budget_minutes=$1, packer_budget_minutes=$2, notes=$3, updated_at=NOW() WHERE week_start=$4 RETURNING *`, [cashierBudgetMinutes, packerBudgetMinutes, notes, weekStart]);
    await commitServiceTransaction(client,request);
    response.json({ week: mapWeek(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    response.status(error.status||400).json({ error: error.message || "Paramètres invalides." });
  }finally{client.release();}
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
    await beginUndo(client,"Ajouter des quarts",request.params.weekStart||null,request);
    await client.query("SELECT pg_advisory_xact_lock(8675309)");
    await ensureWeek(weekStart, client);
    const created = [];
    for (const dayIndex of days) {
      const result = await client.query(`INSERT INTO schedule_shifts (week_start, area, role, day_index, start_minute, end_minute, break_minutes, source_department, notes, absence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [weekStart, shift.area, shift.role, dayIndex, shift.startMinute, shift.endMinute, shift.breakMinutes, shift.sourceDepartment, shift.notes, shift.absence]);
      created.push(mapShift(result.rows[0]));
    }
    await commitServiceTransaction(client,request);
    response.status(201).json({ shifts: created });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    response.status(error.status||400).json({ error: error.message || "Quart invalide." });
  } finally { client.release(); }
});

app.put("/api/shifts/:id", requireManager, sameOrigin, async (request, response) => {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(8675309)");
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Quart invalide.");
    let shift = normalizeShift(request.body || {});
    const dayIndex = parseMinutes(request.body?.dayIndex, "Journée", 0, 6);
    const existing=(await client.query("SELECT s.week_start,s.absence,a.employee_id FROM schedule_shifts s LEFT JOIN schedule_assignments a ON a.shift_id=s.id WHERE s.id=$1",[id])).rows[0];
    await beginUndo(client,"Modifier un quart",existing?isoDate(existing.week_start):null,request);
    if(existing?.employee_id){
      const weekStart=isoDate(existing.week_start);
      const periods=(await approvedLeave(client,weekStart)).filter(r=>String(r.employee_id)===String(existing.employee_id)).flatMap(r=>r.periods);
      shift=shiftWithApprovedLeave(editedShiftLeave({...shift,weekStart,dayIndex},existing),periods,existing.employee_id);
      if(conflictsWithLeave(shift,periods))throw new Error("Ce changement chevauche un congé approuvé. Réattribuez le quart d’abord.");
      const employeeId=Number(existing.employee_id),employee=mapEmployee((await client.query('SELECT * FROM schedule_employees WHERE id=$1',[employeeId])).rows[0],weekStart);
      employee.leavePeriods=periods;
      employee.allowSixOrSevenDays=!!(await client.query('SELECT 1 FROM schedule_day_exceptions WHERE week_start=$1 AND employee_id=$2',[weekStart,employeeId])).rowCount;
      if((await client.query('SELECT 1 FROM schedule_time_off WHERE week_start=$1 AND employee_id=$2 AND day_index=$3',[weekStart,employeeId,dayIndex])).rowCount)throw Error('Congé demandé pour cette journée. Réattribuez le quart d’abord.');
      const all=(await client.query('SELECT * FROM schedule_shifts WHERE week_start=$1',[weekStart])).rows.map(mapShift);
      const assigned=(await client.query('SELECT a.shift_id,a.employee_id FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id WHERE s.week_start=$1 AND a.shift_id<>$2',[weekStart,id])).rows.map(r=>({shiftId:Number(r.shift_id),employeeId:Number(r.employee_id)}));
      const conflict=assignmentConflict(employee,{...shift,...serviceShiftTiming(shift.startMinute,shift.endMinute,shift.absence),id,dayIndex},all,assigned);
      if(conflict)throw Error(conflict+' Réattribuez le quart d’abord.');
    }
    const result = await client.query(`UPDATE schedule_shifts SET area=$1, role=$2, day_index=$3, start_minute=$4, end_minute=$5, break_minutes=$6, source_department=$7, notes=$8, absence=$10, updated_at=NOW() WHERE id=$9 RETURNING *`, [shift.area, shift.role, dayIndex, shift.startMinute, shift.endMinute, shift.breakMinutes, shift.sourceDepartment, shift.notes, id, storedShiftAbsence(shift)]);
    if (!result.rowCount) throw new Error("Quart introuvable.");
    await commitServiceTransaction(client,request);
    response.json({ shift: mapShift(result.rows[0]) });
  } catch (error) { await client.query("ROLLBACK").catch(()=>{}); response.status(error.status||400).json({ error: error.message || "Quart invalide." }); } finally {client.release();}
});

app.delete("/api/shifts/:id", requireManager, sameOrigin, async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ error: "Quart invalide." });
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(8675309)');
    const previous=(await client.query("SELECT week_start FROM schedule_shifts WHERE id=$1",[id])).rows[0];
    await beginUndo(client,"Supprimer un quart",previous?isoDate(previous.week_start):null,request);
    await client.query("DELETE FROM schedule_shifts WHERE id=$1", [id]);
    await commitServiceTransaction(client,request);
    response.json({ ok: true });
  } catch {await client.query('ROLLBACK').catch(()=>{});response.status(500).json({error:'Suppression impossible.'});}
  finally {client.release();}
});

app.post("/api/weeks/:weekStart/copy-previous", requireManager, sameOrigin, async (request, response) => {
  const client = await pool.connect();
  try {
    const { weekStart } = request.params;
    if (!validDate(weekStart)) throw new Error("Date invalide.");
    const previous = addDays(weekStart, -7);
    await client.query("BEGIN");
    await beginUndo(client,"Copier la semaine précédente",request.params.weekStart||null,request);
    await client.query("SELECT pg_advisory_xact_lock(8675309)");
    await ensureWeek(weekStart, client);
    const count = await client.query("SELECT COUNT(*)::int AS count FROM schedule_shifts WHERE week_start=$1", [weekStart]);
    if (count.rows[0].count > 0) throw new Error("La semaine contient déjà des quarts.");
    const previousWeek = await client.query("SELECT * FROM schedule_weeks WHERE week_start=$1", [previous]);
    if (!previousWeek.rowCount) throw new Error("La semaine précédente est vide.");
    const previousCount = await client.query("SELECT COUNT(*)::int AS count FROM schedule_shifts WHERE week_start=$1", [previous]);
    if (previousCount.rows[0].count === 0) throw new Error("La semaine précédente ne contient aucun quart.");
    await client.query(`UPDATE schedule_weeks SET cashier_budget_minutes=$1, packer_budget_minutes=$2, notes='', updated_at=NOW() WHERE week_start=$3`, [previousWeek.rows[0].cashier_budget_minutes, previousWeek.rows[0].packer_budget_minutes, weekStart]);
    await copyServiceShifts(client,weekStart,previous);
    await commitServiceTransaction(client,request);
    response.json({ copiedFrom: previous });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    response.status(error.status||400).json({ error: error.message || "Copie impossible." });
  } finally { client.release(); }
});

installPdfAssets(app);
app.use(express.static("public", { extensions: ["html"] }));
app.use((_request, response) => response.status(404).json({ error: "Page introuvable." }));
app.use((error,_req,res,_next)=>{
  logEvent('http_unhandled_error',{code:errorCode(error)},'error');
  if(!res.headersSent)res.status(error.status>=400&&error.status<500?error.status:500).json({error:'Service temporairement indisponible. Réessayez.'});
});
startupPhase('listen');
const server=app.listen(port,()=>startupPhase('ready'));
const shutdown=()=>{
  startupPhase('shutdown');
  chatPush?.stop();
  server.close(async()=>{await pool.end();process.exit(0);});
  setTimeout(()=>process.exit(1),25000).unref();
};
process.once('SIGTERM',shutdown);
process.once('SIGINT',shutdown);
