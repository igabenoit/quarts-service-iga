import {serviceShiftTiming} from '../public/service-rules.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
function print(data){const c=vm.createContext({serviceShiftTiming,});vm.runInContext(source.slice(0,source.indexOf('function render(){')),c);c.data={weekStart:'2026-10-12',employees:[],shifts:[],assignments:[],approvedLeaves:[],timeOff:[],...data};return vm.runInContext('servicePrintHTML(data)',c);}
const person=(id,role='cashier')=>({id,name:'Employé témoin '+id,role,active:true,displayRank:id,seniority:'2020-01-01',availability:{0:[[480,1020]],1:[[0,1440]]}});
const shift=(id,role='cashier',dayIndex=0)=>({id,role,dayIndex,startMinute:480,endMinute:960,breakMinutes:60,paidMinutes:420});
test('Service pages keep every employee exactly once across page boundaries and preserve priorities',()=>{
 const employees=Array.from({length:31},(_,i)=>person(i+1));const html=print({employees});
 for(const p of employees)assert.equal((html.match(new RegExp(`data-person="${p.id}"`,'g'))||[]).length,1);
 assert.ok(html.indexOf('data-person="1"')<html.indexOf('data-person="2"'));assert.ok((html.match(/class="service-sheet"/g)||[]).length>3);assert.equal((html.match(/class="sheet-header"/g)||[]).length,(html.match(/class="service-sheet"/g)||[]).length);
});
test('cross-role assignments and uncovered shifts are printed once and all paid totals reconcile',()=>{
 const data={employees:[person(1,'packer'),person(2,'cashier')],shifts:[shift(1,'cashier'),shift(2,'packer',1),shift(3,'cashier',2)],assignments:[{shiftId:1,employeeId:1},{shiftId:2,employeeId:2}]};
 const html=print(data),totals=[...html.matchAll(/Cette feuille : ([0-9,]+) h/g)].map(m=>Number(m[1].replace(',','.')));
 assert.equal(totals.reduce((a,b)=>a+b,0),21);assert.equal((html.match(/class="print-start"/g)||[]).length,3);assert.match(html,/class="service-role">Caissière/);assert.match(html,/class="service-role">Emballeur/);assert.match(html,/Service · semaine complète : 21 h/);assert.match(html,/dont 7 h à couvrir/);
});
test('two shifts, availability, birthday and partial approved leave all survive in a larger cell',()=>{
 const p={...person(1),birthday:'1995-10-12'};const data={employees:[p],shifts:[{...shift(1),endMinute:600,paidMinutes:120,breakMinutes:0},{...shift(2),startMinute:840,endMinute:960,paidMinutes:120,breakMinutes:0}],assignments:[{shiftId:1,employeeId:1},{shiftId:2,employeeId:1}],approvedLeaves:[{employee_id:1,periods:[{date:'2026-10-12',allDay:false,startMinute:600,endMinute:840}]}]};
 const html=print(data);assert.equal((html.match(/class="print-start"/g)||[]).length,2);assert.match(html,/Bonne fête !/);assert.match(html,/10:00–14:00/);assert.match(html,/<span>4<\/span><span>8–17<\/span>/);assert.match(html,/--row-height:(84|126)pt" data-person="1"/);assert.match(html,/<span>J<\/span>/);
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
