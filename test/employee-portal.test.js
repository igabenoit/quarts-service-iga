import {publishServiceWeek,publishedServiceResult} from '../service-publication.js';
import {serviceShiftTiming} from '../public/service-rules.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {departmentFixture} from './department-fixture.js';
import {employeeCode,saveEmployeeCode} from '../employee-portal.js';
import {blankCell,isBirthday,sheetHTML,publicSnapshot} from '../public/departments-core.js';

test('six-digit codes preserve zeros, reject full matricules and prevent collisions',async()=>{
  assert.equal(employeeCode('001234'),'001234');assert.throws(()=>employeeCode('000001234'));assert.throws(()=>employeeCode(1234));
  const f=await departmentFixture();try{
    await f.pool.query("INSERT INTO schedule_store_people(name) VALUES('Premier test'),('Second test')");
    const rows=(await f.pool.query('SELECT id FROM schedule_store_people ORDER BY id')).rows;
    await saveEmployeeCode(f.pool,rows[0].id,'001234');await assert.rejects(()=>saveEmployeeCode(f.pool,rows[1].id,'001234'),/déjà attribué/);
  }finally{await f.db.close();}
});

test('personal sessions reject common cookies, invalid codes, tampering and inactive accounts',async()=>{
  process.env.SESSION_SECRET='test-secret-employee-portal';
  const f=await departmentFixture();try{
    const person=(await f.pool.query("INSERT INTO schedule_store_people(name,employee_code) VALUES('Test personnel','001234') RETURNING id")).rows[0];
    const reply=()=>({code:200,headers:{},status(n){this.code=n;return this;},set(){return this;},setHeader(k,v){this.headers[k]=v;},json(x){this.body=x;return this;}});
    let res=reply();await f.service.employeePortal.login({body:{code:'001234'},ip:'test'},res);assert.equal(res.code,200);
    const cookie=res.headers['Set-Cookie'].split(';')[0];assert.match(cookie,/employee_portal=/);assert.ok(!cookie.includes('001234'));
    assert.equal(Number((await f.service.employeePortal.identity({headers:{cookie}})).id),Number(person.id));
    assert.equal(await f.service.employeePortal.identity({headers:{cookie:'leave_access=123.common'}}),null);
    assert.equal(await f.service.employeePortal.identity({headers:{cookie:cookie+'x'}}),null);
    await saveEmployeeCode(f.pool,person.id,'005678');assert.equal(await f.service.employeePortal.identity({headers:{cookie}}),null);
    res=reply();await f.service.employeePortal.login({body:{code:'005678'},ip:'test'},res);const newer=res.headers['Set-Cookie'].split(';')[0];
    await f.pool.query('UPDATE schedule_store_people SET active=FALSE WHERE id=$1',[person.id]);assert.equal(await f.service.employeePortal.identity({headers:{cookie:newer}}),null);
    for(let i=0;i<10;i++){res=reply();await f.service.employeePortal.login({body:{code:'123456'},ip:'limited'},res);assert.equal(res.code,401);}
    res=reply();await f.service.employeePortal.login({body:{code:'123456'},ip:'limited'},res);assert.equal(res.code,429);
  }finally{await f.db.close();}
});

test('personal department read filters other rows and notes, records the publication and denies absent employee',async()=>{
  const f=await departmentFixture();try{
    const dep=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='fruits');
    const people=[];for(const name of ['Alpha test','Beta test'])people.push((await f.call('post','/api/departments/people',{body:{name,group:'regular',active:true,departments:[dep.id],availability:{},birthday:'2000-10-14'}})).body);
    const route='/api/departments/:id/weeks/:week',params={id:dep.id,week:'2026-10-12'};
    await f.call('put',route,{params,body:{revision:0,draft:{rows:people.map(p=>({personId:p.id,cells:Array.from({length:7},blankCell)})),notes:'Private team note',manager:''}}});
    await f.call('post',route+'/publish',{params,body:{revision:1,verified:true,warningsReviewed:true}});
    const response=await f.call('get','/api/leave/department-schedules/:id/:week',{params,employee:{id:people[0].id,birthday:'2000-10-14'}});
    assert.equal(response.body.schedule.rows.length,1);assert.equal(response.body.schedule.rows[0].personId,people[0].id);assert.equal(response.body.schedule.notes,'');assert.equal(response.body.schedule.rows[0].birthdayMonthDay,'10-14');assert.ok(!JSON.stringify(response.body).includes('2000-10-14'));
    const report=await f.call('get',route+'/views',{params});assert.equal(report.body.employees.filter(p=>p.lastViewedAt).length,1);
    assert.equal((await f.call('get','/api/leave/department-schedules/:id/:week',{params,employee:{id:999}})).code,404);
  }finally{await f.db.close();}
});

