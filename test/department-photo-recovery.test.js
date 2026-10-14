import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {DAY_NAMES,blankCell} from '../public/departments-core.js';

const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ3sAAAAASUVORK5CYII=';
const candidate={weekText:'12 au 18',departmentText:'PAM',warnings:[],rows:[{name:'Exemple fictif',writtenTotal:'',days:DAY_NAMES.map(day=>({...blankCell(),day,rawText:'',uncertain:false}))}]};
const response=()=>({ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(candidate)}]}]})});

test('photos : diagnostic précis, compteur conservé et reprise explicite sans nouvel appel IA',async()=>{
  const oldKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='mock-only';
  let calls=0,mode='error';
  const f=await departmentFixture({fetchImpl:async()=>{calls++;return mode==='error'?{ok:false,status:429}:response();}});
  try{
    const d=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='pam');
    const created=await f.call('post','/api/departments/photos',{body:{departmentId:d.id,weekStart:'2026-10-12',name:'PAM exemple.png',dataUrl:photo}}),id=created.body.id;
    assert.equal(created.code,201);
    const analyze=()=>f.call('post','/api/departments/photos/:id/analyze',{params:{id}});
    const state=async()=>(await f.call('get','/api/departments/photos/:id/status',{params:{id}})).body;
    const extend=attemptLimit=>f.call('post','/api/departments/photos/:id/extend-attempts',{params:{id},body:{attemptLimit}});
    const missing=await f.call('post','/api/departments/photos/:id/analyze',{params:{id:9999}});
    assert.equal(missing.code,404);assert.match(missing.body.error,/introuvable/);
    await f.pool.query("UPDATE schedule_department_photos SET state='processing',attempts=4,started_at=clock_timestamp()-interval '4 minutes' WHERE id=$1",[id]);
    const busy=await analyze();assert.equal(busy.code,409);assert.match(busy.body.error,/déjà en cours/);assert.equal(calls,0);
    assert.equal((await state()).busy,true);assert.ok((await state()).retryAfterSeconds<=60);
    await f.pool.query("UPDATE schedule_department_photos SET started_at=clock_timestamp()-interval '6 minutes',candidate=$2 WHERE id=$1",[id,JSON.stringify(candidate)]);
    const failed=await analyze();assert.match(failed.body.error,/crédit/);assert.equal(calls,1);
    let s=await state();assert.equal(s.attempts,5);assert.equal(s.remainingAttempts,0);assert.equal(s.busy,false);assert.match(s.lastError,/crédit/);assert.deepEqual(s.candidate,{...candidate,rulesVersion:1});
    assert.equal(s.dataUrl,undefined);assert.equal(s.operation_id,undefined);
    const limited=await analyze();assert.equal(limited.code,409);assert.match(limited.body.error,/5 essais autorisés/);assert.equal(calls,1);
    const extended=await extend(5);assert.equal(extended.code,200);assert.equal(extended.body.attemptLimit,10);assert.equal(extended.body.attempts,5);assert.equal(calls,1,'authorizing more attempts does not call the provider');
    assert.equal((await extend(5)).code,409);assert.equal((await extend(10)).code,409);assert.equal((await extend('10')).code,400);
    mode='success';assert.equal((await analyze()).code,200);assert.equal(calls,3);
    s=await state();assert.equal(s.attempts,6);assert.equal(s.remainingAttempts,4);assert.equal(s.lastError,'');assert.equal(s.state,'ready');
    await f.pool.query("UPDATE schedule_department_photos SET state='processing',attempts=10,started_at=clock_timestamp() WHERE id=$1",[id]);
    assert.equal((await extend(10)).code,409,'cannot extend while last allowed attempt is running');
    await f.pool.query("UPDATE schedule_department_photos SET started_at=clock_timestamp()-interval '6 minutes' WHERE id=$1",[id]);
    assert.equal((await extend(10)).body.attemptLimit,15);
    await f.pool.query('UPDATE schedule_department_photos SET started_at=NULL WHERE id=$1',[id]);
    assert.equal((await analyze()).code,200,'recover legacy processing rows without a start timestamp');
    for(const path of ['get /api/departments/photos/:id/status','post /api/departments/photos/:id/extend-attempts']){
      const handlers=f.routes.get(path);assert.equal(handlers[0],f.options.requireManager);if(path.startsWith('post'))assert.equal(handlers[1],f.options.sameOrigin);
    }
  }finally{if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;await f.db.close();}
});

test('photo : une lecture périmée ne remplace pas le résultat ou l’état de sa reprise',async()=>{
  const oldKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='mock-only';
  let release,notify;const started=new Promise(resolve=>notify=resolve),held=new Promise(resolve=>release=resolve);
  let calls=0;const f=await departmentFixture({fetchImpl:async()=>{if(++calls===1){notify();await held;}return response();}});
  try{
    const dept=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='pam');
    const id=(await f.call('post','/api/departments/photos',{body:{departmentId:dept.id,weekStart:'2026-10-12',name:'Exemple.png',dataUrl:photo}})).body.id;
    const pending=f.call('post','/api/departments/photos/:id/analyze',{params:{id}});await started;
    await f.pool.query("UPDATE schedule_department_photos SET operation_id='newer-operation' WHERE id=$1",[id]);release();
    const result=await pending;assert.equal(result.code,409);assert.match(result.body.error,/autre lecture/);
    const row=(await f.pool.query('SELECT state,candidate,last_error,operation_id FROM schedule_department_photos WHERE id=$1',[id])).rows[0];
    assert.equal(row.state,'processing');assert.equal(row.candidate,null);assert.equal(row.last_error,'');assert.equal(row.operation_id,'newer-operation');
  }finally{release();if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;await f.db.close();}
});
