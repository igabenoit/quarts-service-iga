import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {normalizeCell,blankCell,trainingMinutes,totalMinutes,cellDetail,sheetHTML} from '../public/departments-core.js';
const cell={kind:'training',trainingMention:true,note:'Accueil <nouveau>',start:420,end:960,breakMinutes:60};
test('autre mention en formation : heures nettes, texte échappé et absence de double comptage',()=>{
  assert.deepEqual(normalizeCell(cell),cell);
  assert.equal(trainingMinutes({cells:[cell]}),480);assert.equal(totalMinutes({cells:[cell]}),0);
  assert.equal(cellDetail(cell),'Formation · Accueil <nouveau>');
  assert.throws(()=>normalizeCell({...cell,note:''}),/mention/);
  assert.throws(()=>normalizeCell({...cell,kind:'note'}),/formation/);
  assert.throws(()=>normalizeCell({...cell,end:null}),/quart/);
  const note=normalizeCell({kind:'note',note:'Accueil'});assert.equal(trainingMinutes({cells:[note]}),0);
  const html=sheetHTML({department:{key:'pam',id:1},weekStart:'2026-10-26',people:[{id:1,name:'Test',group:'regular',availability:{}}],draft:{rows:[{personId:1,cells:[cell,...Array.from({length:6},blankCell)]}],notes:''}});
  assert.match(html,/Accueil &lt;nouveau&gt;/);assert.doesNotMatch(html,/Accueil <nouveau>/);
});
test('mention Formation : sauvegarde, publication, copie et retrait du calcul',async()=>{
  const f=await departmentFixture();try{
    const department=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='cuisine');
    const person=(await f.call('post','/api/departments/people',{body:{name:'Test Mention',active:true,group:'regular',departments:[department.id],availability:{}}})).body;
    const route='/api/departments/:id/weeks/:week',params={id:department.id,week:'2026-10-26'};
    const draft={rows:[{personId:person.id,cells:[cell,...Array.from({length:6},blankCell)]}],notes:'',manager:''};
    assert.equal((await f.call('put',route,{params,body:{revision:0,draft}})).code,200);
    assert.equal((await f.call('post',route+'/publish',{params,body:{revision:1,verified:true,warningsReviewed:true}})).code,200);
    const pub=(await f.call('get','/api/leave/department-schedules/:id/:week',{params})).body.schedule.rows[0];
    assert.deepEqual(pub.cells[0],cell);assert.equal(trainingMinutes(pub),480);
    const target={...params,week:'2026-11-02'};
    assert.equal((await f.call('post',route+'/copy',{params:target,body:{revision:0,sourceWeek:params.week,sourceRevision:2}})).code,200);
    const copied=(await f.call('get',route,{params:target})).body;assert.deepEqual(copied.draft,draft);
    copied.draft.rows[0].cells[0]=normalizeCell({kind:'note',note:cell.note});
    assert.equal((await f.call('put',route,{params:target,body:{revision:1,draft:copied.draft}})).code,200);
    const saved=(await f.call('get',route,{params:target})).body;assert.equal(trainingMinutes(saved.draft.rows[0]),0);
  }finally{await f.db.close();}
});
