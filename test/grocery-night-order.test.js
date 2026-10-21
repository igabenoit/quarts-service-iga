import test from 'node:test';
import assert from 'node:assert/strict';
import {blankCell,orderDraft,sheetHTML,publicSnapshot,scheduleGroup} from '../public/departments-core.js';
import {departmentFixture} from './department-fixture.js';
const cells=c=>[c,...Array.from({length:6},blankCell)];
const night={kind:'shift',start:1320,end:1830,breakMinutes:30,post:'night',note:''};
const day={kind:'shift',start:480,end:960,breakMinutes:60,note:''};
test('Épicerie : réguliers puis temps partiel de jour puis nuit, classés par rang et ancienneté',()=>{
 const people=[
  {id:1,name:'Nuit régulier',group:'regular',seniorityDate:'2000-01-01',displayPriorities:{7:2}},
  {id:2,name:'Jour régulier',group:'regular',seniorityDate:'2010-01-01',displayPriorities:{7:4}},
  {id:3,name:'Jour temps partiel',group:'part_time',seniorityDate:'2020-01-01',displayPriorities:{7:3}},
  {id:4,name:'Nuit temps partiel',group:'part_time',seniorityDate:'2025-01-01',displayPriorities:{7:1}},
  {id:5,name:'Nuit sans quart',group:'regular',specification:'Équipe de nuit',seniorityDate:'1990-01-01'},
  {id:6,name:'Nuit ancienneté',group:'part_time',seniorityDate:'1995-01-01'},
 ].map(p=>({...p,availability:{},active:true}));
 const draft={notes:'',rows:people.map(p=>({personId:p.id,cells:cells(p.id===5?blankCell():[1,4,6].includes(p.id)?night:day)}))};
 const before=structuredClone(draft),expected=[2,3,4,1,5,6];
 assert.deepEqual(orderDraft(draft,people,7,'epicerie').rows.map(r=>r.personId),expected);
 assert.deepEqual(publicSnapshot(draft,people,7,'epicerie').rows.map(r=>r.personId),expected);
 for(const blank of [false,true]){
  const html=sheetHTML({department:{id:7,key:'epicerie',name:'Épicerie'},people,draft,weekStart:'2026-10-26',blank});
  const names=expected.map(id=>people.find(p=>p.id===id).name);
  for(let i=1;i<names.length;i++)assert.ok(html.indexOf(names[i-1])<html.indexOf(names[i]),names.join(' → '));
  assert.ok(html.indexOf('data-group="part_time"')<html.indexOf('data-group="night"'));
  for(const name of names)assert.equal(html.split(name).length-1,1);
 }
 assert.deepEqual(draft,before,'no shifts or employment statuses modified');
 assert.deepEqual(orderDraft(draft,people,7,'fruits').rows.map(r=>r.personId),[1,2,5,4,3,6]);
 assert.equal(scheduleGroup(people[0],{cells:cells({...night,post:'',end:1830})},'epicerie'),'night');
 assert.equal(scheduleGroup(people[0],{cells:cells({...night,workDepartment:'fruits'})},'epicerie'),'regular');
 const nightOnly=sheetHTML({department:{id:7,key:'epicerie',name:'Épicerie'},people:[people[0]],draft:{rows:[draft.rows[0]]},weekStart:'2026-10-26'});
 assert.equal(nightOnly.split('<tr class="sheet-person').length-1,1);assert.doesNotMatch(nightOnly,/data-group="regular"|data-group="part_time"/);
});

test('publication Épicerie conserve les cellules et place la nuit après le jour',async()=>{
 const f=await departmentFixture();try{
  const meta=(await f.call('get','/api/departments/meta')).body,department=meta.departments.find(d=>d.key==='epicerie');
  const base={active:true,departments:[department.id],availability:{},email:''};
  const ids=[];
  for(const [name,group] of [['Nuit','regular'],['Régulier jour','regular'],['Temps partiel jour','part_time']]){
   const result=await f.call('post','/api/departments/people',{body:{...base,name,group}});assert.equal(result.code,200);ids.push(result.body.id);
  }
  const params={id:department.id,week:'2030-10-14'};
  const current=(await f.call('get','/api/departments/:id/weeks/:week',{params})).body;
  current.draft.rows.forEach(r=>r.cells=cells(r.personId===ids[0]?night:day));
  const saved=await f.call('put','/api/departments/:id/weeks/:week',{params,body:{revision:0,draft:current.draft}});assert.equal(saved.code,200);
  const published=await f.call('post','/api/departments/:id/weeks/:week/publish',{params,body:{revision:saved.body.revision,verified:true,warningsReviewed:true}});assert.equal(published.code,200,JSON.stringify(published.body));
  const snapshot=(await f.call('get','/api/leave/department-schedules/:id/:week',{params})).body.schedule;
  assert.deepEqual(snapshot.rows.map(r=>r.personId),[ids[1],ids[2],ids[0]]);
  assert.equal(snapshot.rows.at(-1).cells[0].start,1320);assert.equal(snapshot.rows.at(-1).group,'regular');
 }finally{await f.db.close();}
});
