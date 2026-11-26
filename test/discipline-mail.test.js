import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {disciplineSchemaSQL} from '../employee-discipline-schema.js';
import {sendDisciplineMail} from '../discipline-approval.js';

test('discipline mail retries with identical payload and idempotency key, then stops',async()=>{
 const db=new PGlite();const pool={query:(...args)=>db.query(...args),connect:async()=>({...pool,release(){}})};
 try{
  await db.exec(disciplineSchemaSQL);
  const id='10000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO employee_file_discipline(id,case_id,version,employee_key,occurred_on,measure_type,title,facts,expectations,status,actor)
   VALUES($1,$1,1,'fictif',CURRENT_DATE,'verbal','Test','Faits confidentiels fictifs','', 'filed','{}')`,[id]);
  await db.query("INSERT INTO employee_discipline_approvals(revision_id,employee_key,level) VALUES($1,'fictif',1)",[id]);
  const calls=[],env={RESEND_API_KEY:'test-only',RESEND_FROM_EMAIL:'test@example.invalid'};
  const fetchImpl=async(url,options)=>{calls.push(options);return {ok:calls.length>1};};
  await assert.rejects(sendDisciplineMail(pool,{env,fetchImpl}),/reprendre/);
  await db.query("UPDATE employee_discipline_approvals SET mail_last_at=clock_timestamp()-interval '3 minutes'");
  await sendDisciplineMail(pool,{env:{...env,RESEND_FROM_EMAIL:'changed@example.invalid'},fetchImpl});
  assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);
  assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(calls[0].body).to,['igabenoit@gmail.com']);
  assert.ok(!calls[0].body.includes('Faits confidentiels'));
  await sendDisciplineMail(pool,{env,fetchImpl});assert.equal(calls.length,2);
  assert.equal((await db.query('SELECT mail_status FROM employee_discipline_approvals')).rows[0].mail_status,'sent');
 }finally{await db.close();}
});
