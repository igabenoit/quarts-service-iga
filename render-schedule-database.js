import {readFileSync} from 'node:fs';

const identifier = /^[a-z_][a-z0-9_]{0,62}$/;

export function renderScheduleConnection(env) {
  const supplied = new URL(env.DATABASE_URL);
  const project = env.QUART_SUPABASE_PROJECT_REF;
  const role = env.QUART_SUPABASE_DB_ROLE;
  const schema = env.QUART_SUPABASE_SCHEMA;
  const limits = {max:5, connectionTimeoutMillis:3000};
  if (![project,role,schema].some(v=>v !== undefined) &&
      !supplied.hostname.endsWith('.supabase.co') && !supplied.hostname.endsWith('.supabase.com')) {
    return {config:{...limits,connectionString:env.DATABASE_URL,
      ssl:env.NODE_ENV === 'production' ? {rejectUnauthorized:false} : false}};
  }

  if (!/^[a-z0-9]{20}$/.test(project ?? '') || !identifier.test(role ?? '') ||
      !identifier.test(schema ?? '') || schema === 'public' || schema === 'information_schema' || schema.startsWith('pg_')) {
    throw Error('Projet, rôle ou schéma Supabase des horaires manquant ou invalide.');
  }
  const direct = supplied.hostname === 'db.'+project+'.supabase.co' && supplied.username === role;
  const session = supplied.hostname.endsWith('.pooler.supabase.com') && supplied.username === role+'.'+project;
  if ((!direct && !session) || !['postgres:','postgresql:'].includes(supplied.protocol) ||
      (supplied.port && supplied.port !== '5432') || supplied.pathname !== '/postgres' || !supplied.password) {
    throw Error('Connexion Supabase inattendue pour les horaires.');
  }
  // Only the configured private schema and certificate settings apply to this connection.
  supplied.search = '';
  const ssl = {rejectUnauthorized:true,ca:readFileSync(new URL('./certs/supabase-root.crt',import.meta.url),'utf8')};
  return {schema,role,config:{...limits,connectionString:supplied.href,ssl,options:'-c search_path='+schema}};
}

export async function verifyRenderScheduleConnection(pool, target) {
  if (!target.schema) return;
  const {rows:[db]} = await pool.query('SELECT current_user AS role, current_schema() AS schema');
  if (db.role !== target.role || db.schema !== target.schema) {
    throw Error('Le rôle ou le schéma ouvert ne correspond pas à la cible Supabase des horaires.');
  }
}
