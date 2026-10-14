import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {saveEmployeeCode,installEmployeePortal} from '../employee-portal.js';
import {blankCell} from '../public/departments-core.js';

const linkRoute='/api/departments/people/:id/portal-link';
const week='2030-10-14';
const cells=()=>[{kind:'shift',start:420,end:960,breakMinutes:60,note:''},...Array.from({length:6},blankCell)];
async function seed(f){
  const serviceId=(await f.pool.query("INSERT INTO schedule_employees(name,area,role) VALUES('Camille Exemple','front','cashier') RETURNING id")).rows[0].id;
  const meta=(await f.call('get','/api/departments/meta')).body,fruits=meta.departments.find(d=>d.key==='fruits'),viande=meta.departments.find(d=>d.key==='viande');
  const owner=meta.people.find(p=>p.serviceEmployeeId===Number(serviceId));
  await saveEmployeeCode(f.pool,owner.id,'001234');
  const alias=(await f.pool.query("INSERT INTO schedule_store_people(name,birthday) VALUES('Camille Exemple','2000-01-01') RETURNING id")).rows[0];
  const other=(await f.pool.query("INSERT INTO schedule_store_people(name) VALUES('Autre personne') RETURNING id")).rows[0];
  for(const p of [alias,other])await f.pool.query('INSERT INTO schedule_store_memberships(person_id,department_id) VALUES($1,$2)',[p.id,fruits.id]);
  const published={rows:[{personId:Number(alias.id),name:'Camille Exemple',cells:cells()},{personId:Number(other.id),name:'Autre personne',cells:cells()}],notes:'Privé'};
  await f.pool.query('INSERT INTO schedule_department_weeks(department_id,week_start,draft,published,published_at) VALUES($1,$2,$3,$3,clock_timestamp())',[fruits.id,week,JSON.stringify(published)]);
  await f.pool.query('INSERT INTO schedule_department_weeks(department_id,week_start,draft) VALUES($1,$2,$3)',[viande.id,week,JSON.stringify({rows:[published.rows[0]],notes:'Brouillon privé'})]);
  await f.pool.query('INSERT INTO schedule_weeks(week_start) VALUES($1)',[week]);
  await f.pool.query("INSERT INTO schedule_public_links(week_start,token,access_code_hash) VALUES($1,$2,'common')",[week,'a'.repeat(43)]);
  const people=await f.service.directory();
  return {owner:people.find(p=>p.id===owner.id),alias:people.find(p=>p.id===Number(alias.id)),other,fruits,viande,serviceId:Number(serviceId)};
}
const attach=(f,s,extra={})=>f.call('put',linkRoute,{params:{id:s.alias.id},body:{portalPersonId:s.owner.id,version:s.alias.version,targetVersion:s.owner.version,confirmed:true,...extra}});
async function login(f){
  const response={headers:{},set(){return this;},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await f.service.employeePortal.login({body:{code:'001234'},ip:'test'},response);
  assert.equal(response.body.ok,true);
  return response.headers['Set-Cookie'].split(';')[0];
}

test('rattachement personnel : même session pour Service et Fruits, horaires conservés et consultations liées à la bonne fiche',async()=>{
  process.env.SESSION_SECRET='test-portal-links';
  const f=await departmentFixture();try{
    const s=await seed(f),cookie=await login(f),before=(await f.pool.query('SELECT * FROM schedule_department_weeks ORDER BY department_id')).rows;
    const identity=()=>f.service.employeePortal.identity({headers:{cookie}});
    assert.deepEqual((await identity()).portalPersonIds,[s.owner.id]);
    const linked=await attach(f,s);assert.equal(linked.code,200,JSON.stringify(linked.body));
    const employee=await identity();assert.deepEqual(employee.portalPersonIds,[s.owner.id,s.alias.id]);assert.equal(Number(employee.service_employee_id),s.serviceId);
    const listing=await f.call('get','/api/leave/department-schedules',{employee});
    assert.deepEqual(listing.body.schedules.map(d=>d.departmentId),[s.fruits.id]);assert.equal(listing.body.service.length,1);
    const published=await f.call('get','/api/leave/department-schedules/:id/:week',{params:{id:s.fruits.id,week},employee});
    assert.deepEqual(published.body.schedule.rows.map(r=>r.personId),[s.alias.id]);assert.equal(published.body.schedule.notes,'');
    assert.deepEqual((await f.pool.query('SELECT * FROM schedule_department_weeks ORDER BY department_id')).rows,before,'no draft, publication, revision or hours changed');
    const report=await f.call('get','/api/departments/:id/weeks/:week/views',{params:{id:s.fruits.id,week}});
    assert.deepEqual(report.body.employees.filter(p=>p.lastViewedAt).map(p=>p.personId),[s.alias.id]);
    const data=(await f.pool.query('SELECT employee_code,portal_person_id FROM schedule_store_people WHERE id=$1',[s.alias.id])).rows[0];
    assert.equal(data.employee_code,null);assert.equal(Number(data.portal_person_id),s.owner.id);
    assert.equal((await f.call('get','/api/leave/department-schedules/:id/:week',{params:{id:s.viande.id,week},employee})).code,404,'unpublished work stays private');
  }finally{await f.db.close();}
});

test('rattachement : retrait et désactivation retirent immédiatement les accès des sessions existantes',async()=>{
  process.env.SESSION_SECRET='test-portal-links';
  const f=await departmentFixture();try{
    const s=await seed(f),cookie=await login(f),identity=()=>f.service.employeePortal.identity({headers:{cookie}});
    assert.equal((await attach(f,s)).code,200);
    await f.pool.query('UPDATE schedule_store_people SET active=FALSE WHERE id=$1',[s.alias.id]);
    assert.deepEqual((await identity()).portalPersonIds,[s.owner.id]);
    await f.pool.query('UPDATE schedule_store_people SET active=TRUE WHERE id=$1',[s.alias.id]);
    assert.deepEqual((await identity()).portalPersonIds,[s.owner.id,s.alias.id]);
    assert.equal((await attach(f,s,{portalPersonId:null,version:s.alias.version+1})).code,200);
    assert.deepEqual((await identity()).portalPersonIds,[s.owner.id]);
    assert.equal((await f.call('get','/api/leave/department-schedules/:id/:week',{params:{id:s.fruits.id,week},employee:await identity()})).code,404);
    assert.equal((await attach(f,s,{version:s.alias.version+2})).code,200);
    await saveEmployeeCode(f.pool,s.owner.id,'005678');assert.equal(await identity(),null,'changing the principal code revokes its session');
  }finally{await f.db.close();}
});

test('rattachement : administration, confirmation, versions et identité vérifiées sans modification partielle',async()=>{
  const f=await departmentFixture();try{
    const s=await seed(f);
    const handlers=f.routes.get('put '+linkRoute);assert.equal(handlers[0],f.options.requireManager);assert.equal(handlers[1],f.options.sameOrigin);
    const scoped=await f.call('put',linkRoute,{manager:{kind:'account',departments:[s.fruits.id]},params:{id:s.alias.id},body:{portalPersonId:s.owner.id,version:s.alias.version,targetVersion:s.owner.version,confirmed:true}});
    assert.equal(scoped.code,403);
    for(const [extra,code] of [[{confirmed:false},400],[{version:0},409],[{targetVersion:0},409],[{portalPersonId:999999},400],[{portalPersonId:s.alias.id},400]])assert.equal((await attach(f,s,extra)).code,code);
    await f.pool.query("UPDATE schedule_store_people SET birthday='2001-01-01' WHERE id=$1",[s.owner.id]);assert.equal((await attach(f,s)).code,400);
    await f.pool.query('UPDATE schedule_store_people SET birthday=NULL WHERE id=$1',[s.owner.id]);
    await f.pool.query("UPDATE schedule_employees SET name='Quelqu’un d’autre' WHERE id=$1",[s.serviceId]);assert.equal((await attach(f,s)).code,400);
    await f.pool.query("UPDATE schedule_employees SET name='Camille Exemple',active=FALSE WHERE id=$1",[s.serviceId]);assert.equal((await attach(f,s)).code,400);
    assert.equal((await f.pool.query('SELECT portal_person_id FROM schedule_store_people WHERE id=$1',[s.alias.id])).rows[0].portal_person_id,null);
  }finally{await f.db.close();}
});

test('rattachement : aucun second code ni chaîne de fiches, migration réexécutable',async()=>{
  const f=await departmentFixture();try{
    const s=await seed(f);
    await saveEmployeeCode(f.pool,s.alias.id,'005678');assert.equal((await attach(f,s)).code,400);
    await saveEmployeeCode(f.pool,s.alias.id,'');assert.equal((await attach(f,s)).code,200);
    await assert.rejects(()=>saveEmployeeCode(f.pool,s.alias.id,'005678'),/accès personnel partagé/);
    const source=(await f.pool.query("INSERT INTO schedule_store_people(name) VALUES('Camille Exemple') RETURNING id,version")).rows[0];
    const chained=await f.call('put',linkRoute,{params:{id:source.id},body:{portalPersonId:s.alias.id,version:source.version,targetVersion:s.alias.version+1,confirmed:true}});
    assert.equal(chained.code,400);
    await installEmployeePortal(f.app,f.pool,f.options);
    assert.equal(Number((await f.pool.query('SELECT portal_person_id FROM schedule_store_people WHERE id=$1',[s.alias.id])).rows[0].portal_person_id),s.owner.id);
  }finally{await f.db.close();}
});
