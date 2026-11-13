import pg from 'pg';
import {schedulePoolConfig, verifyPreviewDatabase} from '../schedule-database.js';
import {preparePreview,usePreparedSchema} from '../preview-schema.js';

const environment = process.env.VERCEL_ENV;
const args = process.argv.slice(2);
const explicitPreparation = args.length === 1 && args[0] === '--prepare-production';
if (!process.env.VERCEL || !['preview','production'].includes(environment) ||
    (args.length && !(explicitPreparation && environment === 'production'))) {
  throw Error('Cible ou commande de préparation Vercel invalide.');
}
const client = new pg.Client(schedulePoolConfig(process.env));
try {
  await client.connect();
  await verifyPreviewDatabase(client,process.env);
  if (environment === 'production' && !explicitPreparation) {
    await usePreparedSchema(client,process.env);
    console.log('Schéma de production et origine vérifiés.');
  } else {
    const status=await preparePreview(client,process.env,()=>import('../server.js'));
    console.log('Schéma Quart Service '+status+'.');
  }
} catch (error) {
  console.error('Échec du contrôle ou de la préparation du schéma.',error.code || error.name);
  process.exitCode=1;
} finally {
  await client.end();
}
