import {installScheduleNotifications} from '../service-schedule-notifications.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {departmentFixture} from './department-fixture.js';
import {installServiceChat} from '../service-chat.js';
import {createServiceChatPush,pushTables} from '../service-chat-push.js';
import {installServicePublications,publishServiceWeek} from '../service-publication.js';

test('schedule alerts: publication, changes, rollback, scope, membership, retries and revocation',async()=>{
  const f=await departmentFixture(),workers=[],sent=[];let failure=null;
  try{
    await installServiceChat(f.app,f.pool,{employeePortal:{},managerAccess:{},sameOrigin(){}});
    await installServicePublications(f.pool);
    const week='2026-10-26';
    await f.pool.query('INSERT INTO schedule_weeks(week_start) VALUES($1)',[week]);
    await f.pool.query("INSERT INTO schedule_public_links(week_start,token,access_code_hash) VALUES($1,$2,'')",[week,'a'.repeat(43)]);
    const employee=(await f.pool.query("INSERT INTO schedule_employees(name,area,role) VALUES('Employé fictif','front','cashier') RETURNING id")).rows[0];
    const person=(await f.pool.query("INSERT INTO schedule_store_people(name,service_employee_id,employee_code) VALUES('Employé fictif',$1,'123456') RETURNING id",[employee.id])).rows[0];
    const guest=(await f.pool.query("INSERT INTO schedule_store_people(name,employee_code) VALUES('Invité fictif','123457') RETURNING id")).rows[0];
    await f.pool.query("INSERT INTO schedule_service_chat_guests(person_id,expires_at) VALUES($1,clock_timestamp()+interval '1 day')",[guest.id]);
    const scopes=['https://quarts-service-iga.onrender.com','https://second.example.test'];
    for(const scope of scopes){
      const worker=await createServiceChatPush(f.pool,{scope,secret:scope,startWorker:false,send:async(sub,payload)=>{if(failure)throw failure;sent.push({scope,payload:JSON.parse(payload),endpoint:sub.endpoint});}});workers.push(worker);
      for(const owner of ['employee:'+person.id,'employee:'+guest.id,'admin']){
        await f.pool.query(`INSERT INTO ${pushTables(scope).subscriptions}(id,owner_key,credential_hash,endpoint_hash,subscription) VALUES($1,$2,$3,$4,$5)`,[crypto.randomUUID(),owner,await worker.credential(owner),owner,JSON.stringify({endpoint:'https://fcm.googleapis.com/'+owner})]);
      }
    }
    const jobs=async()=>Number((await f.pool.query('SELECT count(*) AS n FROM schedule_service_schedule_push_jobs')).rows[0].n);
    const publish=async()=>{const kind=await publishServiceWeek(f.pool,week);if(kind)await workers[0].enqueueSchedule(f.pool,week,kind);return kind;};
    await f.pool.query('BEGIN');assert.equal(await publish(),'published');assert.equal(await jobs(),6);await f.pool.query('ROLLBACK');assert.equal(await jobs(),0);
    assert.equal(await publish(),'published');assert.equal(await publish(),null);assert.equal(await jobs(),6);
    await workers[0].drain();assert.equal(sent.length,2,'active Service employee and administrator, on this origin');assert.equal(await jobs(),3);
    assert.equal(sent[0].payload.kind,'schedule-published');assert.equal(sent[0].payload.week,week);assert.doesNotMatch(JSON.stringify(sent),/Employé fictif|123456/);
    await workers[1].drain();assert.equal(sent.length,4);assert.equal(await jobs(),0);
    assert.ok(await workers[0].credential('employee:'+guest.id),'guest retains chat notifications');
    await f.pool.query("INSERT INTO schedule_shifts(week_start,area,role,day_index,start_minute,end_minute) VALUES($1,'front','cashier',0,480,960)",[week]);
    assert.equal(await jobs(),0,'editing a draft does not notify');assert.equal(await publish(),'updated');
    failure=Object.assign(Error('temporary'),{statusCode:503});await workers[0].drain();assert.equal(sent.length,4);
    failure=null;await f.pool.query('UPDATE schedule_service_schedule_push_jobs SET due_at=clock_timestamp()');await workers[0].drain();assert.equal(sent.at(-1).payload.kind,'schedule-updated');
    await f.pool.query('UPDATE schedule_employees SET active=FALSE WHERE id=$1',[employee.id]);await workers[1].drain();assert.equal(sent.length,7,'revoked employee receives nothing; administrator still receives the notice');assert.equal(await jobs(),0);
    await f.pool.query('UPDATE schedule_employees SET active=TRUE WHERE id=$1',[employee.id]);
    const pass=(_q,_s,next)=>next();
    await installScheduleNotifications(f.app,f.pool,{requireManager:pass,sameOrigin:pass,push:workers[0]});
    const inventory=await f.call('get','/api/weeks/:weekStart/notifications',{params:{weekStart:week}});
    assert.equal(inventory.code,200);assert.deepEqual(inventory.body,{employees:1,managers:1,inactive:1,pending:0,recipients:[{name:'Employé fictif',kind:'employee',devices:1},{name:'Accès gestionnaire partagé',kind:'manager',devices:1}],published:true});
    // Same employee on two devices is one person; manager names are separate.
    await f.pool.query('CREATE TABLE schedule_manager_accounts(id BIGINT PRIMARY KEY,name TEXT,version INTEGER,active BOOLEAN,departments JSONB)');
    const service=(await f.pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0].id;
    await f.pool.query("INSERT INTO schedule_manager_accounts VALUES(7,'Gestionnaire exemple',1,TRUE,$1)",[JSON.stringify([Number(service)])]);
    const extraIds=[];
    for(const owner of ['employee:'+person.id,'manager:7']){
      const id=crypto.randomUUID();extraIds.push(id);
      await f.pool.query(`INSERT INTO ${pushTables(scopes[0]).subscriptions}(id,owner_key,credential_hash,endpoint_hash,subscription) VALUES($1,$2,$3,$4,$5)`,[id,owner,await workers[0].credential(owner),id,JSON.stringify({endpoint:'https://fcm.googleapis.com/'+id})]);
    }
    const named=await workers[0].scheduleInventory(week,{includeRecipients:true});
    assert.equal(named.employees,2);assert.equal(named.managers,2);
    assert.deepEqual(named.recipients,[{name:'Employé fictif',kind:'employee',devices:2},{name:'Accès gestionnaire partagé',kind:'manager',devices:1},{name:'Gestionnaire exemple',kind:'manager',devices:1}]);
    assert.doesNotMatch(JSON.stringify(named),/123456|credential|endpoint|Invité fictif/);
    await f.pool.query('UPDATE schedule_employees SET active=FALSE WHERE id=$1',[employee.id]);
    assert.ok(!(await workers[0].scheduleInventory(week,{includeRecipients:true})).recipients.some(p=>p.kind==='employee'));
    await f.pool.query('UPDATE schedule_employees SET active=TRUE WHERE id=$1',[employee.id]);
    await f.pool.query('UPDATE schedule_manager_accounts SET version=2 WHERE id=7');
    assert.ok(!(await workers[0].scheduleInventory(week,{includeRecipients:true})).recipients.some(p=>p.name==='Gestionnaire exemple'));
    for(const id of extraIds)await f.pool.query(`DELETE FROM ${pushTables(scopes[0]).subscriptions} WHERE id=$1`,[id]);
    // Avoid background work in this fixture; explicit drains below verify publication withdrawal.
    const oldKick=workers[0].kick;workers[0].kick=()=>{};
    const before=(await f.pool.query('SELECT snapshot,published_at FROM schedule_service_publications WHERE week_start=$1',[week])).rows[0];
    const resent=await f.call('post','/api/weeks/:weekStart/notifications',{params:{weekStart:week}});
    assert.equal(resent.code,200);assert.equal(resent.body.queued,3);
    const repeat=await f.call('post','/api/weeks/:weekStart/notifications',{params:{weekStart:week}});assert.equal(repeat.code,429);
    assert.deepEqual((await f.pool.query('SELECT snapshot,published_at FROM schedule_service_publications WHERE week_start=$1',[week])).rows[0],before);
    workers[0].kick=oldKick;
    await workers[0].enqueueSchedule(f.pool,week,'updated');await f.pool.query('DELETE FROM schedule_public_links WHERE week_start=$1',[week]);
    await workers[0].drain();await workers[1].drain();assert.equal(sent.length,7,'withdrawn publication does not notify');assert.equal(await jobs(),0);
  }finally{workers.forEach(w=>w.stop());await f.db.close();}
});

