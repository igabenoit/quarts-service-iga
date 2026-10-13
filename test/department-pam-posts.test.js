import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {PAM_POSTS,normalizeCell,validateAssignment,totalMinutes,trainingMinutes,kitchenMinutes,grandMinutes,cellDetail,sheetHTML,mergeIncoming} from '../public/departments-core.js';
import {validateCandidate,photoSchema} from '../department-photo.js';
const shift={kind:'shift',start:420,end:900,breakMinutes:30,note:''};
const cells=()=>[...Object.keys(PAM_POSTS).map(post=>normalizeCell({...shift,post})),normalizeCell({...shift,kind:'kitchen'}),normalizeCell({...shift,kind:'training'})];
test('PAM: regular posts and kitchen/formation hours remain separate without double counting',()=>{
  const row={cells:cells()};
  assert.equal(totalMinutes(row),2250);assert.equal(kitchenMinutes(row),450);assert.equal(trainingMinutes(row),450);assert.equal(grandMinutes(row),3150);
  for(const cell of row.cells){assert.doesNotThrow(()=>validateAssignment(cell,'pam'));if(cell.kind!=='training')assert.throws(()=>validateAssignment(cell,'viande'));}
  for(const [post,label] of Object.entries(PAM_POSTS))assert.equal(cellDetail({...shift,post}),label);
  assert.equal(cellDetail({kind:'kitchen'}),'Cuisine');
  assert.throws(()=>validateAssignment({...shift,kind:'kitchen',post:'bbq'},'pam'));
  const outgoing={...shift,kind:'kitchen',workDepartment:'pam'};
  assert.doesNotThrow(()=>validateAssignment(outgoing,'fruits'));assert.equal(grandMinutes({cells:[outgoing]}),0);
  const incoming=mergeIncoming({rows:[]},[{personId:1,day:0,cell:outgoing,sourceDepartment:'fruits',sourceDepartmentId:2}]);assert.equal(kitchenMinutes(incoming.rows[0]),450);assert.equal(totalMinutes(incoming.rows[0]),0);
});
test('PAM: print labels beneath shifts, kitchen totals and photo schema',()=>{
  const row={personId:1,cells:cells()},people=[{id:1,name:'Test PAM',group:'regular',availability:{}}];
  const html=sheetHTML({department:{key:'pam',name:'Prêt-à-manger'},weekStart:'2026-10-12',people,draft:{rows:[row],notes:''}});
  for(const label of Object.values(PAM_POSTS))assert.ok(html.includes(`<small class="assignment-label">${label}</small>`));
  assert.match(html,/Régulier : 37,5 h/);assert.match(html,/Cuisine : 7,5 h/);assert.match(html,/Formation : 7,5 h/);assert.match(html,/Grand total : 52,5 h/);
  const blank=sheetHTML({department:{key:'pam',name:'Prêt-à-manger'},weekStart:'2026-10-12',people,draft:{rows:[row],notes:''},blank:true});assert.doesNotMatch(blank,/assignment-label|Cuisine : 7,5/);
  const candidate=validateCandidate({weekText:'12 octobre',departmentText:'PAM',warnings:[],rows:[{name:'Test PAM',writtenTotal:'',days:cells()}]});assert.equal(candidate.rows[0].days[5].kind,'kitchen');assert.equal(candidate.rows[0].days[4].post,'pizza_sandwiches');
  const schema=photoSchema.properties.rows.items.properties.days.items.properties;assert.ok(schema.kind.enum.includes('kitchen'));for(const post of Object.keys(PAM_POSTS))assert.ok(schema.post.enum.includes(post));
});
test('PAM: save, reload, copy and publish preserve all new assignments',async()=>{
  const f=await departmentFixture();try{
    const pam=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='pam');
    const person=await f.call('post','/api/departments/people',{body:{name:'Test PAM',group:'regular',active:true,departments:[pam.id],availability:{},email:''}});
    const route='/api/departments/:id/weeks/:week',params={id:pam.id,week:'2026-10-12'},draft={rows:[{personId:person.body.id,cells:cells()}],notes:'',manager:''};
    assert.equal((await f.call('put',route,{params,body:{revision:0,draft}})).code,200);
    const saved=(await f.call('get',route,{params})).body;assert.deepEqual(saved.draft.rows[0].cells,cells());
    assert.equal((await f.call('post',route+'/publish',{params,body:{revision:1,verified:true,warningsReviewed:true}})).code,200);
    const published=(await f.call('get','/api/leave/department-schedules/:id/:week',{params})).body.schedule.rows[0];assert.equal(kitchenMinutes(published),450);assert.equal(totalMinutes(published),2250);
    const next={id:pam.id,week:'2026-10-19'};assert.equal((await f.call('post',route+'/copy',{params:next,body:{revision:0,sourceWeek:params.week,sourceRevision:2}})).code,200);
    assert.deepEqual((await f.call('get',route,{params:next})).body.draft.rows[0].cells,cells());
  }finally{await f.db.close();}
});

