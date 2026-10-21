import {serviceDayPortions} from '../public/shared-service.js';
import {shiftWithApprovedLeave} from '../public/approved-shift-leave.js';
import {absenceLabel,workingIntervals} from '../public/shift-absence.js';
import {serviceShiftTiming} from '../public/service-rules.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');

test('gérante avant superviseurs, avec des rangs séparés par fonction dans la liste',()=>{
  const list={innerHTML:''};
  const context=vm.createContext({serviceDayPortions,shiftWithApprovedLeave,absenceLabel,workingIntervals,serviceShiftTiming,document:{querySelector:()=>list,querySelectorAll:()=>[]}});
  vm.runInContext(source.slice(0,source.indexOf('function render(){')),context);
  vm.runInContext(source.slice(source.indexOf('function renderEmployees(){'),source.indexOf('async function loadEmployees()')),context);
  vm.runInContext(`state.employees=[
    {id:1,name:'Supervision ancienne',role:'supervisor',displayRank:2,seniority:'1990-01-01'},
    {id:2,name:'Direction',role:'manager',displayRank:1,seniority:'2026-01-01'},
    {id:3,name:'Supervision prioritaire',role:'supervisor',displayRank:1,seniority:'2025-01-01'}
  ].map(p=>({...p,active:true,targetMinutes:0}));renderEmployees();`,context);
  assert.deepEqual([...list.innerHTML.matchAll(/data-id="(\d+)"/g)].map(m=>Number(m[1])),[2,3,1]);
  const groups=[...list.innerHTML.matchAll(/<section class="employee-group">([\s\S]*?)<\/section>/g)].map(m=>m[1]);
  assert.match(groups[0],/^<h3>Gérante<\/h3>/);assert.match(groups[0],/1\. Direction/);assert.doesNotMatch(groups[0],/Supervision/);
  assert.match(groups[1],/^<h3>Superviseurs<\/h3>/);assert.match(groups[1],/1\. Supervision prioritaire/);
});
test('inactif visible, départ retiré de la liste, anciens horaires conservés',()=>{
  const elements=new Map();
  const context=vm.createContext({serviceDayPortions,shiftWithApprovedLeave,absenceLabel,workingIntervals,serviceShiftTiming,document:{querySelector:key=>{if(!elements.has(key))elements.set(key,{innerHTML:''});return elements.get(key);},querySelectorAll:()=>[]}});
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
