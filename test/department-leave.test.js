import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {departmentFixture} from './department-fixture.js';
import {blankCell,cellMinutes,totalMinutes,normalizeCell} from '../public/departments-core.js';
import {leavePersonIds} from '../department-leave.js';
import {assertLeaveCell,leaveSpans,projectLeaveCell,leaveLabel} from '../public/department-leave.js';
const week='2030-10-14',next='2030-10-21',route='/api/departments/:id/weeks/:week';
const shift={kind:'shift',start:480,end:960,breakMinutes:60,note:''};
const period=(date=week,startMinute=0,endMinute=1440)=>({date,startMinute,endMinute});
const cells=(cell,day=0)=>Array.from({length:7},(_,i)=>i===day?structuredClone(cell):blankCell());

test('congé : limites exactes, nuits, absences manuelles et heures convenues',()=>{
  const partial=[period(week,600,720)];
  assert.throws(()=>assertLeaveCell(shift,partial,week),/congé approuvé/);
  for(const cell of [{...shift,end:600,breakMinutes:0},{...shift,start:720,breakMinutes:0},{...shift,absence:{start:600,end:720,includesMeal:false}}])assert.doesNotThrow(()=>assertLeaveCell(cell,partial,week));
  assert.equal(cellMinutes(projectLeaveCell(shift,partial,week)),300);
  const override=projectLeaveCell({...shift,paidMinutesOverride:600,trainingMinutes:400},partial,week);
  assert.equal(override.paidMinutesOverride,undefined);assert.equal(override.trainingMinutes,300);
  assert.doesNotThrow(()=>normalizeCell(override));
  const manual={...shift,absence:{start:540,end:570,includesMeal:false}};
  assert.match(projectLeaveCell(manual,partial,week).note,/réattribuer/);
  assert.deepEqual(projectLeaveCell(manual,[],week),manual);
  assert.equal(cellMinutes(projectLeaveCell(shift,[period()],week)),0);
  const night={...shift,start:1320,end:1830,breakMinutes:30,post:'night'};
  assert.deepEqual(leaveSpans([period(next,0,120)],'2030-10-20',1320,1830),[[1440,1560]]);
  assert.throws(()=>assertLeaveCell(night,[period(next,0,120)],'2030-10-20'),/congé approuvé/);
  assert.equal(cellMinutes(projectLeaveCell(night,[period(next,0,120)],'2030-10-20')),360);
  assert.match(leaveLabel([period()],week),/journée bloquée/);
});

test('congé : identités explicites, fiches liées et homonymes',()=>{
  const people=[{id:1,name:'Nom actuel',departments:[10],serviceEmployeeId:40},{id:2,name:'Nom actuel',departments:[11],portalPersonId:1},{id:3,name:'Nom actuel',departments:[10]},{id:4,name:'Unique',departments:[11]}];
  assert.deepEqual(leavePersonIds({person_id:2,employee_name:'Ancien nom'},people),[1,2]);
  assert.deepEqual(leavePersonIds({employee_id:40},people),[1,2]);
  assert.deepEqual(leavePersonIds({employee_name:'Nom actuel',department_id:10},people),[]);
  assert.deepEqual(leavePersonIds({employee_name:'Unique',department_id:11},people),[4]);
  assert.deepEqual(leavePersonIds({person_id:999,employee_name:'Unique',department_id:11},people),[]);
});

