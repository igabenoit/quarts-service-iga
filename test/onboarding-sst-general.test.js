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
 assert.equal(pdf.catalog.has(PDFLib.PDFName.of('AcroForm')),false,'le PDF signé est statique sans ancien formulaire résiduel');
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
test('signatures SST : les tracés restent au-dessus des deux lignes, même dessinés au bas du pavé',async()=>{
 const lowStrokes=[[[.12,.85],[.45,.99],[.82,.84]]];
 const bytes=await signedGeneralSst({...valid,signature_nom_responsable:'Responsable fictif',signature_date_responsable:'2026-11-23'},lowStrokes,{onsite:true,supervisorStrokes:lowStrokes});
 const pdf=await PDFLib.PDFDocument.load(bytes),contents=pdf.getPage(2).node.Contents();
 const commands=contents.asArray().map(ref=>Buffer.from(PDFLib.decodePDFRawStream(pdf.context.lookup(ref)).decode()).toString()).join('\n');
 const paths=[...commands.matchAll(/0\.03 0\.16 0\.4 RG([\s\S]*?)Q/g)];
 assert.equal(paths.length,4);
 const points=paths.flatMap(match=>[...match[1].matchAll(/([\d.]+) ([\d.]+) [ml]/g)].map(p=>[Number(p[1]),Number(p[2])]));
 assert.ok(points.length>=8);
 assert.equal(Math.min(...points.map(p=>p[1])),172);
 for(const [x,y] of points){assert.ok(y>=172&&y<=192,'au-dessus de la ligne originale à y=171');assert.ok((x>=98&&x<=288)||(x>=391&&x<=560),'dans la bonne zone de signature');}
});
test('parcours nouvelle embauche : le formulaire SST est proposé sans attribuer les anciennes annexes',{timeout:90000},async()=>{
 const f=await liveAppFixture({employeeVault:true,onboardingEmail:true});
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
   documents:['sst_general','tuac'],email:'employee@example.invalid',managerEmail:'rh@example.invalid',days:3,due:'2030-01-01'
  });
  assert.equal(invitation.status,200,JSON.stringify(invitation.body));
  const token=invitation.body.path.split('#')[1];
  const call=(action,body={})=>f.call('POST','/api/accueil-employe/'+action,{headers:{...headers,Authorization:'Bearer '+token},body});
  const state=await call('state');
  assert.equal(state.status,200);
  assert.deepEqual(state.body.documents.map(d=>d.kind),['tuac','sst_general']);
  const reminder=await f.onboardingMail(true);assert.equal(reminder.length,1);
  assert.equal(reminder[0].payload.from,'IGA Benoit <rh@example.invalid>');
  assert.match(reminder[0].payload.text,/À remplir avec votre gérant, dans votre département/);
  assert.match(reminder[0].payload.text,/Cette étape est obligatoire/);
  const forged={...valid,formation_complete:'yes',tache_1:'Trancheur',tache_1_autorise:'yes',signature_nom_responsable:'Signature falsifiée'};
  const sign=await call('sign',{kind:'sst_general',version:0,policy:state.body.policy.id,answers:forged,strokes});
  assert.equal(sign.status,200,JSON.stringify(sign.body));
  const doc=(await admin('GET',route)).body.documents.find(d=>d.kind==='sst_general');
  assert.equal(doc.done,false);assert.equal(doc.awaitingDirection,true);
  const pdf=await admin('GET','originals/'+doc.employeeOriginalId);
  assert.equal(pdf.status,200);
  assert.equal(pdf.headers.get('content-type'),'application/pdf');
  await f.query('UPDATE onboarding_cases SET reminded=false WHERE employee_key=$1',[key],{vault:true});
  const notice=await f.onboardingMail();assert.equal(notice.length,1);assert.match(notice[0].payload.subject,/Document à finaliser/);
  const remaining=await f.onboardingMail(true);assert.equal(remaining.length,1);
  assert.equal(remaining[0].payload.to[0],'employee@example.invalid');
  assert.equal(remaining[0].payload.text.includes('Programme d’accueil SST'),false,'ne plus réclamer le SST signé lorsque seul le TUAC reste à remplir');
 }finally{await f.close();}
});
