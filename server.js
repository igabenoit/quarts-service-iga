import {installScheduledWorkSchema,runsInWebProcess,runScheduledWork} from './scheduled-work.js';
import {needsSchema,isPreparingPreview,usePreparedSchema} from './preview-schema.js';
import {installCash} from './cash-order.js';
import {installEthicsSource} from './onboarding/ethics-source.js';
import {installEmployeeFiles} from './employee-files.js';
import {employeeFilesStorage,previewEmployeeFilesStorage} from './employee-files-storage.js';
import {clearExpiredDocuments,sstImportUploads} from './document-uploads.js';
import {installPreventionProgram} from './prevention-program.js';
import {installEquipmentTraining} from './equipment-training.js';
import {installInspectionGrid} from './inspection-grid.js';
import {installSSTIntake} from './sst-intake.js';
import {installSST} from './sst.js';
import {installScheduleNotifications} from './service-schedule-notifications.js';
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
import {installManagerAccess} from './manager-access.js';
import crypto from "node:crypto";
import {employeeAvailability,localDate,profileAt} from "./availability-rules.js";
import {availabilityRevision,recordManualAvailability,saveAvailabilityHistory} from "./availability.js";
import {beginUndo,installUndo} from "./undo.js";
import {recordDeparture} from './employee-status.js';
import express from "express";
import pg from "pg";
import {installCoreSchema} from "./schedule-core-schema.js";
import {schedulePoolConfig,verifyPreviewDatabase} from "./schedule-database.js";
import {saveEmployeeCode} from './employee-portal.js';
import {installDepartmentSchedules} from './department-schedules.js';
import {installLeave, approvedLeave} from "./leave.js";
import {conflictsWithLeave} from "./leave-rules.js";
import { assignmentConflict, generateAssignments } from "./scheduler.js";
import {clearExpiredPhotoUploads} from './department-photo-uploads.js';
import {backupBeforeRegeneration,finishRegenerationBackup,installScheduleBackup} from './schedule-backup.js';
import {applyServiceRoleDefault,copyServiceShifts} from './service-role-defaults.js';

const { Pool } = pg;
const app = express();
// Vercel reserves /api for filesystem functions. Restore the app path before routing and access checks.
if (process.env.VERCEL) app.use((req,_res,next)=>{
  if (req.url.startsWith('/quart-api/')) req.url='/api/'+req.url.slice('/quart-api/'.length);
  next();
});
const port = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === "production";

startupPhase('configuration');
for (const key of ["DATABASE_URL", "SESSION_SECRET", "MANAGER_CODE"]) {
  if (!process.env[key]) throw Object.assign(new Error(`Variable requise absente: ${key}`),{code:'MISSING_'+key});
}

const pool = new Pool(schedulePoolConfig(process.env));
await verifyPreviewDatabase(pool,process.env);
const preparation = isPreparingPreview();
if (process.env.VERCEL && !preparation) await usePreparedSchema(pool,process.env);
pool.on('error',error=>logEvent('database_pool_error',{code:errorCode(error)},'error'));
startupPhase('schema_core');
const attempts = new Map();
const scheduleAccessAttempts = new Map();
const sessionSecret = process.env.SESSION_SECRET;

