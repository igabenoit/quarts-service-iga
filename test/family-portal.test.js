import {publishServiceWeek} from '../service-publication.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {blankCell} from '../public/departments-core.js';

process.env.SESSION_SECRET='isolated-family-test-secret';
const admin={kind:'admin'},start='2026-10-12';
async function call(f,method,path,request={}){
  const res={code:200,headers:{},status(n){this.code=n;return this;},set(k,v){this.headers[k]=v;return this;},setHeader(k,v){this.headers[k]=v;},json(body){this.body=body;return this;}};
  await f.routes.get(method+' '+path).at(-1)({headers:{},body:{},params:{},query:{},ip:'family-test',...request},res);return res;
}
async function person(f,name,departmentId){return (await f.call('post','/api/departments/people',{body:{name,group:'regular',active:true,departments:[departmentId],availability:{}}})).body;}
async function account(f,personIds,name='Parent test'){const r=await call(f,'post','/api/family-accounts',{manager:admin,body:{name,personIds,active:true}});assert.equal(r.code,200,JSON.stringify(r.body));return r.body;}
async function login(f,code){const r=await call(f,'post','/api/family-portal/access',{body:{code}});assert.equal(r.code,200,JSON.stringify(r.body));assert.match(r.headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);return r.headers['Set-Cookie'].split(';')[0];}
async function publish(f,departmentId,people){
  const cells=()=>[{...blankCell(),kind:'shift',start:480,end:900,breakMinutes:0},...Array.from({length:6},blankCell)];
  const route='/api/departments/:id/weeks/:week',params={id:departmentId,week:start};
  const saved=await f.call('put',route,{params,body:{revision:0,draft:{rows:people.map(p=>({personId:p.id,cells:cells()})),notes:'Confidential team note',manager:''}}});assert.equal(saved.code,200,JSON.stringify(saved.body));
  const r=await f.call('post',route+'/publish',{params,body:{revision:1,verified:true,warningsReviewed:true}});assert.equal(r.code,200,JSON.stringify(r.body));
}

test('family credentials are independent, admin-only, hashed, revocable and rate limited',async()=>{
  const f=await departmentFixture();try{
    const dep=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='fruits');
    const p=await person(f,'Child test',dep.id);
    for(const manager of [undefined,{kind:'account',departments:[dep.id]}])assert.equal((await call(f,'post','/api/family-accounts',{manager,body:{name:'Parent',personIds:[p.id],active:true}})).code,manager?403:401);
    const a=await account(f,[p.id]);assert.match(a.code,/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
    assert.equal(Number((await f.pool.query('SELECT count(*) AS n FROM schedule_store_people')).rows[0].n),1);
    const raw=(await f.pool.query('SELECT * FROM schedule_family_access')).rows[0];assert.ok(!JSON.stringify(raw).includes(a.code));
    const cookie=await login(f,a.code.toLowerCase().replaceAll('-',' '));assert.equal((await f.service.familyPortal.identity({headers:{cookie}})).name,'Parent test');
    assert.equal(await f.service.employeePortal.identity({headers:{cookie}}),null);
    assert.equal(await f.service.familyPortal.identity({headers:{cookie:cookie+'x'}}),null);
    assert.equal((await call(f,'get','/api/family-portal',{headers:{cookie:'employee_portal=1.fake'}})).code,401);
    const rotated=await call(f,'post','/api/family-accounts/:id/code',{manager:admin,params:{id:a.id},body:{version:1}});assert.equal(rotated.code,200);
    assert.equal(await f.service.familyPortal.identity({headers:{cookie}}),null);
    assert.equal((await call(f,'post','/api/family-portal/access',{body:{code:a.code}})).code,401);
    const second=await login(f,rotated.body.code);
    const revoked=await call(f,'put','/api/family-accounts/:id',{manager:admin,params:{id:a.id},body:{name:'Parent test',personIds:[p.id],active:false,version:2}});assert.equal(revoked.code,200);
    assert.equal(await f.service.familyPortal.identity({headers:{cookie:second}}),null);
    for(let i=0;i<10;i++)assert.equal((await call(f,'post','/api/family-portal/access',{ip:'limited',body:{code:'BAD'}})).code,401);
    assert.equal((await call(f,'post','/api/family-portal/access',{ip:'limited',body:{code:rotated.body.code}})).code,429);
    assert.equal((await call(f,'post','/api/family-accounts/:id/code',{manager:admin,params:{id:a.id},body:{version:1}})).code,409);
  }finally{await f.db.close();}
});

