import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {tuacPrintCopy} from '../onboarding/tuac-print.js';
import {signedTuac} from '../onboarding/tuac.js';
import PDFLib from '../onboarding/tuac/pdf-lib.min.cjs';
import {liveAppFixture} from './live-app-fixture.mjs';
const fixture=()=>readFile(new URL('./fixtures/tuac-two-copy-fictitious.pdf',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const operators=pdf=>Array.from({length:pdf.getPage(0).node.Contents().size()},(_,i)=>Buffer.from(PDFLib.decodePDFRawStream(pdf.getPage(0).node.Contents().lookup(i)).decode()).toString()).join('');

test('ancien TUAC : reproduction exacte des valeurs et du tracé sur trois fiches, original intact',async()=>{
 const old=await fixture(),before=hash(old),copy=await tuacPrintCopy(old);
 const expected=await signedTuac({Nom:'EXEMPLE FICTIF',Prénom:'CAMILLE',Naissance:'1990-01-01',Rue:'123 RUE EXEMPLE',Appartement:'',Ville:'VILLE EXEMPLE',Province:'QC','Code postal':'H0H 0H0',Indicatif:'450',Téléphone:'5550123',Courriel:'exemple@example.invalid',Emploi:'2026-11-23',Signature:'2026-11-23',_employerPrepared:true},[[[.1,.7],[.3,.2],[.4,.6],[.65,.3],[.8,.65]]]);
 const normalized=pdf=>operators(pdf).replace(/-?\d+\.\d+/g,n=>String(Number(Number(n).toFixed(8))));
 assert.equal(normalized(await PDFLib.PDFDocument.load(copy)),normalized(await PDFLib.PDFDocument.load(expected)));
 assert.equal(hash(old),before);
 assert.deepEqual(await tuacPrintCopy(expected),expected,'nouveau modèle déjà calibré : aucun changement');
 await assert.rejects(()=>tuacPrintCopy(Buffer.from('not a pdf')));
 const unknown=await PDFLib.PDFDocument.create();unknown.addPage([612,792]);await assert.rejects(()=>unknown.save().then(tuacPrintCopy),/modèle/);
});

test('ancien TUAC : copie privée à imprimer, téléchargement de l’original inchangé',{timeout:90000},async()=>{
 const f=await liveAppFixture({employeeVault:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie,headers={Origin:f.base,'X-Employee-Files':'1'};
  const must=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body).slice(0,350));return r.body;};
  const admin=(method,path,body)=>f.call(method,'/api/employee-files/'+path,{cookie,headers,body});
  must(await admin('POST','policy?view=direction',{text:'Politique fictive de confidentialité. '.repeat(12),confirmed:true}),201);
  const dep=must(await f.call('GET','/api/departments/meta',{cookie})).departments.find(d=>d.key==='boulangerie');
  must(await f.call('POST','/api/departments/people',{cookie,body:{name:'TUAC Archive Fictive',employeeCode:'887799',group:'regular',active:true,departments:[dep.id],availability:{}}}));
  const key=must(await admin('GET','state')).employees.find(e=>e.name==='TUAC Archive Fictive').key;
  must(await admin('GET','onboarding?key='+key+'&view=direction'));
  const bytes=await fixture(),id=randomUUID();
  await f.query("INSERT INTO employee_file_originals(id,employee_key,category,name,mime,size,sha256,data,provenance,signature_kind,actor) VALUES($1,$2,'rh','Adhésion TUAC 500.pdf','application/pdf',$3,$4,decode($5,'hex'),'Fixture historique','drawn','{}')",[id,key,bytes.length,hash(bytes),bytes.toString('hex')],{vault:true});
  await f.query("INSERT INTO onboarding_docs(employee_key,kind,original_id) VALUES($1,'tuac',$2)",[key,id],{vault:true});
  const url=f.base+'/api/employee-files/originals/'+id+'?view=direction';
  const response=await fetch(url+'&print=tuac-original',{headers:{cookie}});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
  const copy=await PDFLib.PDFDocument.load(await response.arrayBuffer());assert.equal(copy.getPageCount(),1);assert.equal(operators(copy).match(/ Do\b/g),null);assert.equal(operators(copy).match(/ Tj\b/g).length,63);
  const original=await fetch(url+'&download=1',{headers:{cookie}});assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
  assert.equal((await fetch(url+'&print=tuac-original')).status,401);
  assert.equal((await fetch(url+'&print=unknown',{headers:{cookie}})).status,400);
  const unchanged=(await f.query('SELECT sha256,size FROM employee_file_originals WHERE id=$1',[id],{vault:true})).rows[0];assert.equal(unchanged.sha256,hash(bytes));assert.equal(Number(unchanged.size),bytes.length);
 }finally{await f.close();}
});
