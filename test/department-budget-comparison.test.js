import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetMinutes,programmedMinutes,budgetDelta,budgetLabel,budgetComparisonTotals} from '../public/department-budget-comparison.js';
import {summaryPage,summaryCSV} from '../public/department-summary.js';
const row=(key,hours,extra={})=>({department:{id:1,key,name:key},weekStart:'2026-11-30',totals:{shift:8*60,training:2*60,buffet:60,kitchen:4*60,mention:3*60},total:18*60,actual:{minutes:17*60,kitchenMinutes:4*60,note:''},budget:{status:'ready',department:key,hours},...extra});
test('budget is independent of the schedule and payroll, with kitchen and separate assignments outside department scope',()=>{
 const data=row('pam',20);assert.equal(budgetMinutes(data),1200);assert.equal(programmedMinutes(data),660);assert.equal(budgetDelta(data),-540);
 assert.equal(programmedMinutes({...data,actual:{minutes:0}}),660);
 assert.equal(budgetMinutes({...data,total:9999,totals:{shift:9999}}),1200);
 assert.equal(programmedMinutes(row('cuisine',5)),240);
 assert.equal(programmedMinutes(row('service',20,{totals:{shift:600,training:120,orders:240}})),960);
});
test('unknown budgets never fall back to scheduled hours; zero budgets and decimal hours remain valid',()=>{
 const zero=row('pam',0);assert.equal(budgetDelta(zero),660);assert.equal(budgetLabel(zero),'0 h');
 assert.equal(budgetMinutes(row('pam',12.25)),735);
 for(const budget of [{status:'ready',hours:null},{status:'unavailable',hours:null},undefined]){
  const missing=row('pam',1,{budget});assert.equal(budgetMinutes(missing),null);assert.equal(budgetDelta(missing),null);
  assert.equal(budgetComparisonTotals([zero,missing])[0].budget,null);
 }
});
test('screen, PDF and CSV compare the same budgets and scheduled amounts, excluding kitchen from the store total',()=>{
 const pam=row('pam',20),kitchen=row('cuisine',5),rows=[pam,kitchen];
 const totals=budgetComparisonTotals(rows);assert.deepEqual(totals.map(m=>[m.budget,m.programmed,m.delta]),[[1200,660,-540],[300,240,-60]]);
 const html=summaryPage(rows),csv=summaryCSV(rows);
 assert.match(html,/20 h/);assert.match(html,/11 h/);assert.match(html,/-9 h/);assert.match(html,/Budget et heures programmées/);
 assert.match(csv,/"pam";"2026-11-30";"20";"11";"'-9"/);assert.match(csv,/Total du magasin · hors cuisine/);
 assert.match(summaryPage([row('pam',null)]),/Non renseigné/);
});
