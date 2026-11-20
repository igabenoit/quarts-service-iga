import {handleSchedule} from '@vercel/schedules';

export const POST = handleSchedule(async ({executionId}) => {
  if (process.env.VERCEL_ENV === 'production' && process.env.QUART_PERIODIC_OWNER !== 'vercel') return;
  if (!['preview','production'].includes(process.env.VERCEL_ENV)) throw Error('Environnement de planification inattendu.');
  const {runPeriodicTasks} = await import('../server.js');
  const result = await runPeriodicTasks(executionId);
  console.log('quart_periodic', executionId, result, process.env.VERCEL_REGION);
});
