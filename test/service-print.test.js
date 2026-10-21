import {serviceDayPortions} from '../public/shared-service.js';
import {shiftWithApprovedLeave} from '../public/approved-shift-leave.js';
import {absenceLabel,workingIntervals} from '../public/shift-absence.js';
import {serviceShiftTiming} from '../public/service-rules.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
function print(data){const c=vm.createContext({serviceDayPortions,shiftWithApprovedLeave,absenceLabel,workingIntervals,serviceShiftTiming,});vm.runInContext(source.slice(0,source.indexOf('function render(){')),c);c.data={weekStart:'2026-10-12',employees:[],shifts:[],assignments:[],approvedLeaves:[],timeOff:[],...data};return vm.runInContext('servicePrintHTML(data)',c);}
const person=(id,role='cashier')=>({id,name:'Employé témoin '+id,role,active:true,displayRank:id,seniority:'2020-01-01',availability:{0:[[480,1020]],1:[[0,1440]]}});
const shift=(id,role='cashier',dayIndex=0)=>({id,role,dayIndex,startMinute:480,endMinute:960,breakMinutes:60,paidMinutes:420});

test('manager stays on the first Service sheet with her title and all existing supervision shifts',()=>{
 const html=print({employees:[{...person(1,'manager'),name:'Gérante témoin'}],shifts:[shift(1,'supervisor'),shift(2,'manager',1)],assignments:[{shiftId:1,employeeId:1},{shiftId:2,employeeId:1}]});
 const sheets=html.match(/<article[\s\S]*?<\/article>/g);
 assert.equal(sheets.length,3);assert.match(sheets[0],/Gérante témoin<small class="sheet-job-title">Gérante<\/small><\/div>/);
 assert.equal((html.match(/data-person="1"/g)||[]).length,1);
 assert.equal((sheets[0].match(/class="print-start"/g)||[]).length,2);
 assert.match(sheets[0],/Cette feuille : 14 h/);
});