if (needsSchema(pool)) await installCoreSchema(pool);
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
import {managerStores} from './service-store-weeks.js';
async function requireManager(request, response, next) {
  try {
    await managerAccess.authorize(request);
    const storeHeader=request.get('X-Service-Store');
    const storePortal=request.path.startsWith('/api/store-portal') && (request.manager.kind==='account'||storeHeader);
    if (storePortal || (request.path==='/api/undo' && storeHeader) || /^\/api\/(weeks\/|shifts\/|employees(?:\/|$)|leave\/week\/)/.test(request.path)) {
      const stores=await managerStores(pool,request.manager);
      const selected=storeHeader ?? (stores.includes('principal')?'principal':stores[0]);
      if (!stores.includes(selected)) return response.status(403).json({error:'Magasin inaccessible.'});
      request.storeId=selected;
      request.serviceStores=stores;
    }
    if(request.manager?.kind==='account') {
      if(!response.employeeSecretsRedacted){
        response.employeeSecretsRedacted=true;
        const send=response.json.bind(response);
        const redact=value=>Array.isArray(value)?value.map(redact):value&&typeof value==='object'&&!(value instanceof Date)?Object.fromEntries(Object.entries(value).filter(([key])=>!['employeeCode','employee_code'].includes(key)).map(([key,v])=>[key,redact(v)])):value;
        response.json=value=>send(redact(value));
      }
    }
    next();
  }
  catch(error) { response.status(error.status||500).json({error:error.status?error.message:'Impossible de vérifier l’accès.'}); }
}
startupPhase('schema_manager_access');
// Production direction access always requires a named, verified passkey session.
// A stale shared-code cookie must never confer authority, including in SST and RH.
const directionPasskeysRequired=production||process.env.DIRECTION_PASSKEY_REQUIRED==='yes';
if(directionPasskeysRequired&&(!['pilot','required'].includes(process.env.EMPLOYEE_PASSKEY_MODE)||!process.env.EMPLOYEE_PASSKEY_ADMIN_IDS))throw Error('Direction passkey configuration is required');
const managerAccess=await installManagerAccess(app,pool,{readSession,issueSession,sameOrigin,production,
  allowLegacyAdmin:!directionPasskeysRequired,
  directionIdentity:req=>employeePortal.directionIdentity(req)});
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
  const {breakMinutes,absence,paidMinutes} = serviceShiftTiming(startMinute,endMinute,body.absence);
  const trainingMinutes = body.training === true ? body.trainingMinutes ?? null : null;
  if (trainingMinutes !== null && (!Number.isInteger(trainingMinutes) || trainingMinutes < 1 || trainingMinutes > paidMinutes))
    throw Error('La durée de formation doit être positive et comprise dans les heures payées du quart.');
  return {
    role,
    area: role === "packer" ? "packer" : "front",
    startMinute,
    endMinute,
    breakMinutes, absence:absence||null,
    training: body.training === true, trainingMinutes,
    sourceDepartment: String(body.sourceDepartment || "").trim().slice(0, 80),
    notes: String(body.notes || "").trim().slice(0, 300),
  };
}
async function ensureWeek(weekStart, client = pool, store='principal') {
  await client.query(`INSERT INTO schedule_weeks (week_start,store_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [weekStart,store]);
}
function mapWeek(row) {
  return {
    weekStart: isoDate(row.week_start), storeId:row.store_id,
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
    training: row.training === true, trainingMinutes:row.training_minutes??null, sourceDepartment: row.source_department, notes: row.notes,
  };
}

function normalizeEmployee(body,{requestedTarget=null}={}) {
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
  if (targetMinutes > maxMinutes && targetMinutes !== requestedTarget) throw new Error("La cible dépasse le maximum.");
  const isMinor = body.isMinor === true;
  if (isMinor && targetMinutes > 1020 && targetMinutes !== requestedTarget) throw new Error("Un employé de 17 ans ou moins ne peut pas demander plus de 17 h par semaine.");
  const seniority = validDate(body.seniority) ? body.seniority : "9999-12-31";
  return { name, role, roles, area: role === "packer" ? "packer" : "front", seniority,
    targetMinutes, maxMinutes, availability, notes: String(body.notes || "").slice(0, 300),
    active: body.active !== false, isMinor, allowExtraHours: body.allowExtraHours === true };
}
function desiredRank(value, fallback) {
  return value === undefined || value === null || value === ""
    ? fallback : parseMinutes(value, "Rang", 1, 500);
}
async function reorderEmployees(client, role, column, movedId, requestedRank,store) {
  const result = await client.query(`SELECT id FROM schedule_employees WHERE role=$1 AND store_id=$2
    ORDER BY ${column}, seniority, id FOR UPDATE`, [role,store]);
  const ids = result.rows.map(row => Number(row.id)).filter(id => id !== movedId);
  if (movedId !== null) ids.splice(Math.min(requestedRank - 1, ids.length), 0, movedId);
  for (let i = 0; i < ids.length; i++) {
    await client.query(`UPDATE schedule_employees SET ${column}=$1 WHERE id=$2`, [i + 1, ids[i]]);
  }
}
async function saveServicePersonal(client,id,body,initialOnly){
  if(body.employeeCode===undefined&&body.birthday===undefined)return;
  const birthday=body.birthday;
  if(birthday!==undefined&&(typeof birthday!=='string'||birthday&&(!validDate(birthday)||birthday>new Date().toISOString().slice(0,10)||birthday<'1900-01-01')))throw Error('Date de naissance invalide.');
  await client.query('INSERT INTO schedule_store_people(service_employee_id,name) SELECT id,name FROM schedule_employees WHERE id=$1 ON CONFLICT(service_employee_id) DO NOTHING',[id]);
  const person=(await client.query('SELECT id FROM schedule_store_people WHERE service_employee_id=$1',[id])).rows[0];
  await saveEmployeeCode(client,person.id,body.employeeCode,{initialOnly});
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
    const result = await pool.query("SELECT e.*,p.employee_code,p.birthday FROM schedule_employees e LEFT JOIN schedule_store_people p ON p.service_employee_id=e.id WHERE e.store_id=$1 ORDER BY e.role, e.display_rank, e.seniority, e.name",[request.storeId]);
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
    const count = await client.query("SELECT COUNT(*)::int AS count FROM schedule_employees WHERE store_id=$1",[request.storeId]);
    if (count.rows[0].count) throw new Error("La liste existe déjà. Modifiez les employés individuellement.");
    for (const e of normalized) await client.query(
      `INSERT INTO schedule_employees (name,area,role,roles,seniority,target_minutes,max_minutes,availability,notes,active,is_minor,allow_extra_hours,store_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [e.name,e.area,e.role,JSON.stringify(e.roles),e.seniority,e.targetMinutes,e.maxMinutes,JSON.stringify(e.availability),e.notes,e.active,e.isMinor,e.allowExtraHours,request.storeId]);
    for (const role of ["manager","supervisor","cashier","packer","orders"]) {
      await client.query(`WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY seniority, id) AS position
        FROM schedule_employees WHERE role=$1 AND store_id=$2
      ) UPDATE schedule_employees e SET display_rank=ranked.position, assignment_rank=ranked.position
        FROM ranked WHERE e.id=ranked.id`, [role,request.storeId]);
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
    const result = await client.query(`INSERT INTO schedule_employees (name,area,role,roles,seniority,target_minutes,max_minutes,availability,notes,active,is_minor,allow_extra_hours,onboarding_new,store_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13) RETURNING *`,
      [e.name,e.area,e.role,JSON.stringify(e.roles),e.seniority,e.targetMinutes,e.maxMinutes,JSON.stringify(e.availability),e.notes,e.active,e.isMinor,e.allowExtraHours,request.storeId]);
    const id = Number(result.rows[0].id);
    const count = await client.query("SELECT COUNT(*)::int AS count FROM schedule_employees WHERE role=$1 AND store_id=$2", [e.role,request.storeId]);
    await reorderEmployees(client,e.role,"display_rank",id,desiredRank(request.body?.displayRank,count.rows[0].count),request.storeId);
    await reorderEmployees(client,e.role,"assignment_rank",id,desiredRank(request.body?.assignmentRank,count.rows[0].count),request.storeId);
    await saveServicePersonal(client,id,request.body,request.manager?.kind==='account');
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
    await client.query("BEGIN");
    await beginUndo(client,"Modifier un employé",request.params.weekStart||null,request);
    await client.query("SELECT pg_advisory_xact_lock(8675309)");
    const before = await client.query("SELECT * FROM schedule_employees WHERE id=$1 AND store_id=$2 FOR UPDATE", [request.params.id,request.storeId]);
    if (!before.rowCount) { await client.query("ROLLBACK"); return response.status(404).json({ error: "Employé introuvable." }); }
    if(before.rows[0].departed_at){await client.query('ROLLBACK');return response.status(409).json({error:'Cet employé a été retiré pour un départ définitif. Sa fiche ne peut plus être modifiée.'});}
    const currentProfile=profileAt(before.rows[0],localDate());
    const e=normalizeEmployee(request.body||{},{requestedTarget:currentProfile.source==='request'?currentProfile.targetMinutes:null});
    const availabilityHistory=await recordManualAvailability(client,before.rows[0],e,request.body||{});
    if(availabilityHistory.some(v=>v.source!=='request'&&v.effectiveDate>=localDate()&&v.targetMinutes>Math.min(e.maxMinutes,e.isMinor?1020:3000)))throw new Error("Une disponibilité approuvée demande plus d’heures que ce nouveau maximum. Révisez d’abord la demande.");
    await client.query(`UPDATE schedule_employees SET name=$1,area=$2,role=$3,roles=$4,seniority=$5,target_minutes=$6,max_minutes=$7,
      availability=$8,notes=$9,active=$10,is_minor=$11,allow_extra_hours=$12 WHERE id=$13 RETURNING *`,
      [e.name,e.area,e.role,JSON.stringify(e.roles),e.seniority,e.targetMinutes,e.maxMinutes,JSON.stringify(e.availability),e.notes,e.active,e.isMinor,e.allowExtraHours,request.params.id]);
    if(availabilityHistory.length)await saveAvailabilityHistory(client,Number(request.params.id),availabilityHistory);
    const id = Number(request.params.id), old = before.rows[0];
    if (old.role !== e.role) {
      await reorderEmployees(client,old.role,"display_rank",null,1,request.storeId);
      await reorderEmployees(client,old.role,"assignment_rank",null,1,request.storeId);
    }
    const count = await client.query("SELECT COUNT(*)::int AS count FROM schedule_employees WHERE role=$1 AND store_id=$2", [e.role,request.storeId]);
    const fallbackDisplay = old.role===e.role ? old.display_rank : count.rows[0].count;
    const fallbackAssignment = old.role===e.role ? old.assignment_rank : count.rows[0].count;
    await reorderEmployees(client,e.role,"display_rank",id,desiredRank(request.body?.displayRank,fallbackDisplay),request.storeId);
    await reorderEmployees(client,e.role,"assignment_rank",id,desiredRank(request.body?.assignmentRank,fallbackAssignment),request.storeId);
    await saveServicePersonal(client,id,request.body,request.manager?.kind==='account');
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
    if(!(await client.query('SELECT 1 FROM schedule_employees WHERE id=$1 AND store_id=$2 FOR UPDATE',[request.params.id,request.storeId])).rowCount)throw Error('Employé introuvable.');
    const employee=await recordDeparture(client,Number(request.params.id),request);
    await commitServiceTransaction(client,request);response.json({employee:mapEmployee(employee)});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});response.status(error.status||400).json({error:error.message});}
  finally{client.release();}
});
app.get("/api/weeks/:weekStart/assignments", requireManager, async (request, response) => {
  try {
    const result = await pool.query(`SELECT a.shift_id, a.employee_id FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id
      WHERE s.week_start=$1 AND s.store_id=$2`, [request.params.weekStart,request.storeId]);
    response.json({ assignments: result.rows.map(r => ({ shiftId:Number(r.shift_id), employeeId:Number(r.employee_id) })) });
  } catch { response.status(500).json({ error: "Impossible de charger l’horaire." }); }
});
app.get("/api/weeks/:weekStart/time-off", requireManager, async (request, response) => {
  try {
    if (!validDate(request.params.weekStart)) throw new Error("Semaine invalide.");
    const result = await pool.query("SELECT employee_id, day_index FROM schedule_time_off WHERE week_start=$1 AND store_id=$2", [request.params.weekStart,request.storeId]);
    response.json({ timeOff: result.rows.map(r=>({employeeId:Number(r.employee_id),dayIndex:Number(r.day_index)})) });
  } catch { response.status(400).json({ error:"Impossible de charger les congés demandés." }); }
});
app.get("/api/weeks/:weekStart/day-exceptions", requireManager, async (request, response) => {
  try {
    if (!validDate(request.params.weekStart)) throw new Error("Semaine invalide.");
    const result = await pool.query("SELECT employee_id FROM schedule_day_exceptions WHERE week_start=$1 AND store_id=$2", [request.params.weekStart,request.storeId]);
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
    await ensureWeek(weekStart,client,request.storeId);
    if(!(await client.query("SELECT 1 FROM schedule_employees WHERE id=$1 AND store_id=$2",[employeeId,request.storeId])).rowCount)throw Error("Employé introuvable.");
    if (request.body.allowed) await client.query(`INSERT INTO schedule_day_exceptions (week_start,employee_id,store_id)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [weekStart,employeeId,request.storeId]);
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
    await ensureWeek(weekStart,client,request.storeId);
    const employee = await client.query("SELECT id FROM schedule_employees WHERE id=$1 AND store_id=$2 FOR UPDATE", [employeeId,request.storeId]);
    if (!employee.rowCount) throw new Error("Employé introuvable.");
    await client.query("DELETE FROM schedule_time_off WHERE week_start=$1 AND employee_id=$2", [weekStart,employeeId]);
    for (const day of days) await client.query(
      "INSERT INTO schedule_time_off (week_start,employee_id,day_index,store_id) VALUES ($1,$2,$3,$4)",
      [weekStart,employeeId,day,request.storeId]);
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
    const shiftResult = await client.query("SELECT * FROM schedule_shifts WHERE id=$1 AND store_id=$2", [id,request.storeId]);
    if (!shiftResult.rowCount) throw new Error("Quart introuvable.");
    await beginUndo(client,"Modifier une affectation",isoDate(shiftResult.rows[0].week_start),request);
    if (request.body?.employeeId === null) {
      await client.query("DELETE FROM schedule_assignments WHERE shift_id=$1", [id]);
      const before=mapShift(shiftResult.rows[0]);
      const shift=await saveShiftLeave(client,before,shiftWithApprovedLeave(before));
      await commitServiceTransaction(client,request);
      return response.json({ ok:true,shift });
    }
    const people = await client.query("SELECT * FROM schedule_employees WHERE id=$1 AND store_id=$2", [employeeId,request.storeId]);
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
      WHERE s.week_start=$1 AND a.shift_id<>$2 AND s.store_id=$3`, [s.weekStart,id,request.storeId]);
    const all = await client.query("SELECT * FROM schedule_shifts WHERE week_start=$1 AND store_id=$2", [s.weekStart,request.storeId]);
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
    const shifts = (await client.query("SELECT * FROM schedule_shifts WHERE week_start=$1 AND store_id=$2 ORDER BY id FOR UPDATE", [request.params.weekStart,request.storeId])).rows.map(mapShift);
    const employees = (await client.query("SELECT * FROM schedule_employees WHERE store_id=$1",[request.storeId])).rows.map(row=>mapEmployee(row,request.params.weekStart));
    const approved=await approvedLeave(client,request.params.weekStart);
    for(const e of employees) e.leavePeriods=approved.filter(r=>Number(r.employee_id)===e.id).flatMap(r=>r.periods);
    const exceptions = (await client.query("SELECT employee_id FROM schedule_day_exceptions WHERE week_start=$1 AND store_id=$2", [request.params.weekStart,request.storeId])).rows;
    for (const e of employees) e.allowSixOrSevenDays = exceptions.some(x => Number(x.employee_id) === e.id);
    const leaves = (await client.query("SELECT employee_id, day_index FROM schedule_time_off WHERE week_start=$1 UNION SELECT p.service_employee_id, day FROM schedule_store_people p CROSS JOIN generate_series(0,6) day WHERE p.service_employee_id IS NOT NULL AND p.employment_ended_on <= $1::date+day", [request.params.weekStart])).rows;
    for (const leave of leaves) {
      const employee=employees.find(e=>e.id===Number(leave.employee_id));
      if (employee) employee.availability={...employee.availability,[leave.day_index]:[]};
    }
    let backupId;
    if (request.body?.replaceAll === true) {
      backupId=await backupBeforeRegeneration(client,request.params.weekStart,request.storeId);
      await client.query(`DELETE FROM schedule_assignments WHERE shift_id IN
        (SELECT id FROM schedule_shifts WHERE week_start=$1 AND store_id=$2)`, [request.params.weekStart,request.storeId]);
    }
    const current = (await client.query(`SELECT a.shift_id, a.employee_id FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id
      WHERE s.week_start=$1 AND s.store_id=$2`, [request.params.weekStart,request.storeId])).rows.map(r=>({shiftId:Number(r.shift_id),employeeId:Number(r.employee_id)}));
    const result = generateAssignments(shifts, employees, current);
    for(const shift of shifts.filter(s=>!current.some(a=>a.shiftId===s.id))){
      const employee=employees.find(e=>e.id===result.assignments.find(a=>a.shiftId===shift.id)?.employeeId);
      await saveShiftLeave(client,shift,shiftWithApprovedLeave(shift,employee?.leavePeriods,employee?.id));
    }
    for (const a of result.assignments) {
      await client.query("INSERT INTO schedule_assignments (shift_id,employee_id) VALUES ($1,$2)", [a.shiftId,a.employeeId]);
      await applyServiceRoleDefault(client,shifts.find(s=>s.id===a.shiftId),employees.find(e=>e.id===a.employeeId));
    }
    if(backupId)await finishRegenerationBackup(client,backupId,request.params.weekStart,request.storeId);
    await commitServiceTransaction(client,request);
    response.json({ ...result, preserved:current.length });
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    response.status(error.status||400).json({ error:error.message || "Génération impossible." });
  } finally { client.release(); }
});

