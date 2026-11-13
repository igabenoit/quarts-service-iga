import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {liveAppFixture} from './live-app-fixture.mjs';
import {employeeFilesStorage} from '../employee-files-storage.js';

test('coffre obligatoire : aucun repli vers Render et aucune écriture sans stockage canadien',async()=>{
 assert.equal((await employeeFilesStorage({})).pool,null);
 for(const env of [
  {EMPLOYEE_FILES_DATABASE_URL:'postgres://dpg-test.oregon-postgres.render.com/db'},
  {EMPLOYEE_FILES_DATABASE_URL:'postgres://example.test/db',EMPLOYEE_FILES_REGION:'us-east-1',EMPLOYEE_FILES_HOSTING_REVIEWED:'yes'},
  {EMPLOYEE_FILES_DATABASE_URL:'postgres://example.test/db',EMPLOYEE_FILES_REGION:'ca-central-1'}
 ])await assert.rejects(()=>employeeFilesStorage(env));
 const f=await liveAppFixture();try{const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  const s=await f.call('GET','/api/employee-files/state?view=direction',{cookie});assert.equal(s.status,200);assert.equal(s.body.storage.ready,false);
  const blocked=await f.call('POST','/api/employee-files/templates?view=direction',{cookie,body:{title:'Ne pas écrire'},headers:{Origin:f.base,'X-Employee-Files':'1'}});assert.equal(blocked.status,503);
  assert.equal((await f.call('GET','/api/sst/state',{cookie})).status,200);
  assert.equal((await f.call('GET','/api/employee-files/policy')).status,200);
 }finally{await f.close();}
});

test('une erreur de schéma du coffre laisse le SST disponible et les dossiers sans écriture',async()=>{
 const f=await liveAppFixture({employeeVault:true,employeeSchemaFailure:true});try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  assert.equal((await f.call('GET','/api/sst/state',{cookie})).status,200);
  const s=await f.call('GET','/api/employee-files/state?view=direction',{cookie});assert.equal(s.status,200);assert.equal(s.body.storage.ready,false);
  assert.equal((await f.call('POST','/api/employee-files/templates?view=direction',{cookie,body:{},headers:{Origin:f.base,'X-Employee-Files':'1'}})).status,503);
 }finally{await f.close();}
});

