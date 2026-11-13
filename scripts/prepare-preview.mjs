import pg from 'pg';
import {schedulePoolConfig, verifyPreviewDatabase} from '../schedule-database.js';
import {preparePreview} from '../preview-schema.js';

if (!process.env.VERCEL || process.env.VERCEL_ENV !== 'preview') throw Error('Cette commande exige une cible Vercel Preview.');
const client = new pg.Client(schedulePoolConfig(process.env));
try {
  await client.connect();
  await verifyPreviewDatabase(client,process.env);
  const status=await preparePreview(client,process.env,()=>import('../server.js'));
  console.log('Schéma Quart Service '+status+'.');
} catch (error) {
  console.error('Échec de préparation de la préversion.',error.code || error.name);
  process.exitCode=1;
} finally {
  await client.end();
}
