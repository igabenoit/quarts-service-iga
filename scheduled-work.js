import {errorCode,logEvent} from './runtime-diagnostics.js';

// On Vercel, only the scheduled function drains queues. Render keeps its existing workers.
export const runsInWebProcess = () => !process.env.VERCEL && process.env.QUART_PERIODIC_OWNER !== 'vercel';

export async function installScheduledWorkSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS quart_scheduled_work (
    execution_id text NOT NULL, task text NOT NULL, completed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (execution_id,task))`);
}

export async function runScheduledWork(pool, executionId, tasks) {
  if (typeof executionId !== 'string' || !executionId || executionId.length > 256) throw Error('Identifiant de passage invalide.');
  const client = await pool.connect();
  const lock = "hashtextextended(current_schema() || ':quart-scheduled-work',0)";
  let locked = false;
  let discard = false;
  try {
    const result = await client.query('SELECT pg_try_advisory_lock('+lock+') AS acquired');
    locked = result.rows[0].acquired;
    if (!locked) return 'busy';
    await client.query("DELETE FROM quart_scheduled_work WHERE completed_at < now() - interval '7 days'");
    const {rows} = await client.query('SELECT task FROM quart_scheduled_work WHERE execution_id=$1',[executionId]);
    const done = new Set(rows.map(row => row.task));
    const failures = [];
    for (const [task,run] of Object.entries(tasks)) {
      if (done.has(task)) continue;
      try {
        await run();
        await client.query('INSERT INTO quart_scheduled_work (execution_id,task) VALUES ($1,$2)',[executionId,task]);
      } catch (error) {
        failures.push(task);
        logEvent('scheduled_work_failed',{component:task,code:errorCode(error)},'error');
      }
    }
    if (failures.length) throw Error('Travaux à reprendre : '+failures.join(', '));
    return 'complete';
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock('+lock+')');
    } catch (error) {
      discard = true;
      throw error;
    } finally {
      client.release(discard);
    }
  }
}
