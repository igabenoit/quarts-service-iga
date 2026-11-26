import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {installTuacPostings,endDate,fields,documentPdf} from '../tuac-postings.js';
const sample={department:'D',reference:'D-01',job:'Commis épicerie',employmentStatus:'Partiel',startDate:'2026-11-26',supervisor:'Responsable fictif',requirements:'Jour, soirs et fins de semaine',candidates:''};
test('TUAC dates, leap year, invalid dates and multi-page PDF',()=>{assert.equal(endDate('2026-12-28'),'2027-01-04');assert.equal(endDate('2028-02-26'),'2028-03-04');assert.throws(()=>endDate('2026-02-30'));assert.throws(()=>fields({...sample,reference:'G-01'}));assert.equal(fields(sample).endDate,'2026-12-03');const pdf=documentPdf(fields({...sample,requirements:'Exigences du poste. '.repeat(250)}),'affichage');assert.ok(pdf.toString().startsWith('%PDF-'));assert.ok(Number(pdf.toString().match(/\/Count (\d+)/)[1])>=2);assert.throws(()=>documentPdf(fields(sample),'nomination'));});
test('TUAC owner-only CRUD, stale edits, private PDF, immutable history and email idempotency',async()=>{
 const db=new PGlite(),app=express();app.use(express.json());let calls=0,lastMail;
 const auth=(req,res,next)=>{if(!req.get('x-test-user'))return res.status(401).end();req.ef={admin:req.get('x-test-user')!=='manager',manager:{personId:Number(req.get('x-test-user')),authentication:req.get('x-test-auth')||'passkey'},audit:{name:'Fictif'}};res.set('Cache-Control','private, no-store');next();};
 const origin=(req,res,next)=>req.get('x-employee-files')==='1'?next():res.status(403).end();const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.message});}};
 await installTuacPostings(app,{pool:{query:(sql,args)=>args?db.query(sql,args):sql.includes('CREATE TABLE')?db.exec(sql):db.query(sql)},auth,origin,wrap,transaction:fn=>db.transaction(fn),directory:async()=>({departments:[{id:11,name:'Épicerie'},{id:6,name:'Boulangerie'},{id:1,name:'Service',code:'service'}],employees:[{key:'store:1',name:'Personne fictive',active:true,departments:[11]},{key:'store:2',name:'Autre département',active:true,departments:[6]},{key:'store:3',name:'Inactif',active:false,departments:[11]}]}),fetchImpl:async(_url,opts)=>{calls++;lastMail=JSON.parse(opts.body);return {ok:true,json:async()=>({id:'mail-provider-test'})};}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/employee-files/tuac';
 const call=(path='',body,user='69574',extra={})=>fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{'x-test-user':user}:{}),'x-employee-files':'1',...extra},body:body?JSON.stringify(body):undefined});
 const oldKey=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='mock-only';
 try{
  assert.equal((await call('',null,null)).status,401);
  for(const user of ['manager','72034']){assert.equal((await call('',null,user)).status,403);assert.equal((await call('',sample,user)).status,403);}
  assert.equal((await call('',null,'69574',{'x-test-auth':'legacy'})).status,403);
  assert.equal((await call('',sample,'69574',{'x-employee-files':''})).status,403);
  let r=await call('',sample);assert.equal(r.status,201);const {id,reference}=await r.json();assert.equal(reference,'D-01');
  const second=await (await call('',{...sample,reference:'D-99'})).json();assert.equal(second.reference,'D-02');
  const another=await (await call('',{...sample,department:'G',reference:undefined})).json();assert.equal(another.reference,'G-01');
  const parallel=await Promise.all([call('',sample),call('',sample)]);const assigned=await Promise.all(parallel.map(r=>r.json()));assert.deepEqual(assigned.map(r=>r.reference).sort(),['D-03','D-04']);
  assert.equal((await call('/'+id,{...sample,department:'G',version:1})).status,400);
  assert.equal((await call('/'+id+'/nomination/pdf')).status,400);
  r=await call('/'+id+'/affichage/pdf');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.match(await r.text(),/^%PDF-/);
  const updated={...sample,reference:'D-999',version:1,nomination:{employeeKey:'store:1',employee:'Nom falsifié ignoré',effectiveDate:'2026-12-04'}};
  const choices=await (await call('/'+id+'/employees')).json();assert.deepEqual(choices.employees.map(e=>e.key),['store:1']);
  for(const employeeKey of ['store:2','store:3','missing'])assert.equal((await call('/'+id,{...updated,nomination:{...updated.nomination,employeeKey}})).status,400);
  assert.equal((await call('/'+id,updated)).status,200);assert.equal((await call('/'+id,updated)).status,409);
  const nominationPdf=await call('/'+id+'/nomination/pdf');assert.equal(nominationPdf.status,200);assert.match(await nominationPdf.text(),/D-01/);
  for(const suffix of ['/history','/employees','/affichage/pdf','/nomination/pdf'])assert.equal((await call('/'+id+suffix,null,'72034')).status,403);
  assert.equal((await call('/'+id,{...updated,version:2},'72034')).status,403);
  const mail={requestId:randomUUID(),version:2,to:'test@example.invalid'};
  assert.equal((await call('/'+id+'/nomination/email',mail,'manager')).status,403);
  assert.equal((await call('/'+id+'/nomination/email',{...mail,to:'bad'})).status,400);
  const sent=await call('/'+id+'/nomination/email',mail);assert.equal(sent.status,200);const confirmation=await sent.json();assert.equal(confirmation.status,'sent');assert.deepEqual(confirmation.recipients,['test@example.invalid']);assert.ok(confirmation.sentAt);assert.equal(confirmation.providerId,'mail-provider-test');const repeated=await (await call('/'+id+'/nomination/email',mail)).json();assert.deepEqual(repeated,confirmation);assert.equal(calls,1);assert.equal(lastMail.attachments.length,1);assert.match(Buffer.from(lastMail.attachments[0].content,'base64').toString(),/^%PDF-/);
  assert.equal((await call('/'+id+'/nomination/email',{...mail,to:'other@example.invalid'})).status,409);
  const history=await (await call('/'+id+'/history')).json();assert.equal(history.history.length,2);assert.equal(history.history[0].data.reference,'D-01');assert.equal(history.history[0].data.nomination.employee,'Personne fictive');assert.equal(history.history[0].data.nomination.employeeKey,'store:1');assert.equal(history.history[1].data.reference,'D-01');assert.equal(history.history[1].data.nomination,null);assert.equal(history.mail[0].status,'sent');
 }finally{if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;await new Promise(r=>server.close(r));await db.close();}
});
