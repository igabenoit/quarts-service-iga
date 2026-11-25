import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {chequeFixture} from './cheque-fixture.mjs';
import {chequeLink} from '../public/cheque-schema.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLa0AAAAASUVORK5CYII=','base64');
const hash=b=>createHash('sha256').update(b).digest('hex');
test('spécimen : PDF, photo et lien conservés; invitations isolées et accès paie strict',{timeout:120000},async()=>{
 const {f,cookie,headers,must,admin,createCase,dep}=await chequeFixture();
 try{
  const a=await createCase(),b=await createCase(),c=await createCase(),unassigned=await createCase(['tuac']);
  const metadata=entry=>({version:0,policy:entry.policy,confirmed:true});
  const post=(entry,path,body)=>f.call('POST','/api/accueil-employe/specimen-cheque/'+path,{headers:entry.employeeHeaders,body});
  async function begin(entry,bytes,name='specimen.pdf'){
   const id=randomUUID(),path='uploads/'+id;
   must(await post(entry,path,{...metadata(entry),name,size:bytes.length,sha256:hash(bytes)}),201);return path;
  }
  async function part(entry,path,bytes,expected=200){
   const response=await fetch(f.base+'/api/accueil-employe/specimen-cheque/'+path+'/parts/0',{method:'PUT',headers:{...entry.employeeHeaders,'Content-Type':'application/octet-stream'},body:bytes});assert.equal(response.status,expected);return response;
  }
  const before=must(await a.call('state'));assert.equal(before.documents[0].done,false);assert.equal(before.documents[0].submissionRequired,true);
  must(await a.call('sign',{kind:'cheque',...metadata(a),answers:{}}),400);
  must(await post(unassigned,'link',{...metadata(unassigned),url:'https://example.invalid/specimen'}),404);
  for(const url of ['javascript:alert(1)','file:///test','http://example.invalid/file','https://user:pass@example.invalid/file','invalide'])must(await post(c,'link',{...metadata(c),url}),400);
  must(await post(c,'link',{...metadata(c),confirmed:false,url:'https://example.invalid/specimen'}),400);
  const invalid=Buffer.from('<html>not a photo</html>'),bad=await begin(a,invalid,'photo.png');await part(a,bad,invalid);must(await post(a,bad+'/complete'),400);assert.equal(must(await a.call('state')).documents[0].done,false);
  const upload=await begin(a,png,'specimen.png');
  await part(b,upload,png,409);must(await post(b,upload+'/complete'),404);
  await part(a,upload,png);await part(a,upload,png);
  const photo=must(await post(a,upload+'/complete'),201).id;
  assert.equal(must(await post(a,upload+'/complete'),201).id,photo,'reprise de transfert sans doublon');
  const received=must(await a.call('state')).documents[0];assert.equal(received.done,true);assert.equal(received.employeeSigned,false);assert.equal(received.attachment.name,'specimen.png');
  const fileUrl='/api/employee-files/originals/'+photo+'?view=direction';
  const photoResponse=await fetch(f.base+fileUrl,{headers:{cookie}});assert.equal(photoResponse.status,200);assert.equal(photoResponse.headers.get('x-onboarding-kind'),'cheque');assert.deepEqual(Buffer.from(await photoResponse.arrayBuffer()),png);
  assert.equal((await fetch(f.base+fileUrl)).status,401);assert.equal((await fetch(f.base+fileUrl,{headers:b.employeeHeaders})).status,401);
  assert.ok(must(await admin('GET',a.route(''))).completed_at);
  const pdf=await readFile(new URL('./fixtures/tuac-three-copy-before-alignment.pdf',import.meta.url)),pdfUpload=await begin(b,pdf);await part(b,pdfUpload,pdf);const pdfId=must(await post(b,pdfUpload+'/complete'),201).id;
  const pdfResponse=await fetch(f.base+'/api/employee-files/originals/'+pdfId+'?view=direction',{headers:{cookie}});assert.deepEqual(Buffer.from(await pdfResponse.arrayBuffer()),pdf,'PDF original intact');
  const url='https://example.invalid/specimen?partage=fiction',linkId=must(await post(c,'link',{...metadata(c),url}),201).id;
  const link=must(await admin('GET','originals/'+linkId+'?view=direction'));assert.equal(link,url+'\n');
  const audit=await f.query("SELECT data FROM employee_file_events WHERE action='onboarding.submitted'",[],{vault:true});assert.equal(audit.rows.length,3);assert.ok(!JSON.stringify(audit).includes(url));assert.ok(!JSON.stringify(audit).includes(a.token));
  const mail=await f.onboardingMail();assert.equal(mail.length,1);assert.equal(mail[0].payload.attachments,undefined);assert.ok(!mail[0].payload.text.includes(url));
  const account=must(await f.call('POST','/api/manager-accounts',{cookie,headers,body:{name:'RH Fictif',login:'cheque.rh.test',password:'Password-test-only-123',departments:[dep.id],personId:Number(unassigned.key.split(':')[1]),active:true}}));
  const accountId=Number(account.accounts.find(x=>x.name==='RH Fictif').id),rhCookie=(await f.call('POST','/api/manager-login',{body:{login:'cheque.rh.test',password:'Password-test-only-123'}})).cookie;
  const grant={accountId,role:'rh',departments:[dep.id],allDepartments:false,revoke:false};must(await admin('POST','access?view=direction',grant));
  const rh=(path)=>f.call('GET','/api/employee-files/'+path,{cookie:rhCookie,headers});
  must(await rh('originals/'+photo+'?view=direction'),403);
  const hidden=must(await rh(a.route(''))).documents[0];assert.equal(hidden.done,true);assert.equal(hidden.original_id,null);assert.equal(hidden.attachment,null);
  assert.equal(must(await rh('state?view=direction')).receivedDocuments.some(d=>d.originalId===photo),false);
  must(await admin('POST','access?view=direction',{...grant,role:'payroll'}));must(await rh('originals/'+photo+'?view=direction'));
  must(await admin('POST','access?view=direction',{...grant,role:'payroll',revoke:true}));must(await rh('originals/'+photo+'?view=direction'),403);
  const revoked=await createCase(),pending=await begin(revoked,png,'specimen.png');must(await admin('POST',revoked.route('revoke'),{}));await part(revoked,pending,png,404);must(await post(revoked,pending+'/complete'),404);
 }finally{await f.close();}
});

test('les liens de spécimen restent des liens HTTPS explicites',()=>{
 assert.equal(chequeLink(' https://example.invalid/specimen.pdf '),'https://example.invalid/specimen.pdf');
 assert.throws(()=>chequeLink('https://user:password@example.invalid/file'));
 assert.throws(()=>chequeLink('data:text/html,exemple'));
});
