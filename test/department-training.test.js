import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {blankCell,normalizeCell,totalMinutes,trainingMinutes,draftWarnings,sheetHTML,DEPARTMENT_STYLES,cellTone} from '../public/departments-core.js';
import {validateCandidate,photoSchema} from '../department-photo.js';

const training={kind:'training',start:420,end:960,breakMinutes:30,note:'Accueil'},shift={...training,kind:'shift',end:720};
const days=()=>[shift,training,...['off','vacation','requested','sick'].map(kind=>({...blankCell(),kind})),blankCell()];
test('formation : heures nettes séparées, validation et transcription sans heures inventées',()=>{
  assert.equal(totalMinutes({cells:days()}),270);
  assert.equal(trainingMinutes({cells:days()}),510);
  assert.deepEqual(normalizeCell(training),training);
  for(const invalid of [{start:null},{end:420},{breakMinutes:540},{end:1861}])assert.throws(()=>normalizeCell({...training,...invalid}));
  const row={personId:1,cells:days()},person={id:1,name:'Camille',active:true,availability:{0:'J',1:'0'}};
  assert.match(draftWarnings({rows:[row]},[person]).join(' '),/Mardi.*en dehors/);
  assert.equal(cellTone({kind:'note',note:'Congé demandé'}),'status-requested');
  assert.equal(trainingMinutes({cells:[{...blankCell(),kind:'note',note:'Formation'}]}),0);
  const candidate=validateCandidate({warnings:[],rows:[{name:'Camille',days:days()}]});
  assert.deepEqual(candidate.rows[0].days,days().map(c=>c.kind==='training'?{...c,breakMinutes:60,note:''}:c.kind==='shift'?{...c,note:''}:c));
  assert.ok(photoSchema.properties.rows.items.properties.days.items.properties.kind.enum.includes('training'));
});
test('gabarit : 14 lignes stables et répartition proportionnelle sans perdre de nom',()=>{
  for(const [regular,partTime] of [[0,0],[2,0],[0,8],[2,8],[9,3],[10,4],[3,11],[16,16]]){
    const people=Array.from({length:regular+partTime},(_,i)=>({id:i+1,name:'Exemple '+i,group:i<regular?'regular':'part_time',active:true,availability:{}}));
    const html=sheetHTML({department:DEPARTMENT_STYLES[1],weekStart:'2030-10-14',people,draft:{rows:people.map(p=>({personId:p.id,cells:days()})),notes:''}});
    assert.equal((html.match(/class="sheet-person"/g)||[]).length,Math.max(14,people.length));
    for(const p of people)assert.ok(html.includes('>'+p.name+'</div>'));
    const groups=[...html.matchAll(/<tbody data-group="([^"]+)">([\s\S]*?)<\/tbody>/g)];
    if(regular===2&&partTime===8)assert.equal((groups[0][2].match(/class="sheet-person"/g)||[]).length,3);
    if(people.length){assert.match(html,/class="training-hours">Form. 8,5/);assert.match(html,/status-requested/);assert.match(html,/status-sick/);}
  }
});
test('PostgreSQL : formation copiée, publiée et contrôlée comme un quart occupé',async()=>{
  const f=await departmentFixture(),{call}=f,route='/api/departments/:id/weeks/:week',week='2030-10-14';
  try{
    const meta=(await call('get','/api/departments/meta')).body,[dept,other]=meta.departments.filter(d=>d.key!=='service');
    const person=(await call('post','/api/departments/people',{body:{name:'Camille Formation',group:'regular',active:true,departments:[dept.id,other.id],availability:Object.fromEntries(Array.from({length:7},(_,d)=>[d,'J']))}})).body.id;
    const params={id:dept.id,week},draft={rows:[{personId:person,cells:days()}],notes:'',manager:''};
    assert.equal((await call('put',route,{params,body:{revision:0,draft}})).code,200);
    assert.equal((await call('post',route+'/publish',{params,body:{revision:1,verified:true}})).code,200);
    const pub=(await call('get','/api/leave/department-schedules/:id/:week',{params})).body.schedule.rows[0];
    assert.deepEqual(pub.cells,days());assert.equal(totalMinutes(pub),270);assert.equal(trainingMinutes(pub),510);
    const target={id:dept.id,week:'2030-10-21'};
    assert.equal((await call('post',route+'/copy',{params:target,body:{revision:0,sourceWeek:week,sourceRevision:2}})).code,200);
    assert.deepEqual((await call('get',route,{params:target})).body.draft,draft);
    const otherParams={id:other.id,week};
    const busy={rows:[{personId:person,cells:[training,{...training,kind:'shift'},...Array.from({length:5},blankCell)]}]};
    assert.equal((await call('put',route,{params:otherParams,body:{revision:0,draft:busy}})).code,200);
    const warnings=(await call('get',route,{params:otherParams})).body.warnings;
    assert.equal(warnings.filter(w=>w.includes('chevauchement')).length,2);
    assert.equal((await call('post',route+'/publish',{params:otherParams,body:{revision:1,verified:true}})).code,400);
  }finally{await f.db.close();}
});
