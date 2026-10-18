import test from 'node:test';
import assert from 'node:assert/strict';
import {installSalesForecasts} from '../sales-forecasts.js';
import {forecastWeekDates,normalizeInitialForecasts,forecastDayHTML,createSalesForecastDisplay} from '../public/sales-forecast.js';

const fixture=(weekStart='2026-10-19')=>({schemaVersion:1,weekStart,currency:'CAD',basis:'initial',scope:'store',days:forecastWeekDates(weekStart).map((date,i)=>({date,initialSales:i===0?123456.78:i===1?0:i===2?null:50000+i}))});
const response=data=>({ok:true,json:async()=>data});
test('initial totals are matched by actual date and missing is distinct from zero',()=>{
  const data=fixture('2026-12-28');data.days.reverse();
  const normalized=normalizeInitialForecasts(data,'2026-12-28');
  assert.equal(normalized.days[0].date,'2026-12-28');
  assert.equal(normalized.days[6].date,'2027-01-03');
  assert.match(forecastDayHTML('2026-12-28',{status:'ready',data:normalized}),/123\s456,78\s\$/);
  assert.match(forecastDayHTML('2026-12-29',{status:'ready',data:normalized}),/>0,00\s\$/);
  assert.match(forecastDayHTML('2026-12-30',{status:'ready',data:normalized}),/Non renseignée/);
  assert.doesNotMatch(forecastDayHTML('2027-01-04',{status:'ready',data:normalized}),/123\s456/);
  assert.equal(forecastWeekDates('2028-02-28')[1],'2028-02-29');
  assert.equal(forecastWeekDates('2026-10-26')[6],'2026-11-01');
  assert.equal(forecastWeekDates('2026-02-30'),null);
  assert.equal(forecastWeekDates('2026-10-20'),null);
  for(const edit of [d=>d.basis='revised',d=>d.scope='department',d=>d.currency='USD',d=>d.days.pop(),d=>d.days[1]=d.days[0],d=>d.days[0].date='2026-10-20',d=>d.days[0].initialSales=-1,d=>d.days[0].initialSales='123',d=>d.days[0].initialSales=Infinity]){
    const bad=fixture();edit(bad);assert.throws(()=>normalizeInitialForecasts(bad,'2026-10-19'));
  }
  assert.throws(()=>normalizeInitialForecasts(fixture(),'2026-10-26'));
});

test('proxy keeps the credential server-side, validates source and degrades without schedule writes',async()=>{
  let handler,guard,options,url,calls=0;
  const requireManager=()=>{},token='test-only-credential-not-for-production-123456';
  const app={get(path,middleware,fn){assert.equal(path,'/api/sales-forecasts/:weekStart');guard=middleware;handler=fn;}};
  const fetchImpl=async(u,o)=>{calls++;url=u;options=o;return response({...fixture(),secret:'must be removed'});};
  installSalesForecasts(app,{requireManager,token,fetchImpl});assert.equal(guard,requireManager);
  const call=async(weekStart='2026-10-19')=>{const res={code:200,set(k,v){this[k]=v;return this;},status(code){this.code=code;return this;},json(body){this.body=body;}};await handler({params:{weekStart}},res);return res;};
  const good=await call();assert.equal(good.code,200);assert.equal(good['Cache-Control'],'no-store');
  assert.deepEqual(good.body,fixture());assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.redirect,'error');
  assert.equal(url,'https://releve-quotidien-iga.onrender.com/api/integrations/quarts-service/initial-sales/2026-10-19');
  assert.equal((await call('2026-10-20')).code,400);assert.equal(calls,1);
  for(const result of [{ok:false},response(fixture('2026-10-26')),response({...fixture(),basis:'revised'})]){
    installSalesForecasts(app,{requireManager,token,fetchImpl:async()=>result});assert.equal((await call()).code,503);
  }
  installSalesForecasts(app,{requireManager,token:'',fetchImpl:()=>{throw Error('must not fetch');}});assert.equal((await call()).code,503);
  installSalesForecasts(app,{requireManager,token,timeoutMs:5,fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error(token))))});
  const keepAlive=setTimeout(()=>{},100);
  const timeout=await call();clearTimeout(keepAlive);assert.equal(timeout.code,503);assert.ok(!JSON.stringify(timeout).includes(token));
});

test('late responses and errors cannot leave old amounts above a newly selected week; refresh does not edit drafts',async()=>{
  const pending=[],nodes=[],status={},button={};
  const root={querySelector:()=>status,querySelectorAll:selector=>selector==='[data-refresh-sales]'?[button]:nodes};
  const display=createSalesForecastDisplay({root,fetchImpl:(url,options)=>new Promise((resolve,reject)=>pending.push({url,options,resolve,reject}))});
  const first=display.load('2026-10-19');
  nodes.push({dataset:{forecastDate:'2026-10-26'},outerHTML:''});
  const second=display.load('2026-10-26');assert.equal(pending[0].options.signal.aborted,true);
  pending[1].resolve(response(fixture('2026-10-26')));await second;
  pending[0].resolve(response(fixture()));await first;
  assert.match(nodes[0].outerHTML,/123\s456,78/);assert.match(display.dayHTML('2026-10-19'),/Chargement/);
  const refresh=button.onclick();assert.match(nodes[0].outerHTML,/Chargement/);assert.equal(pending[2].url,'/api/sales-forecasts/2026-10-26');
  pending[2].reject(Error('offline'));await new Promise(resolve=>setImmediate(resolve));
  assert.match(nodes[0].outerHTML,/Indisponible/);assert.doesNotMatch(nodes[0].outerHTML,/123\s456/);assert.match(status.textContent,/Actualisez/);
  const retry=display.load('2026-10-26');pending[3].resolve(response(fixture('2026-10-26')));await retry;
  assert.match(nodes[0].outerHTML,/123\s456,78/);assert.match(status.textContent,/initiales/);
});
