import {emptyTrainingForm} from '../public/training-form-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {liveAppFixture} from './live-app-fixture.mjs';
import {buildTrainingReport,registerRows,localDay} from '../public/equipment-training-model.js';

test('chronologie : une observation nouvelle ne change jamais le dossier enregistré avant l’accident',()=>{
 const employee='service:1',equipmentId=randomUUID(),base={equipment_id:equipmentId,actor:{name:'Compte de test',kind:'admin'}},sc={employeeKeys:[employee],enteredBy:'Personne fictive'};
 const assignment={...base,id:randomUUID(),kind:'assignment',created_at:'2026-10-01T14:00:00Z',data:{...sc,tasks:['Utilisation','Nettoyage'],active:true,replacement:false,date:'2026-10-01'}};
 const evidence={...base,id:randomUUID(),kind:'evidence',created_at:'2026-10-02T14:00:00Z',data:{...sc,tasks:['Utilisation'],documentId:randomUUID(),date:'2026-09-01',module:'Cours utilisation',provenance:'Campus fictif'}};
 const testimony={...base,id:randomUUID(),kind:'testimony',created_at:'2026-11-07T14:00:00Z',data:{...sc,tasks:['Utilisation'],dateKind:'unknown',date:'',statement:'Je me souviens de la formation à l’utilisation uniquement.'}};
 const observation={...base,id:randomUUID(),kind:'observation',created_at:'2026-11-07T15:00:00Z',data:{...sc,tasks:['Nettoyage'],date:'2026-11-07',supervisor:'Superviseur fictif',points:[{id:'1',result:'ok'}]}};
 const before=buildTrainingReport([assignment,evidence,testimony],[],{equipmentId,cutoff:'2026-11-06'});
 const after=buildTrainingReport([assignment,evidence,testimony,observation],[],{equipmentId,cutoff:'2026-11-06'});
 assert.deepEqual(after.beforeState,before.beforeState);
 assert.equal(after.beforeState.find(r=>r.task==='Nettoyage').result,'À vérifier');
 assert.equal(after.current.find(r=>r.task==='Nettoyage').result,'Points observés satisfaisants');
 assert.equal(after.current.find(r=>r.task==='Utilisation').result,'À vérifier');
 assert.equal(after.statementsSince[0].data.dateKind,'unknown');
 assert.equal(after.interventionsSince[0].data.date,'2026-11-07');
 const corrected={...observation,id:randomUUID(),supersedes:observation.id,created_at:'2026-11-08T15:00:00Z',correction_reason:'Point non observé en réalité',data:{...observation.data,points:[{id:'1',result:'unobserved'}]}};
 assert.equal(registerRows([assignment,observation,corrected],'2026-11-07').find(r=>r.task==='Nettoyage').result,'Points observés satisfaisants');
 assert.equal(registerRows([assignment,observation,corrected]).find(r=>r.task==='Nettoyage').result,'Observation partielle');
});