startupPhase('schema_leave');
const leaveAccess=await installLeave(app,pool,{requireManager,sameOrigin,employeeIdentity:req=>employeePortal.identity(req)});
startupPhase('schema_departments');
const departmentService=await installDepartmentSchedules(app,pool,{requireManager,sameOrigin,requireStaff:leaveAccess.requireStaff});
if (runsInWebProcess()){
  await departmentService.finishDueDepartures();
  setInterval(()=>clearExpiredPhotoUploads(pool).catch(error=>logEvent('photo_upload_cleanup_failed',{code:errorCode(error)},'error')),3600000).unref();
  setInterval(()=>departmentService.finishDueDepartures().catch(error=>console.error('Fin d’emploi planifiée',error.message)),60000).unref();
}
const employeePortal=departmentService.employeePortal;
await managerAccess.installEmployeeLinks();
startupPhase('schema_sst');
await installEthicsSource(app,pool);
await installCash(app,pool,requireManager,sameOrigin);
const sstService=await installSST(app,pool,{identity:req=>managerAccess.identity(req)});
installSSTIntake(app,pool,sstService);
await installInspectionGrid(app,pool,sstService);
await installEquipmentTraining(app,pool,sstService);
await installPreventionProgram(app,pool,sstService);
let employeeVault;
let onboardingReminders;
try {
  if(process.env.VERCEL && (preparation || process.env.VERCEL_ENV!=='production')) {
    employeeVault=!preparation && process.env.QUART_PREVIEW_VAULT_SCHEMA
      ? await previewEmployeeFilesStorage()
      : {pool:null,status:{ready:false,message:'Le coffre RH est fermé dans cette préversion.'}};
  } else employeeVault=await employeeFilesStorage();
} catch {
  logEvent('employee_vault_unavailable',{},'error');
  employeeVault={pool:null,status:{ready:false,message:'Le coffre canadien est indisponible ou sa configuration est incomplète. Aucune nouvelle saisie n’est permise.'}};
}
try{onboardingReminders=await installEmployeeFiles(app,pool,{managerAccess,employeePortal,sstService,vaultPool:employeeVault.pool,trialPool:employeeVault.trialPool,storageStatus:employeeVault.status});}
catch{await employeeVault.trialPool?.end();await employeeVault.pool?.end();logEvent('employee_vault_schema_unavailable',{},'error');employeeVault={pool:null,status:{ready:false,message:'Le coffre canadien n’a pas pu être initialisé. Les dossiers sont en consultation seulement; le portail SST reste disponible.'}};await installEmployeeFiles(app,pool,{managerAccess,employeePortal,sstService,storageStatus:employeeVault.status});}
app.get('/api/access-session',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
    const identity=req.query.mode==='manager'?await managerAccess.identity(req):await employeePortal.identity(req);
    res.status(identity?200:401).json({active:!!identity});
  }catch{res.status(503).json({error:'Impossible de vérifier l’accès.'});}
});
startupPhase('schema_chat_push');
chatPush=await installServiceChat(app,pool,{employeePortal,managerAccess,sameOrigin,
  pushFactory:pool=>createServiceChatPush(pool,{secret:sessionSecret})});
