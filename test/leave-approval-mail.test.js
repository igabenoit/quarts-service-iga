import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installLeave} from '../leave.js';
import {installUndoSchema} from '../undo.js';
import {approvalPayload,installApprovalMail,queueApprovalMail} from '../leave-approval-mail.js';
import {loadContactDirectory} from '../employee-contacts.js';

const full={date:'2030-10-18',allDay:true,startMinute:0,endMinute:1440};
const part={date:'2030-10-19',allDay:false,startMinute:675,endMinute:1035};
const response=()=>({code:200,body:null,set(){return this;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}});

test('confirmation limitée au destinataire et aux périodes approuvées, sans motif ni note privée',()=>{
  const job={request_id:8,email:'employee@example.com',employee_name:'Camille',department_name:'Service',recipient:'manager@example.com',periods:[full,part],effective_periods:[part],reason:'confidentiel',decision_note:'privé'};
  const payload=approvalPayload(job,{from:'Horaires <hours@example.com>'});
  assert.deepEqual(payload.to,['employee@example.com']);assert.equal(payload.reply_to,'manager@example.com');assert.equal(payload.cc,undefined);
  assert.match(payload.text,/19 octobre 2030/);assert.match(payload.text,/11 h 15 à 17 h 15/);assert.doesNotMatch(payload.text,/18 octobre|confidentiel|privé/);
  const fake=approvalPayload({...job,is_test:true},{testRecipient:'test@example.com'});
  assert.deepEqual(fake.to,['test@example.com']);assert.equal(fake.reply_to,undefined);assert.match(fake.subject,/^\[TEST\]/);
  assert.throws(()=>approvalPayload({...job,is_test:true}),/test à configurer/);
});

