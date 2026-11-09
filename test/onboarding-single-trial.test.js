import test from 'node:test';
import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';
import {tuacFields} from '../onboarding/tuac.js';
test('essai unique : coffre général fermé, destinataires fixes et PDF isolé',async()=>{
 const f=await liveAppFixture({singleTrial:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  const headers={Origin:f.base,'X-Employee-Files':'1'};
  const call=(method,path,body)=>f.call(method,'/api/employee-files/'+path,{cookie,headers,body});
  const route=(op='',key='trial:unique')=>'onboarding'+(op?'/'+op:'')+'?key='+key;
  const state=await call('GET','state');assert.equal(state.body.storage.singleTrial,true);assert.equal(state.body.storage.ready,false);
  assert.equal((await call('POST','policy',{confirmed:true,text:'politique'})).status,503);
  assert.equal((await call('GET','policy')).body.published,false);
  assert.equal((await call('GET',route('','store:2'))).status,404);
  assert.equal((await f.call('GET','/api/employee-files/'+route())).status,403);
  const c=(await call('GET',route())).body;
  const config={days:1,due:'2030-11-15',documents:['tuac'],email:c.employeeEmail,managerEmail:c.managerEmail,approvedPolicy:c.policyId};
  assert.equal((await call('POST',route('invite','store:2'),config)).status,404);
  assert.equal((await call('POST',route('invite'),{...config,email:'outside@example.invalid'})).status,400);
  assert.equal((await call('POST',route('invite'),{...config,approvedPolicy:''})).status,400);
  const invite=await call('POST',route('invite'),config);assert.equal(invite.status,200,JSON.stringify(invite.body));
  const employee=(action,body)=>f.call('POST','/api/accueil-employe/'+action,{headers:{...headers,Authorization:'Bearer '+invite.body.path.split('#')[1]},body});
  const answers=Object.fromEntries(tuacFields.map(k=>[k,'Exemple']));
  Object.assign(answers,{Naissance:'1990-01-01',Emploi:'2026-11-09',Signature:'2026-11-09'});
  assert.equal((await employee('sign',{version:0,kind:'tuac',answers,policy:c.policyId,strokes:[[[0,0],[1,1]]]})).status,200);
  const done=(await call('GET',route())).body;assert.ok(done.completed_at);
  assert.equal((await call('GET','originals/'+done.documents[0].original_id)).status,200);
  assert.equal((await call('GET','originals/00000000-0000-0000-0000-000000000000')).status,404);
  assert.equal((await call('POST','campaigns',{})).status,503);
 }finally{await f.close();}
});
