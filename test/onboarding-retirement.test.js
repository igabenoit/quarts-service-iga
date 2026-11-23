import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import PDFLib from '../onboarding/tuac/pdf-lib.min.cjs';
import {signedRetirement} from '../onboarding/retirement.js';
import {retirementAnswers,retirementEmployerReady,retirementEmployerKeys} from '../public/retirement-fields.js';
import {retirementEmployeeExample as employee,retirementEmployerExample as employer,retirementStrokes as strokes} from './retirement-fixture.mjs';
import {liveAppFixture} from './live-app-fixture.mjs';

test('retraite : direction propriétaire des quatre champs, original lettre recto verso sans métadonnées ajoutées',async()=>{
 const original=await PDFLib.PDFDocument.load(await readFile(new URL('../onboarding/retraite/form.pdf',import.meta.url)),{updateMetadata:false});
 const draft=retirementAnswers(employee,retirementAnswers(employer,{},true));
 assert.equal(retirementEmployerReady({...employer}),false,'un ancien brouillon rempli par l’employé doit être revu par la direction');
 assert.equal(retirementEmployerReady(draft),true);
 for(const key of retirementEmployerKeys)assert.equal(retirementAnswers({...employee,[key]:'FAUX',_employerPrepared:true},draft)[key],employer[key]);
 assert.equal(retirementAnswers({...employer,p_nas:'111111111'},draft,true).p_nas,employee.p_nas);
 await assert.rejects(()=>signedRetirement({...employee,...employer},strokes),/direction doit compléter/);
 const pdf=await PDFLib.PDFDocument.load(await signedRetirement(draft,strokes),{updateMetadata:false});
 assert.equal(pdf.getPageCount(),2);
 const preferences=pdf.catalog.getOrCreateViewerPreferences();
 assert.equal(preferences.getDuplex(),PDFLib.Duplex.DuplexFlipLongEdge);
 assert.equal(preferences.getPrintScaling(),PDFLib.PrintScaling.None);
 assert.equal(preferences.getPickTrayByPDFSize(),true);
 assert.equal(pdf.context.trailerInfo.Info,undefined);
 for(let i=0;i<2;i++){
  const page=pdf.getPage(i);assert.deepEqual(page.getSize(),{width:612,height:792});
  const originalObjects=original.getPage(i).node.Resources().lookup(PDFLib.PDFName.of('XObject'),PDFLib.PDFDict);
  const signedObjects=page.node.Resources().lookup(PDFLib.PDFName.of('XObject'),PDFLib.PDFDict);
  for(const [name,ref] of originalObjects.entries()){
   const source=original.context.lookup(ref),copy=pdf.context.lookup(signedObjects.get(name));
   assert.deepEqual(copy.getContents(),source.getContents(),'le scan original reste intact sur chaque page');
  }
 }
});

test('retraite : le participant ne peut ni modifier ni approuver les données de la direction',{timeout:90000},async()=>{
 const f=await liveAppFixture({employeeVault:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie,headers={Origin:f.base,'X-Employee-Files':'1'};
  const must=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body).slice(0,400));return r.body;};
  const admin=(method,path,body)=>f.call(method,'/api/employee-files/'+path,{cookie,headers,body});
  must(await admin('POST','policy?view=direction',{text:'Politique fictive de confidentialité. '.repeat(12),confirmed:true}),201);
  const dep=must(await f.call('GET','/api/departments/meta',{cookie})).departments.find(d=>d.key==='boulangerie');
  must(await f.call('POST','/api/departments/people',{cookie,body:{name:'Camille Retraite Fictive',employeeCode:'887795',group:'regular',active:true,departments:[dep.id],availability:{}}}));
  const key=must(await admin('GET','state')).employees.find(e=>e.name==='Camille Retraite Fictive').key;
  const route=op=>'onboarding'+(op?'/'+op:'')+'?key='+key+'&view=direction';
  must(await admin('GET',route()));
  const invite=must(await admin('POST',route('invite'),{documents:['retraite'],email:'employee@example.invalid',managerEmail:'rh@example.invalid',days:3,due:'2030-01-01'}));
  const call=(action,body={})=>f.call('POST','/api/accueil-employe/'+action,{headers:{...headers,Authorization:'Bearer '+invite.path.split('#')[1]},body});
  const onsite=(action,body)=>admin('POST','onboarding/sur-place/'+action+'?key='+key+'&view=direction',{kind:'retraite',...body});
  const policy=must(await call('state')).policy.id;
  const input={kind:'retraite',version:0,policy,answers:{...employee,...employer,_employerPrepared:true},strokes};
  must(await call('sign',input),400);
  let state=must(await call('save',input));assert.equal(state.documents[0].draft._employerPrepared,false);assert.equal(state.documents[0].draft.p_employeur,'');
  state=must(await onsite('save',{version:1,policy,answers:{...employer,p_nas:'111111111'}}));assert.equal(state.documents[0].draft.p_nas,employee.p_nas);assert.equal(state.documents[0].draft._employerPrepared,true);
  must(await call('save',{...input,version:1}),409);must(await onsite('sign',{...input,version:2}),400);
  const accounts=must(await f.call('POST','/api/manager-accounts',{cookie,headers,body:{name:'Gestion fictive',login:'retirement.test',password:'Password-test-only-123',departments:[dep.id],personId:Number(key.split(':')[1]),active:true}}));
  const accountId=Number(accounts.accounts.find(a=>a.login==='retirement.test').id);
  must(await admin('POST','access?view=direction',{accountId,role:'rh',departments:[dep.id],allDepartments:false,revoke:false}));
  const managerCookie=(await f.call('POST','/api/manager-login',{body:{login:'retirement.test',password:'Password-test-only-123'}})).cookie;
  must(await f.call('POST','/api/employee-files/onboarding/sur-place/save?key='+key+'&view=gerant',{cookie:managerCookie,headers,body:{...input,version:2}}),403);
  state=must(await call('save',{...input,version:2,answers:{...employee,p_employeur:'Faux employeur',p_section:'999'}}));
  assert.equal(state.documents[0].draft.p_employeur,employer.p_employeur);assert.equal(state.documents[0].draft.p_section,'500');
  state=must(await call('sign',{...input,version:3}));assert.equal(state.documents[0].done,true);
  const complete=must(await admin('GET',route()));assert.ok(complete.completed_at);
  const pdf=await admin('GET','originals/'+complete.documents[0].original_id+'?view=direction');assert.equal(pdf.headers.get('content-type'),'application/pdf');
  assert.ok(pdf.headers.get('content-disposition').includes(encodeURIComponent('Inscription au régime de retraite.pdf')));
  must(await onsite('save',{version:4,policy,answers:employer}),409);
 }finally{await f.close();}
});
