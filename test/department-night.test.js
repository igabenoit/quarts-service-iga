import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {parseShiftTimes,quickTimeLabel,timeLabel,normalizeCell,automaticBreakMinutes,cellMinutes,totalMinutes,trainingMinutes,grandMinutes,blankCell,cellDetail,DEPARTMENT_STYLES,validateAssignment,sheetHTML,draftWarnings,parseAvailability} from '../public/departments-core.js';
import {normalizePhotoCell,photoSchema} from '../department-photo.js';

const night=()=>({kind:'shift',start:1320,end:1830,breakMinutes:60,note:'',post:'night'});
const cells=(c,day=0)=>Array.from({length:7},(_,d)=>d===day?{...c}:blankCell());
test('nuit : saisie explicite, durée, réouverture et garde-fous',()=>{
  for(const [a,b,start,end] of [['22','6h30',1320,1830],['22h','630',1320,1830],['22:00','06:30',1320,1830],['20','4',1200,1680],['19','7',1140,1860],['7','04:00',420,1680],['22','11:00 +1',1320,2100],['23','0',1380,1440]]){
    assert.deepEqual(parseShiftTimes(a,b),{start,end});
    assert.deepEqual(parseShiftTimes(quickTimeLabel(start),quickTimeLabel(end)),{start,end},'reopening preserves the date offset');
  }
  assert.equal(timeLabel(1830),'06:30 +1');assert.equal(quickTimeLabel(1830),'06:30 +1');
  assert.equal(automaticBreakMinutes(1320,1830),60);
  assert.equal(cellMinutes(night()),450);assert.equal(cellMinutes({...night(),breakMinutes:0}),510);
  assert.deepEqual(normalizeCell({...night(),end:390}),night());
  assert.equal(totalMinutes({cells:cells(night())}),450);
  assert.equal(trainingMinutes({cells:cells({...night(),kind:'training'})}),450);
  assert.equal(grandMinutes({cells:cells(night())}),450);
  for(const c of [{start:1440,end:1830},{start:-1,end:390},{end:1320},{end:3000},{end:-1},{breakMinutes:510}])assert.throws(()=>normalizeCell({...night(),...c}));
  for(const pair of [['22','22'],['22','23 +1'],['24','6'],['22','25'],['22','6h99']])assert.throws(()=>parseShiftTimes(...pair));
  assert.throws(()=>parseAvailability('22-6h30'),'availability still belongs to each calendar day');
});
test('nuit : poste commun, feuille et lecture photo cohérents',()=>{
  for(const department of DEPARTMENT_STYLES){
    assert.doesNotThrow(()=>validateAssignment(night(),department.key));
    const html=sheetHTML({department,weekStart:'2030-10-14',people:[{id:1,name:'Camille Nuit',group:'regular',availability:{}}],draft:{rows:[{personId:1,cells:cells(night())}],notes:''}});
    assert.match(html,/06:30 \+1/);assert.match(html,/>Nuit<\/small>/);assert.match(html,/Grand total : 7,5 h/);assert.match(html,/\+1 : fin le lendemain/);assert.doesNotMatch(html,/30:30/);
  }
  assert.equal(cellDetail(night()),'Nuit');
  assert.ok(photoSchema.properties.rows.items.properties.days.items.properties.post.enum.includes('night'));
  for(const raw of ['22-6h30 Nuit','22:00 / 06:30 Nuit'])assert.deepEqual(normalizePhotoCell({...night(),end:390,breakMinutes:0,post:null},raw),night());
  assert.deepEqual(normalizePhotoCell({...night(),end:390,breakMinutes:0},''),night());
});
test('nuit : disponibilité et chevauchement du lendemain, y compris dimanche',()=>{
  const p={id:1,name:'Camille',active:true,availability:{0:'22:00-24:00',1:'00:00-06:30',6:'J'}};
  const draft={rows:[{personId:1,cells:cells(night())}]};
  assert.deepEqual(draftWarnings(draft,[p]),[]);
  assert.match(draftWarnings(draft,[{...p,availability:{...p.availability,1:'0'}}]).join(' '),/Mardi.*en dehors/);
  draft.rows[0].cells[1]={...night(),start:360,end:600,post:'',breakMinutes:0};
  assert.match(draftWarnings(draft,[p]).join(' '),/chevauchement avec le quart de la veille/);
  draft.rows[0].cells=cells(night(),6);
  assert.match(draftWarnings(draft,[p]).join(' '),/Lundi.*en dehors/);
});
test('API : sauvegarde, publication, copie, conflits du lendemain et de la semaine suivante',async()=>{
  const f=await departmentFixture(),{call,pool}=f,week='2030-10-14',next='2030-10-21',route='/api/departments/:id/weeks/:week';
  try{
    const meta=(await call('get','/api/departments/meta')).body,dept=meta.departments.find(d=>d.key==='epicerie'),other=meta.departments.find(d=>d.key==='viande');
    const person=(await call('post','/api/departments/people',{body:{name:'Camille Nuit',group:'regular',active:true,departments:[dept.id,other.id],availability:Object.fromEntries(Array.from({length:7},(_,d)=>[d,'J']))}})).body.id;
    const draft={rows:[{personId:person,cells:cells({...night(),end:390})}],notes:'Conserver',manager:''};
    const params={id:dept.id,week};
    assert.equal((await call('put',route,{params,body:{revision:0,draft}})).code,200);
    let saved=(await call('get',route,{params})).body;
    assert.deepEqual(saved.draft.rows[0].cells[0],night());assert.deepEqual(saved.warnings,[]);
    assert.equal((await call('post',route+'/publish',{params,body:{revision:1,verified:true,warningsReviewed:true}})).code,200);
    const published=(await call('get','/api/leave/department-schedules/:id/:week',{params})).body;
    assert.deepEqual(published.schedule.rows[0].cells[0],night());
    assert.equal((await call('post',route+'/copy',{params:{...params,week:next},body:{revision:0,sourceWeek:week,sourceRevision:2}})).code,200);
    assert.deepEqual((await call('get',route,{params:{...params,week:next}})).body.draft.rows[0].cells[0],night());
    const morning={kind:'shift',start:360,end:600,breakMinutes:0,note:''};
    await pool.query('INSERT INTO schedule_department_weeks(department_id,week_start,draft,published) VALUES($1,$2,$3,$3)',[other.id,week,JSON.stringify({rows:[{personId:person,cells:cells(morning,1)}]})]);
    await pool.query("INSERT INTO schedule_leave_requests(submission_key,employee_name,email,reason,periods,first_date,last_date,status,department_id,department_name) VALUES('00000000-0000-4000-8000-000000000999','Camille Nuit','test@example.com','Test',$1,'2030-10-15','2030-10-15','approved',$2,'Épicerie')",[JSON.stringify([{date:'2030-10-15',startMinute:0,endMinute:400}]),dept.id]);
    saved=(await call('get',route,{params})).body;
    assert.ok(saved.warnings.some(w=>w.includes('chevauchement avec Viande')));
    assert.ok(saved.warnings.some(w=>w.includes('congé approuvé')&&w.includes('2030-10-15')));
    // Sunday is stored on the starting week; Monday conflicts are checked in both directions.
    draft.rows[0].cells=cells(night(),6);
    assert.equal((await call('put',route,{params,body:{revision:2,draft}})).code,200);
    assert.equal((await call('post',route+'/publish',{params,body:{revision:3,verified:true,warningsReviewed:true}})).code,200);
    await pool.query('INSERT INTO schedule_department_weeks(department_id,week_start,draft,published) VALUES($1,$2,$3,$3)',[other.id,next,JSON.stringify({rows:[{personId:person,cells:cells(morning)}]})]);
    assert.ok((await call('get',route,{params})).body.warnings.some(w=>w.includes('chevauchement avec Viande')));
    assert.ok((await call('get',route,{params:{id:other.id,week:next}})).body.warnings.some(w=>w.includes('chevauchement avec Épicerie')));
    assert.equal((await call('get',route,{params})).body.draft.notes,'Conserver');
  }finally{await f.db.close();}
});
