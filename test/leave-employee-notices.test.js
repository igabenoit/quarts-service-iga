import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {installLeave} from '../leave.js';
import {installUndoSchema,undoLast} from '../undo.js';
import {localDate,earliestLeaveDate} from '../public/leave-calendar.js';
import {employeeNoticePayload,installEmployeeNotices,queueEmployeeNotice} from '../leave-employee-notices.js';

const snapshot={employee_name:'Camille <Exemple>',email:'employee@example.com',recipient:'manager@example.com',is_test:false,department_name:'Service',submitted_at:'2026-10-11T23:07:00Z',periods:[{date:'2026-10-16',allDay:true,startMinute:0,endMinute:1440}],decision_note:'Effectif insuffisant.\n<script>alert("non")</script>',was_late:true,reason:'motif privé à ne pas partager'};
test('avis lisibles en HTML et texte : échéance réelle, raison exacte échappée et destinataire unique',()=>{
  const late=employeeNoticePayload({kind:'late',request_id:26,snapshot});
  assert.match(late.subject,/HORS DÉLAI/);assert.match(late.text,/jeudi 8 octobre 2026, avant 9 h/);assert.match(late.text,/dimanche 11 octobre 2026 à 19 h 07/);
  assert.match(late.html,/DÉLAI DÉPASSÉ/);assert.match(late.html,/Camille &lt;Exemple&gt;/);assert.doesNotMatch(late.text,/Effectif insuffisant|motif privé/);
  const refused=employeeNoticePayload({kind:'refused',request_id:26,snapshot});
  assert.ok(refused.text.includes(snapshot.decision_note));assert.match(refused.html,/Effectif insuffisant.<br>&lt;script&gt;/);assert.doesNotMatch(refused.html,/<script>/);
  assert.doesNotMatch(refused.text,/motif privé/);assert.deepEqual(refused.to,['employee@example.com']);assert.equal(refused.reply_to,'manager@example.com');assert.equal(refused.cc,undefined);
  const onTime=employeeNoticePayload({kind:'refused',request_id:27,snapshot:{...snapshot,was_late:false}});assert.doesNotMatch(onTime.text,/déposée hors délai/);
  const winter=employeeNoticePayload({kind:'late',request_id:28,snapshot:{...snapshot,periods:[{...snapshot.periods[0],date:'2027-01-04'}],submitted_at:'2026-12-31T14:00:00Z'}});
  assert.match(winter.text,/jeudi 31 décembre 2026, avant 9 h/);assert.match(winter.text,/à 0?9 h 00/);
  const fake=employeeNoticePayload({kind:'refused',request_id:29,snapshot:{...snapshot,is_test:true}},{testRecipient:'test@example.com'});
  assert.deepEqual(fake.to,['test@example.com']);assert.equal(fake.reply_to,undefined);assert.doesNotMatch(fake.html,/mailto:/);assert.match(fake.subject,/^\[TEST\]/);
  assert.throws(()=>employeeNoticePayload({kind:'refused',request_id:26,snapshot:{...snapshot,decision_note:''}}),/raison/);
});

