import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {approvalPayload} from '../leave-approval-mail.js';
import {undoLast} from '../undo.js';

const period=(date,startMinute=750,endMinute=810)=>({date,startMinute,endMinute,allDay:startMinute===0&&endMinute===1440});
const input=p=>({startDate:p.date,endDate:p.date,allDay:p.allDay,startTime:`${String(Math.floor(p.startMinute/60)).padStart(2,'0')}:${String(p.startMinute%60).padStart(2,'0')}`,endTime:p.endMinute===1440?'24:00':`${String(Math.floor(p.endMinute/60)).padStart(2,'0')}:${String(p.endMinute%60).padStart(2,'0')}`});
test('correction de congé accepté : dates, absences, autres demandes, historique et Annuler',async t=>{
 const f=await departmentFixture();const oldKey=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='';
 try{
  const {pool}=f,dept=(await pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0].id;
  await pool.query(`INSERT INTO schedule_employees(id,name,area,role) VALUES(1,'Camille','front','cashier'),(2,'Autre','front','cashier');
   INSERT INTO schedule_weeks(week_start) VALUES('2030-10-14'),('2030-10-21');
   INSERT INTO schedule_shifts(id,week_start,area,role,day_index,start_minute,end_minute) VALUES
    (1,'2030-10-14','front','cashier',0,480,1020),(2,'2030-10-21','front','cashier',1,480,1020),(3,'2030-10-14','front','cashier',0,480,1020);
   INSERT INTO schedule_assignments(shift_id,employee_id) VALUES(1,1),(2,1),(3,2);`);
  const add=async(id,periods,status='pending',employee=1)=>pool.query(`INSERT INTO schedule_leave_requests(id,submission_key,employee_id,employee_name,email,reason,periods,first_date,last_date,status,department_id,department_name)
   VALUES($1,$2,$3,'Camille','camille@example.com','Personnel',$4,$5,$6,$7,$8,'Service')`,[id,`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,employee,JSON.stringify(periods),periods[0].date,periods.at(-1).date,status,dept]);
  const get=async id=>(await pool.query('SELECT * FROM schedule_leave_requests WHERE id=$1',[id])).rows[0];
  const shifts=async()=>(await pool.query('SELECT id,absence FROM schedule_shifts ORDER BY id')).rows;
  const assignments=async()=>(await pool.query('SELECT * FROM schedule_assignments ORDER BY shift_id')).rows;
  const decide=(id,body,extra={})=>f.call('patch','/api/leave/requests/:id',{params:{id},body,...extra});
  const initialAssignments=await assignments();
  const old=period('2030-10-14'),newPeriod=period('2030-10-22',840,900);
  await add(1,[old]);assert.equal((await decide(1,{status:'approved',version:1})).code,200);
  const before=await get(1),beforeShifts=await shifts();assert.ok(beforeShifts[0].absence?.approvedLeave);
  await t.test('refuse les corrections vides, invalides, sans raison ou concurrentes et les autres départements',async()=>{
   const body={status:'approved',version:before.version,note:'Mauvaise date',periods:[input(newPeriod)]};
   for(const [change,code] of [[{note:''},400],[{periods:undefined},400],[{periods:[]},400],[{periods:[input(old)]},400],[{periods:[{...input(newPeriod),startDate:'2030-02-30'}]},400],[{version:0},409]]){
    const res=await decide(1,{...body,...change});assert.equal(res.code,code,JSON.stringify(res.body));assert.deepEqual(await get(1),before);assert.deepEqual(await shifts(),beforeShifts);
   }
   assert.equal((await decide(1,body,{manager:{kind:'account',departments:[]}})).code,403);
  });
  await t.test('déplace une absence partielle vers une autre semaine sans effacer la nouvelle date par auto-chevauchement',async()=>{
   const res=await decide(1,{status:'approved',version:before.version,note:'Erreur de journée',periods:[input(newPeriod)]});assert.equal(res.code,200,JSON.stringify(res.body));assert.equal(res.body.corrected,true);assert.equal(res.body.adjustedShifts,2);
   const row=await get(1);assert.equal(row.status,'approved');assert.equal(row.version,before.version+1);assert.deepEqual(row.periods,[newPeriod]);assert.deepEqual(row.effective_periods,[newPeriod]);
   const after=await shifts();assert.equal(after[0].absence,null);assert.equal(after[1].absence.start,840);assert.equal(after[1].absence.end,900);assert.equal(after[2].absence,null);assert.deepEqual(await assignments(),initialAssignments);
   const events=(await pool.query('SELECT note FROM schedule_leave_events WHERE request_id=1')).rows;assert.ok(events.some(e=>e.note.includes('Avant : 2030-10-14')&&e.note.includes('Après : 2030-10-22')));
   const jobs=(await pool.query('SELECT request_version FROM schedule_leave_approval_mail WHERE request_id=1 ORDER BY request_version')).rows;assert.deepEqual(jobs.map(r=>r.request_version),[2,3]);
   const email=approvalPayload({...row,request_id:row.id});assert.match(email.subject,/Congé corrigé/);assert.match(email.text,/remplace la confirmation précédente/);assert.match(email.text,/22 octobre 2030/);assert.doesNotMatch(email.text,/14 octobre 2030/);
   const undo=(await pool.query('SELECT max(id) AS id FROM schedule_undo_actions')).rows[0].id;await pool.query('BEGIN');await undoLast(pool,undo);await pool.query('COMMIT');assert.deepEqual((await get(1)).periods,[old]);assert.deepEqual(await shifts(),beforeShifts);
  });
  await t.test('conserve les autres congés et leurs heures quand la correction les chevauche',async()=>{
   await add(2,[period('2030-10-14',780,840)],'approved');
   const row=await get(1);const changed=period('2030-10-14',750,840);
   const res=await decide(1,{status:'approved',version:row.version,note:'Fin à 14 h',periods:[input(changed)]});assert.equal(res.code,200,JSON.stringify(res.body));assert.deepEqual((await get(1)).effective_periods,[period('2030-10-14',750,780)]);assert.deepEqual((await get(2)).periods,[period('2030-10-14',780,840)]);
   const shift=(await shifts())[0];assert.equal(shift.absence.start,750);assert.equal(shift.absence.end,840);
  });
  await t.test('une journée complète libère le quart sans réattribuer automatiquement les anciennes journées',async()=>{
   const row=await get(1),full=period('2030-10-22',0,1440);const res=await decide(1,{status:'approved',version:row.version,note:'Toute la journée',periods:[input(full)]});assert.equal(res.code,200);assert.equal(res.body.releasedShifts,1);assert.deepEqual((await assignments()).map(r=>Number(r.shift_id)),[1,3]);
   const next=await get(1);const moved=await decide(1,{status:'approved',version:next.version,note:'Retour au lundi',periods:[input(old)]});assert.equal(moved.code,200);assert.deepEqual((await assignments()).map(r=>Number(r.shift_id)),[1,3]);
  });
 }finally{if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;await f.db.close();}
});
