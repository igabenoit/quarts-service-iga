import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function render({periods=[],manual=false,shift=false}={}) {
  const sheet={innerHTML:''};
  const context=vm.createContext({document:{querySelector:()=>sheet}});
  vm.runInContext(app.slice(0,app.indexOf('function render(){')),context);
  vm.runInContext(app.match(/^function approvedForDay[^\n]+/m)[0],context);
  context.fixture={periods,manual,shift};
  vm.runInContext(`
    state.weekStart='2026-10-12';
    state.employees=[{id:1,name:'Employé exemple',role:'cashier',active:true,seniority:'2020-01-01',availability:{}}];
    state.approvedLeaves=[{employee_id:'1',periods:fixture.periods}];
    state.timeOff=fixture.manual?[{employeeId:1,dayIndex:0}]:[];
    state.shifts=fixture.shift?[{id:1,role:'cashier',dayIndex:0,startMinute:480,endMinute:600,paidMinutes:120}]:[];
    state.assignments=fixture.shift?[{shiftId:1,employeeId:1}]:[];
    renderPrint();
  `,context);
  return sheet.innerHTML;
}
test('la grille affiche le congé approuvé même sans heures attribuées',()=>{
  const html=render({periods:[{date:'2026-10-12',allDay:true,startMinute:0,endMinute:1440}]});
  assert.match(html,/<td class=""><strong class="print-leave">CONGÉ APPROUVÉ<\/strong><\/td>/);
  assert.match(html,/<td class="print-hours">—<\/td>/);
});
test('un congé partiel conserve le quart compatible et son total',()=>{
  const html=render({periods:[{date:'2026-10-12',allDay:false,startMinute:600,endMinute:720}],shift:true});
  assert.match(html,/CONGÉ APPROUVÉ<br>10 h–12 h/);
  assert.match(html,/<span class="print-start">8 h<\/span>/);
  assert.match(html,/<td class="print-hours">2 h<\/td>/);
});
test('les congés manuels restent affichés et les autres semaines sont exclues',()=>{
  const html=render({manual:true,periods:[{date:'2026-10-19',allDay:true,startMinute:0,endMinute:1440}]});
  assert.match(html,/CONGÉ DEMANDÉ/);
  assert.doesNotMatch(html,/CONGÉ APPROUVÉ/);
});
