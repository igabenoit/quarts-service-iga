import test from 'node:test';
import assert from 'node:assert/strict';
import PDFLib from '../onboarding/tuac/pdf-lib.min.cjs';
import {signedEmergency,emergencyFields} from '../onboarding/emergency.js';
import {liveAppFixture} from './live-app-fixture.mjs';

const answers={
 employeeName:'Camille Exemple',departmentRole:'Service',
 contact1Name:'Parent Exemple',contact1Relationship:'Parent',contact1Phone:'450-555-0123',contact1OtherPhone:'',
 contact2Name:'Ami Exemple',contact2Relationship:'Ami',contact2Phone:'514-555-0123',contact2OtherPhone:'',
 foodAllergy:'no',foodDetails:'',medicineAllergy:'undisclosed',medicineDetails:'',
 urgentCondition:'yes',conditionDetails:'Asthme',symptoms:'Respiration difficile',
 carePlan:'Inhalateur dans le sac de travail',accessConsent:'yes'
};
test('fiche urgence : deux contacts, option de non-divulgation et PDF signé',async()=>{
 assert.equal(new Set(emergencyFields).size,emergencyFields.length);
 assert.ok(emergencyFields.indexOf('contact1Name')<emergencyFields.indexOf('contact2Name'));
 const buffer=await signedEmergency(answers,[[[0,0],[.4,.8],[1,.3]]]);
 assert.ok(Buffer.isBuffer(buffer));assert.ok(buffer.subarray(0,5).equals(Buffer.from('%PDF-')));
 const pdf=await PDFLib.PDFDocument.load(buffer);assert.equal(pdf.getPageCount(),1);
 await assert.rejects(()=>signedEmergency({...answers,contact2Name:''},[[[0,0],[1,1]]]),/Champ obligatoire/);
 await assert.rejects(()=>signedEmergency({...answers,accessConsent:'no'},[[[0,0],[1,1]]]),/autorisation/i);
 await assert.rejects(()=>signedEmergency({...answers,foodAllergy:'whatever'},[[[0,0],[1,1]]]),/réponse/);
 await assert.rejects(()=>signedEmergency(answers,[]),/Signature/);
});

test('embauche : formulaire d’urgence en troisième position, signé et accessible uniquement avec connexion', {timeout:90000},async()=>{
 const f=await liveAppFixture({employeeVault:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  const headers={Origin:f.base,'X-Employee-Files':'1'};
  const admin=(method,path,body)=>f.call(method,'/api/employee-files/'+path,{cookie,headers,body});
  const expect=(r,code=200)=>{assert.equal(r.status,code,JSON.stringify(r.body).slice(0,400));return r.body;};
  expect(await admin('POST','policy?view=direction',{text:'Politique fictive de confidentialité. '.repeat(12),confirmed:true}),201);
  const dep=expect(await f.call('GET','/api/departments/meta',{cookie})).departments.find(d=>d.key==='boulangerie');
  expect(await f.call('POST','/api/departments/people',{cookie,body:{name:'Camille Exemple',group:'regular',active:true,departments:[dep.id],availability:{},employeeCode:'887763'}}));
  const key=expect(await admin('GET','state')).employees.find(e=>e.name==='Camille Exemple').key;
  const route='onboarding?key='+encodeURIComponent(key)+'&view=direction';
  const start=expect(await admin('GET',route));
  assert.deepEqual(Object.keys(start.catalog),['tuac','retraite','urgence']);
  const link=expect(await admin('POST','onboarding/invite?key='+encodeURIComponent(key)+'&view=direction',
   {documents:['tuac','retraite','urgence'],email:'employee@example.invalid',managerEmail:'rh@example.invalid',days:3,due:'2030-11-15'})).path;
  const employee=(action,body={})=>f.call('POST','/api/accueil-employe/'+action,{headers:{...headers,Authorization:'Bearer '+link.split('#')[1]},body});
  const initial=expect(await employee('state'));
  assert.deepEqual(initial.documents.map(x=>x.kind),['tuac','retraite','urgence']);
  assert.equal(initial.documents[2].done,false);
  expect(await employee('sign',{kind:'urgence',version:0,policy:initial.policy.id,answers,strokes:[[[0,0],[.5,.7],[1,.1]]]}));
  const status=expect(await admin('GET',route));
  assert.equal(status.documents[2].done,true);
  assert.ok(status.documents[2].original_id);
  const pdf=expect(await admin('GET','originals/'+status.documents[2].original_id));assert.ok(pdf.startsWith('%PDF-'));
  assert.equal((await f.call('GET','/api/employee-files/originals/'+status.documents[2].original_id)).status,401);
 }finally{await f.close();}
});
