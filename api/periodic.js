import {handleSchedule} from '@vercel/schedules';

export const POST = handleSchedule(async ({executionId}) => {
  if (process.env.VERCEL_ENV !== 'preview') throw Error('Cette tâche est réservée à la préversion.');
  const {runPeriodicTasks} = await import('../server.js');
  const result = await runPeriodicTasks(executionId);
  console.log('quart_periodic', executionId, result);
});