await installScheduleNotifications(app,pool,{requireManager,sameOrigin,push:chatPush});
startupPhase('schema_clothing');
await installClothing(app,pool,{requireManager,sameOrigin,requireStaff:leaveAccess.requireStaff});
startupPhase('schema_backups');
await installScheduleBackup(app,pool,{requireManager,sameOrigin});
startupPhase('schema_undo');
await installUndo(app,pool,{requireManager,sameOrigin});
app.get("/conges-test", (_req,res)=>res.sendFile("conges.html",{root:"public"}));

installHealth(app,pool);
app.post("/api/login", sameOrigin, (request, response) => {
  if(directionPasskeysRequired)return response.status(401).json({error:'L’accès direction exige votre clé personnelle. Le code maître ne donne plus accès au portail.',passkeyRequired:true,path:'/connexion-employe?retour=%2F'});
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
app.post("/api/logout", sameOrigin, async (request, response) => {
  try {
    await employeePortal.logout(request,response);
    response.append("Set-Cookie", `schedule_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production ? "; Secure" : ""}`);
    response.json({ ok: true });
  } catch { response.status(503).json({error:'Déconnexion non confirmée. Réessayez.'}); }
});
app.get("/api/session", async (request, response) => {
  try { const user=await managerAccess.identity(request);const service=(await pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0];if(user)user.serviceAccess=user.kind==='admin'||user.departments.includes(Number(service?.id));response.set('Cache-Control','no-store').json({role:user?'manager':null,user}); }
  catch { response.status(500).json({error:'Impossible de vérifier la connexion.'}); }
});

app.get("/api/weeks/:weekStart/share-link", requireManager, async (request, response) => {
  try {
    if (!validDate(request.params.weekStart)) return response.status(400).json({ error: "Semaine invalide." });
    const result = await pool.query("SELECT token FROM schedule_public_links WHERE week_start=$1 AND store_id=$2", [request.params.weekStart,request.storeId]);
    response.set("Cache-Control", "no-store").json({ path: result.rowCount ? `/h/${result.rows[0].token}` : null });
  } catch { response.status(500).json({ error: "Impossible de charger le lien." }); }
});
app.put("/api/weeks/:weekStart/share-link", requireManager, sameOrigin, async (request, response) => {
  const client=await pool.connect();
  try {
    if (!validDate(request.params.weekStart)) return response.status(400).json({ error: "Semaine invalide." });
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
    await assertServiceRevision(client,request.params.weekStart,request);
    await ensureWeek(request.params.weekStart,client,request.storeId);
    const token = crypto.randomBytes(32).toString("base64url");
    const result = await client.query(`INSERT INTO schedule_public_links (week_start,token,access_code_hash,store_id)
      SELECT week_start,$2,$3,store_id FROM schedule_weeks WHERE week_start=$1 AND store_id=$4
      ON CONFLICT (week_start,store_id) DO UPDATE SET week_start=EXCLUDED.week_start RETURNING token`, [request.params.weekStart,token,'',request.storeId ?? 'principal']);
    const notification=await publishServiceWeek(client,request.params.weekStart,request.storeId);
    if(notification)await chatPush.enqueueSchedule(client,request.params.weekStart,notification,request.storeId);
    await commitServiceTransaction(client,request);
    chatPush.kick();
    logEvent('schedule_publication_notice',{component:'service_schedule',code:notification||'UNCHANGED_NO_NOTICE'});
    response.set("Cache-Control", "no-store").json({ path: `/h/${result.rows[0].token}`,notification });
  } catch(error) { await client.query('ROLLBACK').catch(()=>{});response.status(error.status||500).json({ error: error.status?error.message:"Impossible de publier cette semaine. Réessayez." }); }finally{client.release();}
});
app.delete("/api/weeks/:weekStart/share-link", requireManager, sameOrigin, async (request, response) => {
  const client=await pool.connect();
  try {
    if (!validDate(request.params.weekStart)) return response.status(400).json({ error: "Semaine invalide." });
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
    await assertServiceRevision(client,request.params.weekStart,request);
    await client.query('DELETE FROM schedule_public_links WHERE week_start=$1 AND store_id=$2',[request.params.weekStart,request.storeId]);
    await commitServiceTransaction(client,request);response.json({ok:true});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});response.status(error.status||500).json({error:error.status?error.message:'Impossible de désactiver le lien.'});}finally{client.release();}
});

