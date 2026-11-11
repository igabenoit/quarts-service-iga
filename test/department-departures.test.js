import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {applyDepartures} from '../department-departures.js';
import {publishServiceWeek,publishedServiceResult} from '../service-publication.js';
import {activePersonSQL} from '../employee-access.js';
import {blankCell,addDays,monday,today} from '../public/departments-core.js';
test('departure preserves past, removes future publications, enforces rights and prevents resurrection',async()=>{
 const f=await departmentFixture();try{
 const meta=(await f.call('get','/api/departments/meta')).body,dept=meta.departments.find(d=>d.key==='boulangerie').id;
 const body={name:'Personne Fictive',group:'regular',active:true,departments:[dept],availability:{},email:''};
 const id=(await f.call('post','/api/departments/people',{body})).body.id;
 const person=async()=>(await f.call('get','/api/departments/meta')).body.people.find(p=>p.id===id);
 const snapshot={notes:'',manager:'',rows:[{personId:id,cells:Array.from({length:7},()=>({kind:'shift',start:480,end:960,breakMinutes:30,note:''}))}]};
 for(const start of ['2019-12-30','2020-01-06','2020-01-13'])await f.pool.query('INSERT INTO schedule_department_weeks(department_id,week_start,draft,published,published_at) VALUES($1,$2,$3,$3,clock_timestamp())',[dept,start,JSON.stringify(snapshot)]);
 const req={params:{id},body:{version:(await person()).version,effectiveOn:'2020-01-08',confirmed:true}};
 assert.equal((await f.call('post','/api/departments/people/:id/departure',{...req,manager:{kind:'account',departments:[]}})).code,403);
 assert.equal((await f.call('post','/api/departments/people/:id/departure',{...req,body:{...req.body,version:999}})).code,409);
 assert.equal((await f.call('post','/api/departments/people/:id/departure',{...req,body:{...req.body,confirmed:false}})).code,400);
 const result=await f.call('post','/api/departments/people/:id/departure',req);assert.equal(result.code,200,JSON.stringify(result.body));
 const p=await person();assert.equal(p.active,false);assert.equal(p.employmentEndedOn,'2020-01-08');
 const weeks=(await f.pool.query('SELECT * FROM schedule_department_weeks ORDER BY week_start')).rows;
 assert.deepEqual(weeks[0].draft,snapshot);assert.equal(weeks[0].revision,1);
 assert.equal(weeks[1].draft.rows[0].cells[0].kind,'shift');assert.deepEqual(weeks[1].published.rows[0].cells[2],blankCell());
 assert.equal(weeks[2].published.rows.length,0);assert.equal(weeks[2].draft.rows.length,0);
 assert.equal((await f.pool.query('SELECT * FROM schedule_department_history')).rows.length,2);
 assert.equal((await f.pool.query('SELECT * FROM schedule_store_departures')).rows.length,1);
 assert.equal((await f.call('put','/api/departments/people/:id',{params:{id},body:{...body,version:p.version}})).code,409);
 const params={id:dept,week:'2020-01-13'};
 assert.equal((await f.call('put','/api/departments/:id/weeks/:week',{params,body:{revision:1,draft:snapshot}})).code,409);
 const save=await f.call('put','/api/departments/:id/weeks/:week',{params,body:{revision:2,draft:snapshot}});assert.equal(save.code,200,JSON.stringify(save.body));
 assert.equal((await f.pool.query("SELECT draft FROM schedule_department_weeks WHERE week_start='2020-01-13'")).rows[0].draft.rows.length,0);
 const copied=await f.call('post','/api/departments/:id/weeks/:week/copy',{params:{id:dept,week:'2020-01-20'},body:{revision:0,sourceWeek:'2019-12-30',sourceRevision:1}});assert.equal(copied.code,200,JSON.stringify(copied.body));
 assert.equal((await f.pool.query("SELECT draft FROM schedule_department_weeks WHERE week_start='2020-01-20'")).rows[0].draft.rows.length,0);
 assert.deepEqual(applyDepartures(snapshot,'2020-01-13',[{id,active:false}]),snapshot,'inactive absence does not remove shifts');
 assert.equal(snapshot.rows[0].cells[2].kind,'shift');
 }finally{await f.db.close();}
});