const response=()=>({code:200,body:null,set(){return this;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
test('PostgreSQL : avis automatiques atomiques, refus annulable, reprises figées et anciens avis explicites',async t=>{
  const db=new PGlite(),pool={release(){},async query(sql,args){const r=args?await db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};return {...r,rowCount:r.affectedRows??r.rows.length};}};pool.connect=async()=>pool;
  const priorKey=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='';
  try{
    const source=readFileSync(new URL('../server.js',import.meta.url),'utf8'),ddl=source.slice(source.indexOf('await pool.query(`'),source.indexOf('app.disable('));
    await new Function('pool','return (async()=>{'+ddl+'})();')(pool);
    const routes=new Map(),app={use(){}};for(const verb of ['get','post','put','patch'])app[verb]=(path,...handlers)=>routes.set(verb+' '+path,handlers);
    const manager=()=>{},origin=()=>{},timer=globalThis.setInterval;globalThis.setInterval=()=>({unref(){}});
    try{await installLeave(app,pool,{requireManager:manager,sameOrigin:origin,hasStaffAccess:()=>false});}finally{globalThis.setInterval=timer;}
    await installUndoSchema(pool);
    await pool.query("UPDATE schedule_leave_departments SET recipient='manager@example.com',mail_enabled=FALSE; UPDATE schedule_leave_mail_settings SET test_recipient='test@example.com' WHERE id=1;");
    const dept=(await pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0].id;
    const now=(await pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const body=(date,overrides={})=>({submissionKey:randomUUID(),departmentId:Number(dept),employeeName:'Camille Exemple',email:'employee@example.com',reason:'motif confidentiel',periods:[{startDate:date,endDate:date,allDay:true}],...overrides});
    const call=async(method,url,req={})=>{process.env.RESEND_API_KEY='';const res=response();await routes.get(method+' '+url).at(-1)({body:{},params:{},query:{},headers:{},...req},res);return res;};
    const notices=async()=>(await pool.query('SELECT * FROM schedule_leave_employee_notices ORDER BY id')).rows;
    const due=()=>pool.query("UPDATE schedule_leave_employee_notices SET available_at=clock_timestamp()-interval '1 minute',last_attempt_at=CASE WHEN last_attempt_at IS NULL THEN NULL ELSE clock_timestamp()-interval '3 minutes' END WHERE status IN ('pending','error','sending')");
    const sends=[];let fail=false;
    const worker=await installEmployeeNotices(pool,{autoStart:false,fetchImpl:async(_url,options)=>{sends.push({headers:options.headers,payload:JSON.parse(options.body)});if(fail)throw Error('network failure');return {ok:true,json:async()=>({id:'mock-'+sends.length})};}});
    const run=async()=>{process.env.RESEND_API_KEY='mock-only';try{await worker.run();}finally{process.env.RESEND_API_KEY='';}};
    let lateId,onTimeId;
    await t.test('soumission tardive crée un seul avis; une demande à temps n’en crée aucun',async()=>{
      const b=body(localDate(now));const late=await call('post','/api/leave/submit',{body:b});assert.equal(late.code,422,JSON.stringify(late.body));lateId=late.body.id;
      assert.match(late.body.message,/avis de retard/);assert.equal((await notices()).length,1);
      assert.equal((await call('post','/api/leave/submit',{body:b})).code,422);assert.equal((await notices()).length,1);
      const normal=await call('post','/api/leave/submit',{body:body(earliestLeaveDate(now))});assert.equal(normal.code,201);onTimeId=normal.body.id;assert.equal((await notices()).length,1);
      await run();assert.equal(sends.length,0);await due();await run();assert.equal(sends.length,1);assert.deepEqual(sends[0].payload.to,['employee@example.com']);
      await run();assert.equal(sends.length,1);assert.equal((await notices())[0].status,'sent');
    });
    await t.test('refus sans raison rejeté; raison communiquée exacte et refus annulé avant envoi arrêté',async()=>{
      assert.equal((await call('patch','/api/leave/requests/:id',{params:{id:onTimeId},body:{status:'refused',version:1}})).code,400);
      const note='Notre effectif est insuffisant pour ces dates.\nMerci de contacter la gestion.';
      const refused=await call('patch','/api/leave/requests/:id',{params:{id:onTimeId},body:{status:'refused',version:1,note}});assert.equal(refused.code,200);assert.equal(refused.body.confirmationQueued,true);
      const record=(await notices()).at(-1);assert.equal(record.kind,'refused');assert.equal(record.snapshot.decision_note,note);assert.equal(record.snapshot.reason,undefined);
      const action=(await pool.query('SELECT MAX(id) AS id FROM schedule_undo_actions')).rows[0].id;
      await pool.query('BEGIN');await undoLast(pool,action);await pool.query('COMMIT');await due();await run();
      assert.equal(sends.length,1);assert.equal((await notices()).at(-1).status,'cancelled');
      const current=(await pool.query('SELECT version FROM schedule_leave_requests WHERE id=$1',[onTimeId])).rows[0];
      await call('patch','/api/leave/requests/:id',{params:{id:onTimeId},body:{status:'refused',version:current.version,note}});await due();await run();
      assert.ok(sends.at(-1).payload.text.includes(note));assert.match(sends.at(-1).payload.subject,/REFUS/);assert.equal(sends.length,2);
      const list=await call('get','/api/leave/requests');assert.equal(list.body.requests.find(r=>r.id===onTimeId).refusal_notice_status,'sent');
    });
    await t.test('avis de retard conserve sa valeur factuelle si un refus est enregistré avant l’envoi',async()=>{
      const late=await call('post','/api/leave/submit',{body:body(localDate(now),{email:'other@example.com'})});
      await call('patch','/api/leave/requests/:id',{params:{id:late.body.id},body:{status:'refused',version:1,note:'Effectif insuffisant.'}});
      const before=sends.length;await due();await run();assert.equal(sends.length,before+2);
      assert.match(sends.at(-2).payload.subject,/HORS DÉLAI/);assert.match(sends.at(-1).payload.subject,/REFUS/);
      assert.match(sends.at(-2).payload.text,/ne constitue pas une décision/);assert.match(sends.at(-1).payload.text,/aussi été déposée hors délai/);
    });
    await t.test('reprise identique et arrêt après 20 h; tests envoyés uniquement au destinataire de test',async()=>{
      const fake=await call('post','/api/leave/test-requests',{body:body(localDate(now),{email:'not-used@example.com'})});assert.equal(fake.code,422);
      await due();fail=true;await run();const first=structuredClone(sends.at(-1));assert.equal((await notices()).at(-1).status,'error');
      await pool.query("UPDATE schedule_leave_requests SET email='changed@example.com' WHERE id=$1",[fake.body.id]);
      await due();fail=false;await run();assert.deepEqual(sends.at(-1),first);assert.deepEqual(first.payload.to,['test@example.com']);
      const second=await call('post','/api/leave/test-requests',{body:body(localDate(now))});await due();fail=true;await run();
      await pool.query("UPDATE schedule_leave_employee_notices SET first_attempt_at=clock_timestamp()-interval '21 hours' WHERE request_id=$1",[second.body.id]);
      const count=sends.length;await due();fail=false;await run();assert.equal(sends.length,count);assert.equal((await notices()).at(-1).status,'review');
    });
    await t.test('anciens avis : aucune reprise au démarrage, action privée explicite et idempotente',async()=>{
      const b=body(localDate(now));
      const saved=(await pool.query(`INSERT INTO schedule_leave_requests(submission_key,employee_name,email,reason,periods,first_date,last_date,status,department_id,department_name)
        VALUES($1,'Historique','old@example.com','privé',$2::jsonb,$3,$3,'late',$4,'Service') RETURNING id`,[b.submissionKey,JSON.stringify([{...snapshot.periods[0],date:localDate(now)}]),localDate(now),dept])).rows[0];
      await installEmployeeNotices(pool,{autoStart:false});assert.equal((await notices()).some(n=>n.request_id===saved.id),false);
      const handlers=routes.get('post /api/leave/requests/:id/late-notice');assert.deepEqual(handlers.slice(0,2),[manager,origin]);
      assert.equal((await call('post','/api/leave/requests/:id/late-notice',{params:{id:saved.id},body:{version:99}})).code,409);
      await pool.query('BEGIN');assert.equal(await queueEmployeeNotice(pool,saved.id,'late'),true);await pool.query('ROLLBACK');assert.equal((await notices()).some(n=>n.request_id===saved.id),false);
      const sent=await call('post','/api/leave/requests/:id/late-notice',{params:{id:saved.id},body:{version:1}});assert.equal(sent.body.queued,true);
      const again=await call('post','/api/leave/requests/:id/late-notice',{params:{id:saved.id},body:{version:1}});assert.equal(again.body.queued,false);
      await pool.query('UPDATE schedule_leave_requests SET archived_at=clock_timestamp() WHERE id=$1',[saved.id]);await due();const before=sends.length;await run();assert.equal(sends.length,before);assert.equal((await notices()).at(-1).status,'cancelled');
    });
  }finally{if(priorKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=priorKey;await db.close();}
});