app.get("/api/weeks/:weekStart/schedule-views", requireManager, async (request, response) => {
  try {
    if (!validDate(request.params.weekStart)) return response.status(400).json({ error: "Semaine invalide." });
    const result = await pool.query(`SELECT e.id, e.name, e.role, v.first_viewed_at, v.last_viewed_at, v.view_count
      FROM schedule_employees e
      LEFT JOIN schedule_schedule_views v ON v.employee_id=e.id AND v.week_start=$1
      WHERE e.store_id=$2 AND EXISTS (SELECT 1 FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id
        WHERE a.employee_id=e.id AND s.week_start=$1 AND s.store_id=$2)
      ORDER BY (v.last_viewed_at IS NOT NULL), e.role, e.name`, [request.params.weekStart,request.storeId]);
    response.set("Cache-Control", "no-store").json({ employees: result.rows });
  } catch { response.status(500).json({ error: "Impossible de charger les consultations." }); }
});

app.get("/api/public-schedules/:token", employeePortal.requireEmployee, async (request, response) => {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) return response.status(404).json({ error: "Lien invalide." });
    const link = await pool.query("SELECT week_start,store_id FROM schedule_employee_links WHERE token=$1 AND employee_id=$2", [request.params.token,request.employee.service_employee_id]);
    if (!link.rowCount) return response.status(404).json({ error: "Lien désactivé ou invalide." });
    if (!request.employee.service_employee_id)
      return response.status(401).json({ error: "Code requis." });
    const weekStart = isoDate(link.rows[0].week_start);
    const publication=await publishedServiceResult(pool,weekStart,link.rows[0].store_id);
    if(!publication)return response.status(404).json({error:'Cet horaire n’est pas publié.'});
    const employees=publication.data.employees.filter(e=>e.id===Number(request.employee.service_employee_id)).map(e=>({...e,birthdayMonthDay:request.employee.birthday?isoDate(request.employee.birthday).slice(5):''}));
    response.set({ "Cache-Control":"no-store", "X-Robots-Tag":"noindex, nofollow" }).json({ weekStart, employees });
  } catch { response.status(500).json({ error: "Impossible de charger l’horaire." }); }
});
app.post("/api/public-schedules/:token/views", sameOrigin, employeePortal.requireEmployee, async (request, response) => {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) return response.status(404).json({ error: "Lien invalide." });
    const viewed=await pool.query(`INSERT INTO schedule_schedule_views (week_start,employee_id,store_id)
      SELECT l.week_start,e.id,l.store_id FROM schedule_employee_links l JOIN schedule_employees e ON e.id=l.employee_id
      WHERE l.token=$1 AND e.id=$2 AND (e.active OR EXISTS (SELECT 1 FROM schedule_assignments a
        JOIN schedule_shifts s ON s.id=a.shift_id WHERE a.employee_id=e.id AND s.week_start=l.week_start AND s.store_id=l.store_id))
      ON CONFLICT (week_start,employee_id) DO UPDATE SET last_viewed_at=NOW(),
      view_count=schedule_schedule_views.view_count+1 RETURNING employee_id`, [request.params.token,request.employee.service_employee_id]);
    if(!viewed.rowCount)return response.status(404).json({error:"Lien désactivé ou invalide."});
    response.set("Cache-Control", "no-store").json({ ok:true });
  } catch { response.status(500).json({ error: "Impossible d’enregistrer la consultation." }); }
});
app.post("/api/public-schedules/:token/access", sameOrigin, employeePortal.login);
app.get("/h/:token", (request, response) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) return response.status(404).send("Lien invalide.");
  response.set({ "Cache-Control":"no-store", "X-Robots-Tag":"noindex, nofollow" });
  response.sendFile("horaire.html",{root:"public"});
});

