import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installUndoSchema,beginUndo,undoLast} from '../undo.js';
import {installLeave} from '../leave.js';

test('annulation transactionnelle sur PostgreSQL : quarts, cascade, congés, groupes, pile et concurrence',async()=>{
  const db=new PGlite();
  const pool={query:async(sql,args)=>args?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]}};
  try{
    const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
    const ddl=source.slice(source.indexOf('await pool.query(`'),source.indexOf('app.disable('));
    await new Function('pool','return (async()=>{'+ddl+'})();')(pool);
    const app={use(){},get(){},post(){},patch(){},put(){}};
    const timer=globalThis.setInterval;globalThis.setInterval=()=>({unref(){}});
    try{await installLeave(app,pool,{requireManager(){},sameOrigin(){},hasStaffAccess(){}});}finally{globalThis.setInterval=timer;}
    await installUndoSchema(pool);
    await pool.query(`INSERT INTO schedule_weeks(week_start) VALUES ('2026-10-12'),('2026-10-19');
      INSERT INTO schedule_employees(id,name,area,role) VALUES (1,'Raphaël','front','cashier'),(2,'Autre','front','cashier');
      INSERT INTO schedule_shifts(id,week_start,area,role,day_index,start_minute,end_minute) VALUES
        (1,'2026-10-12','front','cashier',6,675,1035),(2,'2026-10-19','front','cashier',0,480,960);
      INSERT INTO schedule_assignments(shift_id,employee_id) VALUES (1,1),(2,2);`);
    const act=async(label,sql,group=null)=>{
      await pool.query('BEGIN');await beginUndo(pool,label,'2026-10-12',{headers:group?{'x-undo-group':group}:{}});
      await pool.query(sql);await pool.query('COMMIT');
      return (await pool.query('SELECT MAX(id) AS id FROM schedule_undo_actions')).rows[0].id;
    };
    const undo=async id=>{await pool.query('BEGIN');try{const result=await undoLast(pool,id);await pool.query('COMMIT');return result;}catch(e){await pool.query('ROLLBACK');throw e;}};
    const assignments=async()=>(await pool.query('SELECT shift_id,employee_id FROM schedule_assignments ORDER BY shift_id')).rows;
    const initial=await assignments();
    const edited=await act('Modifier un quart',"UPDATE schedule_shifts SET start_minute=720 WHERE id=1");
    const removed=await act('Supprimer un quart','DELETE FROM schedule_shifts WHERE id=1');
    assert.equal((await assignments()).length,1);
    await assert.rejects(undo(edited),/autre action/);
    await undo(removed);assert.deepEqual(await assignments(),initial);
    assert.equal((await pool.query('SELECT start_minute FROM schedule_shifts WHERE id=1')).rows[0].start_minute,720);
    await undo(edited);assert.equal((await pool.query('SELECT start_minute FROM schedule_shifts WHERE id=1')).rows[0].start_minute,675);
    const generated=await act('Recréer',`DELETE FROM schedule_assignments WHERE shift_id=1; INSERT INTO schedule_assignments VALUES (1,2,now());`);
    await undo(generated);assert.deepEqual(await assignments(),initial);
    await pool.query(`INSERT INTO schedule_leave_requests(id,submission_key,employee_id,employee_name,email,reason,periods,first_date,last_date,status)
      VALUES (1,'11111111-1111-4111-8111-111111111111',1,'Raphaël','r@example.com','Congé','[{"date":"2026-10-18","startMinute":0,"endMinute":1440,"allDay":true}]','2026-10-18','2026-10-18','pending');`);
    const approved=await act('Approuver un congé',`UPDATE schedule_leave_requests SET status='approved',version=2 WHERE id=1; DELETE FROM schedule_assignments WHERE shift_id=1; INSERT INTO schedule_leave_events(request_id,status,note) VALUES(1,'approved','Approuvé');`);
    await undo(approved);assert.deepEqual(await assignments(),initial);
    const leave=(await pool.query('SELECT status,version FROM schedule_leave_requests WHERE id=1')).rows[0];
    assert.equal(leave.status,'pending');assert.equal(leave.version,3);
    assert.equal((await pool.query('SELECT * FROM schedule_leave_events')).rows.length,2);
    const group='22222222-2222-4222-8222-222222222222';
    const first=await act('Modifier un employé',"UPDATE schedule_employees SET name='Nouveau nom' WHERE id=1",group);
    const second=await act('Congés manuels',"INSERT INTO schedule_time_off VALUES('2026-10-12',1,6); DELETE FROM schedule_assignments WHERE shift_id=1",group);
    assert.equal(first,second);await undo(second);assert.deepEqual(await assignments(),initial);
    assert.equal((await pool.query('SELECT name FROM schedule_employees WHERE id=1')).rows[0].name,'Raphaël');
    const stale=await act('Affectation',"UPDATE schedule_assignments SET employee_id=2 WHERE shift_id=1");
    await pool.query('UPDATE schedule_assignments SET employee_id=1 WHERE shift_id=1');
    await assert.rejects(undo(stale),/ont changé/);assert.deepEqual(await assignments(),initial);
    await pool.query('BEGIN');await beginUndo(pool,'Échec','2026-10-12');await pool.query('DELETE FROM schedule_shifts WHERE id=1');await pool.query('ROLLBACK');
    assert.deepEqual(await assignments(),initial);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM schedule_undo_actions WHERE label='Échec'")).rows[0].n,0);
  }finally{await db.close();}
});