test('default manager work prints hours without repeating the title in the shift cells',()=>{
 const html=print({employees:[person(1,'manager')],shifts:[shift(1,'manager')],assignments:[{shiftId:1,employeeId:1}]});
 assert.match(html,/sheet-person-label">Employé témoin 1<small class="sheet-job-title">Gérante<\/small><\/div>/);
 assert.doesNotMatch(html,/class="service-role"/);
 assert.equal((html.match(/class="sheet-job-title"/g)||[]).length,1);
 assert.match(html,/class="print-start">08:00/);assert.match(html,/class="print-end">16:00/);
});
test('Service keeps exactly three team sheets with every employee once and in priority order',()=>{
 const employees=Array.from({length:31},(_,i)=>person(i+1));const html=print({employees});
 for(const p of employees)assert.equal((html.match(new RegExp(`data-person="${p.id}"`,'g'))||[]).length,1);
 assert.ok(html.indexOf('data-person="1"')<html.indexOf('data-person="2"'));assert.equal((html.match(/<article class="service-sheet/g)||[]).length,3);assert.equal((html.match(/class="sheet-header"/g)||[]).length,(html.match(/<article class="service-sheet/g)||[]).length);
});

test('managers print before supervisors regardless of their per-role rank or seniority',()=>{
 const employees=[{...person(1,'supervisor'),displayRank:1,seniority:'1990-01-01'},
   {...person(2,'manager'),displayRank:9,seniority:'2025-01-01'},
   {...person(3,'supervisor'),displayRank:2,seniority:'1980-01-01'},
   {...person(4,'manager'),displayRank:1,seniority:'2026-01-01'}];
 const html=print({employees});
 assert.deepEqual([...html.matchAll(/data-person="(\d+)"/g)].map(m=>Number(m[1])),[4,2,1,3]);
 assert.equal((html.match(/<article class="service-sheet/g)||[]).length,3);
});
test('cross-role assignments and uncovered shifts are printed once and all paid totals reconcile',()=>{
 const data={employees:[person(1,'packer'),person(2,'cashier')],shifts:[shift(1,'cashier'),shift(2,'packer',1),shift(3,'cashier',2)],assignments:[{shiftId:1,employeeId:1},{shiftId:2,employeeId:2}]};
 const html=print(data),totals=[...html.matchAll(/Cette feuille : ([0-9,]+) h/g)].map(m=>Number(m[1].replace(',','.')));
 assert.equal(totals.reduce((a,b)=>a+b,0),21);assert.equal((html.match(/class="print-start"/g)||[]).length,3);assert.match(html,/class="service-role">Caissière/);assert.match(html,/class="service-role">Emballeur/);assert.match(html,/Service · semaine complète : 21 h/);assert.match(html,/dont 7 h à couvrir/);
});
test('two shifts, availability, birthday and partial approved leave all survive in a larger cell',()=>{
 const p={...person(1),birthday:'1995-10-12'};const data={employees:[p],shifts:[{...shift(1),endMinute:600,paidMinutes:120,breakMinutes:0},{...shift(2),startMinute:840,endMinute:960,paidMinutes:120,breakMinutes:0}],assignments:[{shiftId:1,employeeId:1},{shiftId:2,employeeId:1}],approvedLeaves:[{employee_id:1,periods:[{date:'2026-10-12',allDay:false,startMinute:600,endMinute:840}]}]};
 const html=print(data);assert.equal((html.match(/class="print-start"/g)||[]).length,2);assert.match(html,/Bonne fête !/);assert.match(html,/10:00–14:00/);assert.match(html,/<span>4<\/span><span>8–17<\/span>/);assert.match(html,/data-row-units="(2|3)" data-person="1"/);assert.match(html,/<span>J<\/span>/);assert.doesNotMatch(html,/ style=/);
});
test('names and department labels are escaped and internal planning notes stay off the printout',()=>{
 const html=print({week:{notes:'Internal planning note'},employees:[{...person(1),name:'<script>alert(1)</script>'}],shifts:[{...shift(1,'support'),sourceDepartment:'<img src=x>'}],assignments:[{shiftId:1,employeeId:1}]});
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x>'));assert.ok(!html.includes('Internal planning note'));assert.match(html,/&lt;img src=x&gt;/);
});

test('paid rest breaks are never deducted, and only a one-hour meal is deducted from shifts of at least 8 hours',()=>{
 for(const [elapsed,paid] of [[3,3],[4,4],[5,5],[6,6],[7,7],[8,7],[9,8]]){
  const html=print({employees:[person(1)],shifts:[{...shift(1),endMinute:480+elapsed*60,breakMinutes:30,paidMinutes:elapsed*60-30}],assignments:[{shiftId:1,employeeId:1}]});
  assert.ok(!html.includes('Pause 30 min'));assert.match(html,new RegExp('class="sheet-total print-hours">'+paid+'<'));assert.match(html,new RegExp('Service · semaine complète : '+paid+' h'));
 }
});

test('sixteen cashiers and a packer with a partial leave stay on their own single sheets',()=>{
 const employees=[...Array.from({length:16},(_,i)=>person(i+1)),...Array.from({length:13},(_,i)=>person(i+17,'packer'))];
 const html=print({employees,shifts:[shift(1,'packer'),shift(2,'packer',1)],assignments:[{shiftId:1,employeeId:17}],approvedLeaves:[{employee_id:17,periods:[{date:'2026-10-12',allDay:false,startMinute:420,endMinute:480}]}]});
 const sheets=html.match(/<article[\s\S]*?<\/article>/g);
 assert.equal(sheets.length,3);
 assert.equal((sheets[1].match(/data-person=/g)||[]).length,16);
 assert.equal((sheets[2].match(/data-person=/g)||[]).length,13);
 assert.match(sheets[1],/data-row-unit="36"/);
 assert.match(sheets[2],/À couvrir/);
 for(const sheet of sheets)assert.match(sheet,/Feuille [123] \/ 3/);
});
