import crypto from 'node:crypto';
import {activePersonSQL} from './employee-access.js';

export const token=()=>crypto.randomBytes(32).toString('base64url');
export const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export const activePerson=`SELECT p.* FROM schedule_store_people p LEFT JOIN schedule_employees e ON e.id=p.service_employee_id WHERE p.portal_person_id IS NULL AND ${activePersonSQL()}`;
export async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
export async function installPasskeySchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_passkey_users(
    person_id BIGINT PRIMARY KEY REFERENCES schedule_store_people(id),handle TEXT NOT NULL UNIQUE,
    required BOOLEAN NOT NULL DEFAULT FALSE);
  CREATE TABLE IF NOT EXISTS schedule_passkey_credentials(
    id TEXT PRIMARY KEY,person_id BIGINT NOT NULL REFERENCES schedule_passkey_users(person_id),
    public_key BYTEA NOT NULL,counter BIGINT NOT NULL,transports JSONB NOT NULL,
    device_type TEXT NOT NULL,backed_up BOOLEAN NOT NULL,revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
  CREATE INDEX IF NOT EXISTS schedule_passkey_person ON schedule_passkey_credentials(person_id);
  CREATE TABLE IF NOT EXISTS schedule_passkey_invitations(
    hash TEXT PRIMARY KEY,person_id BIGINT NOT NULL REFERENCES schedule_store_people(id),
    access_version INTEGER NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),used_at TIMESTAMPTZ);
  CREATE TABLE IF NOT EXISTS schedule_passkey_flows(
    hash TEXT PRIMARY KEY,kind TEXT NOT NULL,challenge TEXT NOT NULL,invitation_hash TEXT,
    shared BOOLEAN NOT NULL,expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+interval '5 minutes');
  CREATE TABLE IF NOT EXISTS schedule_passkey_sessions(
    hash TEXT PRIMARY KEY,person_id BIGINT NOT NULL REFERENCES schedule_store_people(id),
    credential_id TEXT NOT NULL REFERENCES schedule_passkey_credentials(id),access_version INTEGER NOT NULL,
    shared BOOLEAN NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,last_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
  CREATE INDEX IF NOT EXISTS schedule_passkey_session_person ON schedule_passkey_sessions(person_id);
  CREATE TABLE IF NOT EXISTS schedule_passkey_audit(
    id BIGSERIAL PRIMARY KEY,person_id BIGINT NOT NULL REFERENCES schedule_store_people(id),
    actor TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
  CREATE TABLE IF NOT EXISTS schedule_passkey_limits(
    bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at TIMESTAMPTZ NOT NULL);`);
}
export async function log(c,personId,actor,action,reason=''){
  await c.query('INSERT INTO schedule_passkey_audit(person_id,actor,action,reason) VALUES($1,$2,$3,$4)',[personId,actor,action,reason]);
}
export async function requireMatricule(c,person){
  if(!/^\d{6}$/.test(person.employee_code||''))fail('Matricule manquant : la direction doit rapprocher cette fiche dans la liste du personnel.',409);
  const other=(await c.query('SELECT id FROM schedule_store_people WHERE employee_code=$1 AND id<>$2 AND portal_person_id IS NULL LIMIT 1',[person.employee_code,person.id])).rows[0];
  if(other)fail('Matricule ambigu : la direction doit corriger les fiches avant toute activation.',409);
}
// Caller must authenticate/authorize the approver and verify the person's identity.
export async function invite(c,{personId,actor,reason,recover=false}){
  const person=(await c.query(activePerson+' AND p.id=$1 FOR UPDATE OF p',[personId])).rows[0];
  if(!person)fail('Fiche principale active introuvable.',404);
  await requireMatricule(c,person);
  const keys=(await c.query('SELECT id FROM schedule_passkey_credentials WHERE person_id=$1 AND revoked_at IS NULL',[personId])).rows;
  if(keys.length&&!recover)fail('Une clé existe déjà. Utilisez la récupération après vérification de l’identité.',409);
  await c.query('DELETE FROM schedule_passkey_invitations WHERE person_id=$1',[personId]);
  if(recover){
    await c.query('UPDATE schedule_passkey_credentials SET revoked_at=clock_timestamp() WHERE person_id=$1 AND revoked_at IS NULL',[personId]);
    await c.query('DELETE FROM schedule_passkey_sessions WHERE person_id=$1',[personId]);
    await c.query('UPDATE schedule_store_people SET access_version=access_version+1 WHERE id=$1',[personId]);
    person.access_version++;
  }
  await c.query('INSERT INTO schedule_passkey_users(person_id,handle) VALUES($1,$2) ON CONFLICT(person_id) DO NOTHING',[personId,token()]);
  // Recovery never re-enables matricule-only access, even before replacement enrollment.
  if(recover)await c.query('UPDATE schedule_passkey_users SET required=TRUE WHERE person_id=$1',[personId]);
  const secret=token();
  await c.query("INSERT INTO schedule_passkey_invitations(hash,person_id,access_version,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '15 minutes')",[digest(secret),personId,person.access_version]);
  await log(c,personId,actor,recover?'recovery_authorized':'enrollment_authorized',reason);
  return secret;
}
