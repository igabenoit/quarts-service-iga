import test from 'node:test';
import assert from 'node:assert/strict';
import {datesBetween,dayPeriods,quarterHours} from '../public/leave-days.js';
import {normalizeLeave} from '../leave-rules.js';
const parse=periods=>normalizeLeave({email:'test@example.com',reason:'Essai',periods},'2026-09-29T12:00:00Z');
test('journée complète suivie du lendemain jusqu’à 14 h 15, une seule demande',()=>{
 const periods=dayPeriods([{date:'2026-10-11',allDay:true},{date:'2026-10-12',allDay:false,startTime:'00:00',endTime:'14:15'}]);
 const result=parse(periods);assert.deepEqual(result.periods.map(p=>[p.date,p.startMinute,p.endMinute,p.allDay]),[['2026-10-11',0,1440,true],['2026-10-12',0,855,false]]);
});
test('absence en soirée jusqu’à la fin de journée et validation des quarts d’heure',()=>{
 const one={date:'2026-10-12',allDay:false,startTime:'18:30',endTime:'24:00'};assert.equal(parse(dayPeriods([one])).periods[0].endMinute,1440);
 for(const startTime of ['08:10','24:00'])assert.throws(()=>parse([{startDate:one.date,endDate:one.date,allDay:false,startTime,endTime:'24:00'}]));
 assert.throws(()=>dayPeriods([{...one,startTime:'18:30',endTime:'18:15'}]));assert.equal(quarterHours.length,97);assert.ok(quarterHours.includes('08:15'));
});
test('vacances longues regroupées sans perte et dates impossibles refusées',()=>{
 const dates=datesBetween('2026-12-01','2027-02-01');const periods=dayPeriods(dates.map(date=>({date,allDay:true})));assert.equal(periods.length,1);assert.equal(parse(periods).periods.length,dates.length);
 assert.throws(()=>datesBetween('2026-02-30','2026-03-02'));assert.throws(()=>datesBetween('2026-10-12','2026-10-11'));
});
