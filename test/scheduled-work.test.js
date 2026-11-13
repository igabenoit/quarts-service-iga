import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {installScheduledWorkSchema,runScheduledWork} from '../scheduled-work.js';

test('un nouvel appel reprend la tâche interrompue et conserve les tâches déjà terminées', async () => {
  const db=new PGlite();
  const client={query:db.query.bind(db),release() {}};
  const pool={connect:async()=>client};
  const called=[];
  let first=true;
  const tasks={
    mail:async()=>called.push('mail'),
    push:async()=>{called.push('push'); if(first){first=false;throw Error('interruption');}},
    departures:async()=>called.push('departures')
  };
  try {
    await installScheduledWorkSchema(db);
    await assert.rejects(runScheduledWork(pool,'same',tasks),/push/);
    await runScheduledWork(pool,'same',tasks);
    await runScheduledWork(pool,'same',tasks);
    assert.deepEqual(called,['mail','push','departures','push']);
    await runScheduledWork(pool,'next',tasks);
    assert.deepEqual(called.slice(4),['mail','push','departures']);
  } finally {await db.close();}
});
