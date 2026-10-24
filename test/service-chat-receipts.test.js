import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {liveAppFixture} from './live-app-fixture.mjs';

test('receipts are explicit, idempotent and available only to a manager who sent the message',{timeout:90000},async()=>{
  const f=await liveAppFixture();
  try{
    const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
    const people=[],week='2026-10-19';
    for(let n=0;n<3;n++){
      const revision=(await f.call('GET','/api/weeks/'+week,{cookie:admin})).body.revision;
      const created=await f.call('POST','/api/employees',{cookie:admin,headers:{'x-service-week':week,'x-service-revision':revision},body:{name:'Personne fictive '+n,role:'cashier',active:true,employeeCode:'00123'+n,maxMinutes:2400,targetMinutes:1200,availability:{}}});
      assert.equal(created.status,201);
      const login=await f.call('POST','/api/employee-portal/access',{body:{code:'00123'+n}});
      people.push({employeeId:created.body.employee.id,cookie:login.cookie});
    }
    const meta=(await f.call('GET','/api/departments/meta',{cookie:admin})).body;
    for(const person of people)person.id=meta.people.find(p=>p.serviceEmployeeId===person.employeeId).id;
    const service=meta.departments.find(d=>d.key==='service');
    const account={name:'Gérant fictif',login:'receipt.manager',password:'Fixture-password-123!',active:true,departments:[service.id],personId:people[0].id};
    assert.equal((await f.call('POST','/api/manager-accounts',{cookie:admin,body:account})).status,200);
    const manager=(await f.call('POST','/api/manager-login',{body:{login:account.login,password:account.password}})).cookie;
    const send=(cookie,body,privateChat=false)=>f.call('POST','/api/service-chat'+(privateChat?'/private':'')+'/messages',{cookie,body:{body:'Message de test',requestId:randomUUID(),...body}});
    const record=(cookie,ids,privateChat=false,extra={})=>f.call('POST','/api/service-chat'+(privateChat?'/private':'')+'/views',{cookie,body:{messageIds:ids,...extra}});
    const read=(cookie,ids,privateChat=false)=>f.call('GET','/api/service-chat'+(privateChat?'/private':'')+'/views?messageIds='+ids.join(','),{cookie});
    const message=(await send(admin,{})).body.id;
    assert.equal((await read(null,[message])).status,401);
    assert.equal((await read(people[0].cookie,[message])).status,403);
    assert.equal((await read(manager,[message])).status,404,'another manager cannot inspect the sender’s consultations');
    assert.deepEqual((await read(admin,[message])).body.messages,[{id:message,viewers:[]}]);
    assert.equal((await read(admin,[message])).headers.get('cache-control'),'no-store');
    assert.equal((await f.call('POST','/api/service-chat/views',{cookie:people[0].cookie,headers:{origin:'https://evil.test'},body:{messageIds:[message]}})).status,403);
    assert.equal((await f.call('POST','/api/service-chat/read',{cookie:people[0].cookie,body:{lastId:message}})).status,200);
    assert.deepEqual((await read(admin,[message])).body.messages[0].viewers,[],'unread cursors and past logins never imply a view');
    assert.equal((await record(people[0].cookie,[message],false,{viewerKey:'admin',viewerName:'Forged',viewedAt:'2000-01-01'})).status,200);
    const first=(await read(admin,[message])).body.messages[0].viewers;
    assert.equal(first.length,1);assert.equal(first[0].name,'Personne fictive 0');assert.deepEqual(Object.keys(first[0]).sort(),['name','viewedAt']);
    assert.equal((await record(people[0].cookie,[message])).status,200);
    assert.equal((await record(manager,[message])).status,200);
    assert.deepEqual((await read(admin,[message])).body.messages[0].viewers,first,'same person on another device or manager account is counted once');
    assert.equal((await record(admin,[message])).status,200);
    assert.deepEqual((await read(admin,[message])).body.messages[0].viewers,first,'sender is excluded');
    assert.equal((await record(people[1].cookie,[message,'999999'])).status,404);
    assert.deepEqual((await read(admin,[message])).body.messages[0].viewers,first,'invalid batches record nothing');
    for(const ids of [[],[1],['1 OR TRUE'],Array.from({length:51},()=>message)])assert.equal((await record(people[0].cookie,ids)).status,400);
    const employeeMessage=(await send(people[0].cookie,{})).body.id;
    assert.equal((await read(people[0].cookie,[employeeMessage])).status,403,'employees cannot inspect even their own message receipts');
    assert.equal((await read(admin,[message,employeeMessage])).status,404);
    const managerMessage=(await send(manager,{})).body.id;
    assert.equal((await record(people[2].cookie,[managerMessage])).status,200);
    assert.equal((await read(manager,[managerMessage])).body.messages[0].viewers[0].name,'Personne fictive 2');
    const privateMessage=(await send(admin,{peer:'employee:'+people[1].id},true)).body.id;
    assert.equal((await record(people[2].cookie,[privateMessage],true)).status,404,'third party cannot record a private consultation');
    assert.equal((await record(people[1].cookie,[privateMessage],true)).status,200);
    assert.equal((await read(people[1].cookie,[privateMessage],true)).status,403);
    assert.equal((await read(manager,[privateMessage],true)).status,404);
    assert.equal((await read(admin,[privateMessage],true)).body.messages[0].viewers[0].name,'Personne fictive 1');
    const revision=(await f.call('GET','/api/weeks/'+week,{cookie:admin})).body.revision;
    assert.equal((await f.call('POST','/api/employees/'+people[0].employeeId+'/departure',{cookie:admin,headers:{'x-service-week':week,'x-service-revision':revision},body:{}})).status,200);
    assert.equal((await record(people[0].cookie,[managerMessage])).status,401);
    assert.equal((await read(manager,[managerMessage])).status,401,'departure also cuts the manager’s access to receipts');
    assert.deepEqual((await read(admin,[message])).body.messages[0].viewers,first,'past consultations remain historical facts after departure');
  }finally{await f.close();}
});
