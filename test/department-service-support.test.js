import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCell,blankCell,totalMinutes,mentionMinutes,grandMinutes,separateMentionTotals,sheetHTML} from '../public/departments-core.js';
import {departmentServiceSupport,supportTotals,supportBoardHTML,supportPrintHTML} from '../public/department-service-support.js';
import {plannedSummary} from '../public/department-summary.js';
import {controlReport} from '../public/department-control.js';
import {departmentFixture} from './department-fixture.js';
const support=assignment=>normalizeCell({kind:'shift',serviceAssignment:assignment,start:480,end:1020,breakMinutes:60});
test('service and delivery retain separate net hours without increasing regular hours',()=>{
  const row={personId:1,cells:[support('service'),support('delivery'),...Array.from({length:5},blankCell)]};
  assert.equal(totalMinutes(row),0);assert.equal(mentionMinutes(row),960);assert.equal(grandMinutes(row),960);
  assert.deepEqual([...separateMentionTotals([row])],[['Service',480],['Livraison',480]]);
  assert.deepEqual(normalizeCell(row.cells[0]),row.cells[0]);
  assert.throws(()=>support('invalid'),/Service ou Livraison/);
  assert.throws(()=>normalizeCell({...row.cells[0],workDepartment:'fruits'}),/autre affectation/);
  const absent=normalizeCell({...row.cells[0],absence:{start:480,end:540,includesMeal:false}});
  assert.equal(mentionMinutes({cells:[absent]}),420);
  const data={department:{id:1,key:'epicerie',name:'Épicerie'},weekStart:'2026-11-23',people:[{id:1,name:'Test <Nom>',group:'regular',availability:{}}],draft:{rows:[row],notes:''},revision:1};
  assert.equal(plannedSummary(data).total,960);assert.equal(controlReport(data).total,960);
  assert.match(sheetHTML(data),/Livraison/);
  const items=departmentServiceSupport([{key:'epicerie',department_id:1,draft:data.draft}],data.people);
  assert.equal(items.length,2);assert.deepEqual(supportTotals(items),{service:480,delivery:480});
  assert.match(supportBoardHTML(items,data.weekStart),/Test &lt;Nom&gt;/);
  assert.match(supportPrintHTML(items,data.weekStart),/Service : 8 h · Livraison : 8 h/);
  assert.equal(supportPrintHTML([],data.weekStart),'');
});
test('department-only employee appears in Service, follows edits and deletion, and survives publication/copy',async()=>{
  const f=await departmentFixture();try{
    const department=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='cuisine');
    const person=(await f.call('post','/api/departments/people',{body:{name:'Renfort test',active:true,group:'regular',departments:[department.id],availability:{}}})).body;
    const route='/api/departments/:id/weeks/:week',params={id:department.id,week:'2026-11-23'};
    const draft={rows:[{personId:person.id,cells:[support('service'),support('delivery'),...Array.from({length:5},blankCell)]}],notes:'',manager:''};
    assert.equal((await f.call('put',route,{params,body:{revision:0,draft}})).code,200);
    let items=await f.service.serviceSupport(params.week);assert.equal(items.length,2);assert.equal(items[0].name,'Renfort test');
    assert.deepEqual(supportTotals(items),{service:480,delivery:480});
    assert.equal((await f.call('post',route+'/publish',{params,body:{revision:1,verified:true,warningsReviewed:true}})).code,200);
    const pub=(await f.call('get','/api/leave/department-schedules/:id/:week',{params})).body.schedule;
    assert.equal(pub.rows[0].cells[0].serviceAssignment,'service');
    const target={...params,week:'2026-11-30'};
    assert.equal((await f.call('post',route+'/copy',{params:target,body:{revision:0,sourceWeek:params.week,sourceRevision:2}})).code,200);
    assert.equal((await f.service.serviceSupport(target.week)).length,2);
    draft.rows[0].cells[0]=blankCell();draft.rows[0].cells[1]=normalizeCell({...support('delivery'),paidMinutesOverride:240});
    assert.equal((await f.call('put',route,{params:target,body:{revision:1,draft}})).code,200);
    items=await f.service.serviceSupport(target.week);assert.equal(items.length,1);assert.equal(items[0].paidMinutes,240);
    assert.equal((await f.pool.query('SELECT * FROM schedule_shifts')).rows.length,0);
  }finally{await f.db.close();}
});