installSalesForecasts(app,{requireManager,pool});

app.get("/api/weeks/:weekStart", requireManager, async (request, response) => {
  const client=await pool.connect();
  try {
    const {weekStart}=request.params;
    if(!validDate(weekStart)||new Date(weekStart+'T12:00:00Z').getUTCDay()!==1)return response.status(400).json({error:'Choisissez une semaine commençant un lundi valide.'});
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
    await ensureWeek(weekStart,client,request.storeId);
    const week=(await client.query('SELECT * FROM schedule_weeks WHERE week_start=$1 AND store_id=$2',[weekStart,request.storeId])).rows[0];
    const shifts=(await client.query('SELECT * FROM schedule_shifts WHERE week_start=$1 AND store_id=$2 ORDER BY area,day_index,start_minute,id',[weekStart,request.storeId])).rows.map(mapShift);
    const employees=(await client.query('SELECT e.*,p.employee_code,p.birthday FROM schedule_employees e LEFT JOIN schedule_store_people p ON p.service_employee_id=e.id WHERE e.store_id=$1 ORDER BY e.role,e.display_rank,e.seniority,e.name',[request.storeId])).rows.map(row=>mapEmployee(row,weekStart));
    const assignments=(await client.query('SELECT a.shift_id,a.employee_id FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id WHERE s.week_start=$1 AND s.store_id=$2',[weekStart,request.storeId])).rows.map(r=>({shiftId:Number(r.shift_id),employeeId:Number(r.employee_id)}));
    const timeOff=(await client.query('SELECT employee_id,day_index FROM schedule_time_off WHERE week_start=$1 AND store_id=$2',[weekStart,request.storeId])).rows.map(r=>({employeeId:Number(r.employee_id),dayIndex:Number(r.day_index)}));
    const dayExceptions=(await client.query('SELECT employee_id FROM schedule_day_exceptions WHERE week_start=$1 AND store_id=$2',[weekStart,request.storeId])).rows.map(r=>Number(r.employee_id));
    const approvedLeaves=await approvedLeave(client,weekStart,request.storeId),relatedDepartments=await departmentService.serviceRelated(weekStart,client);
    const relatedForStore=relatedDepartments.filter(p=>employees.some(e=>e.id===Number(p.employeeId)));
    const link=(await client.query('SELECT token FROM schedule_public_links WHERE week_start=$1 AND store_id=$2',[weekStart,request.storeId])).rows[0];
    const revision=await serviceRevision(client,weekStart,request.storeId);
    await client.query('COMMIT');
    response.set({'Cache-Control':'no-store','X-Service-Revision':revision}).json({stores:request.serviceStores,week:mapWeek(week),shifts,employees,assignments,timeOff,dayExceptions,approvedLeaves,relatedDepartments:relatedForStore,sharePath:link?'/h/'+link.token:null,revision});
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
    await ensureWeek(weekStart,client,request.storeId);
    const result = await client.query(`UPDATE schedule_weeks SET cashier_budget_minutes=$1, packer_budget_minutes=$2, notes=$3, updated_at=NOW() WHERE week_start=$4 AND store_id=$5 RETURNING *`, [cashierBudgetMinutes, packerBudgetMinutes, notes, weekStart,request.storeId]);
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
    await ensureWeek(weekStart, client,request.storeId);
    const created = [];
    for (const dayIndex of days) {
      const result = await client.query(`INSERT INTO schedule_shifts (week_start, area, role, day_index, start_minute, end_minute, break_minutes, source_department, notes, absence, training, training_minutes, store_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [weekStart, shift.area, shift.role, dayIndex, shift.startMinute, shift.endMinute, shift.breakMinutes, shift.sourceDepartment, shift.notes, shift.absence, shift.training, shift.trainingMinutes,request.storeId]);
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
    const existing=(await client.query("SELECT s.week_start,s.absence,a.employee_id FROM schedule_shifts s LEFT JOIN schedule_assignments a ON a.shift_id=s.id WHERE s.id=$1 AND s.store_id=$2",[id,request.storeId])).rows[0];
    if(!existing)throw Error("Quart introuvable.");
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
      const all=(await client.query('SELECT * FROM schedule_shifts WHERE week_start=$1 AND store_id=$2',[weekStart,request.storeId])).rows.map(mapShift);
      const assigned=(await client.query('SELECT a.shift_id,a.employee_id FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id WHERE s.week_start=$1 AND a.shift_id<>$2',[weekStart,id])).rows.map(r=>({shiftId:Number(r.shift_id),employeeId:Number(r.employee_id)}));
      const conflict=assignmentConflict(employee,{...shift,...serviceShiftTiming(shift.startMinute,shift.endMinute,shift.absence),id,dayIndex},all,assigned);
      if(conflict)throw Error(conflict+' Réattribuez le quart d’abord.');
    }
    const result = await client.query(`UPDATE schedule_shifts SET area=$1, role=$2, day_index=$3, start_minute=$4, end_minute=$5, break_minutes=$6, source_department=$7, notes=$8, absence=$10, training=COALESCE($11,training), training_minutes=CASE WHEN $11 IS FALSE THEN NULL WHEN $13 THEN $12::integer ELSE training_minutes END, updated_at=NOW() WHERE id=$9 RETURNING *`, [shift.area, shift.role, dayIndex, shift.startMinute, shift.endMinute, shift.breakMinutes, shift.sourceDepartment, shift.notes, id, storedShiftAbsence(shift), request.body.training === undefined ? null : shift.training, shift.trainingMinutes, Object.hasOwn(request.body,"trainingMinutes")]);
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
    const previous=(await client.query("SELECT week_start FROM schedule_shifts WHERE id=$1 AND store_id=$2",[id,request.storeId])).rows[0];
    await beginUndo(client,"Supprimer un quart",previous?isoDate(previous.week_start):null,request);
    await client.query("DELETE FROM schedule_shifts WHERE id=$1 AND store_id=$2", [id,request.storeId]);
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
    await ensureWeek(weekStart, client,request.storeId);
    const count = await client.query("SELECT COUNT(*)::int AS count FROM schedule_shifts WHERE week_start=$1 AND store_id=$2", [weekStart,request.storeId]);
    if (count.rows[0].count > 0) throw new Error("La semaine contient déjà des quarts.");
    const previousWeek = await client.query("SELECT * FROM schedule_weeks WHERE week_start=$1 AND store_id=$2", [previous,request.storeId]);
    if (!previousWeek.rowCount) throw new Error("La semaine précédente est vide.");
    const previousCount = await client.query("SELECT COUNT(*)::int AS count FROM schedule_shifts WHERE week_start=$1 AND store_id=$2", [previous,request.storeId]);
    if (previousCount.rows[0].count === 0) throw new Error("La semaine précédente ne contient aucun quart.");
    await client.query(`UPDATE schedule_weeks SET cashier_budget_minutes=$1, packer_budget_minutes=$2, notes='', updated_at=NOW() WHERE week_start=$3 AND store_id=$4`, [previousWeek.rows[0].cashier_budget_minutes, previousWeek.rows[0].packer_budget_minutes, weekStart,request.storeId]);
    await copyServiceShifts(client,weekStart,previous,request.storeId);
    await commitServiceTransaction(client,request);
    response.json({ copiedFrom: previous });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    response.status(error.status||400).json({ error: error.message || "Copie impossible." });
  } finally { client.release(); }
});

app.use(express.static("public", { extensions: ["html"] }));
app.use((_request, response) => response.status(404).json({ error: "Page introuvable." }));
app.use((error,_req,res,_next)=>{
  logEvent('http_unhandled_error',{code:errorCode(error)},'error');
  if(!res.headersSent)res.status(error.status>=400&&error.status<500?error.status:500).json({error:'Service temporairement indisponible. Réessayez.'});
});
export default app;
async function clearDocumentUploads(){
  await clearExpiredDocuments(pool);
  await clearExpiredDocuments(pool,sstImportUploads);
  if(employeeVault.pool) await clearExpiredDocuments(employeeVault.pool);
}
if(runsInWebProcess()) setInterval(()=>clearDocumentUploads().catch(error=>logEvent('document_upload_cleanup_failed',{code:errorCode(error)},'error')),3600000).unref();
if (preparation) await installScheduledWorkSchema(pool);
export function runPeriodicTasks(executionId) {
  return runScheduledWork(pool,executionId,{
    departures:departmentService.finishDueDepartures,
    photoUploads:()=>clearExpiredPhotoUploads(pool),
    documentUploads:clearDocumentUploads,
    ...leaveAccess.periodic,
    ...(onboardingReminders ? {onboarding:onboardingReminders} : {}),
    notifications:chatPush.drain,
    calendar:departmentService.familyPortal.googleCalendar.run
  });
}
if (preparation) {
  await pool.end();
} else if (process.env.VERCEL) {
  startupPhase('ready');
} else {
  startupPhase('listen');
  const server=app.listen(port,()=>startupPhase('ready'));
  const shutdown=()=>{
    startupPhase('shutdown');
    chatPush?.stop();
    server.close(async()=>{await employeeVault.trialPool?.end();await employeeVault.pool?.end();await pool.end();process.exit(0);});
    setTimeout(()=>process.exit(1),25000).unref();
  };
  process.once('SIGTERM',shutdown);
  process.once('SIGINT',shutdown);
}
