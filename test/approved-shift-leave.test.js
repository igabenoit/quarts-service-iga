import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {shiftWithApprovedLeave,storedShiftAbsence,editedShiftLeave} from '../public/approved-shift-leave.js';
import {saveShiftLeave} from '../approved-shift-leave.js';
import {assignmentConflict,generateAssignments} from '../scheduler.js';
import {serviceShiftTiming} from '../public/service-rules.js';
import {workingIntervals} from '../public/shift-absence.js';
import {conflictsWithLeave} from '../leave-rules.js';
import {approvedLeave} from '../leave.js';
import {employeeAvailability} from '../availability-rules.js';
import {availabilityRevision} from '../availability.js';
import {beginUndo,undoLast} from '../undo.js';
import {applyServiceRoleDefault} from '../service-role-defaults.js';
import {backupBeforeRegeneration,finishRegenerationBackup,installScheduleBackup} from '../schedule-backup.js';
import {departmentFixture} from './department-fixture.js';

const week='2030-10-14',date='2030-10-14';
const period=(startMinute=750,endMinute=810)=>({date,startMinute,endMinute,allDay:false});
const shift={id:1,weekStart:week,dayIndex:0,role:'cashier',startMinute:480,endMinute:1020,...serviceShiftTiming(480,1020)};
const employee={id:1,active:true,role:'cashier',roles:['cashier'],seniority:'2020-01-01',availability:{0:[[0,1440]]},maxMinutes:420,targetMinutes:420,leavePeriods:[period()]};

test('approved partial leave keeps work before and after, net hours and candidate eligibility',()=>{
  const projected=shiftWithApprovedLeave(shift,employee.leavePeriods,1);
  assert.deepEqual(workingIntervals(projected.startMinute,projected.endMinute,projected.absence),[[480,750],[810,1020]]);
  assert.equal(projected.paidMinutes,420);assert.equal(conflictsWithLeave(projected,employee.leavePeriods),false);
  assert.equal(assignmentConflict(employee,shift,[shift]),null);
  assert.match(assignmentConflict({...employee,maxMinutes:419},shift,[shift]),/Maximum/);
  assert.deepEqual(generateAssignments([shift],[employee]).assignments,[{shiftId:1,employeeId:1}]);
  assert.equal(shift.absence,undefined);
  assert.deepEqual(shiftWithApprovedLeave(projected,employee.leavePeriods,1),projected);
  assert.equal(shiftWithApprovedLeave(projected,[],2).paidMinutes,480);
  assert.equal(shiftWithApprovedLeave(projected,[],2).absence,null);
});

test('multiple requests do not silently deduct worked gaps, full days still block, manual absence survives',()=>{
  for(const periods of [[period(0,1440)],[{...period(0,1440),allDay:true}],[period(600,660),period(750,810)]]){
    const projected=shiftWithApprovedLeave(shift,periods,1);
    assert.equal(conflictsWithLeave(projected,periods),true);
    assert.equal(projected.absence,undefined);
    assert.deepEqual(generateAssignments([shift],[{...employee,leavePeriods:periods}]).assignments,[]);
  }
  const manual={start:720,end:750,includesMeal:false};
  const projected=shiftWithApprovedLeave({...shift,absence:manual},[period()],1);
  assert.deepEqual(projected.absence,{start:720,end:810,includesMeal:false});
  assert.deepEqual(shiftWithApprovedLeave(projected,[],1).absence,manual);
  const meal={...projected,absence:{...projected.absence,includesMeal:true}};
  assert.equal(shiftWithApprovedLeave(meal,[period()],1).paidMinutes,450);
  assert.equal(shiftWithApprovedLeave(meal,[period()],2).paidMinutes,390);
});

test('Service selector offers a partially absent employee and excludes full-day leave',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const context=vm.createContext({state:{weekStart:week,timeOff:[]},shiftWithApprovedLeave,workingIntervals,
    approvedForDay:()=>[period()],canWorkRole:()=>true});
  vm.runInContext(source.slice(source.indexOf('function candidateShift('),source.indexOf('function shiftAvailabilityPanel(')),context);
  context.employee=employee;context.shift=shift;
  assert.equal(vm.runInContext('availableForShift(employee,shift)',context),true);
  context.approvedForDay=()=>[{...period(0,1440),allDay:true}];
  assert.equal(vm.runInContext('availableForShift(employee,shift)',context),false);
});

