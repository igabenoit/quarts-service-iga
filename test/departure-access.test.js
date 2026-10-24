import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {liveAppFixture} from './live-app-fixture.mjs';

test('departure revokes personal and manager access on every device, including legacy cookies and reactivation',{timeout:90000},async()=>{
  const f=await liveAppFixture();
  try{
    const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
    const week='2026-10-19';
    async function manage(method,path,body){
      const current=await f.call('GET',`/api/weeks/${week}`,{cookie:admin});
      return f.call(method,path,{cookie:admin,body,headers:{'x-service-week':week,'x-service-revision':current.body.revision}});
    }
    const employee=await manage('POST','/api/employees',{name:'Départ fictif',role:'cashier',active:true,employeeCode:'009876',maxMinutes:2400,targetMinutes:1200,availability:{}});
    assert.equal(employee.status,201,JSON.stringify(employee.body));
    const employeeId=employee.body.employee.id;
    const meta=(await f.call('GET','/api/departments/meta',{cookie:admin})).body;
    const person=meta.people.find(p=>p.serviceEmployeeId===employeeId),service=meta.departments.find(d=>d.key==='service');
    const account={name:'Nom affiché différent',login:'manager.depart',password:'Fiction-password-123!',active:true,departments:[service.id],personId:person.id};
    assert.equal((await f.call('POST','/api/manager-accounts',{cookie:admin,body:{...account,personId:null}})).status,400);
    assert.equal((await f.call('POST','/api/manager-accounts',{cookie:admin,body:{...account,personId:999999}})).status,400);
    assert.equal((await f.call('POST','/api/manager-accounts',{cookie:admin,body:account})).status,200);
    assert.equal((await f.call('POST','/api/manager-accounts',{cookie:admin,body:{...account,login:'manager.second'}})).status,200);
    const loginEmployee=()=>f.call('POST','/api/employee-portal/access',{body:{code:'009876'}});
    const loginManager=(login=account.login)=>f.call('POST','/api/manager-login',{body:{login,password:account.password}});
    const personal=[(await loginEmployee()).cookie,(await loginEmployee()).cookie];
    const managerial=[(await loginManager()).cookie,(await loginManager('manager.second')).cookie];
    assert.ok(personal.every(Boolean)&&managerial.every(Boolean));
    const publish=await manage('PUT',`/api/weeks/${week}/share-link`,{});
    assert.equal(publish.status,200,JSON.stringify(publish.body));
    const token=publish.body.path.split('/').pop();
    // Real signatures from the retired scheme must no longer grant access.
    const secret='isolated-platform-audit-secret',expires=Date.now()+3600000;
    const hmac=(value,encoding)=>createHmac('sha256',secret).update(value).digest(encoding);
    const codeHash=hmac('staff-code:654321','hex');
    const legacy=`leave_access=${expires}.${hmac(`leave-access:${codeHash}:${expires}`,'base64url')}; schedule_view=${token}.${expires}.${hmac(`staff-access:${token}:${codeHash}:${expires}`,'base64url')}`;
    for(const [method,path] of [['POST','/api/leave/access'],['GET','/api/leave/access-settings'],['PUT','/api/leave/access-settings']]){
      assert.equal((await f.call(method,path,{cookie:admin,body:method==='GET'?undefined:{code:'654321'}})).status,410);
    }
    const employeeReads=['/api/leave/department-schedules',`/api/public-schedules/${token}`,'/api/service-chat/messages','/api/service-chat/private/messages?peer=admin','/api/leave/form','/api/leave/availability/form','/api/leave/clothing','/api/access-session?mode=employee',`/api/public-schedules/${token}/leave-form`];
    const managerReads=[`/api/weeks/${week}`,'/api/departments/meta','/api/service-chat/messages?mode=manager','/api/access-session?mode=manager'];
    for(const path of employeeReads){
      assert.equal((await f.call('GET',path,{cookie:personal[0]})).status,200,path);
      assert.equal((await f.call('GET',path,{cookie:legacy})).status,401,path+' rejects shared cookies');
    }
    for(const path of managerReads)assert.equal((await f.call('GET',path,{cookie:managerial[0]})).status,200,path);
    const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1sAAAAASUVORK5CYII=';
    const message=await f.call('POST','/api/service-chat/messages',{cookie:personal[0],body:{body:'Message fictif',photo,requestId:randomUUID()}});
    assert.equal(message.status,201);
    employeeReads.push(`/api/service-chat/messages/${message.body.id}/photo`);
    // A failed departure must not revoke a current account.
    assert.equal((await f.call('POST',`/api/employees/${employeeId}/departure`,{cookie:admin,body:{}})).status,409);
    assert.equal((await f.call('GET',managerReads[0],{cookie:managerial[0]})).status,200);
    const departed=await manage('POST',`/api/employees/${employeeId}/departure`,{});
    assert.equal(departed.status,200,JSON.stringify(departed.body));
    assert.ok(departed.body.employee.departedAt);
    async function denied(){
      for(const cookie of personal)for(const path of employeeReads)assert.equal((await f.call('GET',path,{cookie:cookie+'; '+legacy})).status,401,path);
      for(const cookie of managerial)for(const path of managerReads)assert.equal((await f.call('GET',path,{cookie})).status,401,path);
      for(const [path,body] of [['/api/service-chat/messages',{body:'Non autorisé',requestId:randomUUID()}],['/api/service-chat/private/messages',{body:'Non autorisé',peer:'admin',requestId:randomUUID()}],['/api/leave/submit',{}],['/api/leave/availability/submit',{}],['/api/leave/clothing/orders',{}]]){
        assert.equal((await f.call('POST',path,{cookie:personal[0]+'; '+legacy,body})).status,401,path);
      }
    }
    await denied();
    assert.equal((await loginEmployee()).status,401);
    assert.equal((await loginManager()).status,401);
    const accounts=(await f.call('GET','/api/manager-accounts',{cookie:admin})).body.accounts;
    assert.ok(accounts.every(a=>!a.accessAllowed));
    const accountRow=accounts[0];
    assert.equal((await f.call('PUT','/api/manager-accounts/'+accountRow.id,{cookie:admin,body:{...account,version:accountRow.version}})).status,400,'cannot reactivate a manager attached to a departed employee');
    // An intentional undo restores the employee, but never old sessions.
    const undo=(await f.call('GET','/api/undo',{cookie:admin})).body;
    const action=undo.action||undo;
    const restored=await manage('POST','/api/undo',{actionId:action.id});
    assert.equal(restored.status,200,JSON.stringify(restored.body));
    await denied();
    assert.equal((await loginEmployee()).status,200);
    assert.equal((await loginManager()).status,200);
    assert.equal((await f.call('GET','/api/manager-accounts',{cookie:admin})).status,200,'owner keeps administrative access');
  }finally{await f.close();}
});

