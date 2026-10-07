import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('inactif visible, départ retiré de la liste, anciens horaires conservés',()=>{
  const elements=new Map();
  const context=vm.createContext({document:{querySelector:key=>{if(!elements.has(key))elements.set(key,{innerHTML:''});return elements.get(key);},querySelectorAll:()=>[]}});
  vm.runInContext(source.slice(0,source.indexOf('function render(){')),context);
  vm.runInContext(source.slice(source.indexOf('function renderEmployees(){'),source.indexOf('async function loadEmployees()')),context);
  vm.runInContext(source.match(/^function approvedForDay[^\n]+/m)[0],context);
  vm.runInContext(`
    state.weekStart='2026-10-12';
    state.employees=[{id:1,name:'Absence temporaire',active:false,departedAt:null},{id:2,name:'Départ définitif',active:false,departedAt:'2026-10-07'}].map(e=>({...e,role:'cashier',seniority:'2020-01-01',targetMinutes:0}));
    state.shifts=[{id:1,role:'cashier',dayIndex:0,startMinute:480,endMinute:600,paidMinutes:120}];
    state.assignments=[{shiftId:1,employeeId:2}];
    renderEmployees();renderPrint();
  `,context);
  assert.match(elements.get('#employeeList').innerHTML,/Absence temporaire/);
  assert.doesNotMatch(elements.get('#employeeList').innerHTML,/Départ définitif/);
  assert.match(elements.get('#printSheet').innerHTML,/Départ définitif/);
  vm.runInContext('state.assignments=[];renderPrint();',context);
  assert.doesNotMatch(elements.get('#printSheet').innerHTML,/Départ définitif/);
});
