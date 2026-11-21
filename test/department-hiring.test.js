import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {addDays,monday,today,blankCell,assertStartDate,tenure,sheetHTML} from '../public/departments-core.js';

const shift={kind:'shift',start:480,end:960,breakMinutes:60,note:''};
const cells=(day,cell=shift)=>Array.from({length:7},(_,d)=>d===day?{...cell}:blankCell());
const route='/api/departments/:id/weeks/:week';
test('entrée : la première journée est permise, la veille et sa nuit sont refusées',()=>{
  const person={id:1,name:'Recrue',seniorityDate:'2030-10-17'};
  assert.throws(()=>assertStartDate(shift,person,'2030-10-16'),/avant cette date/);
  assert.throws(()=>assertStartDate({...shift,start:1320,end:1800,breakMinutes:30},person,'2030-10-16'),/avant cette date/);
  assert.doesNotThrow(()=>assertStartDate(shift,person,'2030-10-17'));
  assert.doesNotThrow(()=>assertStartDate(blankCell(),person,'2030-10-16'));
  assert.doesNotThrow(()=>assertStartDate(shift,{id:2,name:'Date inconnue'},'2030-10-16'));
  assert.equal(tenure('2030-10-17','2030-10-14'),'À venir');
  assert.equal(tenure('2030-10-17','2030-10-17'),'Moins d’un mois');
});