test('phone displays the right schedule notice and opens only its published week',async()=>{
  const handlers={},shown=[],opened=[];
  const self={location:{origin:'https://quarts-service-iga.onrender.com'},addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(title,options)=>shown.push({title,...options})},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
  vm.runInNewContext(readFileSync(new URL('../public/service-chat-sw.js',import.meta.url),'utf8'),{self,URL,Intl,Date});
  for(const kind of ['schedule-published','schedule-updated']){
    let done;handlers.push({data:{json:()=>({kind,week:'2026-10-26',url:'https://evil.test'})},waitUntil:p=>done=p});await done;
    assert.equal(shown.at(-1).title,kind==='schedule-published'?'Nouvel horaire du Service':'Horaire du Service modifié');assert.match(shown.at(-1).body,/26 octobre 2026/);
    handlers.notificationclick({notification:{data:shown.at(-1).data,close(){}},waitUntil:p=>done=p});await done;
    assert.equal(opened.at(-1),'https://quarts-service-iga.onrender.com/horaires-departements?week=2026-10-26');
  }
});

test('phone recipient list escapes names and clears stale names on failed refresh or week change',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const elements=new Map(),$=selector=>{if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:''});return elements.get(selector);};
  const state={weekStart:'2026-10-26'};
  const info={employees:2,managers:0,pending:0,inactive:0,recipients:[{name:'<img src=x onerror=alert(1)>',kind:'employee',devices:2}]};
  const context=vm.createContext({$,state,api:async()=>info});
  vm.runInContext(source.slice(source.indexOf('function escapeHtml('),source.indexOf('\n',source.indexOf('function escapeHtml(')))+'\n'+source.slice(source.indexOf('async function loadPushStatus(){'),source.indexOf("$('#refreshPushStatus').onclick")),context);
  await vm.runInContext('loadPushStatus()',context);
  assert.match($('#schedulePushRecipients').innerHTML,/&lt;img/);
  assert.doesNotMatch($('#schedulePushRecipients').innerHTML,/<img/);
  assert.match($('#schedulePushRecipients').innerHTML,/2 téléphone/);
  context.api=async()=>{throw Error('Hors connexion');};
  await vm.runInContext('loadPushStatus()',context);
  assert.equal($('#schedulePushRecipients').innerHTML,'');
  assert.equal($('#schedulePushStatus').textContent,'Hors connexion');
  let resolve;context.api=()=>new Promise(r=>resolve=r);
  const pending=vm.runInContext('loadPushStatus()',context);state.weekStart='2026-11-02';resolve(info);await pending;
  assert.equal($('#schedulePushRecipients').innerHTML,'');
});
