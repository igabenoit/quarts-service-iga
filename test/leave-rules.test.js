import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLeave,localDate,weekOf,leaveStatistics,conflictsWithLeave} from '../leave-rules.js';
import {canAssign,generateAssignments} from '../scheduler.js';
const body=(date,extra={})=>({email:'test@example.com',reason:'Essai',periods:[{startDate:date,endDate:date,allDay:true}],...extra});
test('jeudi avant 9 h au Québec, exemple du lundi 5 octobre',()=>{
 assert.equal(normalizeLeave(body('2026-10-05'),'2026-10-01T12:59:59.999Z').late,false);
 assert.equal(normalizeLeave(body('2026-10-05'),'2026-10-01T13:00:00Z').late,true);
 assert.equal(normalizeLeave(body('2026-10-05'),'2026-09-30T23:00:00Z').deadline,'2026-10-01');
 for(const date of ['2026-10-05','2026-10-08','2026-10-11'])assert.equal(normalizeLeave(body(date),'2026-10-01T13:01:00Z').late,true);
 assert.equal(normalizeLeave(body('2026-10-12'),'2026-10-01T13:01:00Z').late,false);
 assert.equal(normalizeLeave(body('2026-10-05'),'2026-10-01T12:59:00Z').earliest,'2026-10-05');
 assert.equal(normalizeLeave(body('2026-10-05'),'2026-10-01T13:00:00Z').earliest,'2026-10-12');
});
test('heure d’hiver, changement d’année et première semaine d’une demande',()=>{
 assert.equal(normalizeLeave(body('2026-11-09'),'2026-11-05T13:59:59Z').late,false);
 assert.equal(normalizeLeave(body('2026-11-09'),'2026-11-05T14:00:00Z').late,true);
 assert.equal(normalizeLeave(body('2027-01-04'),'2026-12-31T13:59:59Z').late,false);
 const multi=body('2026-10-11',{periods:[{startDate:'2026-10-11',endDate:'2026-10-12',allDay:true}]});
 assert.equal(normalizeLeave(multi,'2026-10-02T12:00:00Z').late,true);
 assert.equal(normalizeLeave(multi,'2026-10-01T12:59:00Z').late,false);
});
test('une demande conserve tous les jours sur plusieurs semaines et années',()=>{
 const result=normalizeLeave(body('2026-12-27',{periods:[{startDate:'2026-12-27',endDate:'2027-01-04',allDay:true}]}),'2026-12-01T12:00Z');
 assert.equal(result.periods.length,9);assert.deepEqual([...new Set(result.periods.map(p=>weekOf(p.date)))],['2026-12-21','2026-12-28','2027-01-04']);
});
test('dates réelles, motif, heures et périodes incohérentes refusés',()=>{
 for(const date of ['2026-02-29','2026-13-01','2026-04-31'])assert.throws(()=>normalizeLeave(body(date),new Date()));
 assert.throws(()=>normalizeLeave(body('2026-10-20',{reason:' '}),new Date()));
 for(const [startTime,endTime] of [['14:00','13:00'],['09:00','09:00'],['24:00','25:00']])assert.throws(()=>normalizeLeave(body('2026-10-20',{periods:[{startDate:'2026-10-20',endDate:'2026-10-20',allDay:false,startTime,endTime}]}),new Date()));
 assert.throws(()=>normalizeLeave(body('2026-10-20',{periods:[{startDate:'2026-10-20',endDate:'2026-10-20',allDay:true},{startDate:'2026-10-20',endDate:'2026-10-20',allDay:true}]}),new Date()));
});
test('une absence partielle ne bloque que les quarts qui la chevauchent',()=>{
 const periods=[{date:'2026-10-19',startMinute:600,endMinute:720,allDay:false}];
 const shift={id:1,role:'cashier',weekStart:'2026-10-19',dayIndex:0,startMinute:480,endMinute:600,paidMinutes:120};
 const employee={id:1,active:true,role:'cashier',availability:{0:[[0,1440]]},maxMinutes:2400,targetMinutes:2400,seniority:'2000-01-01',leavePeriods:periods};
 assert.equal(conflictsWithLeave(shift,periods),false);assert.equal(canAssign(employee,shift,[shift]),true);
 const overlap={...shift,endMinute:601};assert.equal(canAssign(employee,overlap,[overlap]),false);
 assert.equal(generateAssignments([overlap],[employee]).assignments.length,0);
 assert.equal(conflictsWithLeave({...shift,startMinute:720,endMinute:800},periods),false);
});
test('statistiques : une demande multisemaine compte une fois, journées et heures séparées',()=>{
 const rows=[{employee_name:'Test',status:'approved',periods:[{date:'2026-10-18',allDay:true},{date:'2026-10-19',allDay:false,startMinute:600,endMinute:690}],submitted_at:'2026-10-01T12:00Z',decided_at:'2026-10-01T14:00Z'}];
 const stats=leaveStatistics(rows);assert.equal(stats.total,1);assert.equal(stats.fullDays,1);assert.equal(stats.partialHours,1.5);assert.equal(stats.averageResponseHours,2);
});
