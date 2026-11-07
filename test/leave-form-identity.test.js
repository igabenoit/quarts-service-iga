import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {liveAppFixture} from './live-app-fixture.mjs';

test('personal leave form: canonical name, omitted hidden ID, department and colleague isolation',async()=>{
 const f=await liveAppFixture();try{
  const employee=(await f.query("INSERT INTO schedule_employees(name,area,role) VALUES('Camille Formation Exemple','front','cashier') RETURNING id")).rows[0];
  const colleague=(await f.query("INSERT INTO schedule_employees(name,area,role) VALUES('Autre Exemple','front','cashier') RETURNING id")).rows[0];
  const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  const meta=(await f.call('GET','/api/departments/meta',{cookie:admin})).body;
  const person=meta.people.find(p=>p.serviceEmployeeId===Number(employee.id));
  await f.query('UPDATE schedule_store_people SET employee_code=$1 WHERE id=$2',['007654',person.id]);
  const cookie=(await f.call('POST','/api/employee-portal/access',{body:{code:'007654'}})).cookie;
  const form=(await f.call('GET','/api/leave/form',{cookie})).body;
  assert.equal(form.employeeName,'Camille Formation Exemple');assert.equal(form.employees.length,0);
  assert.equal(form.departments.length,1);assert.equal(form.departments[0].isService,true);
  const body={submissionKey:randomUUID(),employeeName:form.employeeName,departmentId:String(form.departments[0].id),email:'camille@example.com',reason:'Essai fictif',periods:[{startDate:form.earliest,endDate:form.earliest,allDay:true}]};
  const post=extra=>f.call('POST','/api/leave/submit',{cookie,body:{...body,...extra}});
  assert.equal((await post({employeeId:''})).status,403,'The old hidden select caused this regression');
  assert.equal((await post({employeeName:'camille'})).status,403);
  assert.equal((await post({employeeId:colleague.id})).status,403);
  assert.equal((await post({departmentId:meta.departments.find(d=>d.key==='boulangerie').id})).status,403);
  const sent=await post({});assert.equal(sent.status,201,JSON.stringify(sent.body));
  const saved=(await f.query('SELECT person_id,employee_id,employee_name FROM schedule_leave_requests WHERE id=$1',[sent.body.id])).rows[0];
  assert.equal(Number(saved.person_id),person.id);assert.equal(Number(saved.employee_id),Number(employee.id));assert.equal(saved.employee_name,form.employeeName);
  assert.equal((await post({})).body.id,sent.body.id,'A retry returns the same receipt');
 }finally{await f.close();}
});
