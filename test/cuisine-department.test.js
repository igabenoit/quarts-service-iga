import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {installCuisineMigration} from '../cuisine-migration.js';
import {cuisineCell} from '../public/cuisine-routing.js';
import {blankCell,publicSnapshot,validateAssignment} from '../public/departments-core.js';
import {plannedSummary} from '../public/department-summary.js';

const shift={kind:'kitchen',start:420,end:960,breakMinutes:60,note:''};
test('Cuisine : routage par poste dans les deux sens, sans changer les semaines antérieures',()=>{
  assert.deepEqual(cuisineCell(shift,'pam','2026-10-19'),shift);
  assert.equal(cuisineCell(shift,'pam','2026-10-26').workDepartment,'cuisine');
  const pam=cuisineCell({...shift,kind:'shift',post:'bbq'},'cuisine','2026-10-26');
  assert.equal(pam.workDepartment,'pam');assert.doesNotThrow(()=>validateAssignment(pam,'cuisine'));
  assert.equal(cuisineCell({...shift,kind:'shift'},'cuisine','2026-10-26').kind,'kitchen');
});
test('Cuisine : transfert atomique, historiques intacts, publications distinctes des brouillons et heures comptées une fois',async()=>{
  const f=await departmentFixture();try{
    const meta=(await f.call('get','/api/departments/meta')).body;
    const pam=meta.departments.find(d=>d.key==='pam'),cuisine=meta.departments.find(d=>d.key==='cuisine');
    const people=[];
    for(const name of ['Nicole Morin','Amina Ait Hammou','Fatima Zahra Oufary']){
      const p=(await f.pool.query('INSERT INTO schedule_store_people(name,availability) VALUES($1,$2) RETURNING id',[name,JSON.stringify({0:'J'})])).rows[0];
      people.push({id:Number(p.id),name,group:'regular'});
      await f.pool.query('INSERT INTO schedule_store_memberships(person_id,department_id,display_order) VALUES($1,$2,$3)',[p.id,pam.id,people.length]);
    }
    const draft={manager:'Gérante',notes:'Note PAM',rows:people.map(p=>({personId:p.id,cells:[shift,{...shift,kind:'shift',post:'bbq'},...Array.from({length:5},blankCell)]}))};
    const pub=publicSnapshot(draft,people);pub.rows[0].cells[0]={...shift,end:900};
    for(const start of ['2026-10-19','2026-10-26'])await f.pool.query('INSERT INTO schedule_department_weeks(department_id,week_start,draft,published,published_at) VALUES($1,$2,$3,$4,clock_timestamp())',[pam.id,start,JSON.stringify(draft),JSON.stringify(pub)]);
    const before=(await f.pool.query('SELECT * FROM schedule_department_weeks WHERE week_start=$1',['2026-10-19'])).rows;
    const beforeAll=JSON.stringify((await f.pool.query('SELECT * FROM schedule_department_weeks ORDER BY week_start')).rows);
    const query=f.pool.query;f.pool.query=async(sql,args)=>{if(sql.startsWith('DELETE FROM schedule_store_memberships'))throw Error('failure injected');return query(sql,args);};
    await assert.rejects(()=>installCuisineMigration(f.pool),/failure injected/);f.pool.query=query;
    assert.equal(JSON.stringify((await f.pool.query('SELECT * FROM schedule_department_weeks ORDER BY week_start')).rows),beforeAll);
    assert.equal((await f.pool.query('SELECT * FROM schedule_department_migrations')).rows.length,0);
    await installCuisineMigration(f.pool);
    assert.deepEqual((await f.pool.query('SELECT * FROM schedule_department_weeks WHERE week_start=$1',['2026-10-19'])).rows,before);
    const past=await f.service.getWeek(pam.id,'2026-10-19');assert.equal(past.people.length,3);
    const p=await f.service.getWeek(pam.id,'2026-10-26'),c=await f.service.getWeek(cuisine.id,'2026-10-26');
    assert.equal(p.draft.rows.length,0);assert.equal(c.draft.rows.length,3);
    assert.equal(c.people.length,3);assert.equal(c.people[0].availability[0],'J');
    assert.equal(p.incoming.length,3);assert.equal(c.published.rows[0].cells[0].end,900);assert.equal(c.draft.rows[0].cells[0].end,960);
    assert.equal(plannedSummary(p).total,3*480);assert.equal(plannedSummary(c).total,3*480);
    const saved=JSON.stringify((await f.pool.query('SELECT * FROM schedule_department_weeks ORDER BY week_start,department_id')).rows);
    await installCuisineMigration(f.pool);
    assert.equal(JSON.stringify((await f.pool.query('SELECT * FROM schedule_department_weeks ORDER BY week_start,department_id')).rows),saved);
    assert.equal((await f.pool.query('SELECT * FROM schedule_department_history')).rows.length,1);
    // A subsequent saved Cuisine shift and an outgoing PAM post retain their destinations.
    const result=await f.call('put','/api/departments/:id/weeks/:week',{params:{id:cuisine.id,week:'2026-10-26'},body:{revision:c.revision,draft:c.draft}});
    assert.equal(result.code,200,JSON.stringify(result.body));
  }finally{await f.db.close();}
});
