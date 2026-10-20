import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'node:crypto';
import {departmentFixture} from './department-fixture.js';
import {installServiceChat,chatPayload} from '../service-chat.js';

const requestId=()=>crypto.randomUUID();
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1sAAAAASUVORK5CYII=';
test('chat payload rejects invalid IDs, excessive text and active image formats',()=>{
  assert.throws(()=>chatPayload(null));
  assert.throws(()=>chatPayload({body:'',requestId:requestId()}));
  assert.throws(()=>chatPayload({body:'a'.repeat(4001),requestId:requestId()}));
  assert.throws(()=>chatPayload({body:'hello',requestId:'no'}));
  assert.throws(()=>chatPayload({photo:'data:image/svg+xml;base64,PHN2Zz4=',requestId:requestId()}));
  assert.throws(()=>chatPayload({photo:'data:image/png;base64,PHN2Zz4=',requestId:requestId()}));
  assert.equal(chatPayload({photo:pixel,requestId:requestId()}).photo,pixel);
});

test('Service chat enforces membership, persists messages, protects photos, pins and read cursors',async()=>{
  process.env.SESSION_SECRET='chat-test-secret';
  const f=await departmentFixture();
  let server;
  try{
    const service=(await f.pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0].id;
    const employee=(await f.pool.query("INSERT INTO schedule_employees(name,area,role) VALUES('Service One','front','cashier') RETURNING id")).rows[0].id;
    const person=(await f.pool.query("INSERT INTO schedule_store_people(name,service_employee_id,employee_code) VALUES('Service One',$1,'001234') RETURNING id",[employee])).rows[0].id;
    const other=(await f.pool.query("INSERT INTO schedule_store_people(name,employee_code) VALUES('Other Department','001235') RETURNING id")).rows[0].id;
    const member=(await f.pool.query("INSERT INTO schedule_store_people(name,employee_code) VALUES('Service Member','001236') RETURNING id")).rows[0].id;
    await f.pool.query('INSERT INTO schedule_store_memberships(person_id,department_id) VALUES($1,$2)',[member,service]);
    const cookies={};
    for(const code of ['001234','001235','001236']){
      const res={status(){return this;},set(){return this;},json(){},setHeader(k,v){cookies[code]=v.split(';')[0];}};
      await f.service.employeePortal.login({body:{code},ip:code},res);
    }
    const app=express();app.use(express.json({limit:'250kb'}));
    const sameOrigin=(req,res,next)=>req.get('origin')&&req.get('origin')!=='http://trusted.test'?res.status(403).json({error:'Origin'}):next();
    const managers={admin:{kind:'admin',name:'Administration'},service:{kind:'account',id:7,name:'Service Manager',departments:[Number(service)]},other:{kind:'account',id:8,name:'Other Manager',departments:[]}};
    await installServiceChat(app,f.pool,{employeePortal:f.service.employeePortal,managerAccess:{identity:async req=>managers[req.get('x-test-manager')]||null},sameOrigin});
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const url=`http://127.0.0.1:${server.address().port}`;
    async function call(path='',{cookie=cookies['001234'],manager,method='GET',body,origin,type='application/json'}={}){
      const response=await fetch(url+'/api/service-chat'+path,{method,headers:{...(cookie?{cookie}:{}),...(manager?{'x-test-manager':manager}:{}),...(body!==undefined?{'Content-Type':type}:{}),...(origin?{origin}:{})},body:body!==undefined?JSON.stringify(body):undefined});
      const result=await response.text();return {status:response.status,headers:response.headers,body:response.headers.get('content-type')?.includes('application/json')?JSON.parse(result):result};
    }
    assert.equal((await call('',{cookie:''})).status,401);
    assert.equal((await call('',{cookie:'family_portal=anything'})).status,401);
    assert.equal((await call('',{cookie:cookies['001235']})).status,403);
    assert.equal((await call('',{cookie:'',manager:'other'})).status,403);
    assert.equal((await call('',{cookie:'',manager:'service'})).status,200);
    assert.equal((await call('',{cookie:cookies['001236']})).status,200);
    const payload={body:'<script>alert(1)</script>',photo:pixel,requestId:requestId(),authorName:'Forged'};
    assert.equal((await call('/messages',{method:'POST',body:payload,origin:'https://evil.test'})).status,403);
    const created=await call('/messages',{method:'POST',body:payload,type:'application/vnd.iga.chat+json'});
    assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.authorName,'Service One');
    assert.equal(created.body.photo,undefined);assert.equal(created.body.hasPhoto,true);
    const messageId=created.body.id;
    const retry=await call('/messages',{method:'POST',body:payload});assert.equal(retry.body.id,messageId);
    assert.equal((await call('/messages',{method:'POST',body:{...payload,body:'changed'}})).status,409);
    const photo=await call(`/messages/${messageId}/photo`);assert.equal(photo.status,200);assert.match(photo.headers.get('content-type'),/image\/png/);assert.equal(photo.headers.get('cache-control'),'no-store');
    assert.equal((await call(`/messages/${messageId}/photo`,{cookie:cookies['001235']})).status,403);
    assert.equal((await call(`/messages/${messageId}/pin`,{method:'PUT',body:{pinned:true}})).status,403);
    assert.equal((await call(`/messages/${messageId}/pin`,{cookie:'',manager:'service',method:'PUT',body:{pinned:true}})).status,200);
    assert.equal((await call('/pins')).body.messages.length,1);
    assert.equal((await call('',{cookie:cookies['001236']})).body.unread,1);
    assert.equal((await call('/read',{cookie:cookies['001236'],method:'POST',body:{lastId:messageId}})).status,200);
    assert.equal((await call('',{cookie:cookies['001236']})).body.unread,0);
    assert.equal((await call('/read',{method:'POST',body:{lastId:'999999'}})).status,404);
    assert.equal((await call('/messages?before=abc')).status,400);
    assert.equal((await call('/messages?before=1&after=2')).status,400);
    assert.equal((await call('/messages',{method:'POST',body:null})).status,400);
    // Membership and active status are rechecked on every read/write, including photo requests.
    await f.pool.query('DELETE FROM schedule_store_memberships WHERE person_id=$1',[member]);
    assert.equal((await call('',{cookie:cookies['001236']})).status,403);
    await f.pool.query('UPDATE schedule_employees SET active=FALSE WHERE id=$1',[employee]);
    assert.equal((await call()).status,401);
    await f.pool.query('UPDATE schedule_employees SET active=TRUE WHERE id=$1',[employee]);
    // Seed a longer history to exercise both pagination directions and monotonic read state.
    for(let n=0;n<55;n++)await f.pool.query("INSERT INTO schedule_service_messages(author_key,author_name,request_id,body) VALUES('manager:7','Manager',$1,$2)",[requestId(),`Message ${n}`]);
    const latest=(await call('/messages')).body;assert.equal(latest.messages.length,50);assert.equal(latest.more,true);
    const older=(await call('/messages?before='+latest.messages[0].id)).body;
    assert.equal(older.messages.length,6);assert.equal(older.more,false);
    const after=(await call('/messages?after='+messageId)).body;assert.equal(after.messages.length,50);assert.equal(after.more,true);
    const end=latest.messages.at(-1).id;
    await call('/read',{method:'POST',body:{lastId:end}});
    await call('/read',{method:'POST',body:{lastId:messageId}});
    assert.equal((await call()).body.unread,0);
    for(let n=0;n<19;n++)await f.pool.query("INSERT INTO schedule_service_messages(author_key,author_name,request_id,body) VALUES($1,'Service One',$2,'rate')",['employee:'+person,requestId()]);
    assert.equal((await call('/messages',{method:'POST',body:{body:'limited',requestId:requestId()}})).status,429);
    assert.equal((await call('/messages',{method:'POST',body:payload})).status,200);
    assert.equal((await call('/messages',{method:'POST',body:{body:'a'.repeat(3_200_000),requestId:requestId()},type:'application/vnd.iga.chat+json'})).status,413);
    assert.ok(other);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.db.close();}
});