test('birthdays handle year boundaries without changing hours or exposing birth year',()=>{
  assert.equal(isBirthday('1990-01-01','2027-01-01'),true);assert.equal(isBirthday('2000-02-29','2027-02-28'),false);
  const people=[{id:1,name:'Exemple',group:'regular',birthday:'1990-01-01',availability:{}}],draft={rows:[{personId:1,cells:Array.from({length:7},blankCell)}],notes:''};
  const snapshot=publicSnapshot(draft,people);assert.equal(snapshot.rows[0].birthdayMonthDay,'01-01');assert.ok(!JSON.stringify(snapshot).includes('1990'));
  const html=sheetHTML({department:{key:'fruits',name:'Fruits'},weekStart:'2026-12-28',people,draft});assert.equal((html.match(/Bonne fête !/g)||[]).length,1);assert.ok(!html.includes('1990'));
});

test('Service returns only the authenticated employee and ignores a forged viewing identity',async()=>{
  const f=await departmentFixture();try{
    await f.pool.query("INSERT INTO schedule_weeks(week_start) VALUES('2026-10-12')");
    const token='a'.repeat(43);await f.pool.query("INSERT INTO schedule_public_links(week_start,token,access_code_hash) VALUES('2026-10-12',$1,'shared')",[token]);
    const employees=(await f.pool.query("INSERT INTO schedule_employees(name,area,role) VALUES('First test','front','cashier'),('Second test','front','cashier') RETURNING id")).rows;
    const shifts=(await f.pool.query("INSERT INTO schedule_shifts(week_start,area,role,day_index,start_minute,end_minute,break_minutes) VALUES('2026-10-12','front','cashier',0,480,900,30),('2026-10-12','front','cashier',1,480,1020,30) RETURNING id")).rows;
    for(const shift of shifts)await f.pool.query('INSERT INTO schedule_assignments(shift_id,employee_id) VALUES($1,$2)',[shift.id,employees[0].id]);
    await publishServiceWeek(f.pool,'2026-10-12');
    const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
    const handler=prefix=>{const start=source.indexOf('async (request, response) => {',source.indexOf(prefix)),end=source.indexOf('\n});',start);return new Function('publishedServiceResult','pool','serviceShiftTiming','isoDate','return ('+source.slice(start,end)+'\n});')(publishedServiceResult,f.pool,serviceShiftTiming,v=>typeof v==='string'?v.slice(0,10):v.toISOString().slice(0,10));};
    const reply=()=>({code:200,status(n){this.code=n;return this;},set(){return this;},json(body){this.body=body;return this;}});
    const req={params:{token},body:{employeeId:Number(employees[1].id)},employee:{service_employee_id:employees[0].id,birthday:'2000-10-14'}};
    let res=reply();await handler('app.get("/api/public-schedules/:token",')(req,res);assert.equal(res.code,200,JSON.stringify(res.body));assert.equal(res.body.employees.length,1);assert.equal(res.body.employees[0].id,Number(employees[0].id));assert.ok(!JSON.stringify(res.body).includes('2000'));
    assert.deepEqual(res.body.employees[0].shifts.map(s=>[s.breakMinutes,s.paidMinutes]),[[0,420],[60,480]]);
    res=reply();await handler('app.post("/api/public-schedules/:token/views",')(req,res);assert.equal(res.code,200);
    const views=(await f.pool.query('SELECT employee_id FROM schedule_schedule_views')).rows;assert.deepEqual(views.map(v=>Number(v.employee_id)),[Number(employees[0].id)]);
  }finally{await f.db.close();}
});

test('bulk import rejects extra fields and rolls back a collision without partial changes',async()=>{
  const f=await departmentFixture();try{
    const dep=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='fruits');
    const people=[];for(const name of ['One test','Two test'])people.push((await f.call('post','/api/departments/people',{body:{name,group:'regular',active:true,departments:[dep.id],availability:{}}})).body);
    const directory=await f.service.directory();
    const entries=people.map(p=>({id:p.id,version:directory.find(q=>q.id===p.id).version,employeeCode:'001234',birthday:'1990-01-01'}));
    assert.equal((await f.call('post','/api/departments/personal-import',{body:{entries}})).code,400);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM schedule_store_people WHERE employee_code IS NOT NULL')).rows[0].n,0);
    assert.equal((await f.call('post','/api/departments/personal-import',{body:{entries:[{...entries[0],unexpected:'forbidden'}]}})).code,400);
    entries[1].employeeCode='005678';assert.equal((await f.call('post','/api/departments/personal-import',{body:{entries}})).body.updated,2);
  }finally{await f.db.close();}
});
