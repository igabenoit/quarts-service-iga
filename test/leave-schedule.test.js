import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseLeaveConflicts} from '../leave-schedule.js';
import {installLeave} from '../leave.js';
import {uncoveredLeavePeriods, leaveStatistics} from '../leave-rules.js';

const period=(date,startMinute=0,endMinute=1440)=>({date,startMinute,endMinute,allDay:startMinute===0&&endMinute===1440});
const assignment=(id,day,start=480,end=1020,week='2026-10-12')=>({id:String(id),week_start:week,day_index:day,start_minute:start,end_minute:end,employee_id:'7',request_id:'20',periods:[period('2026-10-17')]});
function clientFor(rows,{failDelete=false}={}) {
  const remaining=new Map(rows.map(r=>[r.id,r]));
  const calls=[];
  return {remaining,calls,release(){},async query(sql,args=[]){
    calls.push({sql,args});
    if(sql.startsWith('INSERT INTO schedule_undo_actions'))return {rows:[{id:'1'}]};
    if(sql.includes('FROM schedule_assignments a')){
      assert.match(sql,/r.status='approved' AND r.is_test=FALSE AND r.archived_at IS NULL/);
      assert.match(sql,/r.employee_id=a.employee_id/);
      assert.match(sql,/FOR UPDATE OF a/);
      return {rows:[...remaining.values()].filter(r=>(!args[0]||r.week_start===args[0])&&(!args[1]||r.request_id===String(args[1])))};
    }
    if(sql.startsWith('DELETE FROM schedule_assignments')){
      if(failDelete)throw new Error('Simulated database error');
      const deleted=args[0].filter(id=>remaining.delete(id)).map(shift_id=>({shift_id}));
      return {rows:deleted};
    }
    return {rows:[]};
  }};
}
test('un congé libère seulement le quart chevauché, pas les quarts avant/après ni les autres semaines',async()=>{
  const rows=[assignment(1,5),assignment(2,4),assignment(3,5,480,600),assignment(4,5,720,1020),assignment(5,5,480,1020,'2026-10-19')];
  for(const r of rows)r.periods=[period('2026-10-17',600,720),period('2026-10-24')];
  const client=clientFor(rows);
  const released=await releaseLeaveConflicts(client,{weekStart:'2026-10-12'});
  assert.deepEqual(released.map(s=>s.shiftId),[1]);
  assert.deepEqual([...client.remaining.keys()],['2','3','4','5']);
  assert.equal(client.calls.filter(c=>c.sql.startsWith('INSERT INTO schedule_leave_events')).length,1);
  assert.deepEqual(await releaseLeaveConflicts(client,{weekStart:'2026-10-12'}),[]);
});
test('une approbation multisemaine est limitée à cette demande',async()=>{
  const a=assignment(1,5),b=assignment(2,5,480,1020,'2026-10-19'),other=assignment(3,5);
  a.periods=b.periods=[period('2026-10-17'),period('2026-10-24')];other.request_id='21';other.employee_id='8';
  const client=clientFor([a,b,other]);
  assert.deepEqual((await releaseLeaveConflicts(client,{requestId:'20'})).map(s=>s.shiftId),[1,2]);
  assert.deepEqual([...client.remaining.keys()],['3']);
});
test('une portée explicite est obligatoire et une erreur de retrait remonte au gestionnaire de transaction',async()=>{
  await assert.rejects(releaseLeaveConflicts(clientFor([])),/semaine ou une demande/);
  await assert.rejects(releaseLeaveConflicts(clientFor([assignment(1,5)],{failDelete:true}),{requestId:'20'}),/database error/);
});

