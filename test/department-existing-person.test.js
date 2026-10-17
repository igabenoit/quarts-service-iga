import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {blankCell} from '../public/departments-core.js';

test('a department manager can attach a Service employee and save their shift without copying their identity',async()=>{
  const f=await departmentFixture();try{
    await f.pool.query("INSERT INTO schedule_employees(id,name,area,role,seniority,availability) VALUES(99,'Service à partager','front','cashier','2010-01-01','{}')");
    const bakery=Number((await f.pool.query("SELECT id FROM schedule_leave_departments WHERE schedule_key='boulangerie'")).rows[0].id);
    const service=Number((await f.pool.query("SELECT id FROM schedule_leave_departments WHERE schedule_key='service'")).rows[0].id);
    const manager={kind:'account',departments:[bakery]},params={id:bakery};
    const choices=await f.call('get','/api/departments/:id/available-people',{params,manager});assert.equal(choices.code,200);
    const person=choices.body.people.find(p=>p.serviceEmployeeId===99);assert.ok(person);assert.equal(person.email,undefined);assert.equal(person.employeeCode,undefined);assert.equal(person.birthday,undefined);
    const denied=await f.call('post','/api/departments/:id/people',{params,manager:{kind:'account',departments:[]},body:{personId:person.id,version:person.version}});assert.equal(denied.code,403);
    const attached=await f.call('post','/api/departments/:id/people',{params,manager,body:{personId:person.id,version:person.version}});assert.equal(attached.code,200);assert.equal(attached.body.added,true);
    const directory=await f.service.directory(),same=directory.find(p=>p.id===person.id);assert.equal(same.serviceEmployeeId,99);assert.ok(same.departments.includes(bakery));assert.ok(same.departments.includes(service));assert.equal(directory.filter(p=>p.serviceEmployeeId===99).length,1);
    const again=await f.call('post','/api/departments/:id/people',{params,manager,body:{personId:person.id,version:same.version}});assert.equal(again.code,200);assert.equal(again.body.added,false);
    const current=await f.service.getWeek(bakery,'2026-10-19'),cells=Array.from({length:7},blankCell);cells[0]={kind:'shift',start:420,end:660,breakMinutes:0,note:''};
    const saved=await f.call('put','/api/departments/:id/weeks/:week',{params:{id:bakery,week:'2026-10-19'},manager,body:{revision:0,draft:{...current.draft,rows:[{personId:person.id,cells}]}}});assert.equal(saved.code,200,JSON.stringify(saved.body));
    const loaded=await f.service.getWeek(bakery,'2026-10-19');assert.equal(loaded.draft.rows[0].cells[0].end,660);
    const choicesAfter=await f.call('get','/api/departments/:id/available-people',{params,manager});assert.ok(!choicesAfter.body.people.some(p=>p.id===person.id));
    assert.equal((await f.pool.query('SELECT name FROM schedule_employees WHERE id=99')).rows[0].name,'Service à partager');
  }finally{await f.db.close();}
});
