import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {blankCell} from '../public/departments-core.js';

test('copie de semaine : toutes les cases, versions protégées, historique et publications conservées',async t=>{
  const f=await departmentFixture(),{call,pool}=f,route='/api/departments/:id/weeks/:week';
  try{
    const meta=(await call('get','/api/departments/meta')).body,id=meta.departments.find(d=>d.key==='boulangerie').id,sourceWeek='2030-10-14',targetWeek='2030-10-21';
    const person=(await call('post','/api/departments/people',{body:{name:'Camille Exemple',group:'regular',active:true,departments:[id],availability:Object.fromEntries(Array.from({length:7},(_,i)=>[i,'J']))}})).body.id;
    const get=async week=>(await call('get',route,{params:{id,week}})).body;
    const save=(week,revision,draft)=>call('put',route,{params:{id,week},body:{revision,draft}});
    const pub=week=>call('get','/api/leave/department-schedules/:id/:week',{params:{id,week}});
    const copy=(body={},week=targetWeek)=>call('post',route+'/copy',{params:{id,week},body:{sourceWeek,sourceRevision:1,revision:0,...body}});
    const draft={manager:'Responsable exemple',notes:'Notes à ajuster',rows:[{personId:person,cells:[{kind:'shift',start:420,end:960,breakMinutes:30,note:'Ouverture'},{...blankCell(),kind:'off',note:'Repos'},{...blankCell(),kind:'vacation',note:'Semaine de repos'},{...blankCell(),kind:'note',note:'Formation'},blankCell(),{...blankCell(),kind:'review',note:'À confirmer'},blankCell()]}]};
    assert.equal((await save(sourceWeek,0,draft)).code,200);
    const source=await get(sourceWeek);
    await t.test('copie complète en brouillon, source intacte, sans publication',async()=>{
      const handlers=f.routes.get('post '+route+'/copy');assert.equal(handlers[0],f.options.requireManager);assert.equal(handlers[1],f.options.sameOrigin);
      const result=await copy();assert.equal(result.code,200,JSON.stringify(result.body));
      const target=await get(targetWeek);assert.deepEqual(target.draft,source.draft);assert.equal(target.revision,1);assert.equal(target.publishedAt,null);assert.deepEqual(await get(sourceWeek),source);
      assert.equal((await pub(targetWeek)).code,404);assert.ok(target.warnings.some(w=>w.includes('lecture à corriger')));
      target.draft.rows[0].cells[0].end=1020;assert.equal((await save(targetWeek,1,target.draft)).code,200);assert.equal((await get(sourceWeek)).draft.rows[0].cells[0].end,960);
    });
    await t.test('refus des sources absentes, mêmes semaines, dates et versions invalides',async()=>{
      const before=await get(targetWeek);
      for(const [body,week,code] of [[{},sourceWeek,400],[{sourceWeek:'2030-10-28'},targetWeek,400],[{sourceRevision:0,revision:2,replaceConfirmed:true},targetWeek,409],[{revision:1,replaceConfirmed:true},targetWeek,409],[{sourceWeek:'2030-10-15'},targetWeek,400],[{revision:2,replaceConfirmed:true},'2030-10-22',400],[{revision:2},targetWeek,400]])assert.equal((await copy(body,week)).code,code);
      assert.deepEqual(await get(targetWeek),before);
    });
    await t.test('remplacement confirmé, historique restaurable, version publiée préservée',async()=>{
      const target=await get(targetWeek);target.draft.rows[0].cells[5]=blankCell();assert.equal((await save(targetWeek,2,target.draft)).code,200);
      assert.equal((await call('post',route+'/publish',{params:{id,week:targetWeek},body:{revision:3,verified:true}})).code,200);
      const published=(await pub(targetWeek)).body,old=await get(targetWeek);
      assert.equal((await copy({revision:4,replaceConfirmed:true})).code,200);
      const copied=await get(targetWeek);assert.deepEqual(copied.draft,source.draft);assert.deepEqual((await pub(targetWeek)).body,published);
      const history=(await call('get',route+'/history',{params:{id,week:targetWeek}})).body.history;
      assert.equal(history[0].action,'copy');assert.equal(history[0].revision,4);
      assert.equal((await call('post',route+'/restore',{params:{id,week:targetWeek},body:{revision:5,historyId:history[0].id}})).code,200);
      assert.deepEqual((await get(targetWeek)).draft,old.draft);assert.deepEqual((await pub(targetWeek)).body,published);
    });
    await t.test('conflits de la nouvelle semaine recalculés et employé retiré refusé sans perte',async()=>{
      await pool.query("UPDATE schedule_store_people SET availability=$1 WHERE id=$2",[JSON.stringify({0:'0'}),person]);
      assert.equal((await copy({revision:6,replaceConfirmed:true})).code,200);
      assert.ok((await get(targetWeek)).warnings.some(w=>w.includes('en dehors de la disponibilité')));
      const previous=(await pool.query('SELECT draft,revision FROM schedule_department_weeks WHERE department_id=$1 AND week_start=$2',[id,targetWeek])).rows[0];
      await pool.query('DELETE FROM schedule_store_memberships WHERE person_id=$1 AND department_id=$2',[person,id]);
      assert.equal((await copy({revision:7,replaceConfirmed:true})).code,400);
      assert.deepEqual((await pool.query('SELECT draft,revision FROM schedule_department_weeks WHERE department_id=$1 AND week_start=$2',[id,targetWeek])).rows[0],previous);
    });
  }finally{await f.db.close();}
});