test('PostgreSQL : préparer une embauche future et empêcher tout quart avant l’entrée',async t=>{
  const f=await departmentFixture(),{call,pool}=f;
  const week=monday(addDays(today(),21)),entry=addDays(week,3),previous=addDays(week,-7);
  try{
    const departments=(await call('get','/api/departments/meta')).body.departments;
    const dept=departments.find(d=>d.key==='viande'),target=departments.find(d=>d.key==='boulangerie');
    const body={name:'Recrue Future',seniorityDate:entry,seniorityVerified:true,sourceNote:'Date d’entrée confirmée',birthday:'1990-05-06',group:'regular',active:true,departments:[dept.id],availability:Object.fromEntries(Array.from({length:7},(_,d)=>[d,'J']))};
    const created=await call('post','/api/departments/people',{body});assert.equal(created.code,200,JSON.stringify(created.body));const id=created.body.id;
    const get=async(w=week)=>(await call('get',route,{params:{id:dept.id,week:w}})).body;
    const save=(draft,revision=0,w=week)=>call('put',route,{params:{id:dept.id,week:w},body:{draft,revision}});
    const draft=day=>({rows:[{personId:id,cells:cells(day)}],manager:'',notes:''});
    await t.test('fiche enregistrée, répertoire disponible et première semaine appropriée',async()=>{
      const person=(await call('get','/api/departments/meta')).body.people.find(p=>p.id===id);
      assert.equal(person.seniorityDate,entry);assert.equal(person.active,true);
      assert.equal((await pool.query('SELECT onboarding_new FROM schedule_store_people WHERE id=$1',[id])).rows[0].onboarding_new,true);
      assert.equal((await get(previous)).draft.rows.length,0);
      assert.equal((await get()).draft.rows[0].personId,id);
      const html=sheetHTML({department:dept,weekStart:previous,people:[person],draft:{rows:[]},blank:true});
      assert.doesNotMatch(html,/Recrue Future/,'do not add a future hire to an earlier blank sheet');
      assert.equal((await call('post','/api/departments/people',{body:{...body,name:'Naissance future',birthday:addDays(today(),1)}})).code,400);
      assert.equal((await call('post','/api/departments/people',{body:{...body,name:'Date invalide',seniorityDate:'2030-02-30'}})).code,400);
      assert.equal((await call('post','/api/departments/people',{body:{...body,name:'Date non confirmée',seniorityVerified:false}})).code,400);
    });
    await t.test('saisie, transfert et ancien formulaire sont bloqués avant la date',async()=>{
      for(const value of [draft(2),{...draft(2),rows:[{personId:id,cells:cells(2,{...shift,workDepartment:target.key})}]}]){
        const result=await save(value);assert.equal(result.code,409,JSON.stringify(result.body));assert.match(result.body.error,/entrée est prévue/);
      }
      assert.equal((await get()).revision,0);
      const candidate={rows:[{name:body.name,days:cells(2)}]};
      const photo=(await pool.query("INSERT INTO schedule_department_photos(department_id,week_start,name,data_url,candidate,state) VALUES($1,$2,'Photo fictive','test',$3,'ready') RETURNING id",[dept.id,week,JSON.stringify(candidate)])).rows[0];
      const applied=await call('post','/api/departments/photos/:id/apply',{params:{id:photo.id},body:{revision:0,mapping:[id],weekConfirmed:true,replaceConfirmed:true,departmentId:dept.id,weekStart:week}});
      assert.equal(applied.code,409,JSON.stringify(applied.body));assert.equal((await get()).revision,0);
      assert.equal((await save(draft(3))).code,200,'the first day itself is schedulable');
      assert.equal((await save(draft(0),1)).code,409);
      assert.equal((await get()).draft.rows[0].cells[3].start,480);
    });
    await t.test('publication, copie et restauration ne contournent pas la date',async()=>{
      const params={id:dept.id,week};
      assert.equal((await call('post',route+'/publish',{params,body:{revision:1,verified:true,warningsReviewed:true}})).code,200);
      const copy=await call('post',route+'/copy',{params:{...params,week:previous},body:{revision:0,sourceWeek:week,sourceRevision:2}});
      assert.equal(copy.code,409);assert.equal((await get(previous)).revision,0);
      // A legacy snapshot cannot be reintroduced through the history endpoint.
      const history=(await pool.query("INSERT INTO schedule_department_history(department_id,week_start,revision,draft,action) VALUES($1,$2,0,$3,'save') RETURNING id",[dept.id,week,JSON.stringify(draft(1))])).rows[0].id;
      assert.equal((await call('post',route+'/restore',{params,body:{revision:2,historyId:Number(history)}})).code,409);
      assert.equal((await get()).revision,2);
      // Server-side publication validation also rejects an old inconsistent draft.
      await pool.query('UPDATE schedule_department_weeks SET draft=$3 WHERE department_id=$1 AND week_start=$2',[dept.id,week,JSON.stringify(draft(1))]);
      assert.equal((await call('post',route+'/publish',{params,body:{revision:2,verified:true,warningsReviewed:true}})).code,409);
      assert.equal((await save(draft(3),2)).code,200);
      const publicWeek=(await call('get','/api/leave/department-schedules/:id/:week',{params})).body;
      assert.equal(publicWeek.schedule.rows[0].cells[3].start,480);
      assert.doesNotMatch(JSON.stringify(publicWeek),/sourceNote|seniorityDate|1990-05-06/);
    });
    await t.test('repousser une date ne rend pas invalides des quarts déjà préparés ou publiés',async()=>{
      let person=(await call('get','/api/departments/meta')).body.people.find(p=>p.id===id);
      let result=await call('put','/api/departments/people/:id',{params:{id},body:{...body,version:person.version,seniorityDate:addDays(entry,1)}});
      assert.equal(result.code,409);
      assert.equal((await call('get','/api/departments/meta')).body.people.find(p=>p.id===id).seniorityDate,entry);
      // Clearing the draft is insufficient while the published shift remains.
      assert.equal((await save(draft(-1),3)).code,200);
      result=await call('put','/api/departments/people/:id',{params:{id},body:{...body,version:person.version,seniorityDate:addDays(entry,1)}});
      assert.equal(result.code,409);
      assert.equal((await call('post',route+'/unpublish',{params:{id:dept.id,week},body:{revision:4}})).code,200);
      result=await call('put','/api/departments/people/:id',{params:{id},body:{...body,version:person.version,seniorityDate:addDays(entry,1)}});
      assert.equal(result.code,200,JSON.stringify(result.body));
      assert.equal((await save(draft(3),5)).code,409,'the new date is used by stale forms too');
      assert.equal((await save(draft(4),5)).code,200);
    });
  }finally{await f.db.close();}
});
