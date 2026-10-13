import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {recipients} from '../department-mail.js';
const pdf=Buffer.from('%PDF-1.4\n'+' '.repeat(200)+'\n%%EOF').toString('base64');
test('destinataires normalisés sans adresses inventées',()=>{
  assert.deepEqual(recipients([' A@example.com ','a@example.com','b@example.com']),['a@example.com','b@example.com']);
  for(const value of ['a@example.com',['bad'],Array(21).fill('a@example.com')])assert.throws(()=>recipients(value));
});
test('courriels de documents : réglages par département, PDF, doublons et erreurs',async()=>{
  const sent=[];let failing=false;const f=await departmentFixture({fetchImpl:async(_url,options)=>{sent.push(options);if(failing)throw Error('timeout');return {ok:true,json:async()=>({id:'provider-id'})};}});
  const old=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='test-key';
  try{
    const meta=(await f.call('get','/api/departments/meta')).body,one=meta.departments.find(d=>d.key==='fruits').id,two=meta.departments.find(d=>d.key==='viande').id;
    const get=id=>f.call('get','/api/departments/:id/mail',{params:{id}});
    const save=(id,version,addresses)=>f.call('put','/api/departments/:id/mail',{params:{id},body:{version,recipients:addresses}});
    assert.deepEqual((await get(one)).body.recipients,[]);
    assert.equal((await save(one,0,['boss@example.com','copy@example.com'])).code,200);
    assert.deepEqual((await get(two)).body.recipients,[]);
    assert.equal((await save(one,0,['other@example.com'])).code,409);
    const body={requestId:'11111111-1111-4111-8111-111111111111',weekStart:'2026-10-12',kind:'draft',note:'À vérifier',pdf,recipientsVersion:1};
    const send=(changes={})=>f.call('post','/api/departments/document-mail/:id',{params:{id:one},body:{...body,...changes}});
    assert.equal((await send({recipientsVersion:0})).code,409);assert.equal(sent.length,0);
    assert.equal((await send({pdf:'not-pdf'})).code,400);assert.equal(sent.length,0);
    assert.equal((await send()).code,200);assert.equal(sent.length,1);
    const payload=JSON.parse(sent[0].body);assert.deepEqual(payload.to,['boss@example.com','copy@example.com']);assert.equal(payload.attachments[0].content,pdf);assert.match(payload.subject,/Ébauche/);assert.match(payload.text,/non définitif/);
    assert.equal((await send()).body.alreadySent,true);assert.equal(sent.length,1);
    assert.equal((await send({note:'changed'})).code,409);
    failing=true;const otherId='22222222-2222-4222-8222-222222222222';assert.equal((await send({requestId:otherId,kind:'blank'})).code,502);
    failing=false;assert.equal((await send({requestId:otherId,kind:'blank'})).code,200);
    assert.equal(sent[1].headers['Idempotency-Key'],sent[2].headers['Idempotency-Key']);assert.equal(sent[1].body,sent[2].body);
    assert.equal((await get(one)).body.history.filter(h=>h.status==='sent').length,2);
    await f.pool.query("UPDATE schedule_department_document_mail SET created_at=clock_timestamp()-interval '21 hours',status='error' WHERE id=$1",[otherId]);
    assert.equal((await send({requestId:otherId,kind:'blank'})).code,409);assert.equal(sent.length,3);
    process.env.RESEND_API_KEY='';assert.equal((await send({requestId:'33333333-3333-4333-8333-333333333333'})).code,503);
    assert.ok(f.routes.get('post /api/departments/document-mail/:id').includes(f.options.requireManager));assert.ok(f.routes.get('post /api/departments/document-mail/:id').includes(f.options.sameOrigin));
  }finally{if(old===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=old;await f.db.close();}
});