test('family reads only selected children and explicit linked records, without employee views or private notes',async()=>{
  const f=await departmentFixture();try{
    const dep=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='fruits');
    const children=[];for(const name of ['Child one','Child two','Other employee','Linked record'])children.push(await person(f,name,dep.id));
    await f.pool.query('UPDATE schedule_store_people SET portal_person_id=$1 WHERE id=$2',[children[0].id,children[3].id]);
    await publish(f,dep.id,children);
    const a=await account(f,[children[0].id,children[1].id]),cookie=await login(f,a.code);
    const listing=await call(f,'get','/api/family-portal',{headers:{cookie}});assert.equal(listing.code,200);assert.equal(listing.body.people.length,2);assert.deepEqual(listing.body.weeks,[start]);
    const result=await call(f,'get','/api/family-portal/weeks/:week',{headers:{cookie},params:{week:start},query:{personId:children[2].id}});assert.equal(result.code,200,JSON.stringify(result.body));assert.equal(result.headers['Cache-Control'],'no-store');
    assert.deepEqual(result.body.people.map(p=>p.id),[children[0].id,children[1].id]);assert.equal(result.body.people[0].days[0].entries.length,2);
    assert.ok(!JSON.stringify(result.body).includes('Other employee'));assert.ok(!JSON.stringify(result.body).includes('Confidential'));assert.ok(!JSON.stringify(result.body).includes('employeeCode'));
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM schedule_department_views')).rows[0].n,0);
    const missing=await call(f,'get','/api/family-portal/weeks/:week',{headers:{cookie},params:{week:'2026-10-19'}});assert.ok(missing.body.people.every(p=>!p.published&&p.days.every(d=>!d.entries.length)));
    assert.equal((await call(f,'get','/api/family-portal/weeks/:week',{headers:{cookie},params:{week:'2026-10-13'}})).code,400);
    await f.pool.query('UPDATE schedule_store_people SET active=FALSE WHERE id=$1',[children[1].id]);assert.equal((await call(f,'get','/api/family-portal',{headers:{cookie}})).body.people.length,1);
    await f.pool.query('DELETE FROM schedule_family_members WHERE access_id=$1',[a.id]);assert.equal((await call(f,'get','/api/family-portal/weeks/:week',{headers:{cookie},params:{week:start}})).body.people.length,0);
  }finally{await f.db.close();}
});

test('family Service hours preserve paid meal rules and exclude unpublished schedules and unrelated staff',async()=>{
  const f=await departmentFixture();try{
    const employees=(await f.pool.query("INSERT INTO schedule_employees(name,area,role) VALUES('Service child','front','cashier'),('Private coworker','front','cashier') RETURNING id")).rows;
    await f.pool.query("INSERT INTO schedule_weeks(week_start) VALUES($1)",[start]);
    const shift=(await f.pool.query("INSERT INTO schedule_shifts(week_start,area,role,day_index,start_minute,end_minute,break_minutes) VALUES($1,'front','cashier',0,480,990,60) RETURNING id",[start])).rows[0];
    await f.pool.query('INSERT INTO schedule_assignments(shift_id,employee_id) VALUES($1,$2)',[shift.id,employees[0].id]);
    const people=await f.service.directory(),child=people.find(p=>p.serviceEmployeeId===Number(employees[0].id));assert.ok(child);
    const a=await account(f,[child.id]),cookie=await login(f,a.code),request={headers:{cookie},params:{week:start}};
    assert.equal((await call(f,'get','/api/family-portal/weeks/:week',request)).body.people[0].published,false);
    await f.pool.query("INSERT INTO schedule_public_links(week_start,token,access_code_hash) VALUES($1,$2,'unused')",[start,'t'.repeat(43)]);
    await publishServiceWeek(f.pool,start);
    const result=await call(f,'get','/api/family-portal/weeks/:week',request);assert.equal(result.code,200,JSON.stringify(result.body));const p=result.body.people[0];assert.equal(p.days[0].entries.length,1);assert.equal(p.days[0].entries[0].minutes,450);assert.match(p.days[0].entries[0].hours,/08:00/);assert.ok(!JSON.stringify(result.body).includes('Private coworker'));
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM schedule_schedule_views')).rows[0].n,0);
    const sameAccount=await call(f,'put','/api/family-accounts/:id',{manager:admin,params:{id:a.id},body:{name:'Parent test',personIds:[],active:true,version:1}});assert.equal(sameAccount.code,400);assert.ok(await f.service.familyPortal.identity({headers:{cookie}}));
  }finally{await f.db.close();}
});
