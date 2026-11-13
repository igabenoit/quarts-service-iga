const schemaVersion = '20261113.4';
const preparedPools = new WeakSet();
let preparing = false;

export const needsSchema = pool => !preparedPools.has(pool);
export const isPreparingPreview = () => preparing;

function origin(env) {
  const url = new URL(env.RENDER_EXTERNAL_URL);
  if (url.protocol !== 'https:' || url.origin !== env.RENDER_EXTERNAL_URL) {
    throw Error('Une origine HTTPS canonique est requise pour préparer les notifications.');
  }
  if (env.VERCEL_ENV === 'production' &&
      (env.EMPLOYEE_PASSKEY_ORIGIN !== url.origin || (env.PUBLIC_BASE_URL && env.PUBLIC_BASE_URL !== url.origin))) {
    throw Error('Les liens publics, les notifications et les clés doivent partager la même origine en production.');
  }
  return url.origin;
}

const check = 'SELECT 1 FROM quart_schema_releases WHERE version=$1 AND origin=$2';

export async function usePreparedSchema(pool, env) {
  let result;
  try {
    result = await pool.query(check, [schemaVersion, origin(env)]);
  } catch (error) {
    if (error.code !== '42P01') throw error;
  }
  if (!result?.rows.length) throw Error('Schéma absent ou incompatible pour cette origine. Exécutez la préparation avant le déploiement.');
  preparedPools.add(pool);
}

// Each legacy module owns its transactions. Publish readiness only after all have succeeded.
// A session lock serializes independent builders, including when preparation needs a retry.
export async function preparePreview(client, env, install) {
  if (!['preview','production'].includes(env.VERCEL_ENV)) throw Error('Une cible Vercel est requise.');
  const scope = origin(env);
  const key = 'quart-service:prepare:' + (env.VERCEL_ENV === 'production' ? env.QUART_SUPABASE_SCHEMA : env.QUART_PREVIEW_SCHEMA);
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS quart_schema_releases(
      version text NOT NULL, origin text NOT NULL, prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(version,origin))`);
    if ((await client.query(check,[schemaVersion,scope])).rows.length) return 'déjà prêt';
    preparing = true;
    try { await install(); } finally { preparing = false; }
    await client.query('INSERT INTO quart_schema_releases(version,origin) VALUES($1,$2)',[schemaVersion,scope]);
    return 'préparé';
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);
  }
}
