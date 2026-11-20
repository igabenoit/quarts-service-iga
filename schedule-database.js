import {readFileSync} from 'node:fs';
import {renderScheduleConnection,verifyRenderScheduleConnection} from './render-schedule-database.js';

export function schedulePoolConfig(env) {
  if (!env.VERCEL) return renderScheduleConnection(env).config;
  if (env.VERCEL_ENV === 'production') {
    if (!env.QUART_SUPABASE_PROJECT_REF || !env.QUART_SUPABASE_DB_ROLE || !env.QUART_SUPABASE_SCHEMA) {
      throw Error('Le projet, le rôle et le schéma Supabase de production sont requis.');
    }
    const {config} = renderScheduleConnection(env);
    return {...config, max:3, idleTimeoutMillis:2000, application_name:'quart-vercel-production'};
  }

  const project = env.QUART_PREVIEW_PROJECT_REF;
  const schema = env.QUART_PREVIEW_SCHEMA;
  const role = env.QUART_PREVIEW_DB_ROLE;
  const identifier = /^[a-z_][a-z0-9_]{0,62}$/;
  if (env.VERCEL_ENV !== 'preview' || !/^[a-z0-9]{20}$/.test(project ?? '') ||
      !identifier.test(schema ?? '') || schema === 'public' || !identifier.test(role ?? '')) {
    throw new Error('Configuration de la base de préversion invalide.');
  }
  const url = new URL(env.DATABASE_URL);
  const direct = url.hostname === 'db.' + project + '.supabase.co' && url.username === role;
  const pooler = url.hostname.endsWith('.pooler.supabase.com') && url.username === role + '.' + project;
  if ((!direct && !pooler) || !['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error('Projet ou rôle Supabase inattendu.');
  }
  for (const key of ['sslmode','sslrootcert','sslcert','sslkey']) url.searchParams.delete(key);
  url.searchParams.set('options', '-c search_path=' + schema);
  return {
    connectionString:url.href,
    ssl:{rejectUnauthorized:true, ca:readFileSync(new URL('./certs/supabase-root.crt',import.meta.url),'utf8')},
    max:3, idleTimeoutMillis:2000, connectionTimeoutMillis:3000,
    application_name:'quart-preview-' + schema
  };
}

export async function verifyPreviewDatabase(pool, env) {
  if (!env.VERCEL || env.VERCEL_ENV === 'production') {
    return verifyRenderScheduleConnection(pool,renderScheduleConnection(env));
  }
  const {rows:[identity]} = await pool.query('SELECT current_schema() AS schema, current_user AS role');
  if (identity.schema !== env.QUART_PREVIEW_SCHEMA || identity.role !== env.QUART_PREVIEW_DB_ROLE) {
    throw new Error('Schéma ou rôle de préversion inattendu.');
  }
}
