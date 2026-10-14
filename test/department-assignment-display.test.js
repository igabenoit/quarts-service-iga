import test from 'node:test';
import assert from 'node:assert/strict';
import {blankCell,cellDetail,sheetHTML,normalizeCell,validateAssignment,totalMinutes,kitchenMinutes,trainingMinutes,buffetMinutes,grandMinutes} from '../public/departments-core.js';
import {applyPhotoRules,validateCandidate,photoSchema} from '../department-photo.js';
import {departmentFixture} from './department-fixture.js';

const shift={kind:'shift',start:960,end:1200,breakMinutes:0,note:''};
const kitchen={kind:'kitchen',post:'kitchen_salads',start:420,end:780,breakMinutes:0,note:''};
const days=()=>[{...shift,post:'bbq',note:'16 h–20 h, dans le contexte des quarts BBQ de la feuille.'},{...shift,kind:'buffet'},
  {...kitchen,post:undefined,note:'Mention transversale Cuisine. Sept quarts visibles.'},
  {...kitchen,post:undefined,note:'Salade, dans la section Cuisine'},kitchen,{...kitchen,kind:'training'},blankCell()];

test('cases horaires : heures et poste uniquement, Buffet visible et anciennes notes Salade reconnues',()=>{
  const row={personId:1,cells:days()},people=[{id:1,name:'Exemple PAM',group:'regular',availability:{}}],args={department:{key:'pam',name:'PAM'},weekStart:'2026-10-19',people,draft:{rows:[row],notes:''}};
  const before=[totalMinutes(row),buffetMinutes(row),kitchenMinutes(row),trainingMinutes(row),grandMinutes(row)];
  const html=sheetHTML(args);
  assert.doesNotMatch(html,/contexte des quarts|Mention transversale|dans la section Cuisine/);
  for(const label of ['BBQ','Buffet','Cuisine','Cuisine Salades','Formation · Cuisine Salades'])assert.ok(html.includes(`<small class="assignment-label">${label}</small>`),label);
  assert.match(html,/<b>16:00<\/b><b>20:00<\/b>/);
  assert.deepEqual([totalMinutes(row),buffetMinutes(row),kitchenMinutes(row),trainingMinutes(row),grandMinutes(row)],before);
  assert.equal(cellDetail(row.cells[3]),'Cuisine Salades');assert.equal(normalizeCell(row.cells[3]).post,'kitchen_salads');
  assert.doesNotMatch(sheetHTML({...args,blank:true}),/assignment-label/);
  assert.throws(()=>validateAssignment({...kitchen,kind:'shift'},'pam'),/Cuisine ou en Formation/);
  assert.throws(()=>validateAssignment(kitchen,'viande'),/PAM/);
  assert.doesNotThrow(()=>validateAssignment({...kitchen,workDepartment:'pam'},'viande'));
});

test('photo : explications exclues des quarts, Cuisine Salades structuré, lecture incertaine conservée',()=>{
  const candidate=validateCandidate({warnings:[],rows:[{name:'Exemple',writtenTotal:'',days:days().map(c=>({...c,rawText:c.kind==='kitchen'?'7-1 Salade':''}))}]});
  assert.ok(candidate.rows[0].days.filter(c=>c.start!==null).every(c=>c.note===''));
  assert.equal(candidate.rows[0].days[3].post,'kitchen_salads');assert.equal(candidate.rows[0].readings[3],'7-1 Salade');
  const legacy={warnings:[],rows:[{name:'Exemple',writtenTotal:'',days:days()}]};
  const updated=applyPhotoRules(legacy);assert.equal(updated.rows[0].days[3].post,'kitchen_salads');assert.equal(updated.rows[0].days[0].note,'');assert.notEqual(legacy.rows[0].days[0].note,'');
  assert.ok(photoSchema.properties.rows.items.properties.days.items.properties.post.enum.includes('kitchen_salads'));
  legacy.rows[0].days[0]={...blankCell(),kind:'review',note:'Début illisible'};
  assert.deepEqual(applyPhotoRules(legacy).rows[0].days[0],legacy.rows[0].days[0]);
});

test('Cuisine Salades : sauvegarde, copie et publication gardent le poste et les totaux Cuisine',async()=>{
  const f=await departmentFixture();try{
    const pam=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='pam');
    const person=(await f.call('post','/api/departments/people',{body:{name:'Exemple Salades',group:'regular',active:true,departments:[pam.id],availability:{},email:''}})).body;
    const params={id:pam.id,week:'2026-10-19'},route='/api/departments/:id/weeks/:week',cells=[kitchen,{...kitchen,kind:'training'},...Array.from({length:5},blankCell)],draft={rows:[{personId:person.id,cells}],notes:'',manager:''};
    assert.equal((await f.call('put',route,{params,body:{revision:0,draft}})).code,200);
    const saved=(await f.call('get',route,{params})).body.draft.rows[0];
    assert.deepEqual(saved.cells,cells);assert.equal(kitchenMinutes(saved),360);assert.equal(trainingMinutes(saved),360);assert.equal(totalMinutes(saved),0);
    assert.equal((await f.call('post',route+'/publish',{params,body:{revision:1,verified:true,warningsReviewed:true}})).code,200);
    assert.deepEqual((await f.call('get','/api/leave/department-schedules/:id/:week',{params})).body.schedule.rows[0].cells,cells);
    const target={id:pam.id,week:'2026-10-26'};
    assert.equal((await f.call('post',route+'/copy',{params:target,body:{revision:0,sourceWeek:params.week,sourceRevision:2}})).code,200);
    assert.deepEqual((await f.call('get',route,{params:target})).body.draft.rows[0].cells,cells);
  }finally{await f.db.close();}
});
