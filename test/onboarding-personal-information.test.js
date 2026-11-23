import test from 'node:test';
import assert from 'node:assert/strict';
import PDFLib from '../onboarding/tuac/pdf-lib.min.cjs';
import {signedPersonalInformation} from '../onboarding/personal-information.js';
import {personalAnswers,validatePersonalInformation} from '../public/personal-information-schema.js';
import {liveAppFixture} from './live-app-fixture.mjs';

const employee={lastName:'Exemple',firstName:'Camille',birthDate:'2000-02-29',sin:'000 000 000',street:'123, rue Exemple',apartment:'4',city:'Ville Exemple',province:'Québec',postalCode:'H0H 0H0',homePhone:'',mobilePhone:'514-555-0100',email:'camille@example.invalid',signatureDate:'2026-11-23'};
const employer={employerDepartment:'Boulangerie',employerPosition:'Commis',employerStartDate:'2030-12-01',employerSalary:'18,50 $ / heure',employerScale:'Échelon 1'};
const strokes=[[[0,.8],[.2,.1],[.4,.6],[1,.3]]];

test('informations personnelles : propriétés des champs, validation et PDF signé',async()=>{
 const merged=personalAnswers({...employee,...employer},personalAnswers(employer,{},true));
 assert.deepEqual(merged,{...employee,...employer});
 assert.equal(personalAnswers({employerSalary:'999 $',...employee},merged).employerSalary,employer.employerSalary);
 assert.equal(personalAnswers({...employer,sin:'111111111'},merged,true).sin,employee.sin);
 assert.throws(()=>personalAnswers({...employee,lastName:'a'.repeat(61)}),/Nom/);
 assert.throws(()=>personalAnswers({...employee,sin:123}),/assurance/);
 assert.throws(()=>validatePersonalInformation({...employee}),/employeur doit compléter/);
 for(const bad of [{sin:'1234'},{birthDate:'2001-02-29'},{email:'faux'},{postalCode:'12345'},{mobilePhone:'123'}])assert.throws(()=>validatePersonalInformation({...merged,...bad}));
 await assert.rejects(()=>signedPersonalInformation(merged,[]),/Signature/);
 await assert.rejects(()=>signedPersonalInformation(merged,[[[0,0],[2,1]]]),/Signature/);
 const bytes=await signedPersonalInformation(merged,strokes);
 const pdf=await PDFLib.PDFDocument.load(bytes);
 assert.equal(pdf.getPageCount(),1);assert.deepEqual(pdf.getPage(0).getSize(),{width:612,height:792});
 assert.equal(pdf.getForm().getFields().length,0);
});

test('nouvelle embauche : section employeur protégée, brouillons partagés et original RH immuable',{timeout:120000},async()=>{
 const f=await liveAppFixture({employeeVault:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  const headers={Origin:f.base,'X-Employee-Files':'1'};
  const must=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body).slice(0,500));return r.body;};
  const admin=(method,path,body)=>f.call(method,'/api/employee-files/'+path,{cookie,headers,body});
  must(await admin('POST','policy?view=direction',{text:'Politique fictive de confidentialité. '.repeat(12),confirmed:true}),201);
  const dep=must(await f.call('GET','/api/departments/meta',{cookie})).departments.find(d=>d.key==='boulangerie');
  const people=[];
  for(const [name,employeeCode] of [['Camille Exemple','887781'],['Autre Exemple','887782']]){
   must(await f.call('POST','/api/departments/people',{cookie,body:{name,employeeCode,group:'regular',active:true,departments:[dep.id],availability:{}}}));
   const key=must(await admin('GET','state')).employees.find(e=>e.name===name).key;
   const route=op=>'onboarding'+(op?'/'+op:'')+'?key='+key+'&view=direction';
   const initial=must(await admin('GET',route()));assert.equal(initial.defaultDocuments.length,6);assert.equal(initial.defaultDocuments[0],'renseignements');
   const invite=must(await admin('POST',route('invite'),{documents:['renseignements'],email:'employee@example.invalid',managerEmail:'rh@example.invalid',days:3,due:'2030-12-01'}));
   people.push({key,route,token:invite.path.split('#')[1],employeeCode});
  }
  const [alice,bob]=people;
  const execute=(person,action,body={})=>f.call('POST','/api/accueil-employe/'+action,{headers:{...headers,Authorization:'Bearer '+person.token},body});
  const onsite=(action,body)=>admin('POST','onboarding/sur-place/'+action+'?key='+alice.key+'&view=direction',{kind:'renseignements',...body});
  let state=must(await execute(alice,'state'));
  const policy=state.policy.id,body={kind:'renseignements',version:0,policy,answers:{...employee,...employer}};
  const premature=must(await execute(alice,'sign',{...body,strokes}),400);assert.match(premature.error,/employeur doit compléter/);
  state=must(await execute(alice,'save',body));assert.equal(state.documents[0].draft.employerSalary,'');assert.equal(state.documents[0].draft.sin,employee.sin);
  must(await onsite('sign',{...body,version:1,strokes}),400);
  state=must(await onsite('save',{version:1,policy,answers:{...employer,sin:'111111111'}}));
  assert.equal(state.documents[0].draft.sin,employee.sin);assert.equal(state.documents[0].draft.employerSalary,employer.employerSalary);
  must(await execute(alice,'save',{...body,version:1}),409);
  assert.deepEqual(must(await execute(bob,'state',{employeeKey:alice.key})).documents[0].draft,{});
  state=must(await execute(alice,'save',{...body,version:2,answers:{...employee,firstName:'Camille corrigée',employerSalary:'999 $'}}));
  assert.equal(state.documents[0].draft.employerSalary,employer.employerSalary);
  state=must(await onsite('save',{version:3,policy,answers:{...employer,employerPosition:'Commis de boulangerie'}}));assert.equal(state.documents[0].draft.firstName,'Camille corrigée');
  const employeeCookie=(await f.call('POST','/api/employee-portal/access',{body:{code:alice.employeeCode}})).cookie;
  must(await f.call('POST','/api/employee-files/onboarding/sur-place/save?key='+alice.key+'&view=direction',{cookie:employeeCookie,headers,body:{...body,version:4}}),403);
  state=must(await execute(alice,'sign',{...body,version:4,strokes}));assert.equal(state.documents[0].done,true);assert.deepEqual(state.documents[0].draft,{});
  const complete=must(await admin('GET',alice.route()));assert.ok(complete.completed_at);
  const original=complete.documents[0].original_id;
  const stored=await f.query('SELECT category FROM employee_file_originals WHERE id=$1',[original],{vault:true});assert.equal(stored.rows[0].category,'rh');
  const pdf=await admin('GET','originals/'+original+'?view=direction');assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.ok(pdf.body.startsWith('%PDF-'));
  must(await execute(alice,'save',{...body,version:5}),409);must(await onsite('save',{version:5,policy,answers:employer}),409);
  const bobCookie=(await f.call('POST','/api/employee-portal/access',{body:{code:bob.employeeCode}})).cookie;
  must(await f.call('POST','/api/employee-files/policy-ack?view=employe',{cookie:bobCookie,headers,body:{policyId:policy,confirmed:true}}));
  must(await f.call('GET','/api/employee-files/originals/'+original+'?view=employe',{cookie:bobCookie}),404);
  const events=await f.query('SELECT data FROM employee_file_events',[],{vault:true});assert.ok(!JSON.stringify(events).includes(employee.sin));
 }finally{await f.close();}
});
