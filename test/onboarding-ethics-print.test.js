import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import PDFLib from '../onboarding/tuac/pdf-lib.min.cjs';
import {ethicsSignatureExcerpt} from '../onboarding/ethics-print.js';
import {liveAppFixture} from './live-app-fixture.mjs';

async function syntheticBook(count=52){
 const pdf=await PDFLib.PDFDocument.create();
 for(let n=1;n<=count;n++)pdf.addPage([612,792]).drawText('Page fictive '+n);
 return Buffer.from(await pdf.save());
}
const streams=(pdf,page)=>{
 const contents=page.node.Contents();
 return (contents instanceof PDFLib.PDFArray?contents.asArray():[contents]).map(ref=>Buffer.from(PDFLib.decodePDFRawStream(pdf.context.lookup(ref)).decode()).toString()).join('\n');
};
test('éthique : extrait exact des pages 40, 51 et 52, original conservé',async()=>{
 const bytes=await syntheticBook(),before=createHash('sha256').update(bytes).digest('hex');
 const original=await PDFLib.PDFDocument.load(bytes),excerpt=await PDFLib.PDFDocument.load(await ethicsSignatureExcerpt(bytes),{updateMetadata:false});
 assert.equal(excerpt.getPageCount(),3);
 for(const [i,n] of [40,51,52].entries())assert.equal(streams(excerpt,excerpt.getPage(i)),streams(original,original.getPage(n-1)));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),before);
 assert.equal(excerpt.context.trailerInfo.Info,undefined);
 await assert.rejects(()=>syntheticBook(47).then(ethicsSignatureExcerpt),e=>e.status===409);
});
test('éthique : extrait privé des signatures existantes sans remplacer le cahier signé',{timeout:90000},async()=>{
 const f=await liveAppFixture({employeeVault:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie,headers={Origin:f.base,'X-Employee-Files':'1'};
  const must=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body).slice(0,300));return r.body;};
  const admin=(method,path,body)=>f.call(method,'/api/employee-files/'+path,{cookie,headers,body});
  must(await admin('POST','policy?view=direction',{text:'Politique fictive de confidentialité. '.repeat(12),confirmed:true}),201);
  await f.query('INSERT INTO onboarding_ethics_source(sha256,document) VALUES($1,decode($2,\'hex\'))',['2ae98cd7cd73c4da36a4de104f5365de098b481e55968e039abb95d2c7e9ab3a',(await syntheticBook()).toString('hex')]);
  const dep=must(await f.call('GET','/api/departments/meta',{cookie})).departments.find(d=>d.key==='boulangerie');
  must(await f.call('POST','/api/departments/people',{cookie,body:{name:'Éthique Fictive',employeeCode:'887791',group:'regular',active:true,departments:[dep.id],availability:{}}}));
  const key=must(await admin('GET','state')).employees.find(e=>e.name==='Éthique Fictive').key;
  const route='onboarding/sur-place/';
  const params='?key='+key+'&view=direction';
  const state=must(await admin('POST',route+'state'+params,{kind:'ethique'}));
  const signed=must(await admin('POST',route+'sign'+params,{kind:'ethique',version:0,policy:state.policy.id,answers:{Prénom:'Camille',Nom:'Exemple fictif',Poste:'Essai',Signature:'2026-11-23',Respect:'yes',Vente:'yes',Réception:'yes'},strokes:[[[.1,.3],[.4,.8],[.7,.2]]]}));
  const id=signed.documents[0].originalId,url=f.base+'/api/employee-files/originals/'+id+'?view=direction';
  const original=await fetch(url,{headers:{cookie}}),originalBytes=Buffer.from(await original.arrayBuffer());
  assert.equal(original.headers.get('x-onboarding-kind'),'ethique');
  const extracted=await fetch(url+'&pages=signatures',{headers:{cookie}});
  assert.equal(extracted.status,200);
  assert.match(extracted.headers.get('cache-control'),/private, no-store/);
  assert.ok(extracted.headers.get('content-disposition').includes('Pages%20de%20signature'));
  const excerpt=await PDFLib.PDFDocument.load(await extracted.arrayBuffer());
  const full=await PDFLib.PDFDocument.load(originalBytes);assert.equal(full.getPageCount(),52);assert.equal(excerpt.getPageCount(),3);
  for(const [i,n] of [40,51,52].entries())assert.equal(streams(excerpt,excerpt.getPage(i)),streams(full,full.getPage(n-1)),'les tracés signés restent dans les pages extraites');
  assert.equal((await fetch(url+'&pages=signatures')).status,401);
  assert.equal((await fetch(url+'&pages=1',{headers:{cookie}})).status,400);
  const again=await fetch(url,{headers:{cookie}});assert.deepEqual(Buffer.from(await again.arrayBuffer()),originalBytes);
 }finally{await f.close();}
});
