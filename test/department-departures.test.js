import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {applyDepartures} from '../department-departures.js';
import {blankCell} from '../public/departments-core.js';
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
