import test from 'node:test';
import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';

test('Service publication remains frozen for employee, family and store until explicit republication',{timeout:90000},async()=>{
  const f=await liveAppFixture();try{
    const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
    const week='2026-10-19';
    const manage=async(method,path,body)=>{
      const revision=(await f.call('GET',`/api/weeks/${week}`,{cookie:admin})).body.revision;
      return f.call(method,path,{cookie:admin,body,headers:{'x-service-week':week,'x-service-revision':revision}});
    };
    const employee=await manage('POST','/api/employees',{name:'Employé fictif Service',role:'cashier',active:true,employeeCode:'009876',maxMinutes:2400,targetMinutes:1200,availability:Object.fromEntries(Array.from({length:7},(_,d)=>[d,[[0,1440]]]))});
    assert.equal(employee.status,201,JSON.stringify(employee.body));
    const shift=await manage('POST',`/api/weeks/${week}/shifts`,{role:'cashier',days:[0],startMinute:480,endMinute:960,breakMinutes:60});assert.equal(shift.status,201);
    const id=shift.body.shifts[0].id;
    const assignment=await manage('PUT',`/api/shifts/${id}/assignment`,{employeeId:employee.body.employee.id});assert.equal(assignment.status,200,JSON.stringify(assignment.body));
    const invalidRole=await manage('PUT',`/api/shifts/${id}`,{role:'packer',dayIndex:0,startMinute:480,endMinute:960});assert.equal(invalidRole.status,400);assert.match(invalidRole.body.error,/fonctions/);
    const second=await manage('POST',`/api/weeks/${week}/shifts`,{role:'cashier',days:[1],startMinute:480,endMinute:960});
    assert.equal((await manage('PUT',`/api/shifts/${second.body.shifts[0].id}/assignment`,{employeeId:employee.body.employee.id})).status,200);
    const duplicateDay=await manage('PUT',`/api/shifts/${id}`,{role:'cashier',dayIndex:1,startMinute:480,endMinute:960});assert.equal(duplicateDay.status,400);assert.match(duplicateDay.body.error,/déjà un quart/);
    const person=(await manage('GET','/api/departments/meta')).body.people.find(p=>p.serviceEmployeeId===employee.body.employee.id);
    const family=await manage('POST','/api/family-accounts',{name:'Famille fictive audit',personIds:[person.id],active:true});assert.equal(family.status,200);
    const familyCookie=(await f.call('POST','/api/family-portal/access',{body:{code:family.body.code}})).cookie;
    const employeeCookie=(await f.call('POST','/api/employee-portal/access',{body:{code:'009876'}})).cookie;
    assert.deepEqual((await f.call('GET','/api/leave/department-schedules',{cookie:employeeCookie})).body.service,[]);
    const published=await manage('PUT',`/api/weeks/${week}/share-link`,{});assert.equal(published.status,200);const token=published.body.path.split('/').pop();
    const personal=()=>f.call('GET','/api/public-schedules/'+token,{cookie:employeeCookie});
    assert.equal((await personal()).body.employees[0].shifts[0].startMinute,480);
    const changed=await manage('PUT',`/api/shifts/${id}`,{role:'cashier',dayIndex:0,startMinute:600,endMinute:1020,breakMinutes:0});assert.equal(changed.status,200,JSON.stringify(changed.body));
    assert.equal((await personal()).body.employees[0].shifts[0].startMinute,480,'an unpublished edit must not reach the employee');
    const familyView=await f.call('GET',`/api/family-portal/weeks/${week}`,{cookie:familyCookie});assert.equal(familyView.body.people[0].days[0].entries[0].start,480);
    const store=await manage('GET',`/api/store-portal/weeks/${week}`);assert.equal(store.body.employees[0].days[0].entries[0].start,480);
    await f.stop();await f.start();assert.equal((await personal()).body.employees[0].shifts[0].startMinute,480);
    assert.equal((await manage('PUT',`/api/weeks/${week}/share-link`,{})).body.path,published.body.path);
    assert.equal((await personal()).body.employees[0].shifts[0].startMinute,600);
    assert.equal((await f.call('GET','/h/'+token)).headers.get('location'),'/horaires-departements');
    assert.equal((await manage('DELETE',`/api/weeks/${week}/share-link`)).status,200);
    assert.equal((await personal()).status,404);
  }finally{await f.close();}
});

test('Service rejects stale, absent and wrong-week revisions without changing saved data',{timeout:60000},async()=>{
  const f=await liveAppFixture();try{
    const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
    const week='2026-10-19',path=`/api/weeks/${week}`;
    const original=await f.call('GET',path,{cookie});assert.equal(original.status,200,JSON.stringify(original.body));
    assert.equal((await f.call('GET','/api/weeks/2026-02-30',{cookie})).status,400);
    assert.equal((await f.call('GET','/api/weeks/2026-10-20',{cookie})).status,400);
    const headers={'x-service-week':week,'x-service-revision':original.body.revision};
    const body={cashierBudgetMinutes:300,packerBudgetMinutes:200,notes:'Gestionnaire A'};
    const saved=await f.call('PUT',path,{cookie,headers,body});assert.equal(saved.status,200,JSON.stringify(saved.body));
    assert.notEqual(saved.headers.get('x-service-revision'),headers['x-service-revision']);
    assert.equal((await f.call('PUT',path,{cookie,headers,body:{...body,notes:'Gestionnaire B'}})).status,409);
    assert.equal((await f.call('PUT',path,{cookie,body})).status,409);
    const current={'x-service-week':week,'x-service-revision':saved.headers.get('x-service-revision')};
    assert.equal((await f.call('PUT','/api/weeks/2026-10-26',{cookie,headers:current,body})).status,409);
    assert.equal((await f.call('GET',path,{cookie})).body.week.notes,'Gestionnaire A');
    assert.equal((await f.call('PUT',path+'/share-link',{cookie,headers,body:{}})).status,409);
    const publish=await f.call('PUT',path+'/share-link',{cookie,headers:current,body:{}});assert.equal(publish.status,200);
    assert.equal((await f.call('DELETE',path+'/share-link',{cookie,headers:current})).status,409);
  }finally{await f.close();}
});
