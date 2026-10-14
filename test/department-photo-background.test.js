import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {DAY_NAMES,blankCell} from '../public/departments-core.js';

const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ3sAAAAASUVORK5CYII=';
const candidate={weekText:'19 au 25 octobre',departmentText:'PAM',warnings:[],rows:[{name:'Camille Exemple',writtenTotal:'',days:DAY_NAMES.map(day=>({...blankCell(),day,rawText:'',uncertain:false}))}]};
const response=()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(candidate)}]}]})});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function setup(options){
  const f=await departmentFixture(options),dept=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='pam');
  const id=(await f.call('post','/api/departments/photos',{body:{departmentId:dept.id,weekStart:'2026-10-19',name:'Exemple.png',dataUrl:photo}})).body.id;
  return {...f,id,start:()=>f.call('post','/api/departments/photos/:id/analyze',{params:{id},body:{background:true}}),state:async()=>(await f.call('get','/api/departments/photos/:id/status',{params:{id}})).body};
}
async function until(done){for(let n=0;n<200;n++){if(await done())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Le traitement ne se termine pas');}

test('lecture indépendante de la page : accusé immédiat, première lecture persistée, résultat récupérable sans relance',async()=>{
  const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fake-only';
  const first=deferred(),second=deferred();let calls=0;
  const f=await setup({fetchImpl:async()=>{await (++calls===1?first:second).promise;return response();}});
  try{
    const started=await f.start();assert.equal(started.code,202);assert.equal(started.body.busy,true);assert.equal(started.body.phase,'reading');
    assert.equal((await f.start()).code,409);assert.equal((await f.state()).attempts,1);
    first.resolve();await until(()=>calls===2);
    let state=await f.state();assert.equal(state.busy,true);assert.equal(state.phase,'verifying');assert.equal(state.candidate.rows[0].name,'Camille Exemple');assert.equal(state.candidate.analysis.verification,'partial');
    assert.equal((await f.call('post','/api/departments/photos/:id/apply',{params:{id:f.id}})).code,409);
    second.resolve();await until(async()=>!(await f.state()).busy);
    state=await f.state();assert.equal(state.state,'ready');assert.equal(state.candidate.analysis.verification,'complete');assert.equal(state.lastError,'');assert.equal(calls,2);assert.equal(state.attempts,1);
  }finally{first.resolve();second.resolve();await f.db.close();if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});

test('délai dépassé pendant la relecture : proposition conservée et bouton libéré même si le fournisseur reste bloqué',async()=>{
  const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fake-only';
  let calls=0;const held=deferred(),finished=deferred();const f=await setup({photoTimeoutMs:100,fetchImpl:async()=>{if(++calls===2){await held.promise;finished.resolve();}return response();}});
  try{
    assert.equal((await f.start()).code,202);await until(()=>calls===2);await until(async()=>!(await f.state()).busy);
    let state=await f.state();assert.equal(state.state,'ready');assert.match(state.lastError,/délai/);assert.equal(state.candidate.analysis.verification,'partial');
    held.resolve();await finished.promise;await new Promise(r=>setImmediate(r));
    state=await f.state();assert.equal(state.candidate.analysis.verification,'partial','a late result cannot overwrite the terminal operation');assert.match(state.lastError,/délai/);
  }finally{held.resolve();await f.db.close();if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});

test('redémarrage du serveur : état périmé libéré, erreur visible et première proposition récupérable',async()=>{
  let calls=0;const f=await setup({fetchImpl:async()=>{calls++;return response();}});
  try{
    await f.pool.query("UPDATE schedule_department_photos SET state='processing',phase='verifying',started_at=clock_timestamp()-interval '6 minutes',operation_id='lost',attempts=1,candidate=$2 WHERE id=$1",[f.id,JSON.stringify(candidate)]);
    const state=await f.state();assert.equal(state.busy,false);assert.equal(state.state,'ready');assert.match(state.lastError,/interrompue/);assert.deepEqual(state.candidate,{...candidate,rulesVersion:1});assert.equal(state.attempts,1);assert.equal(calls,0);
    assert.equal((await f.pool.query('SELECT operation_id FROM schedule_department_photos WHERE id=$1',[f.id])).rows[0].operation_id,null);
  }finally{await f.db.close();}
});
