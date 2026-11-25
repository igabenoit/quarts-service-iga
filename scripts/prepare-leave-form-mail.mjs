// Additive release migration, using the existing application role at build time.
// Existing production deployments keep their prior marker and remain compatible.
import pg from 'pg';
import {schedulePoolConfig,verifyPreviewDatabase} from '../schedule-database.js';
import {formMailSchema} from '../leave-form-mail.js';

export async function prepareFormMail(client,origin){
  await client.query('BEGIN');
  try{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('quart-service:leave-form-email',0))");
    const prior=await client.query("SELECT 1 FROM quart_schema_releases WHERE version='20261113.5' AND origin=$1",[origin]);
    if(!prior.rows.length)throw Error('Expected production schema is missing');
    await client.query(formMailSchema);
    await client.query("INSERT INTO quart_schema_releases(version,origin) VALUES('20261125.1',$1) ON CONFLICT DO NOTHING",[origin]);
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}
}

if(process.env.VERCEL&&process.env.VERCEL_ENV==='production'){
  const client=new pg.Client(schedulePoolConfig(process.env));
  try{
    await client.connect();await verifyPreviewDatabase(client,process.env);
    const origin=new URL(process.env.PUBLIC_BASE_URL).origin;
    if(origin!==process.env.PUBLIC_BASE_URL||origin!==process.env.RENDER_EXTERNAL_URL||origin!==process.env.EMPLOYEE_PASSKEY_ORIGIN)throw Error('Production origin mismatch');
    await prepareFormMail(client,origin);
    console.log('Registre privé des envois du formulaire prêt.');
  }catch(e){console.error('Préparation du registre des envois impossible.',e.code||e.name);process.exitCode=1;}
  finally{await client.end();}
}
