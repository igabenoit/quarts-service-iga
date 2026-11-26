import {campusLogin,campusLink} from '../campus-training.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID,createHash} from 'node:crypto';
import {installTrainingTracker,sendTrainingMail,trainingMailSettings} from '../training-tracker.js';
import {installDocumentUploadSchema} from '../document-uploads.js';

test('training: scoped assignments, snapshot lists, stale edits, proof, mail retry and weekly reminders',async()=>{
 const db=new PGlite(),pool={query:(s,a)=>s.includes('CREATE TABLE')?db.exec(s):db.query(s,a)},app=express();app.use(express.json());await installDocumentUploadSchema(pool);
 const documentId=randomUUID(),employees=[{key:'store:1',name:'Employé fictif',active:true,departments:[8],matricule:'001234'},{key:'store:2',name:'Autre département',active:true,departments:[9]}],departments=[{id:8,name:'Charcuterie',active:true},{id:9,name:'Autre',active:true}];
 const sourcePool={query:async(s,args)=>({rows:s.includes('sst_visible_documents')?(args[0]===8?[{id:documentId,name:'Fiche.pdf',title:'Couteaux'}]:args[0]===documentId?[{name:'Fiche.pdf',mime:'application/pdf',department_id:8,data:Buffer.from('%PDF-test')}]:[]):s.includes('schedule_employees')?[]:s.includes('schedule_store_people')?employees.map((e,i)=>({id:i+1,name:e.name,active:e.active})):s.includes('schedule_store_memberships')?employees.map((e,i)=>({person_id:i+1,department_id:e.departments[0]})):s.includes('schedule_leave_departments')?departments:[]})};
 const auth=(req,res,next)=>{const role=req.get('x-role');if(!role)return res.status(401).end();req.ef={admin:role==='admin',view:role==='employee'?'employe':role==='admin'?'direction':'gerant',manager:role==='employee'?null:{departments:[role==='other'?9:8]},audit:{kind:role,id:1,name:'Test '+role}};next();};
 const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.message});}};
 await installTrainingTracker(app,{pool,sourcePool,auth,origin:(req,res,next)=>req.get('x-employee-files')==='1'?next():res.status(403).end(),wrap,transaction:fn=>db.transaction(fn),directory:async()=>({employees,departments}),date:v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)throw Object.assign(Error('Date invalide'),{status:400});return v;}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/employee-files/formations';
 const call=(path='',body,role='admin',extra={})=>fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-employee-files':'1',...(role?{'x-role':role}:{}),...extra},body:body?JSON.stringify(body):undefined});
 const old=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='synthetic';
 try{
  assert.equal((await call('',null,null)).status,401);assert.equal((await call('',null,'employee')).status,403);
  const body={departmentId:8,title:'Embauche charcuterie',items:[{title:'Couteaux',documentId}]};
  assert.equal((await call('/lists',body,'manager')).status,403);assert.equal((await call('/lists',body,'admin',{'x-employee-files':''})).status,403);
  const list=await (await call('/lists',body)).json();assert.ok(list.id);
  const assignment={listId:list.id,employeeKeys:['store:1'],dueDate:'2020-01-01'};
  assert.equal((await call('/assign',assignment,'other')).status,403);assert.equal((await call('/assign',{...assignment,employeeKeys:['store:2']})).status,400);
  assert.equal((await call('/assign',{...assignment,notify:true})).status,400);assert.equal((await db.query('SELECT * FROM training_plans')).rows.length,0);
  assert.equal((await call('/settings',{departmentId:8,version:0,recipients:['manager@example.invalid'],reminders:true})).status,200);
  let r=await call('/assign',{...assignment,notify:true},'manager');assert.equal(r.status,200);assert.equal((await r.json()).assigned,1);
  assert.equal((await (await call('/assign',assignment)).json()).assigned,0);
  let state=await (await call('',null,'manager')).json();assert.ok(state.plans,JSON.stringify(state));let p=state.plans[0];assert.equal(p.progress.late,true);assert.equal((await (await call('',null,'other')).json()).plans.length,0);
  assert.equal((await call('/plans/'+p.id,null,'other')).status,404);
  assert.equal((await call('/documents/'+documentId,null,'other')).status,404);assert.equal((await call('/documents/'+documentId,null,'manager')).status,200);
  assert.equal((await call('/lists',{...body,id:list.id,version:1,items:[{title:'Nouvelle liste'}]})).status,200);
  assert.equal((await (await call('/plans/'+p.id)).json()).plan.items[0].title,'Couteaux');
  const update={version:1,itemId:p.items[0].id,status:'done',completedDate:'2099-01-01',trainer:'Formateur'};
  assert.equal((await call('/plans/'+p.id,update,'manager')).status,400);
  assert.equal((await call('/plans/'+p.id,{...update,completedDate:'2020-01-02'},'manager')).status,200);
  assert.equal((await call('/plans/'+p.id,{...update,completedDate:'2020-01-02'},'manager')).status,409);
  let item=(await (await call('/plans/'+p.id)).json());assert.equal(item.plan.items[0].status,'done');assert.equal(item.history[0].actor.kind,'manager');
  const bytes=Buffer.from('%PDF-1.7\nproof\n%%EOF'),upload=randomUUID(),uploadPath='/plans/'+p.id+'/items/'+p.items[0].id+'/files/uploads/'+upload;
  const metadata={name:'preuve.pdf',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  assert.equal((await call(uploadPath,metadata,'other')).status,404);assert.equal((await call(uploadPath,metadata,'manager')).status,201);
  r=await fetch(base+uploadPath+'/parts/0',{method:'PUT',headers:{'x-role':'manager','x-employee-files':'1','Content-Type':'application/octet-stream'},body:bytes});assert.equal(r.status,200);
  r=await call(uploadPath+'/complete',{},'manager');assert.equal(r.status,201);const file=await r.json();assert.ok(file.id);assert.equal((await call('/plans/'+p.id+'/files/'+file.id,null,'other')).status,404);assert.match(await (await call('/plans/'+p.id+'/files/'+file.id,null,'manager')).text(),/%PDF/);
  let sent=0,payloads=[];const fetchImpl=async(_url,opts)=>{sent++;payloads.push(JSON.parse(opts.body));return {ok:true,json:async()=>({id:'synthetic-'+sent})};};
  await sendTrainingMail(pool,sourcePool,{fetchImpl});assert.equal(sent,1);assert.match(payloads[0].from,/IGA Famille Benoit 300-425/);await sendTrainingMail(pool,sourcePool,{fetchImpl});assert.equal(sent,1);
  const id=randomUUID();assert.equal((await call('/notify',{requestId:id,departmentId:8},'manager')).status,200);assert.equal((await call('/notify',{requestId:id,departmentId:8},'manager')).status,200);assert.equal((await call('/notify',{requestId:id,departmentId:8},'other')).status,403);
  await assert.rejects(sendTrainingMail(pool,sourcePool,{fetchImpl:async()=>({ok:true,json:async()=>({})})}));
  await db.query("UPDATE training_mail SET last_at=clock_timestamp()-interval '3 minutes' WHERE status='sending'");await sendTrainingMail(pool,sourcePool,{fetchImpl});assert.equal(sent,2);
  await call('/plans/'+p.id,{version:2,itemId:p.items[0].id,status:'doing'},'manager');await sendTrainingMail(pool,sourcePool,{fetchImpl});assert.equal(sent,3);assert.ok(payloads[2].to.includes('igabenoit@gmail.com'));await sendTrainingMail(pool,sourcePool,{fetchImpl});assert.equal(sent,3);
  const campusList=await (await call('/lists',{departmentId:8,title:'Campus fictif',items:[{title:'Formation obligatoire fictive',platform:'campus'}]})).json();
  assert.equal((await call('/lists',{departmentId:8,title:'Lien individuel interdit',items:[{title:'Test',platform:'campus',url:'https://sobeys.csod.com/ui/training/app/targetUser/123/trainingID/456'}]})).status,400);
  assert.equal((await call('/assign',{listId:campusList.id,employeeKeys:['store:1'],dueDate:'2027-01-10'})).status,200);
  const campusPlan=(await (await call()).json()).plans.find(p=>p.list_id===campusList.id),path='/plans/'+campusPlan.id+'/campus';
  const access=await (await call(path)).json();assert.equal(access.login,'m08327e001234');assert.equal(access.password,'Campus2027');assert.equal((await call(path,null,'manager')).status,403);
  const message={requestId:randomUUID(),version:1,login:access.login,email:'employee@example.invalid'};
  assert.equal((await call(path+'/email',message)).status,400);assert.equal((await call(path+'/email',{...message,resetConfirmed:true},'manager')).status,403);
  assert.equal((await call(path+'/email',{...message,resetConfirmed:true,login:'m08327e999999'})).status,409);
  assert.equal((await call(path+'/email',{...message,resetConfirmed:true})).status,200);
  assert.equal((await call(path+'/email',{...message,resetConfirmed:true})).status,200);
  const jobs=(await db.query("SELECT payload FROM training_mail WHERE dedupe LIKE 'campus:%'")).rows;assert.equal(jobs.length,1);assert.deepEqual(jobs[0].payload.to,['employee@example.invalid']);assert.match(jobs[0].payload.text,/m08327e001234/);assert.match(jobs[0].payload.text,/Campus2027/);assert.doesNotMatch(jobs[0].payload.text,/change.*mot de passe/i);
  assert.equal((await db.query("SELECT * FROM training_events WHERE action='campus.reset.confirmed'")).rows.length,1);
  employees[0].departments=[9];assert.equal((await call('/plans/'+p.id,null,'manager')).status,403);assert.equal((await (await call('',null,'manager')).json()).plans.length,0);
 }finally{if(old===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=old;await new Promise(r=>server.close(r));await db.close();}
});


