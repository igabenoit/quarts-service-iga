import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {installScheduleEmail,scheduleEmailPayload,scheduleAccess} from '../schedule-email.js';
import {trainingSchemaSQL,sendTrainingMail} from '../training-tracker.js';
test('schedule email: fixed test recipient, dossier recipient, authorization, retries and provider confirmation',async()=>{
 const db=new PGlite();await db.exec(trainingSchemaSQL+"CREATE TABLE onboarding_cases(employee_key text PRIMARY KEY,employee_email text); CREATE TABLE employee_file_events(action text,actor jsonb,data jsonb); INSERT INTO onboarding_cases VALUES('store:1','employe@example.invalid');");
 const app=express();app.use(express.json());
 const e={key:'store:1',matricule:'001234',active:true,name:'Employée fictive',departments:[8]};
 const sourcePool={query:async()=>({rows:[]})};
 installScheduleEmail(app,{pool:db,sourcePool,directory:async()=>({employees:[e,{...e,key:'store:2'}],departments:[{id:8,active:true}]}),auth:(req,res,next)=>{if(!req.get('role'))return res.sendStatus(401);req.ef={admin:req.get('role')==='admin',view:'direction',audit:{name:'Test'}};next();},origin:(req,res,next)=>req.get('x-employee-files')==='1'?next():res.sendStatus(403),wrap:fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.message});}},transaction:fn=>db.transaction(fn)});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=(op='',body,role='admin',key='store:1',origin='1')=>fetch('http://127.0.0.1:'+server.address().port+'/api/employee-files/schedule-email'+op+'?key='+key,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',role,'x-employee-files':origin},body:body?JSON.stringify(body):undefined});
 const previous=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='synthetic';
 try{
  assert.equal((await call('',undefined,'')).status,401);assert.equal((await call('',undefined,'manager')).status,403);
  const preview=await (await call()).json();assert.equal(preview.email,'employe@example.invalid');assert.match(preview.html,/Voir mon horaire/);
  const body={requestId:randomUUID(),email:preview.email,code:'001234'};
  assert.equal((await call('/send',body,'admin','store:1','')).status,403);
  assert.equal((await call('/send',{...body,email:'wrong@example.invalid'})).status,409);
  assert.equal((await call('/send',body,'admin','absent')).status,404);
  assert.equal((await call('/send',{...body,code:'999999'})).status,409);assert.equal((await call('/send',body)).status,200);assert.equal((await call('/send',body)).status,200);
  assert.equal((await call('/test',body)).status,409);
  assert.equal((await call('/send',{...body,requestId:randomUUID()},'admin','store:2')).status,400);
  const testBody={requestId:randomUUID(),email:'wrong@example.invalid',code:'001234'};
  assert.equal((await call('/test',testBody,'admin','store:2')).status,200);
  assert.equal((await call('/test',testBody,'admin','store:2')).status,200);
  let rows=(await db.query('SELECT * FROM training_mail ORDER BY created_at')).rows;assert.equal(rows.length,2);
  assert.deepEqual(rows[0].payload.to,['employe@example.invalid']);assert.deepEqual(rows[1].payload.to,['igabenoit@gmail.com']);
  assert.equal(rows[0].payload.html,rows[1].payload.html);assert.match(rows[0].payload.html,/001234/);assert.match(rows[0].payload.text,/001234/);assert.match(rows[0].payload.text,/Conserve les zéros/);assert.equal(rows[1].payload.cc,undefined);assert.equal(rows[1].payload.bcc,undefined);
  assert.equal((await (await call()).json()).history.length,1);
  let calls=0;await sendTrainingMail(db,sourcePool,{fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({id:'fake-'+calls})};}});
  assert.equal(calls,2);assert.equal((await (await call()).json()).history[0].status,'sent');
  await sendTrainingMail(db,sourcePool,{fetchImpl:()=>{throw Error('Must not resend');}});
  e.active=false;assert.equal((await call('/test',{requestId:randomUUID()})).status,404);
  assert.match(scheduleEmailPayload('a@example.invalid').text,/clé d’accès/);
 }finally{if(previous===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=previous;await new Promise(r=>server.close(r));await db.close();}
});

test('schedule code preserves leading zeroes and follows passkey enrollment',async()=>{
 const source={query:async()=>({rows:[{required:true}]})};
 const a=await scheduleAccess(source,{personId:7,matricule:'001234'});assert.equal(a.code,'001234');assert.equal(a.requiresPasskey,true);
 const p=scheduleEmailPayload('example@example.invalid',false,a);assert.match(p.text,/ne remplace pas ta clé/);assert.match(p.html,/001234/);assert.doesNotMatch(p.html,/saisis les six chiffres/);
 assert.equal((await scheduleAccess(source,{matricule:'12345'})).code,'');assert.equal((await scheduleAccess(source,{matricule:'001234',issue:'ambigu'})).code,'');
});
