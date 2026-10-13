import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {orderDraft,sheetHTML} from '../public/departments-core.js';
import {installDepartmentSchedules} from '../department-schedules.js';

test('priorités : insertion, déplacement, retrait, groupes, départements et formulaires périmés',async()=>{
  const f=await departmentFixture();
  try{
    const meta=async()=>(await f.call('get','/api/departments/meta')).body;
    const departments=(await meta()).departments,d=departments.find(d=>d.key==='fruits').id,other=departments.find(d=>d.key==='boulangerie').id;
    const base={group:'regular',active:true,departments:[d,other],availability:{},email:''};
    const create=async(name,extra={})=>{const r=await f.call('post','/api/departments/people',{body:{...base,name,...extra}});assert.equal(r.code,200,JSON.stringify(r.body));return r.body.id;};
    const people=async()=>(await meta()).people;
    const person=async id=>(await people()).find(p=>p.id===id);
    const update=async(id,extra={})=>{const p=await person(id);return f.call('put','/api/departments/people/:id',{params:{id},body:{...p,...extra}});};
    const order=async(dept=d,group='regular')=>(await people()).filter(p=>p.active&&p.group===group&&p.departments.includes(dept)).sort((a,b)=>a.displayPriorities[dept]-b.displayPriorities[dept]);
    const expectOrder=async(ids,dept=d,group='regular')=>{const rows=await order(dept,group);assert.deepEqual(rows.map(p=>p.id),ids);assert.deepEqual(rows.map(p=>p.displayPriorities[dept]),ids.map((_,i)=>i+1));};
    const a=await create('Zacharie'),b=await create('Yves'),c=await create('Xavier'),e=await create('William');
    await expectOrder([a,b,c,e]);
    const stale=await person(c);
    const assistant=await create('Assistant gérant',{displayPriorities:{[d]:3}});
    await expectOrder([a,b,assistant,c,e]);await expectOrder([a,b,c,e,assistant],other);
    assert.equal((await f.call('put','/api/departments/people/:id',{params:{id:c},body:stale})).code,409);
    assert.equal((await update(e,{displayPriorities:{[d]:2}})).code,200);await expectOrder([a,e,b,assistant,c]);
    assert.equal((await update(e,{displayPriorities:{[d]:99}})).code,200);await expectOrder([a,b,assistant,c,e]);
    assert.equal((await update(assistant,{active:false,displayPriorities:{}})).code,200);await expectOrder([a,b,c,e]);
    assert.equal((await update(assistant,{active:true,displayPriorities:{}})).code,200);await expectOrder([a,b,c,e,assistant]);
    assert.equal((await update(b,{departments:[other],displayPriorities:{}})).code,200);await expectOrder([a,c,e,assistant]);
    const part=await create('Temps partiel',{group:'part_time'});
    assert.equal((await update(c,{group:'part_time',displayPriorities:{[d]:1}})).code,200);
    await expectOrder([a,e,assistant]);await expectOrder([c,part],d,'part_time');
    for(const invalid of [0,-1,1.5,'3'])assert.equal((await update(a,{displayPriorities:{[d]:invalid}})).code,400);
    await expectOrder([a,e,assistant]);
    await installDepartmentSchedules(f.app,f.pool,f.options);await expectOrder([a,e,assistant]);
  }finally{await f.db.close();}
});

test('ancienneté initiale, horaires existants, cellules, impression et publication stable',async()=>{
  const f=await departmentFixture();
  try{
    const meta=async()=>(await f.call('get','/api/departments/meta')).body;
    const dept=(await meta()).departments.find(d=>d.key==='fruits'),params={id:dept.id,week:'2030-10-14'};
    const base={group:'regular',active:true,departments:[dept.id],availability:{},email:''};
    const ids=[];
    for(const name of ['Zacharie','Albert','Bernard'])ids.push((await f.call('post','/api/departments/people',{body:{...base,name}})).body.id);
    // Simulate a database created before ranks existed; seniority initializes it.
    await f.pool.query('UPDATE schedule_store_memberships SET display_order=NULL');
    await f.pool.query("UPDATE schedule_store_people SET seniority_date='2000-01-01' WHERE id=$1",[ids[0]]);
    let people=(await meta()).people;
    assert.deepEqual(people.map(p=>p.displayPriorities[dept.id]),[1,2,3]);
    const current=(await f.call('get','/api/departments/:id/weeks/:week',{params})).body;
    current.draft.rows[0].cells[0]={kind:'shift',start:420,end:960,breakMinutes:30,note:''};
    let saved=await f.call('put','/api/departments/:id/weeks/:week',{params,body:{revision:0,draft:current.draft}});assert.equal(saved.code,200);
    let published=await f.call('post','/api/departments/:id/weeks/:week/publish',{params,body:{revision:saved.body.revision,verified:true,warningsReviewed:true}});assert.equal(published.code,200,JSON.stringify(published.body));
    const p=people.find(p=>p.id===ids[2]);assert.equal((await f.call('put','/api/departments/people/:id',{params:{id:p.id},body:{...p,displayPriorities:{[dept.id]:1}}})).code,200);
    people=(await meta()).people;
    const sorted=orderDraft(current.draft,people,dept.id);
    assert.deepEqual(sorted.rows.map(r=>r.personId),[ids[2],ids[0],ids[1]]);
    assert.equal(sorted.rows[1].cells[0].start,420);assert.equal(current.draft.rows[0].personId,ids[0]);
    for(const blank of [true,false]){const html=sheetHTML({department:dept,people,draft:current.draft,weekStart:params.week,blank});assert.ok(html.indexOf('Bernard')<html.indexOf('Zacharie'));assert.ok(html.indexOf('Zacharie')<html.indexOf('Albert'));}
    const live=async()=>(await f.call('get','/api/leave/department-schedules/:id/:week',{params})).body.schedule.rows.map(r=>r.personId);
    assert.deepEqual(await live(),ids);
    published=await f.call('post','/api/departments/:id/weeks/:week/publish',{params,body:{revision:published.body.revision,verified:true,warningsReviewed:true}});assert.equal(published.code,200,JSON.stringify(published.body));
    assert.deepEqual(await live(),[ids[2],ids[0],ids[1]]);
  }finally{await f.db.close();}
});