test('deactivating a department employee also blocks the linked manager without affecting other employees',{timeout:60000},async()=>{
  const f=await liveAppFixture();try{
    const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
    const meta=(await f.call('GET','/api/departments/meta',{cookie:admin})).body;
    const bakery=meta.departments.find(d=>d.key==='boulangerie');
    const person={name:'Gérante fictive Boulangerie',group:'regular',active:true,departments:[bakery.id],availability:{},employeeCode:'001234'};
    const saved=await f.call('POST','/api/departments/people',{cookie:admin,body:person});assert.equal(saved.status,200);
    const account={name:person.name,login:'bakery.manager',password:'Fixture-password-123!',active:true,departments:[bakery.id],personId:saved.body.id};
    assert.equal((await f.call('POST','/api/manager-accounts',{cookie:admin,body:account})).status,200);
    const employee=(await f.call('POST','/api/employee-portal/access',{body:{code:person.employeeCode}})).cookie;
    const manager=(await f.call('POST','/api/manager-login',{body:{login:account.login,password:account.password}})).cookie;
    const path=`/api/departments/${bakery.id}/weeks/2026-10-19`;
    assert.equal((await f.call('GET',path,{cookie:manager})).status,200);
    assert.equal((await f.call('PUT','/api/departments/people/'+saved.body.id,{cookie:admin,body:{...person,active:false,version:1}})).status,200);
    assert.equal((await f.call('GET',path,{cookie:manager})).status,401);
    assert.equal((await f.call('GET','/api/leave/form',{cookie:employee})).status,401);
    assert.equal((await f.call('POST','/api/manager-login',{body:{login:account.login,password:account.password}})).status,401);
    assert.equal((await f.call('GET','/api/departments/meta',{cookie:admin})).status,200);
  }finally{await f.close();}
});
