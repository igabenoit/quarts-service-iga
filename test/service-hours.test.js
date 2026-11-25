import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceHoursSummary,serviceDayHoursSummary,unassignedServiceShifts} from '../public/service-hours.js';
const shift=(id,role,extra={})=>({id,role,startMinute:480,endMinute:960,...extra});

test('only the four Service functions reconcile planned, assigned and remaining hours',()=>{
 const data={shifts:['manager','supervisor','cashier','packer','orders','support'].map((role,i)=>shift(i+1,role)),assignments:[{shiftId:1,employeeId:99},{shiftId:3,employeeId:99},{shiftId:5,employeeId:99},{shiftId:6,employeeId:99}],departmentSupport:[{paidMinutes:500}],relatedDepartments:[{paidMinutes:600}]},before=structuredClone(data);
 const result=serviceHoursSummary(data);
 assert.equal(result.plannedMinutes,28*60);assert.equal(result.assignedMinutes,14*60);assert.equal(result.unassignedMinutes,14*60);
 assert.equal(result.plannedCount,4);assert.equal(result.assignedCount,2);assert.equal(result.unassignedCount,2);
 assert.equal(result.byRole.manager.assignedMinutes,420);assert.equal(result.byRole.packer.unassignedMinutes,420);
 assert.deepEqual(data,before);
});
test('assign, unassign and cross-role staffing never change the total need',()=>{
 const data={shifts:[shift(1,'cashier'),shift(2,'packer')],employees:[{id:3,role:'manager'}],assignments:[]};
 assert.equal(serviceHoursSummary(data).unassignedMinutes,840);
 data.assignments=[{shiftId:1,employeeId:3}];assert.equal(serviceHoursSummary(data).assignedMinutes,420);
 data.assignments.push({shiftId:2,employeeId:3});assert.equal(serviceHoursSummary(data).unassignedMinutes,0);
 data.assignments=[];assert.equal(serviceHoursSummary(data).plannedMinutes,840);
});
test('paid meals, absences and training are counted once; legacy paidMinutes are recalculated',()=>{
 const data={shifts:[shift(1,'cashier',{paidMinutes:9999,training:true,trainingMinutes:90,absence:{start:720,end:780,includesMeal:false}}),shift(2,'manager',{endMinute:1020,absence:{start:720,end:840,includesMeal:true}})],assignments:[{shiftId:1,employeeId:2}]};
 const s=serviceHoursSummary(data);assert.equal(s.plannedMinutes,780);assert.equal(s.assignedMinutes,360);assert.equal(s.unassignedMinutes,420);assert.equal(s.trainingMinutes,90);
});
test('duplicate, empty and unrelated assignment records cannot inflate assigned hours',()=>{
 const data={shifts:[shift(1,'cashier'),shift(2,'packer')],assignments:[{shiftId:'1',employeeId:'2'},{shiftId:1,employeeId:2},{shiftId:2,employeeId:null},{shiftId:999,employeeId:2}]};
 const s=serviceHoursSummary(data);assert.equal(s.assignedMinutes,420);assert.equal(s.assignedCount,1);assert.equal(s.unassignedMinutes,420);
 assert.equal(serviceHoursSummary().plannedMinutes,0);
});

test('remaining shift list exactly matches the counter scope without changing stored shifts',()=>{
 const data={shifts:['manager','supervisor','cashier','packer','orders','support'].map((role,i)=>shift(i+1,role)),assignments:[{shiftId:'1',employeeId:'7'},{shiftId:3,employeeId:null},{shiftId:4,employeeId:8},{shiftId:999,employeeId:9}]};
 const before=structuredClone(data),remaining=unassignedServiceShifts(data),summary=serviceHoursSummary(data);
 assert.deepEqual(remaining.map(s=>s.id),[2,3]);assert.equal(remaining.length,summary.unassignedCount);
 assert.equal(serviceHoursSummary({shifts:remaining}).plannedMinutes,summary.unassignedMinutes);
 assert.deepEqual(data,before);assert.deepEqual(unassignedServiceShifts(),[]);
});

test('daily categories reconcile with the weekly Service total, including unpaid meals and absences',()=>{
 const data={shifts:[
  shift(1,'cashier',{dayIndex:0,endMinute:1020,absence:{start:660,end:720,includesMeal:false},paidMinutes:9999}),
  shift(2,'cashier',{dayIndex:0,startMinute:960,endMinute:1200,training:true}),
  shift(3,'cashier',{dayIndex:1,startMinute:900,endMinute:1200}),
  shift(4,'manager',{dayIndex:0}),shift(5,'supervisor',{dayIndex:0}),
  shift(6,'packer',{dayIndex:0,startMinute:600,endMinute:840}),
  shift(7,'support',{dayIndex:0,startMinute:600,endMinute:780}),
  shift(8,'orders',{dayIndex:0,startMinute:540,endMinute:780})
 ],assignments:[{shiftId:1,employeeId:9},{shiftId:1,employeeId:9},{shiftId:4,employeeId:null}]};
 const monday=serviceDayHoursSummary(data,0,['cashier']);
 assert.equal(monday.plannedMinutes,11*60);assert.equal(monday.assignedMinutes,7*60);assert.equal(monday.unassignedMinutes,4*60);
 assert.equal(monday.trainingMinutes,4*60);
 const leadership=serviceDayHoursSummary(data,0,['manager','supervisor']);
 assert.equal(leadership.byRole.manager.plannedMinutes,7*60);assert.equal(leadership.byRole.supervisor.plannedMinutes,7*60);
 assert.equal(leadership.plannedMinutes,14*60);
 assert.equal(serviceDayHoursSummary(data,0,['support']).plannedMinutes,3*60);
 assert.equal(serviceDayHoursSummary(data,0,['orders']).plannedMinutes,4*60);
 assert.equal(serviceDayHoursSummary(data,1,['cashier']).plannedMinutes,5*60);
 assert.equal(serviceDayHoursSummary(data,6,['cashier']).plannedMinutes,0);
 const days=Array.from({length:7},(_,day)=>serviceDayHoursSummary(data,day)),week=serviceHoursSummary(data);
 for(const field of ['plannedMinutes','assignedMinutes','unassignedMinutes'])assert.equal(days.reduce((sum,d)=>sum+d[field],0),week[field]);
 assert.equal(week.plannedMinutes,34*60);
 data.assignments.push({shiftId:3,employeeId:9});
 assert.equal(serviceDayHoursSummary(data,1,['cashier']).assignedMinutes,5*60);
 assert.equal(serviceDayHoursSummary(data,1,['cashier']).unassignedMinutes,0);
 assert.equal(serviceDayHoursSummary(data,0,['cashier']).assignedMinutes,7*60);
});