test('parcours HTTP réel isolé : employés partagés, pièces, témoignage, groupe, pratique, correction, rapport et droits',async t=>{
 const f=await liveAppFixture();try{
  const login=await f.call('POST','/api/login',{body:{code:'audit-admin-test'}}),cookie=login.cookie,headers={Origin:f.base,'X-SST-Request':'1'};
  const call=(method,path,body)=>f.call(method,'/api/sst/'+path,{cookie,headers,body});
  const meta=(await f.call('GET','/api/departments/meta',{cookie})).body,department=meta.departments.find(d=>d.key==='boulangerie');
  for(const name of ['Employé fictif formation','Remplaçant fictif formation']){const r=await f.call('POST','/api/departments/people',{cookie,body:{name,group:'regular',active:true,departments:[department.id],availability:{},employeeCode:name.startsWith('Employé')?'887761':'887762'}});assert.equal(r.status,200,JSON.stringify(r.body));}
  let s=(await call('GET','equipment-training')).body;const person=s.employees.find(x=>x.name==='Employé fictif formation'),replacement=s.employees.find(x=>x.name==='Remplaçant fictif formation');assert.ok(person);
  const eq=await call('POST','records',{kind:'equipment',title:'Trancheur FICTIF — test isolé',status:'open',departmentId:department.id,fields:{model:'Modèle fictif T1'}});assert.equal(eq.status,200,JSON.stringify(eq.body));const equipmentId=eq.body.id;
  const scope={employeeKeys:[person.key],tasks:['Utilisation'],enteredBy:'Gérant fictif'};
  async function entry(kind,data,extra={}){return call('POST','equipment-training/entries',{id:randomUUID(),equipmentId,kind,data:{...scope,...data},...extra});}
  const binary=Buffer.from('%PDF-1.4\nOriginal fictif, exclusivement pour le test.\n%%EOF');
  const upload=await fetch(f.base+'/api/sst/documents?recordId='+equipmentId,{method:'POST',headers:{cookie,...headers,'Content-Type':'application/octet-stream','X-Filename':'Formation-fictive.pdf'},body:binary});assert.equal(upload.status,201);const documentId=(await upload.json()).id;
  const download=await fetch(f.base+'/api/sst/documents/'+documentId,{headers:{cookie}});assert.deepEqual(Buffer.from(await download.arrayBuffer()),binary);
  await t.test('droits SST existants et protection contre les écritures hors origine',async()=>{
   for(const p of ['equipment-training','equipment-training/report?equipmentId='+equipmentId+'&cutoff=2026-11-01','export','documents/'+documentId])assert.equal((await f.call('GET','/api/sst/'+p)).status,401);
   assert.equal((await f.call('POST','/api/sst/equipment-training/entries',{cookie,body:{}})).status,403);
   const manager={name:'Gérant test',login:'training.manager',password:'Example-password-123',active:true,departments:[department.id],personId:Number(person.key.split(':')[1])};
   assert.equal((await f.call('POST','/api/manager-accounts',{cookie,headers:{Origin:f.base},body:manager})).status,200);
   const m=await f.call('POST','/api/manager-login',{body:{login:manager.login,password:manager.password}});assert.equal(m.status,200);
   for(const p of ['equipment-training','equipment-training/report?equipmentId='+equipmentId+'&cutoff=2026-11-01','documents/'+documentId,'export'])assert.equal((await f.call('GET','/api/sst/'+p,{cookie:m.cookie})).status,403);
  });
  const now=localDay(new Date()),cutoff=localDay(new Date(Date.now()-86400000));
  const draft=await entry('preparation',{trainer:'Formateur fictif',content:'Préparer la démonstration',reference:'Manuel à confirmer'});assert.equal(draft.status,201,JSON.stringify(draft.body));assert.equal(draft.body.entry.data.date,'');
  assert.equal((await entry('assignment',{tasks:['Utilisation','Nettoyage'],active:true,replacement:false,date:now})).status,201);
  assert.equal((await entry('assignment',{employeeKeys:[replacement.key],tasks:['Nettoyage'],active:true,replacement:true,date:now})).status,201);
  assert.equal((await entry('evidence',{documentId,date:'2026-01-10',provenance:'Campus Alimentor fictif',module:'Utilisation seulement',uncertainty:''})).status,201);
  const testimony=await entry('testimony',{declarant:'Employé fictif formation',capacity:'Travailleur',basis:'received',mode:'oral',dateKind:'unknown',statement:'Je me souviens de la formation à l’utilisation, pas du nettoyage.',uncertainty:'Je ne me souviens pas de la date.'});assert.equal(testimony.status,201,JSON.stringify(testimony.body));
  const confirmation=await entry('confirmation',{testimonyId:testimony.body.entry.id,declarant:'Employé fictif formation',method:'read_back',confirmed:true});assert.equal(confirmation.status,201,JSON.stringify(confirmation.body));
  s=(await call('GET','equipment-training')).body;let rows=registerRows(s.entries);assert.equal(rows.find(r=>r.employeeKey===person.key&&r.task==='Nettoyage').result,'À vérifier');assert.equal(rows.find(r=>r.employeeKey===replacement.key).documents.length,0);
  const p=await entry('procedure',{employeeKeys:[],tasks:['Utilisation','Nettoyage'],documentId,model:'Modèle fictif T1',title:'Procédure FICTIVE',version:'Test 1',approvedBy:'Approbateur fictif',date:now,approved:true,criteria:[{task:'Utilisation',text:'Critère utilisation fictif',reference:'Page test 1'},{task:'Nettoyage',text:'Critère nettoyage fictif',reference:'Page test 2'}]});assert.equal(p.status,201,JSON.stringify(p.body));const procedureId=p.body.entry.id;
  const badConfirmation=await entry('session',{date:now,trainer:'Test',procedureId,content:'Test',attendance:[{employeeKey:person.key,status:'unconfirmed'}],acknowledgements:[{employeeKey:person.key,confirmed:true,date:now,collectedBy:'Test'}]});assert.equal(badConfirmation.status,400);
  const session=await entry('session',{employeeKeys:[person.key,replacement.key],tasks:['Utilisation'],date:now,trainer:'Formateur fictif',procedureId,content:'Contenu utilisation uniquement',attendance:[{employeeKey:person.key,status:'confirmed',confirmedBy:'Formateur fictif'},{employeeKey:replacement.key,status:'unconfirmed'}],acknowledgements:[{employeeKey:person.key,confirmed:true,date:now,collectedBy:'Formateur fictif'}]});assert.equal(session.status,201,JSON.stringify(session.body));
  const pre=(await call('GET',`equipment-training/report?equipmentId=${equipmentId}&cutoff=${cutoff}`)).body;
  const obsData={tasks:['Nettoyage'],date:now,supervisor:'Superviseur fictif',procedureId,points:[{id:'2',result:'review',note:'Écart fictif'}],note:'Test isolé',immediate:'Mesure fictive immédiate',owner:'Responsable fictif',dueDate:now};
  assert.equal((await entry('observation',{...obsData,immediate:''})).status,400);
  assert.equal((await entry('observation',{...obsData,procedureId:randomUUID()})).status,400);
  assert.equal((await entry('observation',{...obsData,date:'2099-01-01'})).status,400);
  assert.equal((await entry('observation',{...obsData,points:[{id:'1',result:'ok'}]})).status,400);
  const obsRequest={id:randomUUID(),equipmentId,kind:'observation',data:{...scope,...obsData},created_at:'2020-01-01',actor:{name:'Forged'}};
  const obs=await call('POST','equipment-training/entries',obsRequest);assert.equal(obs.status,201,JSON.stringify(obs.body));assert.equal(localDay(obs.body.entry.created_at),now);assert.equal(obs.body.entry.actor.name,'Administration');
  assert.equal((await call('POST','equipment-training/entries',obsRequest)).body.replayed,true);
  const after=(await call('GET',`equipment-training/report?equipmentId=${equipmentId}&cutoff=${cutoff}`)).body;
  assert.deepEqual(after.beforeState,pre.beforeState);assert.equal(after.current.find(r=>r.employeeKey===person.key&&r.task==='Nettoyage').result,'Écarts à revoir');assert.equal(after.current.find(r=>r.employeeKey===person.key&&r.task==='Utilisation').result,'À vérifier');assert.equal(after.open.length,1);assert.equal(after.index[0].depositedBefore,false);assert.equal(after.index[0].datedBefore,true);
  assert.ok(after.statementsSince.some(x=>x.kind==='testimony'&&x.data.dateKind==='unknown'));assert.ok(after.interventionsSince.some(x=>x.id===obs.body.entry.id&&x.data.date===now));
  const corrected=await entry('observation',{...obsData,note:'Précision corrigée'}, {supersedes:obs.body.entry.id,correctionReason:'Préciser le contexte fictif'});assert.equal(corrected.status,201,JSON.stringify(corrected.body));
  assert.equal((await entry('observation',obsData,{supersedes:obs.body.entry.id,correctionReason:'Tentative concurrente'})).status,409);
  const follow=await entry('followup',{tasks:['Nettoyage'],observationId:corrected.body.entry.id,date:now,action:'Mesure fictive réalisée',verification:'Vérification fictive',owner:'Responsable fictif'});assert.equal(follow.status,201,JSON.stringify(follow.body));
  const final=(await call('GET',`equipment-training/report?employeeKey=${person.key}&cutoff=${cutoff}`)).body;assert.equal(final.open.length,0);assert.ok(final.entries.some(e=>e.id===obs.body.entry.id));assert.ok(final.entries.some(e=>e.supersedes===obs.body.entry.id));
  await t.test('formulaire signé : brouillon, signatures, correction et pratique séparée',async()=>{
   const form={...emptyTrainingForm(),date:now,trainer:'Formateur fictif',content:'Explications réellement données en test',reference:'Méthode fictive décrite',employeeDate:now,trainerDate:now,signatures:{employee:[[[100,100],[200,200]]],trainer:[[[300,300],[400,400]]]}};
   const signedDraft=await entry('training_form',{...form,status:'draft'});assert.equal(signedDraft.status,201);
   const finalized=await entry('training_form',{...signedDraft.body.entry.data,status:'completed'},{supersedes:signedDraft.body.entry.id,correctionReason:'Finalisation du brouillon'});assert.equal(finalized.status,201,JSON.stringify(finalized.body));
   const persisted=(await call('GET','equipment-training')).body.entries.find(e=>e.id===finalized.body.entry.id);assert.equal(persisted.data.status,'completed');assert.deepEqual(persisted.data.signatures,form.signatures);
   const dateDraft=await entry('training_form',{...form,status:'draft',date:cutoff,employeeDate:cutoff,trainerDate:cutoff});assert.equal(dateDraft.status,201);
   const dateFinal=await entry('training_form',{...dateDraft.body.entry.data,status:'completed',employeeDate:now,trainerDate:now},{supersedes:dateDraft.body.entry.id,correctionReason:'Finalisation du brouillon'});assert.equal(dateFinal.status,201,JSON.stringify(dateFinal.body));assert.deepEqual(dateFinal.body.entry.data.signatures,form.signatures);
   assert.equal((await entry('training_form',{...dateFinal.body.entry.data,employeeDate:cutoff},{supersedes:dateFinal.body.entry.id,correctionReason:'Changer une date déjà signée'})).status,400,'Une fiche finalisée conserve la protection du contenu signé');
   const signed=await entry('training_form',{...form,status:'completed'});assert.equal(signed.status,201,JSON.stringify(signed.body));
   assert.equal(registerRows((await call('GET','equipment-training')).body.entries).find(r=>r.employeeKey===person.key&&r.task==='Utilisation').result,'À vérifier','Les signatures seules ne valident pas la pratique');
   assert.equal((await entry('training_form',{...form,status:'completed',signatures:{employee:[],trainer:[]}})).status,400);
   assert.equal((await entry('training_form',{...form,signatures:{employee:[[[NaN,0]]],trainer:[]}})).status,400);
   assert.equal((await entry('training_form',{...form,status:'completed',content:'Texte modifié'},{supersedes:signed.body.entry.id,correctionReason:'Modification test'})).status,400,'Pas de report des signatures sur un contenu changé');
   const correction=await entry('training_form',{...form,status:'draft',content:'Texte modifié',signatures:{employee:[],trainer:[]}},{supersedes:signed.body.entry.id,correctionReason:'Modification test'});assert.equal(correction.status,201);
   const withPractice={...form,status:'completed',procedureId,points:[{id:'1',result:'ok',note:'Observation fictive'}],observationDate:now,supervisor:'Superviseur fictif'};
   const practical=await entry('training_form',withPractice);assert.equal(practical.status,201,JSON.stringify(practical.body));
   const current=(await call('GET',`equipment-training/report?employeeKey=${person.key}&cutoff=${cutoff}`)).body;
   assert.equal(current.current.find(r=>r.task==='Utilisation').result,'Points observés satisfaisants');assert.deepEqual(current.beforeState,final.beforeState);
   assert.equal((await entry('training_form',{...withPractice,procedureId:'',points:[{id:'1',result:'ok'}]})).status,400);
   assert.equal((await entry('training_form',{...withPractice,points:[{id:'1',result:'review'}]})).status,400,'Suivi obligatoire pour un écart');
  });
  const backup=await call('GET','export');assert.equal(backup.status,200,JSON.stringify(backup.body));assert.equal(backup.body.equipmentTrainingEntries.length,(await call('GET','equipment-training')).body.entries.length);assert.equal(backup.body.documents.find(d=>d.id===documentId).sha256,createHash('sha256').update(binary).digest('hex'));
  await f.stop();await f.start();assert.equal((await call('GET','equipment-training')).body.entries.length,backup.body.equipmentTrainingEntries.length);
  await t.test('supprimer une formation, ses versions et un fichier avec contrôle de concurrence',async()=>{
   const regs=()=>call('GET','equipment-training').then(r=>r.body.entries);
   const active=(await regs()).filter(e=>e.kind==='training_form');
   const finished=active.find(e=>e.supersedes&&e.data.status==='completed');
   const unfinished=active.find(e=>e.data.status==='draft'&&!active.some(x=>x.supersedes===e.id));
   const remove=id=>call('POST','equipment-training/entries/'+id+'/delete',{});
   assert.equal((await remove(finished.supersedes)).status,409);
   assert.equal((await f.call('POST','/api/sst/equipment-training/entries/'+finished.id+'/delete',{body:{}})).status,401);
   for(const id of [finished.id,unfinished.id,finished.id])assert.equal((await remove(id)).status,200);
   const visible=await regs();
   for(const id of [finished.id,finished.supersedes,unfinished.id])assert.ok(!visible.some(e=>e.id===id));
   const report=await call('GET',`equipment-training/report?equipmentId=${equipmentId}&cutoff=${now}`);
   assert.ok(!report.body.entries.some(e=>e.id===finished.id));
   assert.equal((await call('POST','documents/'+documentId+'/delete',{version:99})).status,409);
   assert.equal((await call('POST','documents/'+documentId+'/delete',{version:1})).status,200);
   assert.equal((await call('GET','documents/'+documentId)).status,404);
   assert.ok(!(await call('GET','state')).body.documents.some(d=>d.id===documentId));
   assert.ok(!(await call('GET','equipment-training')).body.documents.some(d=>d.id===documentId));
  });
 }finally{await f.close();}
});
