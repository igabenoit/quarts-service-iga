import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {installDepartmentHoursSummary} from '../department-hours-summary.js';
import {plannedSummary,summaryDelta,summaryPage,summaryCSV,parseSummaryHours,normalizeSummaryActual,productiveMinutes,actualKitchenMinutes,actualProductiveMinutes,summaryMetrics} from '../public/department-summary.js';
import {blankCell,DEPARTMENT_STYLES} from '../public/departments-core.js';
test('productive hours exclude kitchen and Service includes a separate orders subtotal; actuals persist with authorization and version checks',async()=>{
const db=new PGlite();try{const pool={async query(sql,args){const r=args?await db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};return {...r,rowCount:r.affectedRows??r.rows.length};}};
await pool.query('CREATE TABLE schedule_leave_departments(id BIGINT PRIMARY KEY); INSERT INTO schedule_leave_departments VALUES(1),(2),(3); CREATE TABLE schedule_shifts(week_start DATE,role TEXT,start_minute INTEGER,end_minute INTEGER);');
await pool.query("INSERT INTO schedule_shifts VALUES('2026-10-19','cashier',480,1020),('2026-10-19','supervisor',480,960),('2026-10-19','packer',480,720),('2026-10-19','manager',480,1020),('2026-10-19','orders',480,960),('2026-10-19','support',480,1020)");
const people=[{id:1,name:'Sylvain Malo'}];const data={department:{id:2,key:'viande',name:'Viande'},weekStart:'2026-10-19',revision:4,people,draft:{rows:[{personId:1,cells:[{kind:'shift',start:480,end:900,breakMinutes:0,paidMinutesOverride:480},...Array.from({length:6},blankCell)]}]}};
const routes=new Map(),app={};for(const method of ['get','put'])app[method]=(path,...handlers)=>routes.set(method,handlers.at(-1));
const deps={1:{id:1,key:'service',name:'Service'},2:data.department,3:{id:3,key:'administration',name:'Administration'}};
await installDepartmentHoursSummary(app,pool,{requireManager(){},sameOrigin(){},departmentFor:async id=>deps[id],weekFor:value=>{assert.equal(value,'2026-10-19');return value;},getWeek:async id=>id===3?{...data,department:deps[3],revision:0,draft:{rows:[]}}:data});
const call=async(method,id,body={},manager={kind:'admin'})=>{const res={code:200,status(n){this.code=n;return this;},json(value){this.body=value;return this;}};await routes.get(method)({params:{id:String(id),week:'2026-10-19'},body,manager},res);return res;};
assert.equal(parseSummaryHours('487,5'),29250);assert.equal(parseSummaryHours('487:30'),29250);assert.equal(parseSummaryHours(''),null);assert.equal(parseSummaryHours('0'),0);assert.throws(()=>parseSummaryHours('-1'));assert.throws(()=>parseSummaryHours('7:99'));assert.throws(()=>normalizeSummaryActual({minutes:NaN,note:''}));
const meat=await call('get',2);assert.equal(meat.body.total,480);assert.equal(summaryDelta(meat.body),null);
const saved=await call('put',2,{version:0,actual:{minutes:450,note:'Départ plus tôt'}});assert.equal(saved.code,200);assert.equal(summaryDelta(saved.body),-30);
assert.equal((await call('get',2)).body.actual.minutes,450);
assert.equal((await call('put',2,{version:0,actual:{minutes:0,note:''}})).code,409);
assert.equal((await call('get',2)).body.actual.minutes,450);
assert.equal((await call('put',2,{version:1,actual:{minutes:0,note:''}})).body.actual.minutes,0);
assert.equal((await call('get',1,{}, {kind:'account',departments:[2]})).code,403);
const service=await call('get',1);assert.equal(service.body.total,2040);assert.equal(service.body.totals.shift,1620);assert.equal(service.body.totals.orders,420);assert.equal(service.body.serviceBreakdown.manager,480);assert.equal(service.body.serviceBreakdown.checkout,1620);assert.equal(service.body.serviceBreakdown.orders,420);assert.equal(service.body.serviceBreakdown.checkout+service.body.serviceBreakdown.orders,service.body.total);
const admin=await call('get',3);assert.equal(admin.body.total,0);assert.equal(admin.body.empty,true);assert.ok(DEPARTMENT_STYLES.some(d=>d.key==='administration'));
const rows=[service.body,saved.body,admin.body];assert.equal((summaryPage(rows).match(/<article/g)||[]).length,1);assert.equal(summaryCSV(rows).split('\r\n').length,7);
const pam={department:{id:9,key:'pam',name:'Prêt-à-manger'},weekStart:'2026-10-19',totals:{shift:373*60,training:18*60,buffet:16*60,kitchen:80*60},total:487*60,actual:{minutes:480*60,kitchenMinutes:75*60,note:''}};
assert.equal(productiveMinutes(pam),407*60);assert.equal(actualKitchenMinutes(pam),75*60);assert.equal(actualProductiveMinutes(pam),405*60);
assert.deepEqual(summaryMetrics([pam]).map(m=>[m.planned,m.actual,m.delta]),[[407*60,405*60,-2*60],[80*60,75*60,-5*60],[487*60,480*60,-7*60]]);
assert.equal(actualProductiveMinutes({...pam,actual:{minutes:480*60,note:''}}),null);assert.equal(actualProductiveMinutes({...pam,actual:{minutes:0,note:''}}),0);
assert.throws(()=>normalizeSummaryActual({minutes:60,kitchenMinutes:61,note:''}));assert.throws(()=>normalizeSummaryActual({minutes:null,kitchenMinutes:60,note:''}));
const kitchenSaved=await call('put',2,{version:2,actual:{minutes:480,kitchenMinutes:60,note:'Cuisine à part'}});assert.equal(kitchenSaved.body.actual.kitchenMinutes,60);assert.equal((await call('get',2)).body.actual.kitchenMinutes,60);
assert.ok(summaryPage([pam]).includes('407'));assert.ok(summaryPage([service.body]).includes('Commandes téléphoniques : 7 h'));
}finally{await db.close();}
});