async function routesFor(client,{status='pending',isTest=false,version=1,periods=[period('2026-10-17')],other=[]}={}){
  const routes=new Map();
  const app={use(){}};
  for(const verb of ['get','post','put','patch'])app[verb]=(path,...handlers)=>routes.set(`${verb} ${path}`,handlers);
  const original=client.query.bind(client);
  client.query=async(sql,args)=>{
    if(sql.startsWith('SELECT * FROM schedule_leave_requests WHERE id='))return {rows:[{id:'20',employee_id:'7',department_id:'1',version,status,is_test:isTest,periods,first_date:periods[0].date,last_date:periods.at(-1).date}]};
    if(sql.startsWith('SELECT COALESCE(effective_periods, periods)')){
      assert.match(sql,/employee_id=\$1/);
      assert.match(sql,/archived_at IS NULL/);
      return {rows:other};
    }
    if(sql.startsWith('UPDATE schedule_leave_requests SET effective_periods=')){
      for(const r of client.remaining.values())if(r.request_id===args[1])r.periods=JSON.parse(args[0]);
    }
    if(sql.startsWith('SELECT code FROM schedule_leave_departments'))return {rows:[{code:'service'}]};
    return original(sql,args);
  };
  const manager=()=>{},origin=()=>{};
  // Disable notification timers: tests must never send mail.
  const interval=globalThis.setInterval;
  globalThis.setInterval=()=>({unref(){}});
  const mailKey=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='';
  try{await installLeave(app,{query:async()=>({rows:[]}),connect:async()=>client},{requireManager:manager,sameOrigin:origin,hasStaffAccess:()=>false});}
  finally{globalThis.setInterval=interval;if(mailKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=mailKey;}
  return {routes,manager,origin};
}
function response(){return {code:200,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}

test('ajout du 18 à un congé du 17 : seul le quart du 18 de 11 h 15 à 17 h 15 est libéré',async()=>{
  const client=clientFor([assignment(1,5),assignment(2,6,675,1035),assignment(3,4)]);
  const periods=[period('2026-10-17'),period('2026-10-18')];
  const {routes}=await routesFor(client,{periods,other:[{periods:[period('2026-10-17')]}]});
  const res=response();await routes.get('patch /api/leave/requests/:id').at(-1)({params:{id:'20'},body:{status:'approved',version:1}},res);
  assert.equal(res.code,200);assert.equal(res.body.releasedShifts,1);
  assert.deepEqual([...client.remaining.keys()],['1','3']);
  const saved=client.calls.find(c=>c.sql.startsWith('UPDATE schedule_leave_requests SET effective_periods='));
  assert.deepEqual(JSON.parse(saved.args[0]),[period('2026-10-18')]);
  assert.equal(client.calls.at(-1).sql,'COMMIT');
});

test('une demande entièrement couverte explique le doublon sans modifier les quarts',async()=>{
  const client=clientFor([assignment(1,5)]);
  const {routes}=await routesFor(client,{other:[{periods:[period('2026-10-17')]}]});
  const res=response();await routes.get('patch /api/leave/requests/:id').at(-1)({params:{id:'20'},body:{status:'approved',version:1}},res);
  assert.equal(res.code,409);assert.match(res.body.error,/déjà approuvées/);
  assert.equal(client.calls.some(c=>c.sql.startsWith('UPDATE')||c.sql.startsWith('DELETE')),false);
  assert.equal(client.calls.at(-1).sql,'ROLLBACK');
});

test('les chevauchements partiels et multiples conservent exactement les heures supplémentaires',()=>{
  const requested=[period('2026-10-18',480,1020)];
  const covered=[period('2026-10-18',600,720),period('2026-10-18',660,780),period('2026-10-18',900,1020),period('2026-10-17')];
  assert.deepEqual(uncoveredLeavePeriods(requested,covered),[period('2026-10-18',480,600),period('2026-10-18',780,900)]);
  assert.deepEqual(requested,[period('2026-10-18',480,1020)]);
  assert.deepEqual(uncoveredLeavePeriods(requested,[period('2026-10-18',1020,1080)]),requested);
});

test('les statistiques comptent les périodes ajoutées sans doubler le 17',()=>{
  const base={status:'approved',employee_name:'Raphaël',email:'r@example.com',department_name:'Service'};
  const result=leaveStatistics([{...base,periods:[period('2026-10-17')]},{...base,periods:[period('2026-10-17'),period('2026-10-18')],effective_periods:[period('2026-10-18')]}]);
  assert.equal(result.fullDays,2);
});
test('approbation et libération sont atomiques, protégées, avec compte rendu',async()=>{
  const client=clientFor([assignment(1,5),assignment(2,4)]);
  const {routes,manager,origin}=await routesFor(client);
  const handlers=routes.get('patch /api/leave/requests/:id');
  assert.deepEqual(handlers.slice(0,2),[manager,origin]);
  const res=response();await handlers.at(-1)({params:{id:'20'},body:{status:'approved',version:1}},res);
  assert.equal(res.code,200);assert.equal(res.body.releasedShifts,1);
  assert.deepEqual([...client.remaining.keys()],['2']);
  const sql=client.calls.map(c=>c.sql);
  assert.equal(sql[0],'BEGIN');assert.match(sql[1],/pg_advisory_xact_lock/);
  assert.ok(sql.findIndex(s=>s.startsWith('UPDATE schedule_leave_requests SET status'))<sql.findIndex(s=>s.startsWith('DELETE FROM schedule_assignments')));
  assert.equal(sql.at(-1),'COMMIT');
});
test('échec de libération : rollback de la décision, aucun succès annoncé',async()=>{
  const client=clientFor([assignment(1,5)],{failDelete:true});const {routes}=await routesFor(client);
  const res=response();await routes.get('patch /api/leave/requests/:id').at(-1)({params:{id:'20'},body:{status:'approved',version:1}},res);
  assert.equal(res.code,500);assert.equal(client.calls.at(-1).sql,'ROLLBACK');
  assert.equal(client.calls.some(c=>c.sql==='COMMIT'),false);
});
test('tests, annulations et versions périmées ne retirent pas les affectations',async()=>{
  for(const options of [{isTest:true},{status:'approved',decision:'cancelled'},{version:2}]){
    const client=clientFor([assignment(1,5)]);const {routes}=await routesFor(client,options);
    const res=response();await routes.get('patch /api/leave/requests/:id').at(-1)({params:{id:'20'},body:{status:options.decision||'approved',version:1,note:'Note'}},res);
    assert.equal(client.calls.some(c=>c.sql.startsWith('DELETE FROM schedule_assignments')),false);
    assert.equal(res.code,options.version===2?409:200);
  }
});
test('application ciblée : semaine valide, contrôles gestionnaire et origine, transaction',async()=>{
  const client=clientFor([assignment(1,5)]);const {routes,manager,origin}=await routesFor(client);
  const handlers=routes.get('post /api/leave/week/:weekStart/apply');assert.deepEqual(handlers.slice(0,2),[manager,origin]);
  const bad=response();await handlers.at(-1)({params:{weekStart:'2026-10-13'}},bad);assert.equal(bad.code,400);assert.equal(client.calls.length,0);
  const res=response();await handlers.at(-1)({params:{weekStart:'2026-10-12'}},res);
  assert.equal(res.body.releasedShifts,1);assert.equal(client.calls.at(-1).sql,'COMMIT');
});
