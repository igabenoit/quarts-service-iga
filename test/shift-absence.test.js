import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeCell,cellMinutes,cellDetail,publicSnapshot,blankCell,sheetHTML} from '../public/departments-core.js';
import {shiftWithApprovedLeave,storedShiftAbsence,editedShiftLeave} from '../public/approved-shift-leave.js';
import {serviceShiftTiming} from '../public/service-rules.js';
import {personalDays} from '../public/portal-weeks.js';
import {conflictsWithLeave} from '../leave-rules.js';
import {departmentFixture} from './department-fixture.js';
const absence=includesMeal=>({start:750,end:810,includesMeal});
const cell=includesMeal=>normalizeCell({kind:'shift',start:480,end:1020,breakMinutes:60,absence:absence(includesMeal)});
test('both meal options keep the complete shift and deduct absence exactly once',()=>{
 for(const [included,expected] of [[false,420],[true,480]]){
  const c=cell(included);assert.equal(c.start,480);assert.equal(c.end,1020);assert.equal(cellMinutes(c),expected);
  assert.equal(serviceShiftTiming(480,1020,absence(included)).paidMinutes,expected);
  assert.match(cellDetail(c),/12:30.*13:30/);
 }
 assert.equal(cellMinutes(normalizeCell({...cell(false),absence:null})),480);
 assert.throws(()=>normalizeCell({...cell(false),paidMinutesOverride:480}));
 for(const a of [{start:400,end:500,includesMeal:false},{start:800,end:750,includesMeal:false},{start:750,end:780,includesMeal:true},{start:750,end:810,includesMeal:'yes'}]){
  assert.throws(()=>normalizeCell({...cell(false),absence:a}));assert.throws(()=>serviceShiftTiming(480,1020,a));
 }
 const night=normalizeCell({kind:'shift',start:1320,end:1800,breakMinutes:30,absence:{start:1500,end:1560,includesMeal:true}});
 assert.equal(cellMinutes(night),420);assert.match(cellDetail(night),/01:00 \+1/);
});
test('public snapshots, personal schedules and printed department cells retain the exception',()=>{
 const person={id:1,name:'Employée Démo',group:'regular',departments:[2],availability:{}};
 const draft={rows:[{personId:1,cells:[cell(false),...Array.from({length:6},blankCell)]}],notes:''};
 const snapshot=publicSnapshot(draft,[person]);assert.deepEqual(snapshot.rows[0].cells[0].absence,absence(false));
 const html=sheetHTML({department:{id:2,key:'administration'},weekStart:'2026-10-26',people:[person],draft});assert.match(html,/Absence à ses frais/);
 const days=personalDays('2026-10-26',[{kind:'service',data:{weekStart:'2026-10-26',employees:[{shifts:[{dayIndex:0,startMinute:480,endMinute:1020,role:'cashier',absence:absence(false)}]}]}}]);
 assert.equal(days[0].entries[0].minutes,420);assert.match(days[0].entries[0].detail,/Absence à ses frais/);
});
test('approved leave covered by absence does not conflict with the remaining work',()=>{
 const s={weekStart:'2026-10-26',dayIndex:3,startMinute:480,endMinute:1020,absence:absence(false)};
 const p={date:'2026-10-29',startMinute:750,endMinute:810};
 assert.equal(conflictsWithLeave(s,[p]),false);
 assert.equal(conflictsWithLeave(s,[{...p,startMinute:740}]),true);
 assert.equal(conflictsWithLeave({...s,absence:null},[p]),true);
});
test('Service create/update handlers persist absence and mapping restores its calculated totals',async()=>{
 const f=await departmentFixture();try{
  const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const rules=source.slice(source.indexOf('function parseMinutes('),source.indexOf('async function ensureWeek('))+source.slice(source.indexOf('function mapShift('),source.indexOf('function normalizeEmployee('));
  const {normalizeShift,mapShift}=new Function('serviceShiftTiming','isoDate',rules+';return {normalizeShift,mapShift};')(serviceShiftTiming,v=>v);
  const handlers=new Map();const app={post:(p,...h)=>handlers.set('post '+p,h.at(-1)),put:(p,...h)=>handlers.set('put '+p,h.at(-1))};
  const code=source.slice(source.indexOf('app.post("/api/weeks/:weekStart/shifts"'),source.indexOf('app.delete("/api/shifts/:id"'));
  const ensureWeek=async(start,client)=>client.query('INSERT INTO schedule_weeks(week_start) VALUES($1) ON CONFLICT DO NOTHING',[start]);
  new Function('app','pool','requireManager','sameOrigin','validDate','normalizeShift','beginUndo','ensureWeek','mapShift','parseMinutes','approvedLeave','conflictsWithLeave','isoDate','shiftWithApprovedLeave','storedShiftAbsence','editedShiftLeave',code)(app,f.pool,()=>{},()=>{},()=>true,normalizeShift,async()=>{},ensureWeek,mapShift,(v)=>Number(v),async()=>[],conflictsWithLeave,v=>v,shiftWithApprovedLeave,storedShiftAbsence,editedShiftLeave);
  const response=()=>({status(n){this.code=n;return this;},json(b){this.body=b;return this;}});
  const r=response();await handlers.get('post /api/weeks/:weekStart/shifts')({params:{weekStart:'2026-10-26'},body:{role:'cashier',startMinute:480,endMinute:1020,days:[3],absence:absence(false)}},r);
  assert.equal(r.code,201,JSON.stringify(r.body));assert.equal(r.body.shifts[0].paidMinutes,420);
  const id=r.body.shifts[0].id,res=response();await handlers.get('put /api/shifts/:id')({params:{id},body:{role:'cashier',startMinute:480,endMinute:1020,dayIndex:3,absence:absence(true)}},res);
  assert.equal(res.body.shift.paidMinutes,480,JSON.stringify(res.body));
  const row=(await f.pool.query('SELECT * FROM schedule_shifts WHERE id=$1',[id])).rows[0];assert.deepEqual(row.absence,absence(true));
 }finally{await f.db.close();}
});

test('Service print retains absence and adjusted hours',async()=>{
 const {default:vm}=await import('node:vm');
 const {absenceLabel}=await import('../public/shift-absence.js');
 const {escapeHTML,addDays}=await import('../public/departments-core.js');
 const {serviceDayPortions}=await import('../public/shared-service.js');
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const fixture={weekStart:'2026-10-26',shifts:[{id:1,role:'cashier',dayIndex:3,startMinute:480,endMinute:1020,absence:absence(false)}],assignments:[{shiftId:1,employeeId:1}],employees:[{id:1,name:'Démo',role:'cashier',active:true,availability:{}}],timeOff:[],approvedLeaves:[]};
 const context=vm.createContext({absenceLabel,serviceShiftTiming,serviceDayPortions,escapeHtml:escapeHTML,addDays,roleNames:{cashier:'Caissière'},dayNames:['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'],scheduleGroups:[{title:'Supervision',roles:[]},{title:'Caissières',roles:['cashier']},{title:'Emballeurs',roles:[]},{title:'Commandes',roles:[]}],compareDisplayOrder:()=>0,seniorityText:()=>'',formatWeek:()=>'',fixture});
 vm.runInContext(source.slice(source.indexOf('function servicePrintHTML('),source.indexOf('function renderPrint()')),context);
 const html=vm.runInContext('servicePrintHTML(fixture)',context);assert.match(html,/Absence à ses frais : 12:30/);assert.match(html,/semaine complète : 7 h/);
});