test('training recipients follow the department directory and preserve explicit overrides and disabled reminders',async()=>{
 let email='first@example.invalid',stored=[];
 const source={query:async()=>({rows:[{id:8,recipient:email,active:true},{id:9,recipient:'',active:true},{id:10,recipient:'inactive@example.invalid',active:false}]})};
 const pool={query:async()=>({rows:stored})};
 let result=await trainingMailSettings(pool,source);assert.deepEqual(result[0].recipients,[email]);assert.equal(result[0].reminders,true);assert.equal(result[0].inherited,true);assert.equal(result[1].reminders,false);assert.equal(result.length,2);
 email='changed@example.invalid';assert.deepEqual((await trainingMailSettings(pool,source))[0].recipients,[email]);
 stored=[{department_id:8,version:2,recipients:['custom@example.invalid'],reminders:false}];result=await trainingMailSettings(pool,source);assert.deepEqual(result[0].recipients,['custom@example.invalid']);assert.equal(result[0].inherited,false);assert.equal(result[0].reminders,false);
 stored[0].recipients=[];result=await trainingMailSettings(pool,source);assert.deepEqual(result[0].recipients,[email]);assert.equal(result[0].reminders,false);
 email='';assert.deepEqual((await trainingMailSettings(pool,source))[0].recipients,[]);
});

test('Campus uses exactly six digits and shareable Sobeys links only',()=>{
 assert.equal(campusLogin({active:true,matricule:'001234'}),'m08327e001234');
 for(const e of [{active:true,matricule:'1234'},{active:false,matricule:'001234'},{active:true,matricule:'001234',issue:'Ambigu'}])assert.throws(()=>campusLogin(e));
 assert.equal(campusLink(''),'https://sobeys.csod.com/');
 for(const u of ['http://sobeys.csod.com/','https://evil.example/','https://sobeys.csod.com/?targetUser=123','javascript:alert(1)'])assert.throws(()=>campusLink(u));
});
