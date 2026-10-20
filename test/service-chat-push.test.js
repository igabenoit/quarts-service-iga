import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {departmentFixture} from './department-fixture.js';
import {installServiceChat} from '../service-chat.js';
import {createServiceChatPush,validateSubscription,encryptPushKey,decryptPushKey} from '../service-chat-push.js';

const subscription=(n=1)=>({endpoint:`https://fcm.googleapis.com/fcm/send/test-${n}`,keys:{
  p256dh:crypto.createECDH('prime256v1').generateKeys().toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')
}});
test('push endpoints exclude arbitrary hosts, private URLs, credentials and malformed keys',()=>{
  const good=subscription();assert.deepEqual(validateSubscription(good),good);
  for(const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/','https://evil.test/','https://fcm.googleapis.com.evil.test/x','https://user:pass@fcm.googleapis.com/x','https://web.push.apple.com:444/x']){
    assert.throws(()=>validateSubscription({...good,endpoint}));
  }
  assert.throws(()=>validateSubscription({...good,keys:{...good.keys,auth:'a'}}));
  const encrypted=encryptPushKey('private-value','secret');
  assert.ok(!encrypted.includes('private-value'));assert.equal(decryptPushKey(encrypted,'secret'),'private-value');
  assert.throws(()=>decryptPushKey(encrypted,'different'));
});

