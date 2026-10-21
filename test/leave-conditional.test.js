import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installLeave,approvedLeave} from '../leave.js';
import {installUndoSchema,undoLast} from '../undo.js';
import {employeeNoticePayload,installEmployeeNotices} from '../leave-employee-notices.js';
import {installApprovalMail} from '../leave-approval-mail.js';

const period={date:'2030-10-18',allDay:true,startMinute:0,endMinute:1440};
const conditions='Trouver un remplacement.\nInformer la gestion <avant> de vous absenter.';
test('courriel conditionnel : conditions exactes, horaire maintenu, validation explicite et test isolé',()=>{
  const job={kind:'conditional',request_id:42,snapshot:{employee_name:'Camille <Exemple>',email:'employee@example.com',recipient:'manager@example.com',periods:[period],department_name:'Service',decision_note:conditions,reason:'motif privé'}};
  const payload=employeeNoticePayload(job);
  assert.match(payload.subject,/SOUS CONDITIONS/);assert.ok(payload.text.includes(conditions));
  assert.match(payload.text,/congé n’est pas encore confirmé/);assert.match(payload.text,/horaire actuel reste en vigueur/);assert.match(payload.text,/confirmation finale/);
  assert.match(payload.html,/Camille &lt;Exemple&gt;/);assert.match(payload.html,/remplacement.<br>Informer la gestion &lt;avant&gt;/);
  assert.doesNotMatch(payload.text,/motif privé/);assert.deepEqual(payload.to,['employee@example.com']);assert.equal(payload.reply_to,'manager@example.com');
  const fake=employeeNoticePayload({...job,snapshot:{...job.snapshot,is_test:true}},{testRecipient:'test@example.com'});
  assert.deepEqual(fake.to,['test@example.com']);assert.equal(fake.reply_to,undefined);assert.doesNotMatch(fake.html,/mailto:/);assert.match(fake.subject,/^\[TEST\]/);
  assert.throws(()=>employeeNoticePayload({...job,snapshot:{...job.snapshot,decision_note:''}}),/conditions/);
});

