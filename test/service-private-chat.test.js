import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {departmentFixture} from './department-fixture.js';
import {installServiceChat} from '../service-chat.js';
import {createServiceChatPush} from '../service-chat-push.js';

test('private conversations, leave questions and notifications stay between their participants',async()=>{
  process.env.SESSION_SECRET='private-test-secret';
  const f=await departmentFixture();let server,push;
  try{
    await f.pool.query('CREATE TABLE schedule_manager_accounts(id BIGINT PRIMARY KEY,name TEXT,version INTEGER,active BOOLEAN,departments JSONB,person_id BIGINT)');
    const identities=[];
    for(let n=0;n<3;n++){
      const e=(await f.pool.query("INSERT INTO schedule_employees(name,area,role) VALUES($1,'front','cashier') RETURNING id",['Person '+n])).rows[0];
      const p=(await f.pool.query('INSERT INTO schedule_store_people(name,service_employee_id,employee_code) VALUES($1,$2,$3) RETURNING id',['Person '+n,e.id,'00123'+n])).rows[0];
      identities.push({key:'employee:'+p.id,name:'Person '+n,id:p.id,employee:e.id});
    }
    const sent=[],app=express();app.use(express.json());
    const sameOrigin=(req,res,next)=>req.get('origin')==='https://evil.test'?res.status(403).json({error:'origin'}):next();
    push=await installServiceChat(app,f.pool,{sameOrigin,
      employeePortal:{identity:async req=>identities[Number(req.get('x-person'))]||null},
      managerAccess:{identity:async req=>req.get('x-manager')==='admin'?{kind:'admin',name:'Administration'}:null},
      pushFactory:pool=>createServiceChatPush(pool,{secret:process.env.SESSION_SECRET,startWorker:false,send:async(...args)=>sent.push(args)})});
    push.kick=()=>{};
    for(const person of identities)await f.pool.query(`INSERT INTO schedule_service_push_subscriptions(id,owner_key,credential_hash,endpoint_hash,subscription) VALUES($1,$2,$3,$2,$4)`,[crypto.randomUUID(),person.key,await push.credential(person.key),JSON.stringify({endpoint:person.key})]);
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    async function call(path,{who=0,body,method=body?'POST':'GET',origin}={}){
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/service-chat`+path,{method,headers:{'Content-Type':'application/json',...(who==='admin'?{'x-manager':'admin'}:{'x-person':String(who)}),...(origin?{origin}:{})},body:body?JSON.stringify(body):undefined});
      return {status:response.status,body:await response.json()};
    }
    const payload={body:'Confidential',peer:identities[1].key,requestId:crypto.randomUUID()};
    assert.equal((await call('/private/messages',{body:payload,origin:'https://evil.test'})).status,403);
    const created=await call('/private/messages',{body:payload});assert.equal(created.status,201,JSON.stringify(created));
    assert.equal((await call('/private/messages',{body:payload})).body.id,created.body.id);
    assert.equal((await call('/private/messages',{body:{...payload,peer:identities[2].key}})).status,409);
    for(const who of [0,1,2,'admin']){
      assert.equal((await call('/messages',{who})).body.messages.length,0);
      assert.equal((await call('/pins',{who})).body.messages.length,0);
      assert.equal((await call('',{who})).body.unread,0);
      assert.equal((await call('/messages/'+created.body.id+'/photo',{who})).status,404);
      assert.equal((await call('/read',{who,body:{lastId:created.body.id}})).status,404);
    }
    assert.equal((await call('/messages/'+created.body.id+'/pin',{who:'admin',method:'PUT',body:{pinned:true}})).status,404);
    assert.equal((await call('/private/messages?peer='+identities[0].key,{who:1})).body.messages.length,1);
    for(const who of [2,'admin'])assert.equal((await call('/private/messages?peer='+identities[0].key,{who})).body.messages.length,0);
    assert.equal((await call('/private/read',{who:2,body:{lastId:created.body.id}})).status,404);
    assert.equal((await call('/private',{who:1})).body.contacts.find(p=>p.key===identities[0].key).unread,1);
    assert.equal((await call('/private/read',{who:1,body:{lastId:created.body.id}})).status,200);
    await push.drain();assert.equal(sent.length,1);assert.equal(sent[0][0].endpoint,identities[1].key);
    assert.equal(JSON.parse(sent[0][1]).kind,'private-message');assert.ok(!sent[0][1].includes('Confidential'));
    const leave=(await f.pool.query(`INSERT INTO schedule_leave_requests(submission_key,employee_id,employee_name,email,reason,periods,first_date,last_date,status,department_id,department_name)
      VALUES($1,$2,'Person 1','test@example.test','Test','[]','2026-12-01','2026-12-01','pending',(SELECT id FROM schedule_leave_departments WHERE code='service'),'Service') RETURNING id`,[crypto.randomUUID(),identities[1].employee])).rows[0];
    const question={body:'Peux-tu préciser les heures ?',leaveId:String(leave.id),requestId:crypto.randomUUID()};
    assert.equal((await call('/private/messages',{who:0,body:question})).status,403);
    const asked=await call('/private/messages?mode=manager',{who:'admin',body:question});assert.equal(asked.status,201,JSON.stringify(asked));
    assert.equal(asked.body.recipientKey,identities[1].key);
    assert.equal((await call('/private',{who:1})).body.questions.length,1);
    assert.equal((await call('/private',{who:2})).body.questions.length,0);
    await push.drain();assert.equal(sent.length,2);assert.equal(JSON.parse(sent[1][1]).kind,'leave-question');assert.ok(!sent[1][1].includes('heures'));
    const reply={body:'De 9 h à 12 h',replyTo:asked.body.id,requestId:crypto.randomUUID()};
    assert.equal((await call('/private/messages',{who:2,body:reply})).status,404);
    const answered=await call('/private/messages',{who:1,body:reply});assert.equal(answered.status,201,JSON.stringify(answered));
    assert.equal(answered.body.recipientKey,'admin');
    assert.equal((await call('/private',{who:1})).body.questions.length,0);
    assert.equal((await call('/private/messages?peer='+identities[1].key,{who:'admin'})).body.messages.length,2);
    await f.pool.query('UPDATE schedule_employees SET active=FALSE WHERE id=$1',[identities[1].employee]);
    assert.equal((await call('/private/messages',{body:{...payload,requestId:crypto.randomUUID()}})).status,400);
  }finally{push?.stop();if(server)await new Promise(r=>server.close(r));await f.db.close();}
});

test('phone notification offers a safe private reply link without message text',async()=>{
  const handlers={},shown=[],opened=[];
  const self={location:{origin:'https://service.test'},addEventListener:(name,fn)=>handlers[name]=fn,
    registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
  vm.runInNewContext(readFileSync(new URL('../public/service-chat-sw.js',import.meta.url),'utf8'),{self,URL,Intl,Date});
  let pending;handlers.push({data:{json:()=>({kind:'leave-question',url:'/discussion?private=admin',body:'secret'})},waitUntil:p=>pending=p});await pending;
  assert.match(shown[0][0],/Réponse requise/);assert.equal(shown[0][1].actions[0].title,'Répondre');assert.ok(!JSON.stringify(shown).includes('secret'));
  handlers.notificationclick({notification:{data:shown[0][1].data,close(){}},waitUntil:p=>pending=p});await pending;
  assert.equal(opened[0],'https://service.test/discussion?private=admin');
  handlers.notificationclick({notification:{data:{url:'https://evil.test/discussion?private=admin'},close(){}},waitUntil:p=>pending=p});await pending;
  assert.equal(opened[1],'https://service.test/discussion');
});
