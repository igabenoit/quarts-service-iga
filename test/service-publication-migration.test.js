import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {installServicePublications,readServicePublication} from '../service-publication.js';

test('legacy publications are captured once, without exposing personal credentials or refreshing on restart',async()=>{
  const f=await departmentFixture();try{
    const week='2026-10-19';
    await f.pool.query('INSERT INTO schedule_weeks(week_start) VALUES($1)',[week]);
    const employee=(await f.pool.query("INSERT INTO schedule_employees(name,area,role,notes) VALUES('Personne fictive','front','cashier','Note confidentielle') RETURNING id")).rows[0];
    const shift=(await f.pool.query("INSERT INTO schedule_shifts(week_start,area,role,day_index,start_minute,end_minute,notes) VALUES($1,'front','cashier',0,480,960,'Note privée') RETURNING id",[week])).rows[0];
    await f.pool.query('INSERT INTO schedule_assignments(shift_id,employee_id) VALUES($1,$2)',[shift.id,employee.id]);
    await f.pool.query("INSERT INTO schedule_public_links(week_start,token,access_code_hash) VALUES($1,$2,'ancien-secret')",[week,'m'.repeat(43)]);
    await installServicePublications(f.pool);
    const first=await readServicePublication(f.pool,week);assert.equal(first.snapshot.shifts[0].start_minute,480);
    assert.doesNotMatch(JSON.stringify(first),/confidentielle|privée|ancien-secret|employee_code|availability/);
    await f.pool.query('UPDATE schedule_shifts SET start_minute=600 WHERE id=$1',[shift.id]);
    await installServicePublications(f.pool);
    assert.deepEqual((await readServicePublication(f.pool,week)).snapshot,first.snapshot);
  }finally{await f.db.close();}
});