const response=()=>({code:200,body:null,set(){return this;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
test('PostgreSQL : accord conditionnel, migration, validation finale, refus et retour Annuler',async t=>{
  const db=new PGlite(),pool={release(){},async query(sql,args){const r=args?await db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};return {...r,rowCount:r.affectedRows??r.rows.length};}};pool.connect=async()=>pool;
  const oldKey=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='';
  try{
    const source=readFileSync(new URL('../server.js',import.meta.url),'utf8'),ddl=source.slice(source.indexOf('await pool.query(`'),source.indexOf('app.disable('));
    await new Function('pool','return (async()=>{'+ddl+'})();')(pool);
    const routes=new Map(),app={use(){}};for(const verb of ['get','post','put','patch'])app[verb]=(path,...handlers)=>routes.set(verb+' '+path,handlers);
    const manager=()=>{},origin=()=>{};
    const install=async()=>{const timer=globalThis.setInterval;globalThis.setInterval=()=>({unref(){}});try{await installLeave(app,pool,{requireManager:manager,sameOrigin:origin,hasStaffAccess:()=>false});}finally{globalThis.setInterval=timer;}};
    await install();await installUndoSchema(pool);
    await pool.query(`INSERT INTO schedule_employees(id,name,area,role) VALUES(1,'Camille','front','cashier'),(2,'Autre','front','cashier');
      INSERT INTO schedule_weeks(week_start) VALUES('2030-10-14');
      INSERT INTO schedule_shifts(id,week_start,area,role,day_index,start_minute,end_minute) VALUES(1,'2030-10-14','front','cashier',4,480,960),(2,'2030-10-14','front','cashier',4,480,960),(3,'2030-10-14','front','cashier',5,480,960);
      INSERT INTO schedule_assignments(shift_id,employee_id) VALUES(1,1),(2,2),(3,1);
      UPDATE schedule_leave_departments SET recipient='manager@example.com',mail_enabled=FALSE;
      UPDATE schedule_leave_mail_settings SET test_recipient='test@example.com' WHERE id=1;`);
    const dept=(await pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0].id;
    const add=async(id,status='pending',isTest=false)=>{await pool.query(`INSERT INTO schedule_leave_requests(id,submission_key,employee_name,email,reason,periods,first_date,last_date,status,is_test,department_id,department_name)
      VALUES($1,$2,'Camille','employee@example.com','motif privé',$3,'2030-10-18','2030-10-18',$4,$5,$6,'Service')`,[id,`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,JSON.stringify([period]),status,isTest,dept]);await pool.query('INSERT INTO schedule_leave_events(request_id,status) VALUES($1,$2)',[id,status]);};
    const call=async(method,path,req={})=>{process.env.RESEND_API_KEY='';const res=response();await routes.get(method+' '+path).at(-1)({body:{},params:{},query:{},headers:{},...req},res);return res;};
    const decide=(id,body)=>call('patch','/api/leave/requests/:id',{params:{id},body});
    const request=async id=>(await pool.query('SELECT * FROM schedule_leave_requests WHERE id=$1',[id])).rows[0];
    const assignments=async()=>(await pool.query('SELECT shift_id,employee_id FROM schedule_assignments ORDER BY shift_id')).rows;
    const initial=await assignments();
    const notices=async id=>(await pool.query('SELECT * FROM schedule_leave_employee_notices WHERE request_id=$1 ORDER BY id',[id])).rows;
    const approvals=async id=>(await pool.query('SELECT * FROM schedule_leave_approval_mail WHERE request_id=$1 ORDER BY id',[id])).rows;
    const undo=async()=>{const id=(await pool.query('SELECT MAX(id) AS id FROM schedule_undo_actions')).rows[0].id;await pool.query('BEGIN');await undoLast(pool,id);await pool.query('COMMIT');};
    const sends=[];
    const worker=await installEmployeeNotices(pool,{autoStart:false,fetchImpl:async(_url,opt)=>{sends.push(JSON.parse(opt.body));return {ok:true,json:async()=>({id:'mock-'+sends.length})};}});
    const approvalWorker=await installApprovalMail(pool,{autoStart:false,fetchImpl:async(_url,opt)=>{sends.push(JSON.parse(opt.body));return {ok:true,json:async()=>({id:'mock-'+sends.length})};}});
    const run=async()=>{await pool.query("UPDATE schedule_leave_employee_notices SET available_at=clock_timestamp()-interval '1 minute'; UPDATE schedule_leave_approval_mail SET available_at=clock_timestamp()-interval '1 minute'");process.env.RESEND_API_KEY='mock-only';try{await worker.run();await approvalWorker.run();}finally{process.env.RESEND_API_KEY='';}};

    await t.test('migration de contraintes existantes : conserve les demandes et les avis, réexécutable',async()=>{
      await add(1,'late');
      await pool.query(`INSERT INTO schedule_leave_employee_notices(request_id,request_version,kind,snapshot,status) VALUES(1,1,'late','{}','sent');
        ALTER TABLE schedule_leave_requests DROP CONSTRAINT schedule_leave_requests_status_check;
        ALTER TABLE schedule_leave_requests ADD CONSTRAINT schedule_leave_requests_status_check CHECK(status IN('pending','approved','refused','cancelled','late'));
        ALTER TABLE schedule_leave_employee_notices DROP CONSTRAINT schedule_leave_employee_notices_kind_check;
        ALTER TABLE schedule_leave_employee_notices ADD CONSTRAINT schedule_leave_employee_notices_kind_check CHECK(kind IN('late','refused'));`);
      const before=await request(1);await install();await install();assert.deepEqual(await request(1),before);assert.equal((await notices(1)).length,1);
    });
    await t.test('accord motivé sans liaison : aucun changement d’horaire ni congé définitif',async()=>{
      assert.deepEqual(routes.get('patch /api/leave/requests/:id').slice(0,2),[manager,origin]);
      const missing=await decide(1,{status:'conditional',version:1});assert.equal(missing.code,400);assert.match(missing.body.error,/conditions/);
      const result=await decide(1,{status:'conditional',version:1,note:conditions});assert.equal(result.code,200,JSON.stringify(result.body));assert.equal(result.body.releasedShifts,0);assert.equal(result.body.confirmationQueued,true);
      assert.equal((await request(1)).employee_id,null);assert.equal((await request(1)).effective_periods,null);
      assert.deepEqual(await assignments(),initial);assert.deepEqual(await approvedLeave(pool,'2030-10-14'),[]);assert.deepEqual(await approvals(1),[]);
      assert.equal((await notices(1)).at(-1).snapshot.decision_note,conditions);
      assert.equal((await decide(1,{status:'conditional',version:1,note:conditions})).code,409);
      const list=await call('get','/api/leave/requests');assert.equal(list.body.requests[0].conditional_notice_status,'pending');assert.equal(list.body.statistics.conditional,1);assert.equal(list.body.statistics.fullDays,0);
      const preview=await call('get','/api/leave/reset-preview');assert.equal(preview.body.allowed,false);
      assert.equal((await call('post','/api/leave/reset',{body:{ids:[1]}})).code,409);
    });
    await t.test('modification des conditions : ancienne version arrêtée et nouvelles conditions transmises',async()=>{
      const updated=conditions+'\nFaire un suivi avant jeudi.';
      assert.equal((await decide(1,{status:'conditional',version:2,note:updated})).code,200);await run();
      assert.deepEqual((await notices(1)).map(n=>n.status),['sent','cancelled','sent']);assert.equal(sends.length,1);assert.ok(sends[0].text.includes(updated));
      assert.deepEqual(await assignments(),initial);
    });
    await t.test('validation finale explicite et liaison exigées avant de libérer seulement les quarts en conflit',async()=>{
      for(const value of [undefined,false,'true'])assert.equal((await decide(1,{status:'approved',version:3,employeeId:1,conditionsConfirmed:value})).code,400);
      assert.deepEqual(await assignments(),initial);assert.equal((await decide(1,{status:'approved',version:3,conditionsConfirmed:true})).code,400);
      const final=await decide(1,{status:'approved',version:3,conditionsConfirmed:true,employeeId:1});assert.equal(final.code,200,JSON.stringify(final.body));assert.equal(final.body.releasedShifts,1);
      assert.deepEqual(await assignments(),initial.filter(a=>a.shift_id!==1));assert.equal((await approvedLeave(pool,'2030-10-14')).length,1);assert.equal((await approvals(1)).length,1);
      const events=(await pool.query('SELECT note FROM schedule_leave_events WHERE request_id=1')).rows;assert.ok(events.some(e=>e.note.includes('Validation finale')));
      await undo();assert.equal((await request(1)).status,'conditional');assert.deepEqual(await assignments(),initial);await run();assert.equal(sends.length,1);assert.equal((await approvals(1))[0].status,'cancelled');
      const again=await decide(1,{status:'approved',version:(await request(1)).version,conditionsConfirmed:true,employeeId:1});assert.equal(again.code,200);await run();assert.equal(sends.length,2);assert.doesNotMatch(sends.at(-1).subject,/SOUS CONDITIONS/);
    });
    await t.test('refus et annulation sous conditions : arrêt des conditions en attente, raison exacte du refus',async()=>{
      await add(2);assert.equal((await decide(2,{status:'conditional',version:1,note:conditions})).code,200);
      assert.equal((await decide(2,{status:'refused',version:2})).code,400);
      assert.equal((await decide(2,{status:'refused',version:2,note:'Aucun remplacement disponible.'})).code,200);await run();
      assert.deepEqual((await notices(2)).map(n=>n.status),['cancelled','sent']);assert.match(sends.at(-1).text,/Aucun remplacement disponible/);
      await add(3);await decide(3,{status:'conditional',version:1,note:conditions});const before=sends.length;
      assert.equal((await decide(3,{status:'cancelled',version:2,note:'Retrait de la demande.'})).code,200);await run();assert.equal(sends.length,before);assert.equal((await notices(3))[0].status,'cancelled');
    });
    await t.test('approbation directe sans condition et mode test conservent leur fonctionnement',async()=>{
      await add(4,'pending',true);assert.equal((await decide(4,{status:'conditional',version:1,note:conditions})).code,200);const before=await assignments();await run();assert.deepEqual(sends.at(-1).to,['test@example.com']);
      assert.equal((await decide(4,{status:'approved',version:2,conditionsConfirmed:true})).code,200);assert.deepEqual(await assignments(),before);
      await add(5);assert.equal((await decide(5,{status:'approved',version:1,employeeId:2})).code,200);assert.equal((await request(5)).status,'approved');
    });
    await t.test('dates corrigées : validation atomique, historique, horaire, courriel et annulation',async()=>{
      await add(20,'conditional');
      const periods=[{startDate:'2030-10-19',endDate:'2030-10-19',allDay:true}];
      const body={status:'approved',version:1,employeeId:1,conditionsConfirmed:true,periods};
      const before=await request(20),assigned=await assignments();
      for(const invalid of [[],[{...periods[0],startDate:'2030-02-30'}],[periods[0],periods[0]],[{...periods[0],allDay:false,startTime:'13:00',endTime:'12:00'}]]){
        assert.equal((await decide(20,{...body,periods:invalid})).code,400);
        assert.deepEqual(await request(20),before);
      }
      assert.equal((await decide(20,{...body,version:0})).code,409);
      const result=await decide(20,body);assert.equal(result.code,200,JSON.stringify(result.body));
      assert.equal(result.body.releasedShifts,1);
      assert.deepEqual(await assignments(),assigned.filter(a=>a.shift_id!==3));
      const corrected=await request(20);assert.equal(corrected.periods[0].date,'2030-10-19');assert.deepEqual(corrected.effective_periods,corrected.periods);
      const dates=(await pool.query('SELECT first_date::text,last_date::text FROM schedule_leave_requests WHERE id=20')).rows[0];assert.deepEqual(dates,{first_date:'2030-10-19',last_date:'2030-10-19'});
      const history=(await pool.query('SELECT note FROM schedule_leave_events WHERE request_id=20')).rows;
      assert.ok(history.some(e=>e.note.includes('Avant : 2030-10-18')&&e.note.includes('Après : 2030-10-19')));
      await run();assert.match(sends.at(-1).text,/19 octobre 2030/);assert.doesNotMatch(sends.at(-1).text,/18 octobre 2030/);
      await undo();assert.deepEqual((await request(20)).periods,before.periods);assert.deepEqual(await assignments(),assigned);
      const version=(await request(20)).version;
      assert.equal((await decide(20,{status:'conditional',version,note:conditions,periods:[{...periods[0],allDay:false,startTime:'12:30',endTime:'13:30'}]})).code,200);
      assert.deepEqual(await assignments(),assigned);
      assert.deepEqual((await notices(20)).at(-1).snapshot.periods,[{date:'2030-10-19',allDay:false,startMinute:750,endMinute:810}]);
    });
  }finally{if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;await db.close();}
});
