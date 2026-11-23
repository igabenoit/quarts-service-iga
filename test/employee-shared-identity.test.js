import test from 'node:test';
import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';
import {departmentFixture} from './department-fixture.js';

test('répertoire commun : créer depuis RH ou les horaires, retrouver la même fiche et bloquer les doublons',{timeout:90000},async()=>{
 const f=await liveAppFixture({employeeVault:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie,headers={Origin:f.base,'X-Employee-Files':'1'};
  const call=(method,path,body,extra={})=>f.call(method,path,{cookie,headers:{...headers,...extra},body});
  const must=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body).slice(0,400));return r.body;};
  const meta=must(await call('GET','/api/departments/meta')),dep=meta.departments.find(d=>d.key==='boulangerie');
  const body={name:'Émile Exemple Fictif',employeeCode:'887781',email:'emile@example.invalid',birthday:'2000-01-01',group:'regular',active:true,departments:[dep.id],availability:{}};
  const created=must(await call('POST','/api/departments/people',body)),key='store:'+created.id;
  let state=must(await call('GET','/api/employee-files/state?view=direction'));
  assert.equal(state.employees.filter(e=>e.key===key).length,1);assert.equal(state.employees.find(e=>e.key===key).name,body.name);
  const query=must(await call('POST','/api/departments/people/matches',{name:'Fictif Exemple Emile',employeeCode:'887781'}));
  assert.equal(query.matches.length,1);assert.equal(query.matches[0].employeeKey,key);assert.equal(query.matches[0].canOpen,true);assert.deepEqual(query.matches[0].reasons,['code','name']);
  assert.equal(query.matches[0].employeeCode,undefined);assert.equal(query.matches[0].birthday,undefined);assert.equal(query.matches[0].email,undefined);
  assert.ok(must(await call('POST','/api/departments/people/matches',{name:'Emi Ex'})).matches.some(m=>m.employeeKey===key));
  must(await call('POST','/api/departments/people',{...body,name:'Fictif Exemple Emile',employeeCode:'887782'}),409);
  must(await call('POST','/api/departments/people',{...body,name:'Autre nom',distinctPerson:true}),409);
  must(await call('POST','/api/departments/people',{...body,employeeCode:'887783',distinctPerson:true}));
  const service=async input=>{const week='2030-01-07',snapshot=must(await call('GET','/api/weeks/'+week));return call('POST','/api/employees',{role:'cashier',targetMinutes:0,maxMinutes:2400,availability:{},active:true,...input},{'X-Service-Week':week,'X-Service-Revision':snapshot.revision});};
  must(await service({name:'Fictif Exemple Emile',employeeCode:'887784'}),409);
  must(await service({name:'Autre identité',employeeCode:'887781',distinctPerson:true}),409);
  const importWeek='2030-01-07',importSnapshot=must(await call('GET','/api/weeks/'+importWeek));
  must(await call('POST','/api/employees/import',{employees:[{name:'Fictif Exemple Emile',role:'cashier',availability:{}}]},{'X-Service-Week':importWeek,'X-Service-Revision':importSnapshot.revision}),409);
  const svc=must(await service({name:'Service Exemple Fictif',employeeCode:'887785',email:'service@example.invalid',birthday:'2000-02-01'}),201).employee;
  state=must(await call('GET','/api/employee-files/state?view=direction'));
  assert.equal(state.employees.filter(e=>e.key==='service:'+svc.id).length,1);
  const mirror=must(await call('GET','/api/departments/meta')).people.find(p=>p.serviceEmployeeId===svc.id);
  assert.equal(mirror.email,'service@example.invalid');assert.equal(mirror.employeeCode,'887785');
  assert.equal(must(await call('GET','/api/employee-files/onboarding?view=direction&key=service:'+svc.id)).suggestedEmployeeEmail,'service@example.invalid');
  assert.equal(must(await call('POST','/api/departments/people/matches',{employeeCode:'887785'})).matches[0].employeeKey,'service:'+svc.id);
  must(await call('POST','/api/departments/people',{...body,name:'Service Exemple Fictif',employeeCode:'887786',email:''}),409);
  const results=await Promise.all([call('POST','/api/departments/people',{...body,name:'Création simultanée fictive',employeeCode:'887788',email:''}),call('POST','/api/departments/people',{...body,name:'Création simultanée fictive',employeeCode:'887788',email:''})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.call('POST','/api/departments/people/matches',{headers,body:{name:body.name}})).status,401);
  assert.equal((await f.query('SELECT count(*)::int AS n FROM schedule_store_people WHERE employee_code=$1',['887788'])).rows[0].n,1);
  assert.deepEqual(await f.onboardingMail(),[],'creation alone must never send an invitation');
 }finally{await f.close();}
});

test('gérant : rechercher une fiche hors périmètre ne donne pas accès au dossier RH',async()=>{
 const f=await departmentFixture();
 try{
  const departments=(await f.call('get','/api/departments/meta')).body.departments,bakery=departments.find(d=>d.key==='boulangerie').id,meat=departments.find(d=>d.key==='viande').id;
  const b={name:'Personne Partagée Fictive',employeeCode:'887779',group:'regular',active:true,departments:[meat],availability:{}};
  assert.equal((await f.call('post','/api/departments/people',{body:b})).code,200);
  const response=await f.call('post','/api/departments/people/matches',{manager:{kind:'account',departments:[bakery]},body:{name:b.name}});
  assert.equal(response.code,200);assert.equal(response.body.matches[0].canOpen,false);assert.equal(response.body.matches[0].employeeCode,undefined);
  const duplicate=await f.call('post','/api/departments/people',{manager:{kind:'account',departments:[bakery]},body:{...b,employeeCode:'887780',departments:[bakery]}});
  assert.equal(duplicate.code,409);
  const alias=await f.call('post','/api/departments/people',{body:{...b,employeeCode:'',distinctPerson:true,departments:[bakery]}});
  assert.equal(alias.code,200);
  const owner=(await f.call('get','/api/departments/meta')).body.people.find(p=>p.employeeCode===b.employeeCode);
  assert.equal((await f.call('put','/api/departments/people/:id/portal-link',{params:{id:alias.body.id},body:{confirmed:true,portalPersonId:owner.id,version:1,targetVersion:owner.version}})).code,200);
  const linked=await f.call('post','/api/departments/people/matches',{manager:{kind:'account',departments:[bakery]},body:{name:b.name}});
  assert.equal(linked.body.matches.length,1);assert.equal(linked.body.matches[0].employeeKey,'store:'+owner.id);assert.equal(linked.body.matches[0].canOpen,true);
 }finally{await f.db.close();}
});