test('PostgreSQL : file transactionnelle, décision, annulation avant envoi, reprises et annuaire privé',async t=>{
  const db=new PGlite();
  const pool={query:async(sql,args)=>args?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};
  pool.connect=async()=>pool;
  const savedKey=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='';
  try{
    const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
    const ddl=source.slice(source.indexOf('await pool.query(`'),source.indexOf('app.disable('));
    await new Function('pool','return (async()=>{'+ddl+'})();')(pool);
    const routes=new Map(),app={use(){}};
    for(const verb of ['get','put','post','patch'])app[verb]=(path,...handlers)=>routes.set(verb+' '+path,handlers);
    const manager=()=>{},origin=()=>{},interval=globalThis.setInterval;
    globalThis.setInterval=()=>({unref(){}});
    try{await installLeave(app,pool,{requireManager:manager,sameOrigin:origin,hasStaffAccess:()=>false});}finally{globalThis.setInterval=interval;}
    await installUndoSchema(pool);
    await pool.query("INSERT INTO schedule_employees(id,name,area,role) VALUES(1,'Camille','front','cashier'),(2,'Autre','front','cashier'); UPDATE schedule_leave_departments SET recipient='manager@example.com',mail_enabled=FALSE WHERE code='service'; UPDATE schedule_leave_mail_settings SET test_recipient='test@example.com' WHERE id=1;");
    const dept=(await pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0].id;
    const add=async(id,status='approved',isTest=false)=>pool.query(`INSERT INTO schedule_leave_requests(id,submission_key,employee_id,employee_name,email,reason,periods,first_date,last_date,status,is_test,department_id,department_name)
      VALUES($1,$2,1,'Camille','employee@example.com','motif privé',$3,'2030-10-18','2030-10-18',$4,$5,$6,'Service')`,[id,`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,JSON.stringify([full]),status,isTest,dept]);
    const due=()=>pool.query("UPDATE schedule_leave_approval_mail SET available_at=clock_timestamp()-interval '1 minute',last_attempt_at=CASE WHEN last_attempt_at IS NULL THEN NULL ELSE clock_timestamp()-interval '3 minutes' END WHERE status IN ('pending','error','sending')");
    const mails=async()=>(await pool.query('SELECT * FROM schedule_leave_approval_mail ORDER BY id')).rows;
    const calls=[];let fail=false;
    const worker=await installApprovalMail(pool,{autoStart:false,fetchImpl:async(url,options)=>{calls.push({url,headers:options.headers,payload:JSON.parse(options.body)});if(fail)throw new Error('simulated timeout');return {ok:true,status:200,json:async()=>({id:'fake-provider-'+calls.length})};}});

    await t.test('aucun rattrapage historique, aucun envoi avant délai, insertion atomique et unique',async()=>{
      await add(1);assert.equal((await mails()).length,0);
      await pool.query('BEGIN');await queueApprovalMail(pool,1);await pool.query('ROLLBACK');assert.equal((await mails()).length,0);
      await queueApprovalMail(pool,1);await queueApprovalMail(pool,1);assert.equal((await mails()).length,1);
      process.env.RESEND_API_KEY='fake-key-for-mocked-provider';await worker.run();assert.equal(calls.length,0);
      await due();await worker.run();assert.equal(calls.length,1);assert.equal((await mails())[0].status,'sent');
      await worker.run();assert.equal(calls.length,1);assert.deepEqual(calls[0].payload.to,['employee@example.com']);
    });
    await t.test('annulation ou version changée empêche l’envoi en attente',async()=>{
      await add(2);await queueApprovalMail(pool,2);await pool.query("UPDATE schedule_leave_requests SET status='pending',version=version+1 WHERE id=2");
      await add(3);await queueApprovalMail(pool,3);await pool.query('UPDATE schedule_leave_requests SET version=version+1 WHERE id=3');
      await due();await worker.run();assert.equal(calls.length,1);assert.deepEqual((await mails()).slice(1).map(r=>r.status),['cancelled','cancelled']);
    });
    await t.test('reprise identique après échec, puis arrêt avant expiration de l’idempotence',async()=>{
      await add(4);await queueApprovalMail(pool,4);await due();fail=true;await worker.run();
      const first=calls.at(-1);assert.equal((await mails()).at(-1).status,'error');
      await pool.query("UPDATE schedule_leave_requests SET email='changed@example.com' WHERE id=4");
      await due();fail=false;await worker.run();assert.deepEqual(calls.at(-1),first);assert.equal((await mails()).at(-1).status,'sent');
      await add(5);await queueApprovalMail(pool,5);await due();fail=true;await worker.run();
      const count=calls.length;await pool.query("UPDATE schedule_leave_approval_mail SET first_attempt_at=clock_timestamp()-interval '21 hours' WHERE request_id=5");
      await due();fail=false;await worker.run();assert.equal(calls.length,count);assert.equal((await mails()).at(-1).status,'review');
    });
    await t.test('tests isolés et adresse invalide bloquée',async()=>{
      await add(6,'approved',true);await queueApprovalMail(pool,6);await due();await worker.run();assert.deepEqual(calls.at(-1).payload.to,['test@example.com']);
      await add(7);await pool.query("UPDATE schedule_leave_requests SET email='invalid' WHERE id=7");await queueApprovalMail(pool,7);
      const count=calls.length;await due();await worker.run();assert.equal(calls.length,count);assert.equal((await mails()).at(-1).status,'review');
    });
    await t.test('route d’approbation crée la confirmation dans sa transaction et expose son état',async()=>{
      process.env.RESEND_API_KEY='';
      await add(8,'pending');await pool.query('UPDATE schedule_leave_requests SET employee_id=2 WHERE id=8');
      const res=response();await routes.get('patch /api/leave/requests/:id').at(-1)({params:{id:8},body:{status:'approved',version:1},headers:{}},res);
      assert.equal(res.code,200);assert.equal(res.body.confirmationQueued,true);
      assert.equal((await mails()).at(-1).request_version,2);
      const list=response();await routes.get('get /api/leave/requests').at(-1)({query:{}},list);
      assert.equal(list.code,200);assert.equal(list.body.requests.find(r=>Number(r.id)===8).confirmation_status,'pending');
      const duplicate=response();await routes.get('patch /api/leave/requests/:id').at(-1)({params:{id:8},body:{status:'approved',version:1},headers:{}},duplicate);
      assert.equal(duplicate.code,409);assert.equal((await mails()).filter(r=>Number(r.request_id)===8).length,1);
    });
    await t.test('API privée : préférence et rapprochement ne modifient ni demande ni horaire',async()=>{
      for(const [method,path] of [['get','/api/employee-contacts'],['put','/api/employee-contacts/:id'],['post','/api/employee-contacts/link']]){
        assert.equal(routes.get(method+' '+path)[0],manager);if(method!=='get')assert.equal(routes.get(method+' '+path)[1],origin);
      }
      const saved=response();await routes.get('put /api/employee-contacts/:id').at(-1)({params:{id:1},body:{email:'chosen@example.com'}},saved);assert.equal(saved.code,200);
      await add(9,'pending');await pool.query("UPDATE schedule_leave_requests SET employee_id=NULL,employee_name='Cami' WHERE id=9");
      const linked=response();await routes.get('post /api/employee-contacts/link').at(-1)({body:{employeeId:1,requestIds:[9]}},linked);assert.equal(linked.code,200);
      const before=(await pool.query('SELECT employee_id,status,version FROM schedule_leave_requests WHERE id=9')).rows[0];assert.equal(before.employee_id,null);assert.equal(before.status,'pending');assert.equal(before.version,1);
      const conflicting=response();await routes.get('post /api/employee-contacts/link').at(-1)({body:{employeeId:2,requestIds:[1]}},conflicting);assert.equal(conflicting.code,400);
      const contacts=await loadContactDirectory(pool);assert.equal(contacts.employees.find(e=>e.id===1).email,'chosen@example.com');assert.equal(contacts.received.some(r=>r.requestIds.includes('6')),false);
      await pool.query('UPDATE schedule_employees SET active=FALSE WHERE id=1');
      const inactive=response();await routes.get('put /api/employee-contacts/:id').at(-1)({params:{id:1},body:{email:'chosen@example.com'}},inactive);assert.equal(inactive.code,404);
      const active=await loadContactDirectory(pool);assert.equal(active.summary.total,1);assert.equal(active.emails.includes('chosen@example.com'),false);
    });
  }finally{if(savedKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=savedKey;await db.close();}
});
