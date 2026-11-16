import test from 'node:test';
import assert from 'node:assert/strict';
import {generateAssignments,canAssign} from '../scheduler.js';
const person=(id,role,extra={})=>({id,role,roles:['cashier','packer','supervisor'],active:true,seniority:'2020-01-01',targetMinutes:480,maxMinutes:480,availability:Object.fromEntries(Array.from({length:7},(_,d)=>[d,[[0,1440]]])),...extra});
const shift=(id,role,dayIndex,paidMinutes)=>({id,role,dayIndex,startMinute:480,endMinute:480+paidMinutes,paidMinutes});
const owner=(result,id)=>result.assignments.find(a=>a.shiftId===id)?.employeeId;
test('primary classifications receive their own shifts before senior cross-trained employees can fill other roles',()=>{
 const people=[person(1,'cashier',{seniority:'1990-01-01'}),person(2,'packer'),person(3,'supervisor')];
 const jobs=[shift(1,'packer',0,480),shift(2,'supervisor',0,480),shift(3,'cashier',0,240)];
 const result=generateAssignments(jobs,people);
 assert.equal(owner(result,1),2);assert.equal(owner(result,2),3);assert.equal(owner(result,3),1);
});
test('seniority precedes a conflicting manual rank and seniors receive the longest paid shifts',()=>{
 const people=[person(1,'cashier',{seniority:'1990-01-01',assignmentRank:9}),person(2,'cashier',{seniority:'2020-01-01',assignmentRank:1})];
 const jobs=[shift(1,'cashier',0,240),shift(2,'cashier',0,480)];
 const result=generateAssignments(jobs,people.reverse());
 assert.equal(owner(result,2),1);assert.equal(owner(result,1),2);
 assert.deepEqual(result,generateAssignments([...jobs].reverse(),people));
});
test('long shifts take precedence over a combination of shorter shifts within the requested ceiling',()=>{
 const jobs=[shift(1,'cashier',0,480),shift(2,'cashier',0,360),shift(3,'cashier',1,360)];
 const result=generateAssignments(jobs,[person(1,'cashier',{targetMinutes:720,maxMinutes:720}),person(2,'cashier',{targetMinutes:720,maxMinutes:720})]);
 assert.equal(owner(result,1),1);assert.equal(owner(result,2),2);assert.equal(owner(result,3),2);
});
test('cross-classification fallback remains possible only after primary passes; existing shifts remain untouched',()=>{
 const jobs=[shift(1,'cashier',0,240),shift(2,'packer',1,240),shift(3,'supervisor',2,240)];
 const people=[person(1,'cashier',{roles:['cashier','packer'],targetMinutes:720,maxMinutes:720})];
 const existing=[{shiftId:1,employeeId:1}],before=structuredClone(existing);
 const result=generateAssignments(jobs,people,existing);
 assert.deepEqual(result.assignments,[{shiftId:2,employeeId:1}]);assert.deepEqual(result.unfilled,[3]);assert.deepEqual(existing,before);
});
test('unavailable seniors cannot displace eligible juniors; generated assignments preserve all hard constraints',()=>{
 const jobs=[shift(1,'cashier',0,480),shift(2,'cashier',1,240)];
 const people=[person(1,'cashier',{seniority:'1990-01-01',availability:{1:[[0,1440]]},isMinor:true}),person(2,'cashier')];
 const result=generateAssignments(jobs,people);
 assert.equal(owner(result,1),2);assert.equal(owner(result,2),1);
 const accepted=[];for(const a of result.assignments){assert.equal(canAssign(people.find(p=>p.id===a.employeeId),jobs.find(s=>s.id===a.shiftId),jobs,accepted),true);accepted.push(a);}
});