test('push subscription, durable queue, revocation, retries and private payloads',async()=>{
  process.env.SESSION_SECRET='push-test-secret';process.env.MANAGER_CODE='push-admin-test';
  const f=await departmentFixture();let server,push;
  try{
    await f.pool.query('CREATE TABLE schedule_manager_accounts(id BIGINT PRIMARY KEY,version INTEGER,active BOOLEAN,departments JSONB)');
    const service=(await f.pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0].id;
    await f.pool.query('INSERT INTO schedule_manager_accounts VALUES(7,1,TRUE,$1),(8,1,TRUE,\'[]\')',[JSON.stringify([Number(service)])]);
    const identities=[];
    for(let i=0;i<3;i++){
      const e=(await f.pool.query("INSERT INTO schedule_employees(name,area,role) VALUES($1,'front','cashier') RETURNING id",['Test '+i])).rows[0];
      const p=(await f.pool.query('INSERT INTO schedule_store_people(name,service_employee_id,employee_code) VALUES($1,$2,$3) RETURNING id',['Test '+i,e.id,`00123${i}`])).rows[0];
      const res={set(){return this;},status(){return this;},json(){},setHeader(_k,value){this.cookie=value.split(';')[0];}};
      await f.service.employeePortal.login({body:{code:`00123${i}`},ip:'test-'+i},res);
      identities.push({key:'employee:'+p.id,person:p.id,employee:e.id,cookie:res.cookie});
    }
    const sent=[],app=express();app.use(express.json());let failure=null;
    const sameOrigin=(req,res,next)=>req.get('origin')==='https://evil.test'?res.status(403).json({error:'origin'}):next();
    push=await installServiceChat(app,f.pool,{employeePortal:f.service.employeePortal,managerAccess:{identity:async()=>null},sameOrigin,
      pushFactory:pool=>createServiceChatPush(pool,{secret:process.env.SESSION_SECRET,startWorker:false,send:async(...args)=>{if(failure)throw failure;sent.push(args);}})});
    // Keep dispatch deterministic while exercising the transaction in the real chat POST.
    push.kick=()=>{};
    app.post('/logout',sameOrigin,async(req,res)=>{await push.logout(req,res);res.json({ok:true});});
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const devices={};
    async function call(path,person=0,{method='GET',body,origin}={}){
      const response=await fetch(base+path,{method,headers:{cookie:identities[person].cookie+(devices[person]?'; '+devices[person]:''),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(origin?{origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      const cookie=response.headers.get('set-cookie');if(cookie?.startsWith('service_push_device='))devices[person]=cookie.split(';')[0];
      return {status:response.status,body:await response.json()};
    }
    const one=subscription(),two=subscription(2);
    assert.equal((await call('/api/service-chat/push')).body.enabled,false);
    assert.equal((await call('/api/service-chat/push',0,{method:'POST',body:one,origin:'https://evil.test'})).status,403);
    assert.equal((await call('/api/service-chat/push',0,{method:'POST',body:one})).status,200);
    assert.equal((await call('/api/service-chat/push',1,{method:'POST',body:two})).status,200);
    assert.equal((await call('/api/service-chat/push')).body.enabled,true);
    assert.equal((await call('/api/service-chat/push/test',0,{method:'POST'})).status,200);
    assert.equal((await call('/api/service-chat/push/test',0,{method:'POST'})).status,429);
    assert.equal(sent.length,1);sent.length=0;
    const data={body:'Privé : personne ne voit ce texte sur écran verrouillé',requestId:crypto.randomUUID()};
    const enqueue=push.enqueue;push.enqueue=async()=>{throw Error('database failure');};
    assert.equal((await call('/api/service-chat/messages',0,{method:'POST',body:data})).status,500);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM schedule_service_messages')).rows[0].n,0,'queue and message commit atomically');
    push.enqueue=enqueue;
    const created=await call('/api/service-chat/messages',0,{method:'POST',body:data});assert.equal(created.status,201);
    const jobs=async()=>Number((await f.pool.query('SELECT count(*)::int AS n FROM schedule_service_push_jobs')).rows[0].n);
    assert.equal(await jobs(),1,'sender excluded');
    await call('/api/service-chat/messages',0,{method:'POST',body:data});assert.equal(await jobs(),1,'idempotent retries do not enqueue twice');
    failure=Object.assign(Error('provider unavailable'),{statusCode:503});await push.drain();
    assert.equal(await jobs(),1,'failed delivery remains durable');
    assert.equal((await f.pool.query('SELECT attempts FROM schedule_service_push_jobs')).rows[0].attempts,1);
    failure=null;await f.pool.query('UPDATE schedule_service_push_jobs SET due_at=clock_timestamp()');await push.drain();
    assert.equal(await jobs(),0);assert.equal(sent.length,1);
    assert.equal(sent[0][0].endpoint,two.endpoint);assert.ok(!sent[0][1].includes('Privé'));assert.ok(!sent[0][1].includes('Test 0'));
    assert.equal(JSON.parse(sent[0][1]).url,'/discussion');assert.ok(sent[0][2].vapidDetails.privateKey);
    const stored=(await f.pool.query('SELECT * FROM schedule_service_push_config')).rows[0];
    assert.ok(!JSON.stringify(stored).includes(sent[0][2].vapidDetails.privateKey));
    const reopened=await createServiceChatPush(f.pool,{secret:process.env.SESSION_SECRET,startWorker:false});
    assert.equal(reopened.publicKey,push.publicKey);reopened.stop();
    // Credential changes revoke delivery even when an old browser subscription still exists.
    await call('/api/service-chat/messages',0,{method:'POST',body:{body:'next',requestId:crypto.randomUUID()}});
    await f.pool.query("UPDATE schedule_store_people SET employee_code='999999' WHERE id=$1",[identities[1].person]);
    await push.drain();assert.equal(sent.length,1);assert.equal(await jobs(),0);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM schedule_service_push_subscriptions')).rows[0].n,1);
    await f.pool.query("UPDATE schedule_store_people SET employee_code='001231' WHERE id=$1",[identities[1].person]);
    await call('/api/service-chat/push',1,{method:'POST',body:two});
    await call('/api/service-chat/messages',0,{method:'POST',body:{body:'third',requestId:crypto.randomUUID()}});
    failure=Object.assign(Error('gone'),{statusCode:410});await push.drain();assert.equal(await jobs(),0);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM schedule_service_push_subscriptions')).rows[0].n,1);
    failure=null;
    // A reused device replaces the previous identity; the endpoint alone is not sufficient.
    const forged={...one,keys:{...one.keys,auth:crypto.randomBytes(16).toString('base64url')}};
    assert.equal((await call('/api/service-chat/push',2,{method:'POST',body:forged})).status,409);
    assert.equal((await call('/api/service-chat/push',2,{method:'POST',body:one})).status,200);
    assert.equal((await call('/api/service-chat/push',0)).body.enabled,false);
    assert.equal((await call('/api/service-chat/push',2)).body.enabled,true);
    assert.ok(await push.credential('manager:7'));assert.equal(await push.credential('manager:8'),null);
    const managerHash=await push.credential('manager:7');await f.pool.query('UPDATE schedule_manager_accounts SET version=2 WHERE id=7');assert.notEqual(await push.credential('manager:7'),managerHash);
    await f.pool.query('UPDATE schedule_employees SET departed_at=clock_timestamp() WHERE id=$1',[identities[2].employee]);
    assert.equal(await push.credential(identities[2].key),null);
    await call('/logout',2,{method:'POST'});assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM schedule_service_push_subscriptions')).rows[0].n,0);
  }finally{push?.stop();if(server)await new Promise(resolve=>server.close(resolve));await f.db.close();}
});

test('service worker always shows a generic alert and opens only the Service discussion',async()=>{
  const listeners={},shown=[],opened=[];
  const self={location:{origin:'https://example.test'},registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url),claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name,fn)=>listeners[name]=fn};
  vm.runInNewContext(readFileSync(new URL('../public/service-chat-sw.js',import.meta.url),'utf8'),{self,URL});
  let waiting;listeners.push({data:{json:()=>({body:'private text',url:'https://evil.test/'})},waitUntil:p=>waiting=p});await waiting;
  assert.equal(shown.length,1);assert.ok(!JSON.stringify(shown).includes('private text'));
  listeners.notificationclick({notification:{data:{url:'https://evil.test/'},close(){}},waitUntil:p=>waiting=p});await waiting;
  assert.equal(opened[0],'https://example.test/discussion');
});