test('PostgreSQL : congés bloquants, publications, copies, historique et annulation',async t=>{
  const f=await departmentFixture(),{call,pool}=f;
  try{
    const meta=(await call('get','/api/departments/meta')).body,dept=meta.departments.find(d=>d.key==='boulangerie'),other=meta.departments.find(d=>d.key==='viande');
    const person=(await call('post','/api/departments/people',{body:{name:'Employé Congé',active:true,group:'regular',departments:[dept.id,other.id],availability:Object.fromEntries(Array.from({length:7},(_,i)=>[i,'J']))}})).body.id;
    const draft={rows:[{personId:person,cells:cells(shift)}],manager:'',notes:''};
    const get=async(w=week,d=dept)=>(await call('get',route,{params:{id:d.id,week:w}})).body;
    const save=(value,revision,w=week,d=dept)=>call('put',route,{params:{id:d.id,week:w},body:{draft:value,revision,warningsReviewed:true}});
    const publish=(revision,w=week)=>call('post',route+'/publish',{params:{id:dept.id,week:w},body:{revision,verified:true,warningsReviewed:true}});
    const pub=async()=>(await call('get','/api/leave/department-schedules/:id/:week',{params:{id:dept.id,week}})).body;
    const insert=async(periods,status='approved',flags={})=>Number((await pool.query(`INSERT INTO schedule_leave_requests(submission_key,person_id,employee_name,email,reason,periods,first_date,last_date,status,department_id,department_name,is_test,archived_at)
      VALUES($1,$2,'Ancien nom','confidentiel@example.invalid','raison confidentielle',$3,$4,$5,$6,$7,'Boulangerie',$8,$9) RETURNING id`,[randomUUID(),person,JSON.stringify(periods),periods[0].date,periods.at(-1).date,status,dept.id,flags.test||false,flags.archived?new Date():null])).rows[0].id);
    assert.equal((await save(draft,0)).code,200);assert.equal((await publish(1)).code,200);
    let request;
    await t.test('seuls les congés réellement approuvés bloquent',async()=>{
      for(const status of ['pending','late','conditional','refused','cancelled'])await insert([period()],status);
      await insert([period()],'approved',{test:true});await insert([period()],'approved',{archived:true});
      assert.equal(totalMinutes((await get()).draft.rows[0]),420);
      request=await insert([period()]);
      const current=await get();assert.equal(totalMinutes(current.draft.rows[0]),0);assert.match(current.draft.rows[0].cells[0].note,/Congé approuvé/);
      assert.equal(totalMinutes((await pub()).schedule.rows[0]),0,'a previously published shift is immediately excluded');
      assert.equal((await save(draft,2)).code,409,'a stale form cannot reintroduce the shift');
      assert.equal((await save(draft,0,week,other)).code,409,'another department cannot bypass the leave');
      assert.doesNotMatch(JSON.stringify(await pub()),/confidentiel|raison|storedWeek|approvedLeaves/);
      assert.deepEqual(current.approvedLeaves[person],[period()]);
    });
    await t.test('enregistrer et publier conservent le plan et un historique privé',async()=>{
      const current=await get();current.draft.notes='Autre correction';
      assert.equal((await save(current.draft,2)).code,200);assert.equal((await publish(3)).code,200);
      const stored=(await pool.query('SELECT draft,published FROM schedule_department_weeks WHERE department_id=$1 AND week_start=$2',[dept.id,week])).rows[0];
      assert.deepEqual(stored.draft.rows[0].cells[0],shift);assert.deepEqual(stored.published.rows[0].cells[0],shift);
      assert.equal(totalMinutes((await pub()).schedule.rows[0]),0);
      const history=(await pool.query('SELECT draft FROM schedule_department_history WHERE department_id=$1 AND week_start=$2 ORDER BY id DESC LIMIT 1',[dept.id,week])).rows[0];
      assert.deepEqual(history.draft.rows[0].cells[0],shift);
    });
    await t.test('copier et restaurer appliquent les congés de la semaine cible',async()=>{
      assert.equal((await call('post',route+'/copy',{params:{id:dept.id,week:next},body:{revision:0,sourceWeek:week,sourceRevision:4}})).code,200);
      assert.equal(totalMinutes((await get(next)).draft.rows[0]),420,'do not copy a source-week absence into the next week');
      await insert([period(next,600,720)]);
      assert.equal(totalMinutes((await get(next)).draft.rows[0]),300);
      assert.equal((await call('post',route+'/copy',{params:{id:dept.id,week:next},body:{revision:1,sourceWeek:week,sourceRevision:4,replaceConfirmed:true}})).code,200);
      assert.equal(totalMinutes((await get(next)).draft.rows[0]),300);
      const history=(await call('get',route+'/history',{params:{id:dept.id,week}})).body.history;
      assert.equal((await call('post',route+'/restore',{params:{id:dept.id,week},body:{revision:4,historyId:history[0].id}})).code,200);
      assert.equal(totalMinutes((await get()).draft.rows[0]),0);
    });
    await t.test('correction partielle et annulation rétablissent seulement les heures libérées',async()=>{
      await pool.query('UPDATE schedule_leave_requests SET effective_periods=$1 WHERE id=$2',[JSON.stringify([period(week,600,720)]),request]);
      let current=await get();assert.equal(totalMinutes(current.draft.rows[0]),300);assert.equal(totalMinutes((await pub()).schedule.rows[0]),300);
      assert.equal((await save(current.draft,5)).code,200);
      const overlapping=structuredClone(current.draft);delete overlapping.rows[0].cells[0].absence;
      assert.equal((await save(overlapping,6)).code,409);
      await pool.query("UPDATE schedule_leave_requests SET status='cancelled' WHERE id=$1",[request]);
      current=await get();assert.equal(totalMinutes(current.draft.rows[0]),420);assert.equal(current.draft.rows[0].cells[0].absence,undefined);
      assert.equal(totalMinutes((await pub()).schedule.rows[0]),420);
    });
  }finally{await f.db.close();}
});
