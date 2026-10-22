import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {liveAppFixture} from './live-app-fixture.mjs';

test('leave form and submission accept the employee session without a common-code session',{timeout:60000},async()=>{
  const f=await liveAppFixture();try{
    const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
    const meta=await f.call('GET','/api/departments/meta',{cookie:admin});
    const department=meta.body.departments.find(d=>d.key==='boulangerie');
    const person={name:'Employé fictif congés',group:'regular',active:true,departments:[department.id],availability:{},employeeCode:'001234'};
    const created=await f.call('POST','/api/departments/people',{cookie:admin,body:person});
    assert.equal(created.status,200,JSON.stringify(created.body));
    const login=await f.call('POST','/api/employee-portal/access',{body:{code:person.employeeCode}});
    assert.equal(login.status,200);assert.match(login.cookie,/^employee_portal=/);
    assert.ok(!login.headers.get('set-cookie').includes('leave_access='),'personal login does not create a shared session');
    const cookie=login.cookie;
    assert.equal((await f.call('GET','/api/leave/department-schedules',{cookie})).status,200);
    const form=await f.call('GET','/api/leave/form',{cookie});
    assert.equal(form.status,200,JSON.stringify(form.body));
    assert.equal(form.headers.get('cache-control'),'no-store');
    assert.equal(form.body.nameEntry,'manual');
    // Personal access also works when no common code has been configured yet.
    assert.equal((await f.call('GET','/api/leave/access-settings',{cookie:admin})).body.configured,false);
    const body={submissionKey:randomUUID(),employeeName:person.name,departmentId:form.body.departments[0].id,email:'conges@example.com',reason:'Demande fictive de test',periods:[{startDate:form.body.earliest,endDate:form.body.earliest,allDay:true}]};
    const submitted=await f.call('POST','/api/leave/submit',{cookie,body});
    assert.equal(submitted.status,201,JSON.stringify(submitted.body));
    assert.equal(submitted.body.status,'pending');
    assert.equal((await f.call('POST','/api/leave/submit',{cookie,body,headers:{origin:'https://different.example'}})).status,403);

    // Existing shared sessions remain valid; new visitors use the personal login.
    assert.equal((await f.call('PUT','/api/leave/access-settings',{cookie:admin,body:{code:'654321'}})).status,200);
    for(const path of ['/api/leave/form','/api/leave/requests','/api/leave/access-settings']){
      assert.equal((await f.call('GET',path)).status,401,path);
    }
    assert.equal((await f.call('POST','/api/leave/submit',{body})).status,401);
    for(const path of ['/api/leave/requests','/api/leave/access-settings']){
      assert.equal((await f.call('GET',path,{cookie})).status,401,'employee session cannot access management');
    }
    const common=await f.call('POST','/api/leave/access',{body:{code:'654321'}});
    assert.equal(common.status,200);assert.match(common.cookie,/^leave_access=/);
    assert.equal((await f.call('GET','/api/leave/form',{cookie:common.cookie})).status,200);
    assert.equal((await f.call('POST','/api/leave/submit',{cookie:common.cookie,body:{...body,submissionKey:randomUUID()}})).status,201);
    for(let i=0;i<15;i++)assert.equal((await f.call('POST','/api/leave/access',{body:{code:'000000'}})).status,401);
    assert.equal((await f.call('POST','/api/leave/access',{body:{code:'654321'}})).status,429);
    assert.equal((await f.call('GET','/api/leave/form',{cookie})).status,200,'shared-code lockout does not block a valid employee');
    assert.equal((await f.call('POST','/api/leave/submit',{cookie,body:{...body,submissionKey:randomUUID()}})).status,201);

    const id=cookie.split('=')[1].split('.')[0],expires=Date.now()-1000;
    const signature=createHmac('sha256','isolated-platform-audit-secret').update(`employee:${id}:${expires}:${person.employeeCode}`).digest('base64url');
    const expired=`employee_portal=${id}.${expires}.${signature}`;
    for(const invalid of [cookie+'tampered',expired]){
      assert.equal((await f.call('GET','/api/leave/form',{cookie:invalid})).status,401);
      assert.equal((await f.call('POST','/api/leave/submit',{cookie:invalid,body})).status,401);
    }
    assert.equal((await f.call('GET','/api/leave/form',{cookie:expired+'; '+common.cookie})).status,200,'a valid shared session still works');
    const logout=await f.call('POST','/api/employee-portal/logout',{cookie});
    assert.equal((await f.call('GET','/api/leave/form',{cookie:logout.cookie})).status,401);
    const people=(await f.call('GET','/api/departments/meta',{cookie:admin})).body.people;
    const current=people.find(p=>p.id===created.body.id);
    const disabled=await f.call('PUT',`/api/departments/people/${current.id}`,{cookie:admin,body:{...person,active:false,version:current.version}});
    assert.equal(disabled.status,200,JSON.stringify(disabled.body));
    assert.equal((await f.call('GET','/api/leave/form',{cookie})).status,401,'deactivation revokes personal access immediately');
    assert.equal((await f.call('POST','/api/leave/submit',{cookie,body})).status,401);
  }finally{await f.close();}
});