test('dossiers employés : parcours réel, permissions, originaux et confidentialité en base fictive isolée',{timeout:120000},async t=>{
 const f=await liveAppFixture({employeeVault:true});try{
 const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie,headers={Origin:f.base,'X-Employee-Files':'1'},sstHeaders={Origin:f.base,'X-SST-Request':'1'};
 const call=(cookie,view,method,path,body)=>f.call(method,'/api/employee-files/'+path+(path.includes('?')?'&':'?')+'view='+view,{cookie,headers,body});
 const a=(method,path,body)=>call(admin,'direction',method,path,body);
 const must=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
 const meta=must(await f.call('GET','/api/departments/meta',{cookie:admin})),bakery=meta.departments.find(d=>d.key==='boulangerie'),other=meta.departments.find(d=>d.key!=='boulangerie'&&d.key!=='service');
 const persons=[{name:'Test Employée A',code:'887761',dep:bakery.id},{name:'Test Employé B',code:'887762',dep:other.id},{name:'Test Gérante',code:'887763',dep:bakery.id},{name:'Test sans matricule',code:'',dep:bakery.id}];
 for(const p of persons)must(await f.call('POST','/api/departments/people',{cookie:admin,body:{name:p.name,group:'regular',active:true,departments:[p.dep],availability:{},employeeCode:p.code}}));
 let state=must(await a('GET','state'));for(const p of persons)p.key=state.employees.find(e=>e.name===p.name).key;
 const [alice,bob,manager,missing]=persons;
 const aliceCookie=(await f.call('POST','/api/employee-portal/access',{body:{code:alice.code}})).cookie,bobCookie=(await f.call('POST','/api/employee-portal/access',{body:{code:bob.code}})).cookie;
 const accounts=must(await f.call('POST','/api/manager-accounts',{cookie:admin,headers,body:{name:manager.name,login:'employee.files.test',password:'Password-test-only-123',departments:[bakery.id],personId:Number(manager.key.split(':')[1]),active:true}}));
 const accountId=Number(accounts.accounts.find(x=>x.name===manager.name).id),managerCookie=(await f.call('POST','/api/manager-login',{body:{login:'employee.files.test',password:'Password-test-only-123'}})).cookie;
 const m=(method,path,body)=>call(managerCookie,'gerant',method,path,body),e=(method,path,body)=>call(aliceCookie,'employe',method,path,body);
 let general,sst,rh,aliceGeneral,aliceSST,aliceRH,originalId;
 await t.test('répertoire réel partagé, matricule secret, aucun accès anonyme ou hors département',async()=>{
  assert.equal((await f.call('GET','/api/employee-files/state')).status,401);
  assert.ok(state.exceptions.some(p=>p.key===missing.key));assert.equal(state.employees.find(p=>p.key===alice.key).issue,'');
  for(const code of persons.map(p=>p.code).filter(Boolean))assert.ok(!JSON.stringify(state).includes(code));
  const me=must(await e('GET','state'));assert.deepEqual(me.employees.map(p=>p.key),[alice.key]);
  const scoped=must(await m('GET','state'));assert.ok(scoped.employees.some(p=>p.key===alice.key));assert.ok(!scoped.employees.some(p=>p.key===bob.key));
  assert.equal((await call(managerCookie,'direction','GET','state')).status,403);
  assert.equal((await call(admin,'employe','GET','state')).status,401);
 });
 const template=async(category,title,extra={})=>must(await a('POST','templates',{title,category,body:'Texte de TEST, uniquement pour les essais.',fields:[{label:'Confirmation fictive',type:'checkbox',required:true},{label:'Commentaire fictif',type:'textarea',required:false}],departments:[],jobs:[],managerAssignable:true,published:true,...extra}),201).id;
 await t.test('modèles versionnés, catégories sensibles désactivées, protection origine',async()=>{
  general=await template('general','Accueil fictif');sst=await template('sst','Consignes SST fictives');rh=await template('rh','Titre RH confidentiel fictif');
  assert.equal((await a('POST','templates',{title:'Paie',category:'payroll',fields:[],published:true})).status,409);
  assert.equal((await m('POST','templates',{title:'Impossible'})).status,403);
  assert.equal((await f.call('POST','/api/employee-files/templates?view=direction',{cookie:admin,body:{}})).status,403);
 });
 const assign=async(keys,ids,who=a)=>{const body={employeeKeys:keys,templateIds:ids,workflow:'new',dueDate:'2026-12-01'},preview=must(await who('POST','campaigns/preview',body));const r=must(await who('POST','campaigns',{...body,token:preview.token}),201);assert.equal(r.sent,0);return preview;};
 await t.test('campagne : aperçu obligatoire, exclusions des matricules absents, doublons et envois désactivés',async()=>{
  const p=await assign([alice.key,missing.key],[general,sst,rh]);assert.equal(p.items.length,3);assert.ok(p.excluded.some(x=>x.key===missing.key));
  await assign([bob.key],[general]);
  assert.equal((await m('POST','campaigns/preview',{employeeKeys:[bob.key],templateIds:[general]})).status,404);
  assert.equal((await m('POST','campaigns/preview',{employeeKeys:[alice.key],templateIds:[rh]})).status,403);
  const duplicate=must(await a('POST','campaigns/preview',{employeeKeys:[alice.key],templateIds:[general]}));assert.equal(duplicate.items.length,0);
  assert.equal((await a('POST','campaigns',{employeeKeys:[manager.key],templateIds:[general],token:'forged'})).status,409);
  assert.equal((await a('POST','invitations',{})).status,409);
  state=must(await a('GET','state'));aliceGeneral=state.assignments.find(r=>r.employee_key===alice.key&&r.template_id===general);aliceSST=state.assignments.find(r=>r.employee_key===alice.key&&r.template_id===sst);aliceRH=state.assignments.find(r=>r.employee_key===alice.key&&r.template_id===rh);
 });
 await t.test('droits sur fiches et exports : RH masqué au gérant, IDOR refusé',async()=>{
  const scoped=must(await m('GET','state')),r=scoped.assignments.find(r=>r.id===aliceRH.id);assert.equal(r.access,false);assert.equal(r.title,'Ressources humaines');assert.equal(r.template_id,null);
  assert.equal((await m('GET','assignments/'+aliceRH.id)).status,403);
  assert.equal((await call(bobCookie,'employe','GET','assignments/'+aliceGeneral.id)).status,404);
  const exportData=must(await m('GET','export'));assert.ok(!JSON.stringify(exportData).includes('Titre RH confidentiel'));assert.ok(!JSON.stringify(exportData).includes('Test Employé B'));
 });
 await t.test('brouillon, conflit, signature personnelle, PDF original et serveur horodaté',async()=>{
  assert.equal((await e('POST','assignments/'+aliceGeneral.id+'/draft',{answers:{},version:1})).status,428);
  const prepared=must(await f.call('GET','/api/employee-files/policy'));assert.equal(prepared.published,false);
  const initialPolicy=must(await a('POST','policy',{text:prepared.text,confirmed:true}),201);
  must(await e('POST','policy-ack',{policyId:initialPolicy.id,confirmed:true}));
  must(await call(bobCookie,'employe','POST','policy-ack',{policyId:initialPolicy.id,confirmed:true}));

  const answers={f0:true,f1:'Réponse de test confidentielle'};
  assert.equal((await m('POST','assignments/'+aliceGeneral.id+'/draft',{version:1,answers})).status,403);
  must(await e('POST','assignments/'+aliceGeneral.id+'/draft',{version:1,answers}));
  assert.equal((await e('POST','assignments/'+aliceGeneral.id+'/draft',{version:1,answers})).status,409);
  assert.equal((await e('POST','assignments/'+aliceGeneral.id+'/sign',{version:2,answers,name:alice.name,confirmed:false})).status,400);
  const signed=must(await e('POST','assignments/'+aliceGeneral.id+'/sign',{version:2,answers,name:alice.name,confirmed:true,created_at:'2001-01-01'}),201);originalId=signed.id;
  const d=must(await e('GET','assignments/'+aliceGeneral.id));assert.equal(d.assignment.status,'signed');assert.equal(d.assignment.draft.f1,answers.f1);assert.equal(d.originals.length,1);assert.equal(d.originals[0].actor.kind,'employee');assert.ok(new Date(d.originals[0].created_at).getFullYear()>=2026);
  const pdf=await fetch(f.base+'/api/employee-files/originals/'+originalId+'?view=employe',{headers:{cookie:aliceCookie}});assert.equal(pdf.status,200);const bytes=Buffer.from(await pdf.arrayBuffer());assert.ok(bytes.subarray(0,5).equals(Buffer.from('%PDF-')));assert.equal(createHash('sha256').update(bytes).digest('hex'),d.originals[0].sha256);
  assert.equal((await e('POST','assignments/'+aliceGeneral.id+'/draft',{version:3,answers})).status,409);
  assert.equal((await call(bobCookie,'employe','GET','originals/'+originalId)).status,404);
 });
 async function upload(cookie,view,id,version,bytes,extra={}){const url=f.base+'/api/employee-files/assignments/'+id+'/originals?'+new URLSearchParams({view,version,provenance:'Archive papier fictive',signed:'true',...extra});const r=await fetch(url,{method:'POST',headers:{cookie,...headers,'Content-Type':'application/octet-stream','X-Filename':'Fichier-test.pdf'},body:bytes});return {status:r.status,body:await r.json()};}
 await t.test('papier : provenance, date inconnue, déduplication et un original partagé avec SST',async()=>{
  const bytes=Buffer.concat([Buffer.from('%PDF-1.4\n%'),Buffer.alloc(5*1024*1024,65),Buffer.from('\n%%EOF')]);const r=must(await upload(admin,'direction',aliceSST.id,1,bytes),201),d=must(await a('GET','assignments/'+aliceSST.id));assert.equal(d.originals[0].document_date,null);assert.equal(d.originals[0].provenance,'Archive papier fictive');assert.equal(d.assignment.status,'review');assert.equal(d.originals[0].sst_document_id,null);
  for(const path of ['/api/sst/documents/'+r.id,'/api/employee-files/originals/'+r.id+'?view=direction&download=1']){
   const original=await fetch(f.base+path,{headers:{cookie:admin}});
   assert.equal(original.status,200);assert.equal(original.headers.get('content-type'),'application/pdf');
   assert.equal(original.headers.get('cache-control'),'private, no-store');assert.equal(original.headers.get('content-length'),null);
   assert.equal(original.headers.get('x-content-type-options'),'nosniff');
   assert.match(original.headers.get('content-disposition'),path.includes('download=1')?/^attachment;/:/^inline;/);
   assert.equal(createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex'),d.originals[0].sha256);
  }
  assert.equal((await call(bobCookie,'employe','GET','originals/'+r.id)).status,404);
  assert.equal((await upload(admin,'direction',aliceSST.id,2,bytes)).status,400);
  const duplicate=must(await upload(admin,'direction',aliceSST.id,2,bytes,{reason:'Même pièce vérifiée'}),201);assert.equal(duplicate.id,r.id);
  // Both module endpoints must retain the original category, authorization and digest.
  async function segmented(path,header,label) {
    const bytes=Buffer.alloc(12*1024*1024,65);bytes.write('%PDF-1.4\n'+label);
    const sha256=createHash('sha256').update(bytes).digest('hex'),url=new URL(f.base+path);
    url.pathname+='/uploads/'+crypto.randomUUID();
    const hit=(method,suffix,body,type,who=admin)=>{const u=new URL(url);u.pathname+=suffix;return fetch(u,{method,headers:{Cookie:who,Origin:f.base,[header]:'1',...(type?{'Content-Type':type}:{})},body});};
    const meta=JSON.stringify({name:'Temoin.pdf',size:bytes.length,sha256});
    assert.ok([401,403,404].includes((await hit('POST','',meta,'application/json',bobCookie)).status));
    assert.equal((await hit('POST','',meta,'application/json')).status,201);
    assert.equal((await hit('POST','/complete')).status,409);
    for(let offset=0;offset<bytes.length;offset+=2*1024*1024){
      const block=bytes.subarray(offset,offset+2*1024*1024);
      assert.equal((await hit('PUT','/parts/'+offset,block,'application/octet-stream')).status,200);
      if(!offset)assert.equal((await hit('PUT','/parts/0',block,'application/octet-stream')).status,200);
    }
    const finish=await hit('POST','/complete');assert.equal(finish.status,201);
    const result=await finish.json();assert.deepEqual(await (await hit('POST','/complete')).json(),result);
    return {...result,sha256};
  }
  const rhFile=await segmented('/api/employee-files/assignments/'+aliceRH.id+'/originals?view=direction&version=1&provenance=essai','X-Employee-Files','RH');
  const safety=await segmented('/api/sst/documents','X-SST-Request','SST');
  for(const [url,hash] of [['/api/employee-files/originals/'+rhFile.id+'?view=direction',rhFile.sha256],['/api/sst/documents/'+safety.id,safety.sha256]]){
    const opened=await fetch(f.base+url,{headers:{Cookie:admin}});
    assert.equal(opened.status,200);assert.equal(createHash('sha256').update(Buffer.from(await opened.arrayBuffer())).digest('hex'),hash);
  }
  assert.equal((await m('GET','originals/'+rhFile.id)).status,403);
  assert.equal((await f.call('GET','/api/sst/documents/'+rhFile.id,{cookie:admin})).status,404);
  const sstExport=must(await f.call('GET','/api/sst/export',{cookie:admin}));assert.ok(!sstExport.documents.some(d=>d.id===rhFile.id));
 });
 await t.test('correction : nouvelle attribution et original toujours conservé',async()=>{
  const d=must(await a('GET','assignments/'+aliceGeneral.id));const renewed=must(await a('POST','assignments/'+aliceGeneral.id+'/renew',{version:d.assignment.version,reason:'Mise à jour fictive',dueDate:'2027-01-15'}),201);
  const old=must(await e('GET','assignments/'+aliceGeneral.id));assert.equal(old.assignment.status,'superseded');assert.equal(old.originals[0].id,originalId);assert.equal(must(await e('GET','assignments/'+renewed.id)).assignment.status,'missing');
 });
 await t.test('rôles RH/SST explicites, limites de catégorie et révocation immédiate',async()=>{
  const grant={accountId,role:'rh',departments:[bakery.id],allDepartments:false,revoke:false};must(await a('POST','access',grant));
  assert.equal((await call(managerCookie,'direction','GET','assignments/'+aliceRH.id)).status,200);
  const bobAssignment=must(await a('GET','state')).assignments.find(r=>r.employee_key===bob.key);assert.equal((await call(managerCookie,'direction','GET','assignments/'+bobAssignment.id)).status,404);
  must(await a('POST','access',{...grant,revoke:true}));assert.equal((await call(managerCookie,'direction','GET','state')).status,403);
  must(await a('POST','access',{...grant,role:'sst'}));assert.equal((await call(managerCookie,'sst','GET','assignments/'+aliceSST.id)).status,200);assert.equal((await call(managerCookie,'sst','GET','assignments/'+aliceRH.id)).status,403);
  const s=must(await call(managerCookie,'sst','GET','state'));assert.ok(s.assignments.every(r=>r.category==='sst'));
  assert.equal((await m('POST','access',grant)).status,403);
 });
 await t.test('rapprochement CSV : matricule exact, homonymes non inférés et doublons signalés',async()=>{
  const report=must(await a('POST','reconcile',{rows:[{matricule:alice.code,nom:alice.name},{matricule:bob.code,nom:'Nom différent'},{matricule:'',nom:alice.name},{matricule:manager.code,nom:manager.name},{matricule:manager.code,nom:manager.name}]}));assert.equal(report.rows[0].employeeKey,alice.key);assert.equal(report.changed,0);assert.ok(report.rows.slice(1).every(r=>r.issue));assert.ok(!JSON.stringify(report).includes(alice.code));
 });
 await t.test('politique publique, acquittement personnel non implicite, nouvelles versions',async()=>{
  const p=must(await f.call('GET','/api/employee-files/policy'));assert.equal(p.responsible.name,'Marc-André Benoit');assert.equal(p.published,true);
  const published=must(await a('POST','policy',{text:p.text,confirmed:true}),201);
  assert.equal(must(await e('GET','state')).policyAcknowledged,false);
  assert.equal((await e('GET','assignments/'+aliceGeneral.id)).status,428);
  assert.equal((await e('POST','policy-ack',{policyId:published.id,confirmed:false})).status,400);
  must(await e('POST','policy-ack',{policyId:published.id,confirmed:true}));assert.equal(must(await e('GET','state')).policyAcknowledged,true);
  const detail=must(await e('GET','assignments/'+aliceGeneral.id));assert.equal(detail.assignment.due_date,'2026-12-01');
 });
 await t.test('registre confidentiel : révisions conservées, gérants exclus, aucun avis automatique',async()=>{
  const body={title:'Incident FICTIF',discovered:'2026-11-07',information:'Aucune donnée réelle',circumstances:'Test isolé',assessment:'Simulation',measures:'Aucune action réelle',risk:'À évaluer'};
  const first=must(await a('POST','privacy-incidents',body),201);must(await a('POST','privacy-incidents',{...body,risk:'Non',supersedes:first.id,reason:'Évaluation fictive complétée'}),201);
  const reg=must(await a('GET','privacy-incidents'));assert.equal(reg.incidents.length,1);assert.equal(reg.history.length,2);assert.equal((await m('GET','privacy-incidents')).status,403);
 });
 await t.test('redémarrage : brouillons, originaux et restrictions persistants',async()=>{
  await f.stop();await f.start();assert.equal(must(await e('GET','assignments/'+aliceGeneral.id)).originals[0].id,originalId);assert.equal((await m('GET','assignments/'+aliceRH.id)).status,403);
 });
 }finally{await f.close();}
});
