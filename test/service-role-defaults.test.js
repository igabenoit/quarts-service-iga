import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {departmentFixture} from './department-fixture.js';
import {applyServiceRoleDefault,copyServiceShifts} from '../service-role-defaults.js';
import {assignmentConflict,generateAssignments} from '../scheduler.js';
import {serviceShiftTiming} from '../public/service-rules.js';
import {employeeAvailability} from '../availability-rules.js';
import {availabilityRevision} from '../availability.js';
import {approvedLeave} from '../leave.js';
import {conflictsWithLeave} from '../leave-rules.js';
import {beginUndo,undoLast} from '../undo.js';
import {backupBeforeRegeneration,finishRegenerationBackup,installScheduleBackup} from '../schedule-backup.js';

test('manager defaults persist through manual assignment, generation, copying and undo',async t=>{
  const f=await departmentFixture();
  try{
    await installScheduleBackup(f.app,f.pool,f.options);
    const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
    const context=vm.createContext({app:f.app,pool:f.pool,...f.options,serviceShiftTiming,employeeAvailability,availabilityRevision,
      approvedLeave,conflictsWithLeave,assignmentConflict,generateAssignments,beginUndo,applyServiceRoleDefault,copyServiceShifts,
      backupBeforeRegeneration,finishRegenerationBackup});
    for(const [start,end] of [
      ['function validDate(','function normalizeShift('],
      ['async function ensureWeek(','function mapWeek('],
      ['function mapShift(','function normalizeEmployee('],
      ['function mapEmployee(','app.get("/api/employees"'],
      ['app.put("/api/shifts/:id/assignment"','const leaveAccess=await installLeave('],
      ['app.post("/api/weeks/:weekStart/copy-previous"','installPdfAssets(app);']
    ])vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),context);
    const availability=JSON.stringify(Object.fromEntries(Array.from({length:7},(_,day)=>[day,[[0,1440]]])));
    await f.pool.query(`INSERT INTO schedule_employees(id,name,area,role,roles,seniority,availability,target_minutes,max_minutes,assignment_rank)
      VALUES(1,'Manager test','front','manager','["manager","cashier"]','2020-01-01',$1,2400,3000,1),
      (2,'Supervisor test','front','supervisor','["supervisor"]','2021-01-01',$1,2400,3000,2)`,[availability]);
    const week='2026-10-19',next='2026-10-26';
    await f.pool.query('INSERT INTO schedule_weeks(week_start,cashier_budget_minutes,packer_budget_minutes) VALUES($1,12345,6789)',[week]);
    const addShift=async(role,day)=>Number((await f.pool.query(`INSERT INTO schedule_shifts(week_start,area,role,day_index,start_minute,end_minute,break_minutes,notes)
      VALUES($1,'front',$2,$3,480,1020,60,'Keep note') RETURNING id`,[week,role,day])).rows[0].id);
    const shiftRow=async id=>(await f.pool.query('SELECT role,start_minute,end_minute,break_minutes,notes FROM schedule_shifts WHERE id=$1',[id])).rows[0];
    const assign=(id,employeeId)=>f.call('put','/api/shifts/:id/assignment',{params:{id},body:{employeeId}});
    const undo=async()=>{
      const id=(await f.pool.query('SELECT MAX(id) AS id FROM schedule_undo_actions WHERE undone_at IS NULL')).rows[0].id;
      await f.pool.query('BEGIN');try{await undoLast(f.pool,id);await f.pool.query('COMMIT');}catch(e){await f.pool.query('ROLLBACK');throw e;}
    };
    const supervisor=await addShift('supervisor',0),cashier=await addShift('cashier',1);
    await t.test('manual assignment uses primary manager role and keeps hours, explicit cashier work and refusals',async()=>{
      const before=await shiftRow(supervisor),saved=await assign(supervisor,1);
      assert.equal(saved.code,200,JSON.stringify(saved.body));assert.equal(saved.body.shift.role,'manager');
      assert.deepEqual(await shiftRow(supervisor),{...before,role:'manager'});
      await undo();assert.deepEqual(await shiftRow(supervisor),before);
      assert.equal((await f.pool.query('SELECT * FROM schedule_assignments')).rows.length,0);
      assert.equal((await assign(supervisor,1)).code,200);
      assert.equal((await assign(cashier,1)).code,200);assert.equal((await shiftRow(cashier)).role,'cashier');
      const conflicting=await addShift('supervisor',0),rejected=await assign(conflicting,1);
      assert.equal(rejected.code,400);assert.match(rejected.body.error,/déjà un quart/);
      assert.equal((await shiftRow(conflicting)).role,'supervisor');
      assert.equal((await assign(conflicting,2)).code,200);assert.equal((await shiftRow(conflicting)).role,'supervisor');
    });
    const legacy=await addShift('supervisor',2);
    await f.pool.query('INSERT INTO schedule_assignments(shift_id,employee_id) VALUES($1,1)',[legacy]);
    const open=await addShift('supervisor',3);
    await t.test('copy retains manager needs and converts legacy manager assignments without changing source or other roles',async()=>{
      const sourceRows=(await f.pool.query('SELECT id,role,day_index,start_minute,end_minute,break_minutes,notes FROM schedule_shifts WHERE week_start=$1 ORDER BY id',[week])).rows;
      const copied=await f.call('post','/api/weeks/:weekStart/copy-previous',{params:{weekStart:next}});
      assert.equal(copied.code,200,JSON.stringify(copied.body));
      const rows=(await f.pool.query('SELECT role,day_index,start_minute,end_minute,break_minutes,notes FROM schedule_shifts WHERE week_start=$1 ORDER BY id',[next])).rows;
      assert.deepEqual(rows,sourceRows.map(({id,...s})=>({...s,role:Number(id)===legacy?'manager':s.role})));
      assert.deepEqual((await f.pool.query('SELECT id,role,day_index,start_minute,end_minute,break_minutes,notes FROM schedule_shifts WHERE week_start=$1 ORDER BY id',[week])).rows,sourceRows);
      assert.deepEqual((await f.pool.query('SELECT cashier_budget_minutes,packer_budget_minutes FROM schedule_weeks WHERE week_start=$1',[next])).rows[0],{cashier_budget_minutes:12345,packer_budget_minutes:6789});
      assert.equal((await f.pool.query('SELECT a.* FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id WHERE s.week_start=$1',[next])).rows.length,0);
      assert.equal((await f.call('post','/api/weeks/:weekStart/copy-previous',{params:{weekStart:next}})).code,400);
      const generated=await f.call('post','/api/weeks/:weekStart/generate',{params:{weekStart:next}});
      assert.equal(generated.code,200,JSON.stringify(generated.body));
      const managerNeeds=(await f.pool.query("SELECT s.role,a.employee_id FROM schedule_shifts s LEFT JOIN schedule_assignments a ON a.shift_id=s.id WHERE s.week_start=$1 AND s.role='manager'",[next])).rows;
      assert.equal(managerNeeds.length,3);assert.ok(managerNeeds.every(s=>Number(s.employee_id)===1));
      await undo();
      await undo();assert.equal((await f.pool.query('SELECT * FROM schedule_shifts WHERE week_start=$1',[next])).rows.length,0);
    });
    await t.test('generation persists manager defaults, preserves existing assignments and undo restores the prior role',async()=>{
      const before=(await f.pool.query('SELECT * FROM schedule_assignments ORDER BY shift_id')).rows;
      const result=await f.call('post','/api/weeks/:weekStart/generate',{params:{weekStart:week}});
      assert.equal(result.code,200,JSON.stringify(result.body));assert.equal(result.body.preserved,before.length);
      assert.equal((await shiftRow(open)).role,'manager');
      assert.deepEqual((await f.pool.query('SELECT * FROM schedule_assignments WHERE shift_id<>$1 ORDER BY shift_id',[open])).rows,before);
      await undo();assert.equal((await shiftRow(open)).role,'supervisor');
      assert.deepEqual((await f.pool.query('SELECT * FROM schedule_assignments ORDER BY shift_id')).rows,before);
    });
    await t.test('regeneration backup accepts its own role defaults and restores roles and assignments together',async()=>{
      const before=(await f.pool.query('SELECT shift_id,employee_id FROM schedule_assignments ORDER BY shift_id')).rows;
      const result=await f.call('post','/api/weeks/:weekStart/generate',{params:{weekStart:week},body:{replaceAll:true}});
      assert.equal(result.code,200,JSON.stringify(result.body));assert.equal((await shiftRow(open)).role,'manager');
      const preview=(await f.call('get','/api/weeks/:weekStart/regeneration-backup',{params:{weekStart:week}})).body.backup;
      assert.equal(preview.canRestore,true,preview.issues.join(' '));
      const restored=await f.call('post','/api/weeks/:weekStart/regeneration-backup/restore',{params:{weekStart:week},body:{backupId:preview.id,token:preview.token}});
      assert.equal(restored.code,200,JSON.stringify(restored.body));
      assert.equal((await shiftRow(open)).role,'supervisor');assert.equal((await shiftRow(legacy)).role,'supervisor');
      assert.deepEqual((await f.pool.query('SELECT shift_id,employee_id FROM schedule_assignments ORDER BY shift_id')).rows,before);
    });
  }finally{await f.db.close();}
});

test('generation prefers a copied manager need over an equivalent supervision slot',()=>{
  const manager={id:1,role:'manager',roles:['manager'],active:true,seniority:'2020-01-01',targetMinutes:480,maxMinutes:480,availability:{0:[[0,1440]]}};
  const shifts=['supervisor','manager'].map((role,i)=>({id:i+1,role,dayIndex:0,startMinute:480,endMinute:1020,paidMinutes:480}));
  assert.deepEqual(generateAssignments(shifts,[manager]).assignments,[{shiftId:2,employeeId:1}]);
});
