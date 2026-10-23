import test from 'node:test';
import assert from 'node:assert/strict';
import {installSalesForecasts} from '../sales-forecasts.js';
import {forecastWeekDates,createSalesForecastDisplay} from '../public/sales-forecast.js';
import {normalizeDepartmentBudget,departmentBudgetHTML} from '../public/department-budget.js';
const start='2026-10-19';
const fixture=()=>({schemaVersion:1,weekStart:start,currency:'CAD',basis:'initial',scope:'store',days:forecastWeekDates(start).map(date=>({date,initialSales:1000}))});
const response=data=>({ok:true,json:async()=>data});

test('budget distinguishes missing from zero and keeps decimal precision and PAM/cuisine scope',()=>{
  for(const hours of [null,0,125.25]){
    const departmentBudget=normalizeDepartmentBudget({department:'pam',hours},'pam');
    const html=departmentBudgetHTML('pam',{status:'ready',data:{departmentBudget}});
    assert.match(html,hours===null?/Non renseignées/:hours===0?/>0 h</:/125,25 h/);
    assert.match(html,/hors cuisine/);
  }
  assert.match(departmentBudgetHTML('cuisine'),/Cuisine séparée/);
  for(const hours of [-1,NaN,Infinity,'12',100000000])assert.throws(()=>normalizeDepartmentBudget({department:'pam',hours},'pam'));
  assert.throws(()=>normalizeDepartmentBudget({department:'fruits',hours:12},'pam'));
});

test('proxy enforces department access and exposes only the requested budget',async()=>{
  let handler,fetches=0;
  const pool={query:async()=>({rows:[{code:'pam'}]})};
  installSalesForecasts({get:(_path,_guard,fn)=>handler=fn},{requireManager:()=>{},pool,token:'test-only-credential-not-for-production-123456',fetchImpl:async()=>{fetches++;return response({...fixture(),departmentBudgets:{pam:125.25,cuisine:50,epicerie:999}});}});
  const call=async(query,manager={kind:'account',departments:[3]})=>{
    const res={code:200,set(){return this;},status(code){this.code=code;return this;},json(body){this.body=body;}};
    await handler({params:{weekStart:start},query,manager},res);return res;
  };
  assert.equal((await call({department:'4'})).code,403);assert.equal(fetches,0);
  assert.equal((await call({department:'bad'})).code,400);
  const allowed=await call({department:'3'});assert.equal(allowed.code,200);
  assert.deepEqual(allowed.body.departmentBudget,{department:'pam',hours:125.25});
  assert.equal(allowed.body.departmentBudgets,undefined);assert.ok(!JSON.stringify(allowed.body).includes('999'));
  assert.equal((await call({})).body.departmentBudget,undefined);
});

test('switching department ignores stale budgets and refresh keeps selected department',async()=>{
  const budget={},status={},button={},pending=[];
  const root={querySelector:s=>s==='[data-department-budget]'?budget:status,querySelectorAll:s=>s==='[data-refresh-sales]'?[button]:[]};
  const display=createSalesForecastDisplay({root,fetchImpl:(url,options)=>new Promise((resolve,reject)=>pending.push({url,options,resolve,reject}))});
  const first=display.load(start,{id:3,key:'pam'}),second=display.load(start,{id:4,key:'cuisine'});
  pending[1].resolve(response({...fixture(),departmentBudget:{department:'cuisine',hours:40}}));await second;
  pending[0].resolve(response({...fixture(),departmentBudget:{department:'pam',hours:125}}));await first;
  assert.match(budget.innerHTML,/>40 h</);assert.doesNotMatch(budget.innerHTML,/125/);
  button.onclick();assert.match(budget.innerHTML,/Chargement/);assert.match(pending[2].url,/department=4$/);
  pending[2].reject(Error('offline'));await new Promise(r=>setImmediate(r));assert.match(budget.innerHTML,/Indisponibles/);assert.doesNotMatch(budget.innerHTML,/>40 h</);
});
