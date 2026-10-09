import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {assignmentConflict,canAssign,generateAssignments} from '../scheduler.js';
import {conflictsWithLeave} from '../leave-rules.js';

const employee=(extra={})=>({id:1,name:'Employée test',active:true,role:'cashier',seniority:'2020-01-01',
  targetMinutes:900,maxMinutes:2400,allowExtraHours:true,
  availability:Object.fromEntries(Array.from({length:7},(_,day)=>[day,[[0,1440]]])),...extra});
const shift=(id,dayIndex,paidMinutes=450)=>({id,weekStart:'2026-10-12',role:'cashier',dayIndex,
  startMinute:480,endMinute:480+paidMinutes+30,breakMinutes:30,paidMinutes});
const shifts=[shift(1,0),shift(2,1),shift(3,5,210)];
const existing=[{shiftId:1,employeeId:1},{shiftId:2,employeeId:1}];

test('attribution manuelle : passer de 15 h à 18 h 30 est permis sous le maximum, avec ou sans option de génération',()=>{
  for(const allowExtraHours of [false,true]){
    const e=employee({allowExtraHours,maxMinutes:1110});
    assert.equal(canAssign(e,shifts[2],shifts,existing),true);
    assert.equal(assignmentConflict(e,shifts[2],shifts,existing),null);
  }
});

test('le refus distingue le maximum hebdomadaire des heures souhaitées et utilise les heures payées',()=>{
  const reason=assignmentConflict(employee({maxMinutes:900}),shifts[2],shifts,existing);
  assert.match(reason,/18 h 30/);
  assert.match(reason,/Maximum \/ semaine » de 15 h/);
  assert.match(reason,/ne change pas ce maximum/);
  assert.equal(canAssign(employee({maxMinutes:1109}),shifts[2],shifts,existing),false);
  assert.equal(canAssign(employee({maxMinutes:1110}),shifts[2],shifts,existing),true);
});

test('génération : l’option ajoute le quart libre au-delà de 15 h sans déplacer les quarts existants',()=>{
  const before=structuredClone(existing);
  for(const [allowExtraHours,maxMinutes,expected] of [[false,2400,0],[true,2400,1],[true,900,0]]){
    const result=generateAssignments(shifts,[employee({allowExtraHours,maxMinutes})],existing);
    assert.equal(result.assignments.length,expected);
    assert.deepEqual(result.assignments,expected?[{shiftId:3,employeeId:1}]:[]);
    assert.deepEqual(result.unfilled,expected?[]:[3]);
    assert.deepEqual(existing,before);
  }
});

test('les limites des mineurs restent explicites avec les heures supplémentaires autorisées',()=>{
  const minor=employee({isMinor:true});
  assert.match(assignmentConflict(minor,shifts[2],shifts,existing),/limite de 17 h/);
  assert.equal(canAssign(minor,shift(4,6,120),shifts,existing),true);
  assert.match(assignmentConflict(minor,shift(4,2,120),shifts,existing),/déjà deux jours/);
});

test('les autres blocages précisent le congé, la disponibilité, le poste ou le nombre de jours',()=>{
  const e=employee(),candidate=shifts[2];
  assert.match(assignmentConflict({...e,active:false},candidate,shifts,existing),/inactif/);
  assert.match(assignmentConflict({...e,role:'packer'},candidate,shifts,existing),/fonctions/);
  assert.match(assignmentConflict(e,{...candidate,role:'support'},shifts,existing),/autre département/);
  assert.match(assignmentConflict({...e,availability:{}},candidate,shifts,existing),/quart complet/);
  assert.match(assignmentConflict(e,shift(4,0,60),shifts,existing),/déjà un quart/);
  assert.match(assignmentConflict({...e,leavePeriods:[{date:'2026-10-17',startMinute:0,endMinute:1440}]},candidate,shifts,existing),/congé approuvé/);
  const fiveDays=Array.from({length:5},(_,day)=>shift(day+1,day,60));
  const assigned=fiveDays.map(s=>({shiftId:s.id,employeeId:1}));
  const sixth=shift(6,5,60);
  assert.match(assignmentConflict(e,sixth,fiveDays,assigned),/cinq jours/);
  assert.equal(canAssign({...e,allowSixOrSevenDays:true},sixth,fiveDays,assigned),true);
});

test('la route manuelle accepte le dépassement souhaité et renvoie le motif exact du refus sans modifier les autres quarts',async()=>{
  const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const route=source.slice(source.indexOf('app.put("/api/shifts/:id/assignment"'),source.indexOf('app.post("/api/weeks/:weekStart/generate"'));
  for(const maxMinutes of [900,1110]){
    let handler;
    const writes=[],transactions=[];
    const e=employee({maxMinutes});
    const client={release(){},async query(sql,args=[]){
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))transactions.push(sql);
      if(sql==='SELECT * FROM schedule_shifts WHERE id=$1')return {rowCount:1,rows:[{...shifts[2],week_start:shifts[2].weekStart}]};
      if(sql==='SELECT * FROM schedule_employees WHERE id=$1')return {rowCount:1,rows:[e]};
      if(sql.includes('SELECT a.shift_id, a.employee_id'))return {rows:existing.map(a=>({shift_id:a.shiftId,employee_id:a.employeeId}))};
      if(sql==='SELECT * FROM schedule_shifts WHERE week_start=$1')return {rows:shifts};
      if(sql.includes('INSERT INTO schedule_assignments'))writes.push(args);
      return {rowCount:0,rows:[]};
    }};
    const context=vm.createContext({app:{put(_path,...handlers){handler=handlers.at(-1);}},
      pool:{connect:async()=>client},requireManager(){},sameOrigin(){},beginUndo:async()=>{},isoDate:d=>d,
      mapShift:s=>s,mapEmployee:e=>({...e}),approvedLeave:async()=>[],conflictsWithLeave,assignmentConflict});
    vm.runInContext(route,context);
    const response={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({params:{id:'3'},body:{employeeId:1}},response);
    if(maxMinutes===900){
      assert.equal(response.code,400);
      assert.match(response.body.error,/18 h 30.*Maximum \/ semaine » de 15 h/);
      assert.equal(writes.length,0);
      assert.equal(transactions.at(-1),'ROLLBACK');
    }else{
      assert.equal(response.code,200);
      assert.equal(writes.length,1);
      assert.equal(writes[0][0],3);assert.equal(writes[0][1],1);
      assert.equal(transactions.at(-1),'COMMIT');
    }
  }
});
