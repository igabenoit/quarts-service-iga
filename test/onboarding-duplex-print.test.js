import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import PDFLib from '../onboarding/tuac/pdf-lib.min.cjs';
import {generalSstPrintCopy} from '../onboarding/sst-general-print.js';
import {signedGeneralSst,generalSstTopics} from '../onboarding/sst-general.js';
import {letterDuplexCopy} from '../onboarding/letter-print.js';
import {liveAppFixture} from './live-app-fixture.mjs';
const fixture=()=>readFile(new URL('./fixtures/sst-three-page-fictitious.pdf',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const decode=stream=>Buffer.from(PDFLib.decodePDFRawStream(stream).decode()).toString();
const operators=(pdf,page)=>page.node.Contents().asArray().map(ref=>decode(pdf.context.lookup(ref))).join('');
const load=bytes=>PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
function assertDuplex(pdf){assert.equal(pdf.getPageCount(),2);for(const page of pdf.getPages())assert.deepEqual(page.getSize(),{width:612,height:792});assert.equal(pdf.catalog.getOrCreateViewerPreferences().getDuplex(),PDFLib.Duplex.DuplexFlipLongEdge);assert.equal(pdf.context.trailerInfo.Info,undefined);}
async function oldEmergency(){const pdf=await PDFLib.PDFDocument.create();pdf.addPage([612,792]).drawText('CONTACTS FICTIFS');pdf.addPage([612,792]).drawText('ANNEXE FICTIVE');pdf.catalog.getOrCreateViewerPreferences().setDuplex(PDFLib.Duplex.Simplex);return Buffer.from(await pdf.save());}

test('SST historique : deux pages lettre, mêmes réponses et tracés, archive inchangée',async()=>{
 const old=await fixture(),before=hash(old),converted=await generalSstPrintCopy(old),pdf=await load(converted);assertDuplex(pdf);
 const answers={employe_nom:'Camille Exemple',departement_poste:'Commis',signature_nom_employe:'Camille Exemple',signature_date_employe:'2026-11-23',confirmation:'yes',...Object.fromEntries(generalSstTopics.map(k=>[k,'yes'])),responsable_accueil:'Responsable fictif',date_accueil:'2026-11-23',signature_nom_responsable:'Responsable fictif',signature_date_responsable:'2026-11-23',tache_1:'Caisse',tache_1_explique:'yes',tache_1_pratique:'yes',tache_1_autorise:'yes',formation_complete:'yes',accueil_points_a_reprendre:'Exemple de précision.',poste_restrictions:'Suivi fictif.'};
 const expected=await load(await signedGeneralSst(answers,[[[.1,.7],[.3,.1],[.7,.8]]],{onsite:true,supervisorStrokes:[[[.1,.8],[.6,.1],[.9,.6]]]}));
 const normalized=value=>value.replace(/-?\d+\.\d+/g,n=>String(Number(Number(n).toFixed(7))));
 for(let i=0;i<2;i++){
  assert.equal(normalized(operators(pdf,pdf.getPage(i))),normalized(operators(expected,expected.getPage(i))));
  const objects=p=>p.getPage(i).node.Resources().lookup(PDFLib.PDFName.of('XObject')).entries().map(([,ref])=>decode(p.context.lookup(ref)));
  assert.deepEqual(objects(pdf),objects(expected),'all field appearances, including checked/unchecked boxes');
 }
 assert.equal(hash(old),before);assertDuplex(await load(await generalSstPrintCopy(converted)));
 const unknown=await PDFLib.PDFDocument.create();for(let i=0;i<3;i++)unknown.addPage([612,792]);await assert.rejects(()=>unknown.save().then(generalSstPrintCopy));
});

test('urgence historique : préférence recto verso ajoutée sans toucher au contenu des pages',async()=>{
 const old=await oldEmergency(),before=hash(old),source=await load(old),copy=await load(await letterDuplexCopy(old));assertDuplex(copy);
 for(let i=0;i<2;i++)assert.equal(operators(copy,copy.getPage(i)),operators(source,source.getPage(i)));
 assert.equal(hash(old),before);const invalid=await PDFLib.PDFDocument.create();invalid.addPage([595,842]);await assert.rejects(()=>invalid.save().then(letterDuplexCopy),/lettre/);
});

test('copies recto verso privées, originaux archivés inchangés',{timeout:90000},async()=>{
 const f=await liveAppFixture({employeeVault:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie,headers={Origin:f.base,'X-Employee-Files':'1'};
  const must=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body).slice(0,350));return r.body;};
  const admin=(method,path,body)=>f.call(method,'/api/employee-files/'+path,{cookie,headers,body});
  must(await admin('POST','policy?view=direction',{text:'Politique fictive de confidentialité. '.repeat(12),confirmed:true}),201);
  const dep=must(await f.call('GET','/api/departments/meta',{cookie})).departments.find(d=>d.key==='boulangerie');
  must(await f.call('POST','/api/departments/people',{cookie,body:{name:'Impression Fictive',employeeCode:'887790',group:'regular',active:true,departments:[dep.id],availability:{}}}));
  const key=must(await admin('GET','state')).employees.find(e=>e.name==='Impression Fictive').key;
  must(await admin('GET','onboarding?key='+key+'&view=direction'));
  for(const [kind,category,mode,bytes] of [['urgence','medical','letter-duplex',await oldEmergency()],['sst_general','rh','sst-duplex',await fixture()]]){
   const id=randomUUID();
   await f.query("INSERT INTO employee_file_originals(id,employee_key,category,name,mime,size,sha256,data,provenance,signature_kind,actor) VALUES($1,$2,$3,'Fixture.pdf','application/pdf',$4,$5,decode($6,'hex'),'Fixture historique','drawn','{}')",[id,key,category,bytes.length,hash(bytes),bytes.toString('hex')],{vault:true});
   await f.query('INSERT INTO onboarding_docs(employee_key,kind,original_id) VALUES($1,$2,$3)',[key,kind,id],{vault:true});
   const url=f.base+'/api/employee-files/originals/'+id+'?view=direction',response=await fetch(url+'&print='+mode,{headers:{cookie}});
   assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assertDuplex(await load(await response.arrayBuffer()));
   assert.deepEqual(Buffer.from(await (await fetch(url+'&download=1',{headers:{cookie}})).arrayBuffer()),bytes);
   assert.equal((await fetch(url+'&print='+mode)).status,401);
   assert.equal((await fetch(url+'&print=tuac-original',{headers:{cookie}})).status,400);
   assert.equal((await f.query('SELECT sha256 FROM employee_file_originals WHERE id=$1',[id],{vault:true})).rows[0].sha256,hash(bytes));
  }
 }finally{await f.close();}
});
