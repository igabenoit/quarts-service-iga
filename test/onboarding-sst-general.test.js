import test from 'node:test';
import assert from 'node:assert/strict';
import PDFLib from '../onboarding/tuac/pdf-lib.min.cjs';
import {blankGeneralSst,generalSstFields,sanitizeGeneralSstAnswers,signedGeneralSst} from '../onboarding/sst-general.js';
import {liveAppFixture} from './live-app-fixture.mjs';

const strokes=[[[.04,.3],[.35,.75],[.77,.3]]];
const valid={
 employe_nom:'Camille Exemple',
 departement_poste:'Caissière',
 signature_nom_employe:'Camille Exemple',
 signature_date_employe:'2026-11-10',
 confirmation:'yes',
 ...Object.fromEntries(Array.from({length:6},(_,i)=>['accueil_sujet_'+(i+1),'yes']))
};

test('nouveau programme SST : PDF vierge 3 pages, champs exacts et signature employé',async()=>{
 const original=await PDFLib.PDFDocument.load(await blankGeneralSst());
 assert.equal(original.getPageCount(),3);
 assert.equal(original.getForm().getFields().length,52);
 assert.equal(generalSstFields.length,53);
 const altered={...valid,formation_complete:'yes',tache_1:'Trancheur',tache_1_autorise:'yes',signature_nom_responsable:'Faux responsable'};
 const clean=sanitizeGeneralSstAnswers(altered,false);
 assert.equal(clean.formation_complete,'');
 assert.equal(clean.tache_1,'');
 assert.equal(clean.signature_nom_responsable,'');
 await assert.rejects(()=>signedGeneralSst(valid,[]),/Signature/);
 await assert.rejects(()=>signedGeneralSst({...valid,accueil_sujet_5:'no'},strokes),/sujets/);
 const pdf=await PDFLib.PDFDocument.load(await signedGeneralSst(altered,strokes));
 assert.equal(pdf.getPageCount(),3);
 assert.ok((await pdf.save()).byteLength>30000);
});
test('formation pratique : autorisation fondée sur une observation et signature du responsable',async()=>{
 const base={...valid,responsable_accueil:'Responsable Exemple',date_accueil:'2026-11-10',formation_complete:'yes',tache_1:'Caisse'};
 await assert.rejects(()=>signedGeneralSst(base,strokes,{onsite:true,supervisorStrokes:strokes}),/démonstration/);
 const completed={...base,tache_1_explique:'yes',tache_1_pratique:'yes',tache_1_autorise:'yes',signature_nom_responsable:'Responsable Exemple',signature_date_responsable:'2026-11-10'};
 await assert.rejects(()=>signedGeneralSst(completed,strokes,{onsite:true}),/responsable/);
 const final=await signedGeneralSst(completed,strokes,{onsite:true,supervisorStrokes:strokes});
 assert.equal((await PDFLib.PDFDocument.load(final)).getPageCount(),3);
});
test('parcours nouvelle embauche : le formulaire SST est proposé sans attribuer les anciennes annexes',{timeout:90000},async()=>{
 const f=await liveAppFixture({employeeVault:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  const headers={Origin:f.base,'X-Employee-Files':'1'};
  const admin=(method,path,body)=>f.call(method,'/api/employee-files/'+path,{cookie,headers,body});
  const policy=await admin('POST','policy?view=direction',{text:'Politique fictive de confidentialité. '.repeat(12),confirmed:true});
  assert.equal(policy.status,201);
  const blank=await admin('GET','onboarding/modele/sst-general?view=direction');
  assert.equal(blank.status,200);
  assert.equal(blank.headers.get('content-type'),'application/pdf');
  const dep=(await f.call('GET','/api/departments/meta',{cookie})).body.departments.find(d=>d.key==='boulangerie');
  const make=await f.call('POST','/api/departments/people',{cookie,body:{name:'Employé SST fictif',group:'regular',active:true,departments:[dep.id],availability:{},employeeCode:'887755'}});
  assert.equal(make.status,200);
  const key=(await admin('GET','state')).body.employees.find(e=>e.name==='Employé SST fictif').key;
  const route='onboarding?key='+key+'&view=direction';
  const before=await admin('GET',route);
  assert.equal(before.status,200);
  assert.equal(before.body.catalog.sst_general,'Programme d’accueil général SST – 2026');
  assert.ok(before.body.catalog.sst.includes('ancien modèle'));
  const invitation=await admin('POST','onboarding/invite?key='+key+'&view=direction',{
   documents:['sst_general'],email:'employee@example.invalid',managerEmail:'rh@example.invalid',days:3,due:'2030-01-01'
  });
  assert.equal(invitation.status,200,JSON.stringify(invitation.body));
  const token=invitation.body.path.split('#')[1];
  const call=(action,body={})=>f.call('POST','/api/accueil-employe/'+action,{headers:{...headers,Authorization:'Bearer '+token},body});
  const state=await call('state');
  assert.equal(state.status,200);
  assert.equal(state.body.documents.length,1);
  assert.equal(state.body.documents[0].kind,'sst_general');
  const forged={...valid,formation_complete:'yes',tache_1:'Trancheur',tache_1_autorise:'yes',signature_nom_responsable:'Signature falsifiée'};
  const sign=await call('sign',{kind:'sst_general',version:0,policy:state.body.policy.id,answers:forged,strokes});
  assert.equal(sign.status,200,JSON.stringify(sign.body));
  const doc=(await admin('GET',route)).body.documents.find(d=>d.kind==='sst_general');
  assert.equal(doc.done,true);
  const pdf=await admin('GET','originals/'+doc.original_id);
  assert.equal(pdf.status,200);
  assert.equal(pdf.headers.get('content-type'),'application/pdf');
 }finally{await f.close();}
});
