import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAvailability,normalizeAvailability,publicSnapshot,sheetHTML,blankCell,DEPARTMENT_STYLES} from '../public/departments-core.js';
import {incomingFor} from '../department-transfers.js';
import {departmentFixture} from './department-fixture.js';
import {installDepartmentSchedules} from '../department-schedules.js';

test('disponibilités abrégées : aperçu et stockage canoniques, plages explicites protégées',()=>{
  for(const [input,expected] of [['7 - 4','07:00-16:00'],['7h30 – 4h30','07:30-16:30'],['730-430','07:30-16:30'],['7:30-16:30','07:30-16:30'],['7-11, 13-5','07:00-11:00, 13:00-17:00'],['16-24','16:00-24:00'],['j','J'],['NON','0'],['','']])assert.equal(parseAvailability(input),expected,input);
  for(const value of ['7-04','17:00-08:00','7-25','7h75-16','7-8,9-10,11-12','abc'])assert.throws(()=>parseAvailability(value),undefined,value);
  const normalized=normalizeAvailability({0:'7 - 4',1:'7-11,13-5',2:'J',3:'0'});
  assert.deepEqual(normalizeAvailability(normalized),normalized);
  assert.throws(()=>normalizeAvailability({2:'7-04'}),/Mercredi/);
});

test('spécification : affichage échappé sous le titre, publications et quarts reçus',()=>{
  const person={id:1,name:'Camille',jobTitle:'Commis',specification:'École <soir>',group:'regular',active:true,availability:{0:'J'}};
  const draft={rows:[{personId:1,cells:[{kind:'shift',start:420,end:960,breakMinutes:30,note:'',workDepartment:'fruits'},...Array.from({length:6},blankCell)]}],notes:''};
  const snapshot=publicSnapshot(draft,[person]);assert.equal(snapshot.rows[0].specification,person.specification);
  const incoming=incomingFor([{key:'boulangerie',department_id:2,published:snapshot}],'fruits',{published:true});
  assert.equal(incoming[0].person.specification,person.specification);
  for(const blank of [false,true]){
    const html=sheetHTML({department:DEPARTMENT_STYLES[1],weekStart:'2030-10-14',people:[person],draft,blank});
    assert.match(html,/sheet-job-title">Commis<\/small><small class="sheet-specification">École &lt;soir&gt;/);
    assert.equal((html.match(/class="sheet-person"/g)||[]).length,14);
  }
});

test('PostgreSQL : migration, création, modification, effacement et publication des spécifications',async()=>{
  const f=await departmentFixture();
  try{
    await installDepartmentSchedules(f.app,f.pool,f.options);
    const meta=(await f.call('get','/api/departments/meta')).body;
    const dept=meta.departments.find(d=>d.key==='boulangerie').id;
    const body={name:'Camille Test',jobTitle:'Commis',specification:'  Retour   progressif  ',group:'regular',active:true,departments:[dept],availability:{0:'7 - 4'},email:''};
    const save=await f.call('post','/api/departments/people',{body});assert.equal(save.code,200,JSON.stringify(save.body));
    const id=save.body.id;
    const person=async()=>(await f.call('get','/api/departments/meta')).body.people.find(p=>p.id===id);
    let p=await person();assert.equal(p.specification,'Retour progressif');assert.equal(p.availability[0],'07:00-16:00');
    const params={id:dept,week:'2030-10-14'};
    const draft=(await f.call('get','/api/departments/:id/weeks/:week',{params})).body.draft;
    draft.rows[0].cells[0]={kind:'shift',start:420,end:960,breakMinutes:30,note:''};
    let result=await f.call('put','/api/departments/:id/weeks/:week',{params,body:{revision:0,draft}});assert.equal(result.code,200);
    result=await f.call('post','/api/departments/:id/weeks/:week/publish',{params,body:{revision:result.body.revision,verified:true}});assert.equal(result.code,200,JSON.stringify(result.body));
    const published=async()=>(await f.call('get','/api/leave/department-schedules/:id/:week',{params})).body.schedule.rows[0];
    assert.equal((await published()).specification,'Retour progressif');
    const modify=async changes=>f.call('put','/api/departments/people/:id',{params:{id},body:{...body,version:(await person()).version,...changes}});
    assert.equal((await modify({specification:42})).code,400);
    assert.equal((await modify({specification:'x'.repeat(81)})).code,400);
    assert.equal((await modify({specification:'École'})).code,200);
    assert.equal((await person()).specification,'École');
    assert.equal((await published()).specification,'Retour progressif','La publication reste stable jusqu’à republier.');
    assert.equal((await modify({specification:undefined})).code,200);
    assert.equal((await person()).specification,'École','Un ancien formulaire préserve la spécification.');
    assert.equal((await modify({specification:''})).code,200);assert.equal((await person()).specification,'');
    const stale=await f.call('put','/api/departments/people/:id',{params:{id},body:{...body,version:p.version}});assert.equal(stale.code,409);
  }finally{await f.db.close();}
});
