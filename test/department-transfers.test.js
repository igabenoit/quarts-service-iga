import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {blankCell,normalizeCell,validateAssignment,totalMinutes,trainingMinutes,buffetMinutes,grandMinutes,mergeIncoming,cellTone,sheetHTML,DEPARTMENT_STYLES} from '../public/departments-core.js';
import {incomingFor,assertTransferSlots} from '../department-transfers.js';
const shift={kind:'shift',start:480,end:960,breakMinutes:30,note:''},cells=c=>[c,...Array.from({length:6},blankCell)];
test('postes : Fruits coupés inclus au régulier, Buffet séparé, transfert compté une fois',()=>{
  const fruit=normalizeCell({...shift,post:'cut_fruit'}),buffet=normalizeCell({...shift,kind:'buffet'});
  assert.equal(cellTone(fruit),'status-cut-fruit');assert.equal(totalMinutes({cells:cells(fruit)}),450);
  assert.equal(cellTone(buffet),'');assert.equal(totalMinutes({cells:cells(buffet)}),0);assert.equal(buffetMinutes({cells:cells(buffet)}),450);
  assert.throws(()=>validateAssignment(buffet,'fruits'));assert.throws(()=>validateAssignment(fruit,'viande'));
  assert.doesNotThrow(()=>validateAssignment(buffet,'pam'));assert.doesNotThrow(()=>validateAssignment(buffet,'charcuterie'));
  assert.throws(()=>normalizeCell({...shift,workDepartment:'invented'}));
  assert.equal(normalizeCell({...shift,workDepartment:'viande',sourceDepartment:'fruits'}).sourceDepartment,undefined);
  for(const source of DEPARTMENT_STYLES)for(const target of DEPARTMENT_STYLES.filter(d=>d.key!==source.key)){
    const outgoing={...shift,workDepartment:target.key},weeks=[{key:source.key,department_id:1,draft:{rows:[{personId:1,cells:cells(outgoing)}]}}];
    const incoming=incomingFor(weeks,target.key),dest=mergeIncoming({rows:[]},incoming);
    assertTransferSlots(weeks);assert.equal(grandMinutes(weeks[0].draft.rows[0]),0);assert.equal(grandMinutes(dest.rows[0]),450);
  }
  const row={personId:1,cells:[shift,{...shift,kind:'training'},buffet,...Array.from({length:4},blankCell)]};
  assert.equal(totalMinutes(row),450);assert.equal(trainingMinutes(row),450);assert.equal(buffetMinutes(row),450);assert.equal(grandMinutes(row),1350);
  const html=sheetHTML({department:DEPARTMENT_STYLES[3],weekStart:'2030-10-14',people:[{id:1,name:'Camille',group:'regular',availability:{}}],draft:{rows:[row],notes:''}});
  assert.match(html,/Grand total : 22,5 h/);assert.match(html,/Buffet : 7,5 h/);
  assert.ok([...html.matchAll(/class="sheet-work[^>]*>(.*?)<\/div>/g)].every(m=>!m[1].includes('Buffet')));
});

test('PostgreSQL : quarts reçus liés à la source, copies, conflits, publication privée et retrait',async t=>{
  const f=await departmentFixture(),{call}=f,route='/api/departments/:id/weeks/:week',week='2030-10-14';
  try{
    const meta=(await call('get','/api/departments/meta')).body,fish=meta.departments.find(d=>d.key==='poissonnerie'),meat=meta.departments.find(d=>d.key==='viande'),pam=meta.departments.find(d=>d.key==='pam');
    const id=(await call('post','/api/departments/people',{body:{name:'Camille Transfert',email:'private@example.com',group:'regular',active:true,departments:[fish.id],availability:Object.fromEntries(Array.from({length:7},(_,i)=>[i,'J']))}})).body.id;
    const get=async(d,w=week)=>(await call('get',route,{params:{id:d.id,week:w}})).body;
    const save=(d,data,revision,w=week)=>call('put',route,{params:{id:d.id,week:w},body:{draft:data,revision}});
    const publish=(d,revision,w=week)=>call('post',route+'/publish',{params:{id:d.id,week:w},body:{revision,verified:true,warningsReviewed:true}});
    const pub=(d,w=week)=>call('get','/api/leave/department-schedules/:id/:week',{params:{id:d.id,week:w}});
    let draft={rows:[{personId:id,cells:cells({...shift,workDepartment:'viande'})}],manager:'',notes:''};
    await t.test('réception automatique sans créer de fiche ni publier le brouillon',async()=>{
      assert.equal((await save(fish,draft,0)).code,200);
      const source=await get(fish),target=await get(meat);
      assert.equal(target.draft.rows.length,0);assert.equal(target.incoming.length,1);assert.equal(target.people[0].name,'Camille Transfert');
      assert.equal(totalMinutes(source.draft.rows[0]),0);assert.equal(totalMinutes(mergeIncoming(target.draft,target.incoming).rows[0]),450);
      assert.equal((await pub(meat)).code,404);assert.equal((await pub(fish)).code,404);
      assert.deepEqual((await call('get','/api/departments/meta')).body.people[0].departments,[fish.id]);
      await f.pool.query("INSERT INTO schedule_leave_requests(submission_key,employee_name,email,reason,periods,first_date,last_date,status,department_id,department_name) VALUES('00000000-0000-4000-8000-000000000601','Camille Transfert','private@example.com','Privé',$1,$2,$2,'approved',$3,'Viande')",[JSON.stringify([{date:week,startMinute:0,endMinute:1440}]),week,meat.id]);
      assert.ok((await get(fish)).warnings.some(w=>w.includes('congé approuvé')));
      assert.equal((await call('post',route+'/publish',{params:{id:fish.id,week},body:{revision:1,verified:true}})).code,400);
      assert.equal((await publish(fish,1)).code,200);
      const published=(await pub(meat)).body;
      assert.equal(totalMinutes(published.schedule.rows[0]),450);assert.equal(published.schedule.rows[0].cells[0].sourceDepartment,'poissonnerie');
      assert.doesNotMatch(JSON.stringify(published),/private@example|seniority|availability|birthday|sourceNote/);
      const list=(await call('get','/api/leave/department-schedules')).body.schedules;assert.ok(list.some(s=>s.departmentId===meat.id));
      assert.equal((await get(meat)).warnings.filter(w=>w.includes('chevauchement')).length,0);
    });
    await t.test('modifications en brouillon et publication propagées sans double compte',async()=>{
      draft.rows[0].cells[0].end=1020;assert.equal((await save(fish,draft,2)).code,200);
      assert.equal(totalMinutes(mergeIncoming((await get(meat)).draft,(await get(meat)).incoming).rows[0]),510);
      assert.equal(totalMinutes((await pub(meat)).body.schedule.rows[0]),450);
      assert.equal((await publish(fish,3)).code,200);assert.equal(totalMinutes((await pub(meat)).body.schedule.rows[0]),510);
    });
    await t.test('cases occupées et faux miroirs refusés sans écrasement',async()=>{
      const conflict={...draft,rows:[{personId:id,cells:cells(shift)}]};
      assert.equal((await save(meat,conflict,0)).code,409);assert.equal((await get(meat)).revision,0);
      const forged={...draft,rows:[{personId:id,cells:cells({...shift,workDepartment:'viande',sourceDepartment:'pam'})}]};
      assert.equal((await save(fish,forged,4)).code,200);draft=forged;delete draft.rows[0].cells[0].sourceDepartment;
      assert.equal(totalMinutes((await get(fish)).draft.rows[0]),0);
      const person=(await call('get','/api/departments/meta')).body.people[0];
      assert.equal((await call('put','/api/departments/people/:id',{params:{id},body:{...person,departments:[fish.id,pam.id]}})).code,200);
      assert.equal((await save(pam,{rows:[{personId:id,cells:cells({...shift,workDepartment:'viande'})}]},0)).code,409);
    });
    await t.test('copier la source reproduit le transfert, copier l’accueil ne le duplique pas',async()=>{
      const next='2030-10-21';
      assert.equal((await call('post',route+'/copy',{params:{id:fish.id,week:next},body:{revision:0,sourceWeek:week,sourceRevision:5}})).code,200);
      assert.equal((await get(meat,next)).incoming.length,1);
      assert.equal((await save(meat,{rows:[],notes:'Accueil',manager:''},0)).code,200);
      assert.equal((await call('post',route+'/copy',{params:{id:meat.id,week:next},body:{revision:0,sourceWeek:week,sourceRevision:1}})).code,200);
      const target=await get(meat,next);assert.equal(target.draft.rows.length,0);assert.equal(target.incoming.length,1);assert.equal(totalMinutes(mergeIncoming(target.draft,target.incoming).rows[0]),450);
    });
    await t.test('retirer ou annuler la publication retire uniquement la projection liée',async()=>{
      assert.equal((await call('post',route+'/unpublish',{params:{id:fish.id,week},body:{revision:5}})).code,200);
      assert.equal((await pub(meat)).code,404);assert.equal((await get(meat)).incoming.length,1);
      draft.rows[0].cells[0]=blankCell();assert.equal((await save(fish,draft,6)).code,200);
      assert.equal((await get(meat)).incoming.length,0);assert.equal((await get(meat)).draft.notes,'Accueil');
      const history=(await call('get',route+'/history',{params:{id:fish.id,week}})).body.history;
      assert.equal((await call('post',route+'/restore',{params:{id:fish.id,week},body:{revision:7,historyId:history[0].id}})).code,200);
      assert.equal((await get(meat)).incoming.length,1);assert.equal((await pub(meat)).code,404);
    });
  }finally{await f.db.close();}
});
