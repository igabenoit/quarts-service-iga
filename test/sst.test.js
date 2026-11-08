import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {liveAppFixture} from './live-app-fixture.mjs';
import {normalizeSST} from '../sst.js';

test('SST : validation des saisies réelles sans fausse formation réalisée',()=>{
 const body={kind:'training',title:'Trancheur',status:'done',employeeKey:'service:1',eventDate:'2026-10-01',fields:{trainer:'Responsable',verification:'Observation pratique'}};
 assert.equal(normalizeSST(body).status,'done');
 for(const patch of [{eventDate:'2099-01-01'},{eventDate:'2026-02-30'},{employeeKey:null},{fields:{trainer:'Responsable'}},{status:'conforme'},{kind:'unknown'}])assert.throws(()=>normalizeSST({...body,...patch}));
 assert.throws(()=>normalizeSST({kind:'action',title:'Correctif',status:'done',eventDate:'2026-10-01',fields:{}}),/vérification/);
});
test('SST : administration, répertoire partagé en lecture seule, preuves, historique et sauvegarde',async t=>{
 const f=await liveAppFixture();try{
  const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  const headers={Origin:f.base,'X-SST-Request':'1'};
  const call=(method,path,body,extra={})=>f.call(method,'/api/sst/'+path,{cookie:admin,headers,body,...extra});
  await t.test('les données, les originaux et la sauvegarde exigent la session administrateur',async()=>{
   for(const path of ['state','history','export','audit-export','documents/00000000-0000-4000-8000-000000000000'])assert.equal((await f.call('GET','/api/sst/'+path)).status,401);
   assert.equal((await f.call('POST','/api/sst/records',{cookie:admin,body:{}})).status,403);
   assert.equal((await f.call('POST','/api/sst/records',{cookie:admin,headers:{Origin:'https://autre.example','X-SST-Request':'1'},body:{}})).status,403);
  });
  const meta=(await f.call('GET','/api/departments/meta',{cookie:admin})).body;
  const service=meta.departments.find(d=>d.key==='service'),department=meta.departments.find(d=>d.key==='boulangerie');
  const week=(await f.call('GET','/api/weeks/2030-10-14',{cookie:admin})).body;
  const employee=(await f.call('POST','/api/employees',{cookie:admin,headers:{'X-Service-Week':'2030-10-14','X-Service-Revision':week.revision},body:{name:'Employé SST Service',role:'cashier',roles:['cashier'],seniority:'2020-01-01',targetMinutes:1200,maxMinutes:2400,availability:{0:[[0,1440]]},active:true}}));assert.equal(employee.status,201,JSON.stringify(employee.body));
  const standalone=await f.call('POST','/api/departments/people',{cookie:admin,body:{name:'Employé SST Boulangerie',group:'regular',active:true,departments:[department.id],availability:{},employeeCode:'445566'}});assert.equal(standalone.status,200,JSON.stringify(standalone.body));
  let directory;await t.test('les deux sources restent partagées sans recopier les codes ou modifier les fiches',async()=>{
   const before=(await f.call('GET','/api/departments/meta',{cookie:admin})).body;
   directory=(await call('GET','state')).body;const names=directory.employees.map(p=>p.name);assert.ok(names.includes('Employé SST Service'));assert.ok(names.includes('Employé SST Boulangerie'));assert.equal(names.filter(n=>n==='Employé SST Service').length,1);
   assert.ok(directory.employees.find(p=>p.name==='Employé SST Service').departments.includes(service.id));assert.ok(!JSON.stringify(directory.employees).includes('445566'));
   const after=(await f.call('GET','/api/departments/meta',{cookie:admin})).body;assert.deepEqual(after,before);
  });
  await t.test('un gérant authentifié conserve ses horaires mais ne peut pas ouvrir les dossiers SST',async()=>{
   const people=(await f.call('GET','/api/departments/meta',{cookie:admin})).body.people;
   const manager={name:'Gestion SST test',login:'sst.manager',password:'Example-password-123',active:true,departments:[department.id],personId:standalone.body.id};
   const created=await f.call('POST','/api/manager-accounts',{cookie:admin,headers:{Origin:f.base},body:manager});assert.equal(created.status,200,JSON.stringify(created.body));
   const login=await f.call('POST','/api/manager-login',{body:{login:manager.login,password:manager.password}});assert.equal(login.status,200,JSON.stringify(login.body));
   for(const path of ['access','state','history','export','documents/00000000-0000-4000-8000-000000000000'])assert.equal((await f.call('GET','/api/sst/'+path,{cookie:login.cookie})).status,403);
   assert.equal((await f.call('POST','/api/sst/records',{cookie:login.cookie,headers,body:{}})).status,403);
   assert.equal((await f.call('POST','/api/sst/import',{cookie:login.cookie,headers,body:{}})).status,403);
   assert.equal((await f.call('GET','/api/departments/meta',{cookie:login.cookie})).status,200);
  });
  const person=directory.employees.find(p=>p.name==='Employé SST Service');
  const input={kind:'training',title:'Trancheur — formation test',status:'open',employeeKey:person.key,departmentId:service.id,eventDate:'2026-10-01',fields:{trainer:'Formateur test',verification:'Exercice pratique observé'}};
  const created=await call('POST','records',input);assert.equal(created.status,200,JSON.stringify(created.body));const id=created.body.id;
  await t.test('version, historique, statut réel, dossier lié et archivage réversible',async()=>{
   assert.equal((await call('POST','records',{...input,id,version:0,title:'Obsolète'})).status,409);
   const changed=await call('POST','records',{...input,id,version:1,status:'done'});assert.equal(changed.status,200,JSON.stringify(changed.body));
   const action=await call('POST','records',{kind:'action',title:'Vérifier la méthode',status:'open',relatedId:id,owner:'Responsable',dueDate:'2026-11-10',fields:{procedure:'Observation terrain'}});assert.equal(action.status,200);assert.ok((await call('GET','state')).body.records.some(r=>r.related_id===id));
   assert.equal((await call('POST','records/'+id+'/archive',{version:2,archived:true})).status,200);
   assert.equal((await call('POST','records',{...input,id,version:3,title:'Écriture archivée'})).status,409);
   assert.equal((await call('POST','records/'+id+'/archive',{version:3,archived:false})).status,200);
   const history=(await call('GET','history?id='+id)).body.events;assert.deepEqual(new Set(history.map(e=>e.action)),new Set(['record.created','record.updated','record.archived','record.restored']));assert.equal(history.find(e=>e.action==='record.updated').before_value.status,'open');
  });
  const raw=Buffer.from('%PDF-1.4\nSST original de test\n%%EOF');let fileId;
  await t.test('preuves privées, original intact, empreinte et absence de doublon',async()=>{
   const upload=async()=>{const r=await fetch(f.base+'/api/sst/documents?recordId='+id,{method:'POST',headers:{...headers,Cookie:admin,'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent('Attestation témoin.pdf')},body:raw});return {status:r.status,body:await r.json()}};
   const file=await upload();assert.equal(file.status,201,JSON.stringify(file.body));fileId=file.body.id;assert.equal((await upload()).body.id,fileId);
   const list=(await call('GET','state')).body.documents;assert.equal(list.length,1);assert.equal(list[0].sha256,createHash('sha256').update(raw).digest('hex'));assert.ok(!('data' in list[0]));
   const downloaded=await fetch(f.base+'/api/sst/documents/'+fileId,{headers:{Cookie:admin}});assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('content-type'),'application/pdf');assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),raw);
   assert.equal((await f.call('GET','/api/sst/documents/'+fileId)).status,401);
   assert.equal((await call('POST','documents/'+fileId+'/archive',{version:1,archived:true})).status,200);assert.equal((await call('POST','documents/'+fileId+'/archive',{version:1,archived:false})).status,409);assert.equal((await call('POST','documents/'+fileId+'/archive',{version:2,archived:false})).status,200);
  });
  await t.test('historique séparé : dates conservées, accès privé et fichiers exclus',async()=>{
   const out=await call('GET','audit-export');assert.equal(out.status,200);assert.equal(out.body.format,'iga-sst-audit-v1');
   const record=out.body.records.find(r=>r.id===id);assert.ok(record.created_at);assert.ok(record.updated_at);
   const file=out.body.documents.find(d=>d.id===fileId);assert.ok(file.created_at);assert.ok(!('dataBase64' in file));
   assert.ok(out.body.events.some(e=>e.action==='record.updated'));assert.ok(out.body.events.some(e=>e.action==='document.added'));
  });
  await t.test('la sauvegarde contient les dossiers, les traces et les fichiers originaux',async()=>{
   const out=await call('GET','export');assert.equal(out.status,200,JSON.stringify(out.body));assert.equal(out.body.format,'iga-sst-v1');assert.ok(out.body.records.find(r=>r.id===id));assert.ok(out.body.events.some(e=>e.action==='document.added'));assert.deepEqual(Buffer.from(out.body.documents.find(d=>d.id===fileId).dataBase64,'base64'),raw);
  });
 }finally{await f.close();}
});
