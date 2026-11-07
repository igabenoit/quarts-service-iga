import test from 'node:test';
import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';
import {emptyReport,normalizeIncidentReport} from '../public/incident-report-schema.js';

test('Rapport : contrôle des champs, dates, causes et tracés de signatures',()=>{
 const r=emptyReport();r.answers.eventDescription='<img src=x onerror=alert(1)> reste du texte';
 assert.equal(normalizeIncidentReport(r).answers.eventDescription,r.answers.eventDescription);
 for(const bad of [
  {...r,template:'inconnu'}, {...r,answers:{...r.answers,witnessDate:'2026-02-30'}},
  {...r,answers:{...r.answers,eventTime:'25:30'}}, {...r,answers:{...r.answers,photosAvailable:'oui'}},
  {...r,causes:['forged']}, {...r,measures:[{due:'2026-02-30'}]},
  {...r,answers:{...r.answers,eventDescription:'x'.repeat(6001)}},
  {...r,signatures:{worker:[[[1,'<script>']]]}}, {...r,signatures:{worker:[[[-1,4]]]}},
  {...r,signatures:{worker:[Array.from({length:601},()=>[4,5])]}},
 ])assert.throws(()=>normalizeIncidentReport(bad));
});

test('Rapport : dossier employé, corrections, historique, export et autorisations',async()=>{
 const f=await liveAppFixture();try{
 const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
 const headers={Origin:f.base,'X-SST-Request':'1'};
 const call=(path,body)=>f.call(body?'POST':'GET','/api/sst/'+path,{cookie:admin,headers,body});
 const meta=(await f.call('GET','/api/departments/meta',{cookie:admin})).body;
 const dept=meta.departments.find(d=>d.key==='boulangerie');
 const person=await f.call('POST','/api/departments/people',{cookie:admin,body:{name:'Employé fictif enquête',group:'regular',active:true,departments:[dept.id],availability:{},employeeCode:'887761'}});assert.equal(person.status,200);
 const key=(await call('state')).body.employees.find(e=>e.name==='Employé fictif enquête').key;
 const report=emptyReport();report.answers.eventDescription='Essai fictif — chute observée.';report.answers.workerName='Employé fictif enquête';report.signatures.worker=[[[20,30],[50,90],[70,80]]];report.causes=['environment-4'];report.measures[0]={cause:'Sol glissant',measure:'Sécuriser et nettoyer la zone.',owner:'Responsable fictif',due:'2026-11-10'};
 const body={kind:'incident',title:'Rapport fictif',employeeKey:key,departmentId:dept.id,eventDate:'2026-11-01',status:'draft',fields:{reportedFacts:'Note ancienne conservée',accidentReport:report}};
 assert.equal((await f.call('POST','/api/sst/records',{headers,body})).status,401);
 assert.equal((await f.call('POST','/api/sst/records',{cookie:admin,body})).status,403);
 assert.equal((await call('records',{...body,employeeKey:'store:999999'})).status,400);
 const created=await call('records',body);assert.equal(created.status,200,JSON.stringify(created.body));const id=created.body.id;
 let stored=(await call('state')).body.records.find(r=>r.id===id);assert.deepEqual(stored.fields.accidentReport,report);assert.equal(stored.employee_key,key);assert.equal(stored.version,1);
 const update={...body,id,version:1,correctionReason:'Précision du témoignage'};
 assert.equal((await call('records',{...update,correctionReason:''})).status,400);
 assert.equal((await call('records',{...update,fields:{}})).status,400);
 const corrected=structuredClone(report);corrected.answers.eventDescription='Précision ajoutée après vérification.';
 assert.equal((await call('records',{...update,fields:{accidentReport:corrected}})).status,400,'Une signature ancienne ne peut pas signer un contenu changé');
 corrected.signatures.worker=[];
 const saved=await call('records',{...update,fields:{...body.fields,accidentReport:corrected}});assert.equal(saved.status,200,JSON.stringify(saved.body));
 assert.equal((await call('records',update)).status,409);
 stored=(await call('state')).body.records.find(r=>r.id===id);assert.equal(stored.version,2);assert.equal(stored.fields.reportedFacts,'Note ancienne conservée');assert.deepEqual(stored.fields.accidentReport,corrected);
 const history=(await call('history?id='+id)).body.events;
 const correction=history.find(e=>e.action==='record.updated');assert.deepEqual(correction.before_value.fields.accidentReport,report);assert.equal(correction.after_value.correction_reason,update.correctionReason);assert.ok(correction.actor);assert.ok(correction.created_at);
 const backup=(await call('export')).body;assert.deepEqual(backup.records.find(r=>r.id===id).fields.accidentReport,corrected);assert.ok(backup.events.find(e=>e.record_id===id&&e.before_value?.fields?.accidentReport?.signatures?.worker.length));
 const manager={name:'Gérant fictif enquête',login:'test.enquete',password:'Example-test-12345',active:true,departments:[dept.id],personId:person.body.id};
 assert.equal((await f.call('POST','/api/manager-accounts',{cookie:admin,headers:{Origin:f.base},body:manager})).status,200);
 const login=await f.call('POST','/api/manager-login',{body:{login:manager.login,password:manager.password}});
 for(const path of ['state','history?id='+id,'export'])assert.equal((await f.call('GET','/api/sst/'+path,{cookie:login.cookie})).status,403);
 assert.equal((await f.call('POST','/api/sst/records',{cookie:login.cookie,headers,body:{...update,version:2}})).status,403);
 }finally{await f.close();}
});
