import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {serviceShiftTiming} from '../public/service-rules.js';
import {personalDays} from '../public/portal-weeks.js';
const cases=[[180,1,0,180],[240,1,0,240],[300,1,0,300],[360,2,0,360],[420,2,0,420],[480,2,60,420],[540,2,60,480]];
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const ruleSource=server.slice(server.indexOf('function parseMinutes('),server.indexOf('async function ensureWeek('))+server.slice(server.indexOf('function mapShift('),server.indexOf('function normalizeEmployee('));
const {normalizeShift,mapShift}=new Function('serviceShiftTiming','isoDate',ruleSource+';return {normalizeShift,mapShift};')(serviceShiftTiming,x=>x);

test('Service: rest breaks remain paid and an hour-long meal applies from exactly eight elapsed hours',()=>{
 for(const [elapsed,count,meal,paid] of [...cases,[179,0,0,179],[359,1,0,359],[479,2,0,479],[481,2,60,421]]){
  assert.deepEqual(serviceShiftTiming(480,480+elapsed),{breakMinutes:meal,paidBreakCount:count,paidBreakMinutes:count*15,paidMinutes:paid});
 }
 assert.throws(()=>serviceShiftTiming(480,480));assert.throws(()=>serviceShiftTiming(480,300));
});

test('Service API normalizes new and legacy shifts with the same meal rule, without rewriting stored rows',()=>{
 for(const [elapsed,,meal,paid] of cases)for(const oldBreak of [0,15,30,45,60]){
  const input={role:'cashier',startMinute:480,endMinute:480+elapsed,breakMinutes:oldBreak};
  assert.equal(normalizeShift(input).breakMinutes,meal);
  const row={id:'1',week_start:'2026-10-19',area:'front',role:'cashier',day_index:0,start_minute:480,end_minute:480+elapsed,break_minutes:oldBreak};
  const before=structuredClone(row),mapped=mapShift(row);
  assert.equal(mapped.paidMinutes,paid);assert.equal(mapped.breakMinutes,meal);assert.deepEqual(row,before);
 }
});

test('employee portal agrees with Service paid hours even if an older response contains a thirty-minute break',()=>{
 const weekStart='2026-10-19',shifts=cases.map(([elapsed],dayIndex)=>({dayIndex,startMinute:480,endMinute:480+elapsed,breakMinutes:30,role:'cashier'}));
 const days=personalDays(weekStart,[{kind:'service',data:{weekStart,employees:[{shifts}]}}]);
 assert.deepEqual(days.map(day=>day.entries[0].minutes),cases.map(c=>c[3]));
});

test('Service planogram has the paid rest breaks and meal slots required by the same duration rules',()=>{
 const c=vm.createContext({window:{}});vm.runInContext(readFileSync(new URL('../public/planogram.js',import.meta.url),'utf8'),c);
 for(const [elapsed,count,meal] of cases){
  const html=c.window.createPlanogram({weekStart:'2026-10-19',employees:[],assignments:[],shifts:[{id:1,role:'cashier',dayIndex:0,startMinute:480,endMinute:480+elapsed}]});
  assert.equal((html.match(/class="plano-slot"/g)||[]).length,2*(count+(meal?1:0)));
 }
});
