import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {departmentFixture} from './department-fixture.js';
import {installServiceChat} from '../service-chat.js';
import {createServiceChatPush,pushTables,decryptPushKey} from '../service-chat-push.js';

test('two origins sharing a database retain distinct keys and never consume each other’s jobs',async()=>{
  const f=await departmentFixture(),workers=[];
  const primary='https://quarts-service-iga.onrender.com',secondary='https://besoins.example.test';
  const firstTables=pushTables(primary),secondTables=pushTables(secondary),sent=[];
  try{
    await installServiceChat(f.app,f.pool,{employeePortal:{},managerAccess:{},sameOrigin(){}});
    const first=await createServiceChatPush(f.pool,{scope:primary,secret:'primary-test-secret',startWorker:false,send:async(...args)=>sent.push(['primary',args])});workers.push(first);
    const existing=(await f.pool.query(`SELECT * FROM ${firstTables.config}`)).rows[0];
    // Reproduces the exact old failure: the singleton cannot be decrypted with another service's secret.
    assert.throws(()=>decryptPushKey(existing.private_key_encrypted,'secondary-test-secret'));
    const second=await createServiceChatPush(f.pool,{scope:secondary,secret:'secondary-test-secret',startWorker:false,send:async(...args)=>sent.push(['secondary',args])});workers.push(second);
    assert.notEqual(first.publicKey,second.publicKey);
    assert.deepEqual((await f.pool.query(`SELECT * FROM ${firstTables.config}`)).rows[0],existing,'legacy key was not regenerated');
    const message=(await f.pool.query("INSERT INTO schedule_service_messages(author_key,author_name,request_id,body) VALUES('employee:99','Test',$1,'Test') RETURNING id",[crypto.randomUUID()])).rows[0];
    for(const [worker,tables] of [[first,firstTables],[second,secondTables]]){
      await f.pool.query(`INSERT INTO ${tables.subscriptions}(id,owner_key,credential_hash,endpoint_hash,subscription) VALUES($1,'admin',$2,'test-endpoint',$3)`,
        [crypto.randomUUID(),await worker.credential('admin'),JSON.stringify({endpoint:'https://fcm.googleapis.com/fcm/send/test'})]);
    }
    await first.enqueue(f.pool,{id:message.id,authorKey:'employee:99'});
    await first.enqueue(f.pool,{id:message.id,authorKey:'employee:99'});
    const count=async table=>Number((await f.pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
    assert.equal(await count(firstTables.jobs),1);assert.equal(await count(secondTables.jobs),1);
    await second.drain();assert.equal(sent.length,1);assert.equal(sent[0][0],'secondary');
    assert.equal(await count(firstTables.jobs),1,'foreign pending job remains untouched');
    assert.equal(await count(firstTables.subscriptions),1,'foreign credentials were not revoked');
    await first.drain();assert.equal(sent.length,2);assert.equal(sent[1][0],'primary');
    assert.equal(sent[1][1][2].vapidDetails.publicKey,existing.public_key);
    const restarted=await createServiceChatPush(f.pool,{scope:secondary,secret:'secondary-test-secret',startWorker:false});workers.push(restarted);
    assert.equal(restarted.publicKey,second.publicKey);
    await assert.rejects(createServiceChatPush(f.pool,{scope:primary,secret:'changed-secret',startWorker:false}),{code:'PUSH_KEY_DECRYPT_FAILED'});
    assert.equal((await f.pool.query(`SELECT public_key FROM ${firstTables.config}`)).rows[0].public_key,existing.public_key);
  }finally{for(const worker of workers)worker.stop();await f.db.close();}
});