test('future departure keeps access up to the cutoff and applies to linked department and Service shifts',async()=>{
 const f=await departmentFixture();
 try{
   const start=addDays(monday(today()),14),cutoff=addDays(start,2);
   const sid=(await f.pool.query("INSERT INTO schedule_employees(name,area,role) VALUES('Test échéance','front','cashier') RETURNING id")).rows[0].id;
   const meta=(await f.call('get','/api/departments/meta')).body;
   const owner=meta.people.find(p=>p.serviceEmployeeId===Number(sid)),dept=meta.departments.find(d=>d.key==='fruits').id;
   const alias=(await f.call('post','/api/departments/people',{body:{name:'Test lié',group:'regular',active:true,departments:[dept],availability:{}}})).body.id;
   await f.pool.query('UPDATE schedule_store_people SET portal_person_id=$1 WHERE id=$2',[owner.id,alias]);
   await f.pool.query('INSERT INTO schedule_weeks(week_start) VALUES($1)',[start]);
   await f.pool.query("INSERT INTO schedule_public_links(week_start,token,access_code_hash) VALUES($1,'jeton-sans-valeur','test')",[start]);
   const shifts=(await f.pool.query("INSERT INTO schedule_shifts(week_start,area,role,day_index,start_minute,end_minute) VALUES($1,'front','cashier',1,420,900),($1,'front','cashier',2,420,900) RETURNING id",[start])).rows;
   for(const shift of shifts)await f.pool.query('INSERT INTO schedule_assignments(shift_id,employee_id) VALUES($1,$2)',[shift.id,sid]);
   await publishServiceWeek(f.pool,start);
   const snapshot={rows:[{personId:alias,cells:Array.from({length:7},()=>({kind:'shift',start:480,end:960}))}]};
   await f.pool.query('INSERT INTO schedule_department_weeks(department_id,week_start,draft,published) VALUES($1,$2,$3,$3)',[dept,start,JSON.stringify(snapshot)]);
   const request={params:{id:owner.id},body:{version:owner.version,effectiveOn:cutoff,confirmed:true}};
   const path='/api/departments/people/:id/departure';
   assert.equal((await f.call('post',path,{...request,manager:{kind:'account',departments:[dept]}})).code,403);
   const result=await f.call('post',path,request);assert.equal(result.code,200,JSON.stringify(result.body));
   const eligible=async()=>(await f.pool.query(`SELECT p.id FROM schedule_store_people p LEFT JOIN schedule_employees e ON e.id=p.service_employee_id WHERE ${activePersonSQL()} ORDER BY p.id`)).rows.map(r=>Number(r.id));
   assert.deepEqual(await eligible(),[owner.id,alias]);
   await f.service.finishDueDepartures();assert.deepEqual(await eligible(),[owner.id,alias]);
   assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM schedule_assignments')).rows[0].n,1);
   assert.deepEqual((await publishedServiceResult(f.pool,start)).data.employees.find(p=>p.id===Number(sid)).shifts.map(s=>s.dayIndex),[1]);
   await assert.rejects(()=>f.pool.query('INSERT INTO schedule_assignments(shift_id,employee_id) VALUES($1,$2)',[shifts[1].id,sid]),/fin d’emploi/);
   const cells=(await f.pool.query('SELECT published FROM schedule_department_weeks WHERE week_start=$1',[start])).rows[0].published.rows[0].cells;
   assert.equal(cells[1].kind,'shift');assert.deepEqual(cells[2],blankCell());
   await f.pool.query('UPDATE schedule_store_people SET employment_ended_on=$1',[today()]);
   assert.deepEqual(await eligible(),[],'credentials expire even before the background task runs');
   await f.service.finishDueDepartures();await f.service.finishDueDepartures();
   assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM schedule_store_people WHERE active')).rows[0].n,0);
   assert.equal((await f.pool.query('SELECT active FROM schedule_employees WHERE id=$1',[sid])).rows[0].active,false);
 }finally{await f.db.close();}
});