test('PostgreSQL approval, assignment, cancellation, editing, undo and regeneration retain partial absence correctly',async t=>{
  const f=await departmentFixture();
  const oldKey=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='';
  try{
    await installScheduleBackup(f.app,f.pool,f.options);
    const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
    const context=vm.createContext({app:f.app,pool:f.pool,...f.options,serviceShiftTiming,employeeAvailability,availabilityRevision,
      approvedLeave,conflictsWithLeave,assignmentConflict,generateAssignments,beginUndo,applyServiceRoleDefault,
      backupBeforeRegeneration,finishRegenerationBackup,shiftWithApprovedLeave,saveShiftLeave,storedShiftAbsence,editedShiftLeave});
    for(const [start,end] of [
      ['function validDate(','function normalizeEmployee('],
      ['function mapEmployee(','app.get("/api/employees"'],
      ['app.put("/api/shifts/:id/assignment"','const leaveAccess=await installLeave('],
      ['app.post("/api/weeks/:weekStart/shifts"','app.delete("/api/shifts/:id"']
    ])vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),context);
    await f.pool.query(`INSERT INTO schedule_weeks(week_start) VALUES($1)`,[week]);
    const availability=JSON.stringify(Object.fromEntries(Array.from({length:7},(_,day)=>[day,[[0,1440]]])));
    await f.pool.query(`INSERT INTO schedule_employees(id,name,area,role,roles,seniority,availability,target_minutes,max_minutes,assignment_rank)
      VALUES(1,'Employée test','front','cashier','["cashier"]','2020-01-01',$1,2400,3000,1),
      (2,'Remplaçante test','front','cashier','["cashier"]','2021-01-01',$1,2400,3000,2)`,[availability]);
    const dept=(await f.pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0].id;
    const shiftId=Number((await f.pool.query(`INSERT INTO schedule_shifts(week_start,area,role,day_index,start_minute,end_minute,break_minutes)
      VALUES($1,'front','cashier',0,480,1020,60) RETURNING id`,[week])).rows[0].id);
    const requestId=Number((await f.pool.query(`INSERT INTO schedule_leave_requests(submission_key,employee_id,employee_name,email,reason,periods,first_date,last_date,status,department_id,department_name)
      VALUES('00000000-0000-4000-8000-000000000001',1,'Employée test','test@example.com','Motif confidentiel',$1,$2,$2,'pending',$3,'Service') RETURNING id`,[JSON.stringify([period()]),date,dept])).rows[0].id);
    const row=async()=>(await f.pool.query('SELECT * FROM schedule_shifts WHERE id=$1',[shiftId])).rows[0];
    const assignments=async()=>(await f.pool.query('SELECT shift_id,employee_id FROM schedule_assignments ORDER BY shift_id')).rows;
    const assign=employeeId=>f.call('put','/api/shifts/:id/assignment',{params:{id:shiftId},body:{employeeId}});
    const decide=async status=>{
      const request=(await f.pool.query('SELECT version FROM schedule_leave_requests WHERE id=$1',[requestId])).rows[0];
      const result=await f.call('patch','/api/leave/requests/:id',{params:{id:requestId},body:{status,version:request.version,note:'Décision test'}});
      assert.equal(result.code,200,JSON.stringify(result.body));return result.body;
    };
    const undo=async()=>{const id=(await f.pool.query('SELECT MAX(id) AS id FROM schedule_undo_actions WHERE undone_at IS NULL')).rows[0].id;
      await f.pool.query('BEGIN');await undoLast(f.pool,id);await f.pool.query('COMMIT');};
    await t.test('approval on an existing shift preserves assignment, annotates time and supports undo',async()=>{
      // A legacy conflict on another date must be left alone by this decision.
      const unrelated=Number((await f.pool.query(`INSERT INTO schedule_shifts(week_start,area,role,day_index,start_minute,end_minute,break_minutes)
        VALUES($1,'front','cashier',1,480,1020,60) RETURNING id`,[week])).rows[0].id);
      await f.pool.query('INSERT INTO schedule_assignments(shift_id,employee_id) VALUES($1,1)',[unrelated]);
      await f.pool.query(`INSERT INTO schedule_leave_requests(submission_key,employee_id,employee_name,email,reason,periods,first_date,last_date,status,department_id,department_name)
        VALUES('00000000-0000-4000-8000-000000000003',1,'Employée test','test@example.com','Motif privé',$1,'2030-10-15','2030-10-15','approved',$2,'Service')`,[JSON.stringify([{date:'2030-10-15',allDay:true,startMinute:0,endMinute:1440}]),dept]);
      assert.equal((await assign(1)).code,200);
      const before=await assignments(),changes=await decide('approved');
      assert.equal(changes.releasedShifts,0);assert.equal(changes.adjustedShifts,1);
      assert.deepEqual(await assignments(),before);
      assert.equal(serviceShiftTiming(480,1020,(await row()).absence).paidMinutes,420);
      assert.equal(JSON.stringify((await row()).absence).includes('confidentiel'),false);
      await undo();assert.equal((await row()).absence,null);assert.deepEqual(await assignments(),before);
      await decide('approved');
      const repeated=await f.call('post','/api/leave/week/:weekStart/apply',{params:{weekStart:week}});
      assert.equal(repeated.code,200);assert.equal(repeated.body.adjustedShifts,0);assert.equal(repeated.body.releasedShifts,1);
    });
    await t.test('unassignment clears automatic absence; assignment after approval reconstructs it only for that person',async()=>{
      assert.equal((await assign(null)).body.shift.absence,null);assert.equal((await row()).absence,null);
      const saved=await assign(1);assert.equal(saved.code,200,JSON.stringify(saved.body));assert.equal(saved.body.shift.paidMinutes,420);
      const other=await assign(2);assert.equal(other.code,200);assert.equal(other.body.shift.paidMinutes,480);assert.equal((await row()).absence,null);
      await assign(1);
    });
    await t.test('meal selection survives edits and cancellation restores the full shift',async()=>{
      const result=await f.call('put','/api/shifts/:id',{params:{id:shiftId},body:{role:'cashier',dayIndex:0,startMinute:480,endMinute:1020,absence:{start:750,end:810,includesMeal:true}}});
      assert.equal(result.code,200,JSON.stringify(result.body));assert.equal(result.body.shift.paidMinutes,480);
      await f.call('post','/api/leave/week/:weekStart/apply',{params:{weekStart:week}});
      assert.equal((await row()).absence.includesMeal,true);
      await decide('cancelled');assert.equal((await row()).absence,null);assert.equal((await assignments()).length,1);
      await undo();assert.equal((await row()).absence.includesMeal,true);
    });
    await t.test('regeneration computes the absent employee hours and backup restoration restores absence with assignment',async()=>{
      await assign(2);
      const result=await f.call('post','/api/weeks/:weekStart/generate',{params:{weekStart:week},body:{replaceAll:true}});
      assert.equal(result.code,200,JSON.stringify(result.body));assert.equal(Number((await assignments())[0].employee_id),1);
      assert.equal((await row()).absence.start,750);
      const preview=(await f.call('get','/api/weeks/:weekStart/regeneration-backup',{params:{weekStart:week}})).body.backup;
      assert.equal(preview.canRestore,true);
      const restored=await f.call('post','/api/weeks/:weekStart/regeneration-backup/restore',{params:{weekStart:week},body:{backupId:preview.id,token:preview.token}});
      assert.equal(restored.code,200,JSON.stringify(restored.body));assert.equal(Number((await assignments())[0].employee_id),2);assert.equal((await row()).absence,null);
    });
    await t.test('two contiguous requests combine; cancelling one keeps only the other approved period',async()=>{
      await assign(1);
      const second=Number((await f.pool.query(`INSERT INTO schedule_leave_requests(submission_key,employee_id,employee_name,email,reason,periods,first_date,last_date,status,department_id,department_name)
        VALUES('00000000-0000-4000-8000-000000000002',1,'Employée test','test@example.com','Motif privé',$1,$2,$2,'approved',$3,'Service') RETURNING id`,[JSON.stringify([period(810,840)]),date,dept])).rows[0].id);
      await f.call('post','/api/leave/week/:weekStart/apply',{params:{weekStart:week}});
      assert.equal((await row()).absence.start,750);assert.equal((await row()).absence.end,840);
      await decide('cancelled');assert.equal((await row()).absence.start,810);assert.equal((await row()).absence.end,840);
      const cancelled=await f.call('patch','/api/leave/requests/:id',{params:{id:second},body:{status:'cancelled',version:1,note:'Retrait test'}});
      assert.equal(cancelled.code,200);assert.equal((await row()).absence,null);assert.equal((await assignments()).length,1);
    });
    await t.test('a failed absence update rolls back cancellation and leaves the assigned shift unchanged',async()=>{
      await undo();await undo();
      const query=f.pool.query,requests=(await f.pool.query('SELECT id,status,version FROM schedule_leave_requests ORDER BY id')).rows;
      const before=await row(),assigned=await assignments();
      f.pool.query=async(sql,args)=>{if(sql.startsWith('UPDATE schedule_shifts SET absence='))throw Error('Simulated write failure');return query.call(f.pool,sql,args);};
      try{
        const result=await f.call('patch','/api/leave/requests/:id',{params:{id:requestId},body:{status:'cancelled',version:requests[0].version,note:'Retrait test'}});
        assert.equal(result.code,500);
      }finally{f.pool.query=query;}
      assert.deepEqual((await f.pool.query('SELECT id,status,version FROM schedule_leave_requests ORDER BY id')).rows,requests);
      assert.deepEqual(await row(),before);assert.deepEqual(await assignments(),assigned);
    });
  }finally{if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;await f.db.close();}
});
