import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {blankCell} from '../public/departments-core.js';

test('report photo : fiches explicites, doublons, contexte et lecture en cours; succès privé sans perte des autres lignes',async()=>{
  const f=await departmentFixture(),week='2026-10-12',shift={kind:'shift',start:420,end:960,breakMinutes:30,note:''};
  try{
    const d=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='pam'),ids=[];
    for(const name of ['Camille','Sam','Alex'])ids.push((await f.call('post','/api/departments/people',{body:{name,email:'',group:'regular',active:true,departments:[d.id],availability:{0:'J'}}})).body.id);
    const params={id:d.id,week},route='/api/departments/:id/weeks/:week';
    const get=async()=>(await f.call('get',route,{params})).body;
    let current=await get();current.draft.rows[2].cells[0]=shift;
    let r=await f.call('put',route,{params,body:{revision:0,draft:current.draft}});assert.equal(r.code,200);
    r=await f.call('post',route+'/publish',{params,body:{revision:r.body.revision,verified:true,warningsReviewed:true}});assert.equal(r.code,200);current=await get();
    const candidate={rows:[{name:'Camille',days:[shift,...Array.from({length:6},blankCell)]},{name:'Nom mal lu',days:[{...blankCell(),kind:'vacation'},...Array.from({length:6},blankCell)]}]};
    const photo=(await f.pool.query("INSERT INTO schedule_department_photos(department_id,week_start,name,data_url,candidate) VALUES($1,$2,'Exemple','example',$3) RETURNING id",[d.id,week,JSON.stringify(candidate)])).rows[0];
    const body={revision:current.revision,mapping:ids.slice(0,2),weekConfirmed:true,replaceConfirmed:true,departmentId:d.id,weekStart:week};
    const apply=extra=>f.call('post','/api/departments/photos/:id/apply',{params:{id:photo.id},body:{...body,...extra}});
    r=await apply({mapping:[ids[0],0]});assert.equal(r.code,400);assert.match(r.body.error,/Nom mal lu/);
    r=await apply({mapping:[ids[0],ids[0]]});assert.equal(r.code,400);assert.match(r.body.error,/Camille.*plusieurs lignes/);
    assert.equal((await apply({weekConfirmed:false})).code,400);
    assert.equal((await apply({weekStart:'2026-10-19'})).code,409);assert.equal((await apply({departmentId:999})).code,409);
    await f.pool.query("UPDATE schedule_department_photos SET state='processing',started_at=clock_timestamp() WHERE id=$1",[photo.id]);
    assert.equal((await apply({})).code,409);assert.deepEqual((await get()).draft,current.draft);
    await f.pool.query("UPDATE schedule_department_photos SET state='ready' WHERE id=$1",[photo.id]);
    r=await apply({});assert.equal(r.code,200,JSON.stringify(r.body));
    const saved=await get();assert.equal(saved.draft.rows.find(row=>row.personId===ids[0]).cells[0].start,420);assert.equal(saved.draft.rows.find(row=>row.personId===ids[1]).cells[0].kind,'vacation');assert.deepEqual(saved.draft.rows.find(row=>row.personId===ids[2]),current.draft.rows.find(row=>row.personId===ids[2]));assert.deepEqual(saved.published,current.published);
  }finally{await f.db.close();}
});
