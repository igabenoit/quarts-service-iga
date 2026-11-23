import test from 'node:test';
import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';
import {retirementEmployeeExample,retirementEmployerExample} from './retirement-fixture.mjs';
import {generalSstTopics} from '../onboarding/sst-general.js';
const strokes=[[[.1,.8],[.3,.1],[.5,.7],[.9,.4]]];
const employee={lastName:'Exemple',firstName:'Camille',birthDate:'2000-02-29',sin:'000000000',street:'123 rue Exemple',apartment:'',city:'Ville Exemple',province:'Québec',postalCode:'H0H 0H0',homePhone:'',mobilePhone:'5145550100',email:'test@example.invalid',signatureDate:'2026-11-23'};
const employer={employerDepartment:'Boulangerie',employerPosition:'Commis',employerStartDate:'2030-12-01',employerSalary:'18,50',employerScale:'1'};
const sst={employe_nom:'Camille Exemple',departement_poste:'Boulangerie',signature_nom_employe:'Camille Exemple',signature_date_employe:'2026-11-23',confirmation:'yes',...Object.fromEntries(generalSstTopics.map(k=>[k,'yes']))};

test('signature employé avant direction : original conservé, champs verrouillés, avis privé et finalisation',{timeout:120000},async()=>{
 const f=await liveAppFixture({employeeVault:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie,headers={Origin:f.base,'X-Employee-Files':'1'};
  const must=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body).slice(0,450));return r.body;};
  const admin=(method,path,body)=>f.call(method,'/api/employee-files/'+path,{cookie,headers,body});
  must(await admin('POST','policy?view=direction',{text:'Politique fictive de confidentialité. '.repeat(12),confirmed:true}),201);
  const dep=must(await f.call('GET','/api/departments/meta',{cookie})).departments.find(d=>d.key==='boulangerie');
  must(await f.call('POST','/api/departments/people',{cookie,body:{name:'Camille Finalisation Fictive',employeeCode:'887798',group:'regular',active:true,departments:[dep.id],availability:{}}}));
  const key=must(await admin('GET','state')).employees.find(e=>e.name==='Camille Finalisation Fictive').key;
  const route=op=>'onboarding'+(op?'/'+op:'')+'?key='+key+'&view=direction';
  must(await admin('GET',route()));
  const kinds=['renseignements','tuac','retraite','sst_general'];
  const link=must(await admin('POST',route('invite'),{documents:kinds,email:'employee@example.invalid',managerEmail:'other-manager@example.invalid',days:3,due:'2030-01-01'})).path;
  const call=(action,body={})=>f.call('POST','/api/accueil-employe/'+action,{headers:{...headers,Authorization:'Bearer '+link.split('#')[1]},body});
  const policy=must(await call('state')).policy.id;
  const examples={
   renseignements:[employee,employer,'sin'],
   retraite:[retirementEmployeeExample,retirementEmployerExample,'p_nas'],
   tuac:[{Nom:'Exemple',Prénom:'Camille',Naissance:'2000-02-29',Rue:'123 rue Exemple',Appartement:'',Ville:'Ville Exemple',Province:'QC','Code postal':'H0H 0H0',Indicatif:'',Téléphone:'4505550123',Courriel:'test@example.invalid',Signature:'2026-11-23'},{Emploi:'2030-12-01'},'Nom'],
   sst_general:[sst,{responsable_accueil:'Responsable fictif',date_accueil:'2026-11-23',signature_nom_responsable:'Responsable fictif',signature_date_responsable:'2026-11-23',accueil_complete:'yes'},'employe_nom']
  };
  const initialCopies=new Map();
  for(const kind of kinds){
   const [own,direction]=examples[kind],body={kind,policy,version:0,answers:{...own,...direction,_employerPrepared:true,_workflow:{employeeOriginalId:'forged',strokes}},strokes};
   const signed=must(await call('sign',body)).documents.find(d=>d.kind===kind);
   assert.equal(signed.done,false);assert.equal(signed.employeeSigned,true);assert.equal(signed.awaitingDirection,true);assert.ok(signed.employeeOriginalId);
   assert.equal(signed.draft._workflow,undefined);assert.equal(JSON.stringify(signed).includes('strokes'),false);
   for(const k of Object.keys(direction))assert.notEqual(signed.draft[k],direction[k],'employer fields cannot be supplied by employee');
   const original=await admin('GET','originals/'+signed.employeeOriginalId+'?view=direction');must(original);assert.equal(original.headers.get('content-type'),'application/pdf');
   initialCopies.set(kind,{id:signed.employeeOriginalId,data:original.body});
   must(await call('save',{...body,version:1}),409);must(await call('sign',{...body,version:1}),409);must(await call('finalize',{...body,version:1}),409);
  }
  await assert.rejects(()=>f.query(null,null,{onboardingMail:true,directionEmail:'igabenoit@gmail.com',failMail:true}),/Simulated/);
  const notYet=await f.query("SELECT count(*)::int AS n FROM onboarding_docs WHERE draft#>>'{_workflow,notifiedAt}' IS NOT NULL",[],{vault:true});assert.equal(notYet.rows[0].n,0);
  const notices=await f.query(null,null,{onboardingMail:true,directionEmail:'igabenoit@gmail.com'});
  assert.equal(notices.length,4);assert.equal(new Set(notices.map(n=>n.id)).size,4);
  for(const {payload} of notices){assert.deepEqual(payload.to,['igabenoit@gmail.com']);assert.match(payload.subject,/Document à finaliser/);assert.match(payload.text,/Camille Finalisation Fictive/);assert.equal(payload.attachments,undefined);assert.ok(!payload.text.includes(link.split('#')[1]));}
  assert.deepEqual(await f.onboardingMail(true),[],'only direction remains; no employee reminders');
  for(const kind of kinds){
   const [own,direction,protectedKey]=examples[kind],onsite=(action,body)=>admin('POST',route('sur-place/'+action),{kind,policy,...body});
   const saved=must(await onsite('save',{version:1,answers:{...direction,[protectedKey]:'FORGED'},strokes:[[[0,0],[1,1]]]})).documents[0];
   assert.equal(saved.draft[protectedKey],own[protectedKey]);assert.equal(saved.awaitingDirection,true);assert.equal(saved.employeeOriginalId,initialCopies.get(kind).id);
   if(kind==='sst_general')must(await onsite('finalize',{version:2,answers:direction,supervisorStrokes:[]}),400);
   const final=must(await onsite('finalize',{version:2,answers:{...direction,[protectedKey]:'FORGED'},strokes:[[[0,0],[1,1]]],supervisorStrokes:strokes})).documents[0];
   assert.equal(final.done,true);assert.equal(final.awaitingDirection,false);assert.notEqual(final.originalId,initialCopies.get(kind).id);assert.deepEqual(final.draft,{});
   assert.equal(must(await admin('GET','originals/'+initialCopies.get(kind).id+'?view=direction')),initialCopies.get(kind).data,'the signed employee original must not change');
   const privateDoc=(await f.query('SELECT draft FROM onboarding_docs WHERE employee_key=$1 AND kind=$2',[key,kind],{vault:true})).rows[0];assert.equal(privateDoc.draft._workflow.strokes,null);assert.ok(privateDoc.draft._workflow.finalizedAt);
   must(await onsite('finalize',{version:3,answers:direction,supervisorStrokes:strokes}),409);
  }
  assert.ok(must(await admin('GET',route())).completed_at);
  assert.ok(must(await call('state')).documents.every(d=>d.done&&d.employeeSigned));
  const audit=await f.query('SELECT data FROM employee_file_events',[],{vault:true});assert.equal(JSON.stringify(audit).includes(employee.sin),false);
 }finally{await f.close();}
});
