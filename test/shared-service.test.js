import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import {serviceWeekProjection,departmentPortionsForService,serviceDayPortions} from '../public/shared-service.js';
import {serviceShiftTiming} from '../public/service-rules.js';
import {blankCell,sheetHTML,escapeHTML} from '../public/departments-core.js';
import {relatedFor} from '../department-transfers.js';
import {plannedSummary} from '../public/department-summary.js';
import {departmentFixture} from './department-fixture.js';

const person={id:10,serviceEmployeeId:3,name:'Employée exemple',group:'regular',active:true,departments:[6,7],availability:{},seniorityDate:'2020-01-01'};
const cells=()=>{const c=Array.from({length:7},blankCell);c[0]={kind:'shift',start:420,end:660,breakMinutes:0,note:''};return c;};
const bakery={key:'boulangerie',department_id:6,draft:{rows:[{personId:10,cells:cells()}]}};
const service=serviceWeekProjection([{employee_id:3,day_index:0,start_minute:720,end_minute:960}],[person],7);
const data={weekStart:'2026-10-19',shifts:[{id:1,role:'cashier',dayIndex:0,startMinute:720,endMinute:960,paidMinutes:240}],assignments:[{shiftId:1,employeeId:3}],relatedDepartments:departmentPortionsForService([bakery,service],[person]),employees:[{id:3,name:person.name,active:true,role:'cashier',availability:{},seniority:'2020-01-01'}],timeOff:[],approvedLeaves:[]};

test('7–11 bakery + 12–16 Service is one displayed day, 8 paid hours, 4 in each department',()=>{
  const related=relatedFor([bakery,service],'boulangerie',[person],[person]);
  assert.equal(related.length,1);assert.equal(related[0].sourceDepartment,'service');
  const summary=plannedSummary({department:{id:6,key:'boulangerie'},weekStart:data.weekStart,people:[person],draft:bakery.draft,related,revision:1});
  assert.equal(summary.total,240);
  const html=sheetHTML({department:{id:6,key:'boulangerie',name:'Boulangerie'},weekStart:data.weekStart,people:[person],draft:bakery.draft,related});
  assert.match(html,/07:00/);assert.match(html,/11:00/);assert.match(html,/12:00/);assert.match(html,/16:00/);assert.match(html,/Boulangerie/);assert.match(html,/Service/);assert.match(html,/Grand total : 4 h/);assert.match(html,/Sem\. 8 h/);
  assert.equal(service.draft.rows[0].cells[0].paidMinutesOverride,240);
  assert.equal(serviceDayPortions(data,3,0).length,1);assert.equal(serviceDayPortions(data,3,1).length,0);
  assert.equal(serviceDayPortions({...data,assignments:[]},3,0).length,0);
});

test('explicit linked records match; unrelated equal names do not match and unposted Service stays private',()=>{
  const staff=[{...person,id:10,serviceEmployeeId:null,portalPersonId:11},{...person,id:11}];
  const linked=serviceWeekProjection([{employee_id:3,day_index:0,start_minute:720,end_minute:960}],staff,7);
  assert.equal(relatedFor([bakery,linked],'boulangerie',staff,[staff[0]]).length,1);
  assert.equal(relatedFor([bakery,linked],'boulangerie',staff,[staff[0]],{published:true}).length,0);
  const other={...person,id:12,serviceEmployeeId:null};
  assert.equal(relatedFor([service],'boulangerie',[person,other],[other]).length,0);
});

test('Service printable day includes both portions but Service weekly totals retain only 4 hours',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const context=vm.createContext({serviceShiftTiming,serviceDayPortions,escapeHtml:escapeHTML,roleNames:{cashier:'Caissière'},dayNames:['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'],scheduleGroups:[{title:'Caissières',roles:['cashier']},{title:'Autres',roles:[]},{title:'Emballeurs',roles:[]},{title:'Commandes',roles:[]}],compareDisplayOrder:()=>0,seniorityText:()=>'',formatWeek:()=>'',addDays:(s,d)=>'2026-10-'+(19+d),fixture:data});
  vm.runInContext(source.slice(source.indexOf('function servicePrintHTML('),source.indexOf('function renderPrint()')),context);
  const html=vm.runInContext('servicePrintHTML(fixture)',context);
  assert.match(html,/07:00/);assert.match(html,/11:00/);assert.match(html,/12:00/);assert.match(html,/16:00/);
  assert.match(html,/4 Serv\. \/ 8 total/);assert.match(html,/semaine complète : 4 h/);assert.match(html,/Boulangerie/);
  if(process.env.WRITE_SHARED_FIXTURE)writeFileSync('shared-service-preview.html','<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/print.css">'+html);
});

test('database bridge reads saved Service assignments and department portions without duplicating accounting',async()=>{
  const f=await departmentFixture();try{
    await f.pool.query("INSERT INTO schedule_employees(id,name,area,role,availability) VALUES(99,'Partage test','front','cashier','{}')");
    const people=await f.service.directory(),p=people.find(p=>p.serviceEmployeeId===99);
    const bakeryId=Number((await f.pool.query("SELECT id FROM schedule_leave_departments WHERE schedule_key='boulangerie'")).rows[0].id);
    await f.pool.query('INSERT INTO schedule_store_memberships(person_id,department_id) VALUES($1,$2)',[p.id,bakeryId]);
    await f.pool.query("INSERT INTO schedule_weeks(week_start) VALUES('2026-10-19')");
    const shift=(await f.pool.query("INSERT INTO schedule_shifts(week_start,area,role,day_index,start_minute,end_minute,break_minutes) VALUES('2026-10-19','front','cashier',0,720,960,0) RETURNING id")).rows[0];
    await f.pool.query('INSERT INTO schedule_assignments(shift_id,employee_id) VALUES($1,99)',[shift.id]);
    await f.pool.query("INSERT INTO schedule_department_weeks(department_id,week_start,draft,revision) VALUES($1,'2026-10-19',$2,1)",[bakeryId,JSON.stringify({manager:'',notes:'',rows:[{personId:p.id,cells:cells()}]})]);
    const loaded=await f.service.getWeek(bakeryId,'2026-10-19');assert.equal(loaded.related.length,1);assert.equal(loaded.related[0].cell.paidMinutesOverride,240);assert.equal(plannedSummary(loaded).total,240);
    const portions=await f.service.serviceRelated('2026-10-19');assert.equal(portions.length,1);assert.equal(portions[0].employeeId,99);assert.equal(portions[0].paidMinutes,240);
  }finally{await f.db.close();}
});
