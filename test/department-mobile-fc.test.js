import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {blankCell,normalizeCell,cellLabel,cellTone,totalMinutes,sheetHTML} from '../public/departments-core.js';
import {normalizePhotoCell,validateCandidate,photoSchema} from '../department-photo.js';

test('Congé mobile survives storage, publication and week copying without worked hours',async()=>{
  const mobile=normalizeCell({kind:'mobile',start:420,end:960,breakMinutes:60});
  assert.equal(mobile.start,null);assert.equal(cellLabel(mobile),'Congé mobile');assert.equal(cellTone(mobile),'status-mobile');
  assert.ok(photoSchema.properties.rows.items.properties.days.items.properties.kind.enum.includes('mobile'));
  const cells=[mobile,...Array.from({length:6},blankCell)];
  assert.equal(totalMinutes({cells}),0);
  assert.equal(validateCandidate({warnings:[],rows:[{name:'Test',days:cells}]}).rows[0].days[0].kind,'mobile');
  const f=await departmentFixture();try{
    const dep=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='fruits');
    const person=await f.call('post','/api/departments/people',{body:{name:'Test mobile',group:'regular',active:true,departments:[dep.id],availability:{},email:''}});
    const route='/api/departments/:id/weeks/:week',params={id:dep.id,week:'2026-10-12'},draft={rows:[{personId:person.body.id,cells}],notes:'',manager:''};
    assert.match(sheetHTML({department:dep,weekStart:params.week,people:[{id:person.body.id,name:'Test mobile',group:'regular',availability:{}}],draft}),/Congé mobile/);
    assert.equal((await f.call('put',route,{params,body:{revision:0,draft}})).code,200);
    assert.deepEqual((await f.call('get',route,{params})).body.draft.rows[0].cells,cells);
    assert.equal((await f.call('post',route+'/publish',{params,body:{revision:1,verified:true,warningsReviewed:true}})).code,200);
    assert.equal((await f.call('get','/api/leave/department-schedules/:id/:week',{params})).body.schedule.rows[0].cells[0].kind,'mobile');
    const next={id:dep.id,week:'2026-10-19'};
    assert.equal((await f.call('post',route+'/copy',{params:next,body:{revision:0,sourceWeek:params.week,sourceRevision:2}})).code,200);
    assert.deepEqual((await f.call('get',route,{params:next})).body.draft.rows[0].cells,cells);
  }finally{await f.db.close();}
});

test('FC beneath a timed shift is Fruits coupés; isolated FC never creates hours',()=>{
  const shift={kind:'shift',start:420,end:960,breakMinutes:60,note:''};
  for(const abbreviation of ['FC','Fc','F.C.','F C']){
    const cell=normalizePhotoCell(shift,`7 / 4\n${abbreviation}`);
    assert.equal(cell.post,'cut_fruit');assert.equal(cell.start,420);assert.equal(cell.end,960);assert.equal(cellTone(cell),'status-cut-fruit');
    assert.equal(normalizePhotoCell({kind:'note',note:abbreviation},abbreviation).start,null);
  }
  assert.equal(normalizePhotoCell(shift,'7 / 4').post,undefined);
  assert.equal(normalizePhotoCell(shift,'7 / 4 FCP').post,undefined);
});
