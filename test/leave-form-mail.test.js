import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {formMailPayload,normalizeFormMail,installFormMail} from '../leave-form-mail.js';
import {prepareFormMail} from '../scripts/prepare-leave-form-mail.mjs';

test('migration additive : origine contrôlée, ancien marqueur conservé et relance idempotente',async()=>{
  const db=new PGlite(),pool={query:async(sql,args)=>args?db.query(sql,args):(await db.exec(sql)).at(-1)};
  try{
    await db.exec('CREATE TABLE quart_schema_releases(version text,origin text,PRIMARY KEY(version,origin));');
    await assert.rejects(prepareFormMail(pool,'https://portal.example.invalid'));
    assert.equal((await db.query("SELECT to_regclass('schedule_leave_form_mail') AS name")).rows[0].name,null);
    await db.query("INSERT INTO quart_schema_releases VALUES('20261113.5',$1)",['https://portal.example.invalid']);
    await prepareFormMail(pool,'https://portal.example.invalid');await prepareFormMail(pool,'https://portal.example.invalid');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM quart_schema_releases')).rows[0].count,2);
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE relname='schedule_leave_form_mail'")).rows[0].relrowsecurity,true);
  }finally{await db.close();}
});

test('courriel lisible, règles exactes, destinataire unique et liens test distincts',()=>{
  const input={recipient:' Demo@Example.com ',name:'Alex <script>',isTest:false};
  const payload=formMailPayload(input,{baseUrl:'https://quartservice.igabenoit.com'});
  assert.deepEqual(payload.to,['demo@example.com']);assert.equal(payload.cc,undefined);assert.equal(payload.bcc,undefined);
  assert.match(payload.html,/Alex &lt;script&gt;/);assert.doesNotMatch(payload.html,/<script>/);
  for(const text of [payload.text,payload.html]){
    assert.match(text,/jeudi précédant la semaine/);assert.match(text,/avant 9 h/);
    assert.match(text,/6 derniers chiffres/);assert.match(text,/ne constitue pas une approbation/);
    assert.match(text,/https:\/\/quartservice\.igabenoit\.com\/conges/);
  }
  const trial=formMailPayload({...input,isTest:true});
  assert.match(trial.subject,/^\[TEST\]/);assert.match(trial.html,/\/conges-test/);assert.match(trial.text,/accès de gestion/);
  assert.doesNotMatch(trial.text,/6 derniers chiffres/);
  for(const recipient of ['', 'a@b.com,c@d.com','a@b.com\r\nBcc:x@y.com'])assert.throws(()=>normalizeFormMail({...input,recipient}));
  assert.throws(()=>normalizeFormMail({...input,isTest:'false'}));assert.throws(()=>normalizeFormMail(null));
  assert.throws(()=>formMailPayload(input,{baseUrl:'javascript:alert(1)'}));
});

test('HTTP et PostgreSQL : autorisation, aperçu sans envoi, erreurs, reprise et reçu durable',async t=>{
  const db=new PGlite(),pool={query:async(sql,args)=>args?db.query(sql,args):(await db.exec(sql)).at(-1)};
  const app=express();app.use(express.json());let fail=false,hold=null;const messages=[];
  const requireManager=(req,res,next)=>{
    if(!req.headers['x-test-manager'])return res.status(401).json({error:'Connectez-vous.'});
    req.manager={kind:'admin',personId:Number(req.headers['x-test-manager'])};next();
  };
  const sameOrigin=(req,res,next)=>req.headers.origin==='https://other.invalid'?res.status(403).json({error:'origin'}):next();
  const oldKey=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='fixture-only';
  await installFormMail(app,pool,{requireManager,sameOrigin,fetchImpl:async(_url,options)=>{
    messages.push({payload:JSON.parse(options.body),key:options.headers['Idempotency-Key']});
    if(hold)await hold;
    if(fail)throw Error('simulated timeout');
    return {ok:true,status:200,json:async()=>({id:'mock-provider-id'})};
  }});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  const body=()=>({submissionKey:randomUUID(),recipient:'tester@example.invalid',name:'Test',isTest:true});
  const post=async(input,{manager='1',origin}={})=>{
    const r=await fetch(base+'/api/leave/form-email',{method:'POST',headers:{'Content-Type':'application/json',...(manager?{'x-test-manager':manager}:{}),...(origin?{origin}:{})},body:JSON.stringify(input)});
    return {status:r.status,data:await r.json()};
  };
  try{
    await t.test('accès et aperçu',async()=>{
      assert.equal((await post(body(),{manager:null})).status,401);
      assert.equal((await post(body(),{origin:'https://other.invalid'})).status,403);
      const r=await fetch(base+'/api/leave/form-email/preview?test=true',{headers:{'x-test-manager':'1'}});
      assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/sandbox/);assert.equal(r.headers.get('x-frame-options'),'SAMEORIGIN');
      assert.match(await r.text(),/Essayer le formulaire/);assert.equal(messages.length,0);
    });
    await t.test('service absent puis échec : aucune fausse confirmation',async()=>{
      const b=body();process.env.RESEND_API_KEY='';assert.equal((await post(b)).status,503);assert.equal(messages.length,0);process.env.RESEND_API_KEY='fixture-only';
      fail=true;assert.equal((await post(b)).status,502);const first=structuredClone(messages.at(-1));
      fail=false;const sent=await post(b);assert.equal(sent.status,200);assert.equal(sent.data.status,'sent');assert.ok(sent.data.sentAt);
      assert.deepEqual(messages.at(-1),first);
      const count=messages.length;assert.deepEqual((await post(b)).data,sent.data);assert.equal(messages.length,count);
      assert.equal((await post({...b,recipient:'other@example.invalid'})).status,409);
      assert.equal((await post(b,{manager:'2'})).status,409);
      assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM schedule_leave_form_mail')).rows[0].total,1);
    });
    await t.test('deux clics simultanés et reprise incertaine expirée',async()=>{
      let release;hold=new Promise(r=>release=r);const b=body();const first=post(b);
      for(let i=0;i<100;i++){const r=await db.query('SELECT status FROM schedule_leave_form_mail WHERE submission_key=$1',[b.submissionKey]);if(r.rows[0]?.status==='sending')break;await new Promise(r=>setTimeout(r,10));}
      const count=messages.length;assert.equal((await post(b)).status,409);assert.equal(messages.length,count);
      release();hold=null;assert.equal((await first).status,200);
      const expired=body();fail=true;assert.equal((await post(expired)).status,502);fail=false;
      await db.query("UPDATE schedule_leave_form_mail SET first_attempt_at=clock_timestamp()-interval '21 hours' WHERE submission_key=$1",[expired.submissionKey]);
      const before=messages.length;assert.equal((await post(expired)).status,409);assert.equal(messages.length,before);
    });
  }finally{
    if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;
    await new Promise(r=>server.close(r));await db.close();
  }
});
