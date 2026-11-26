import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {tuacSchemaSQL,documentPdf,fields} from '../tuac-postings.js';
import {tuacReminderSchemaSQL,sendTuacExpiryReminders,tuacSender} from '../tuac-reminders.js';
test('expiry reminders: due only, one per deadline, retries deduplicated and moved dates respected',async()=>{
 const db=new PGlite();await db.exec(tuacSchemaSQL);await db.exec(tuacReminderSchemaSQL);
 const env={RESEND_API_KEY:'mock',RESEND_FROM_EMAIL:'Quarts Service <conges@example.invalid>'};let calls=[];
 const fetchImpl=async(url,options)=>{calls.push(options);return {ok:true};};
 async function posting(end,ref){const id=randomUUID();await db.query('INSERT INTO tuac_postings(id,reference,department,data) VALUES($1,$2,$3,$4)',[id,ref,'D',JSON.stringify({endDate:end,job:'Poste fictif'})]);return id;}
 try{
  const due=await posting('2000-01-01','D-01');await posting('2999-01-01','D-02');
  await sendTuacExpiryReminders(db,{env,fetchImpl});assert.equal(calls.length,1);const mail=JSON.parse(calls[0].body);assert.deepEqual(mail.to,['igabenoit@gmail.com']);assert.equal(mail.from,'IGA Famille Benoit <conges@example.invalid>');assert.match(mail.text,/D-01/);
  await sendTuacExpiryReminders(db,{env,fetchImpl});assert.equal(calls.length,1);
  const retry=await posting('2000-01-02','D-03');let failed;
  await assert.rejects(sendTuacExpiryReminders(db,{env,fetchImpl:async(u,o)=>{failed=o;throw Error('Network timeout');}}));
  await db.query("UPDATE tuac_expiry_reminders SET last_at=now()-interval '3 minutes' WHERE posting_id=$1",[retry]);
  await sendTuacExpiryReminders(db,{env,fetchImpl});assert.equal(calls.length,2);assert.equal(calls[1].headers['Idempotency-Key'],failed.headers['Idempotency-Key']);assert.equal(calls[1].body,failed.body);
  const moved=await posting('2000-01-03','D-04');await assert.rejects(sendTuacExpiryReminders(db,{env,fetchImpl:async()=>({ok:false})}));
  await db.query("UPDATE tuac_postings SET data=jsonb_set(data,'{endDate}','\"2999-02-01\"') WHERE id=$1",[moved]);await db.query("UPDATE tuac_expiry_reminders SET last_at=now()-interval '3 minutes' WHERE posting_id=$1",[moved]);
  await sendTuacExpiryReminders(db,{env,fetchImpl});assert.equal(calls.length,2);
  await db.query("UPDATE tuac_postings SET data=jsonb_set(data,'{endDate}','\"2000-01-04\"') WHERE id=$1",[due]);await sendTuacExpiryReminders(db,{env,fetchImpl});assert.equal(calls.length,3);
  assert.equal(tuacSender({EMAIL_FROM:'conges@example.invalid'}),'IGA Famille Benoit <conges@example.invalid>');
 }finally{await db.close();}
});
test('candidates and nominee print with the same reference and original logos',()=>{
 const d=fields({department:'D',reference:'D-01',job:'Poste fictif',employmentStatus:'Partiel',startDate:'2026-11-26',supervisor:'Responsable fictif',requirements:'Jour et soir',candidates:'Candidat Alpha\nCandidat Beta',nomination:{employee:'Candidat Beta',effectiveDate:'2026-12-04'}});
 for(const kind of ['affichage','nomination']){const pdf=documentPdf(d,kind).toString('latin1');assert.match(pdf,/D-01/);assert.match(pdf,/Candidat Beta/);assert.ok((pdf.match(/\/Subtype \/Image/g)||[]).length>=2);if(kind==='affichage')assert.match(pdf,/Candidat Alpha/);}
});
