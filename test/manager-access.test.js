import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {departmentFixture} from './department-fixture.js';
import {installManagerAccess,passwordHash,passwordMatches} from '../manager-access.js';

test('password hashes are salted and reject incorrect or oversized credentials',async()=>{
  const a=await passwordHash('Example-password-123'),b=await passwordHash('Example-password-123');
  assert.notEqual(a,b);assert.equal(await passwordMatches('Example-password-123',a),true);assert.equal(await passwordMatches('wrong-password',a),false);assert.equal(await passwordMatches('x'.repeat(129),a),false);
  await assert.rejects(passwordHash('short'));
});
test('individual accounts: administration, department boundaries, revocation and stale updates',async()=>{
  const f=await departmentFixture(),app=express();app.use(express.json());
  // Test-only sessions replace signature verification, which remains in server.js.
  const readSession=req=>{try{return JSON.parse(req.headers['x-test-session']||'null');}catch{return null;}};
  const origin=(req,res,next)=>req.headers.origin&&req.headers.origin!=='https://same.example'?res.status(403).json({error:'origin'}):next();
  const access=await installManagerAccess(app,f.pool,{readSession,issueSession:JSON.stringify,sameOrigin:origin,production:true});
  const guard=async(req,res,next)=>{try{await access.authorize(req);next();}catch(e){res.status(e.status||500).json({error:e.message});}};
  for(const [key,handlers] of f.routes){const space=key.indexOf(' '),method=key.slice(0,space),path=key.slice(space+1);if(path.startsWith('/api/departments')||path.startsWith('/api/leave/'))app[method](path,guard,handlers.at(-1));}
  for(const path of ['/api/employees','/api/undo','/api/leave/access-settings','/api/unknown-admin-tool'])app.get(path,guard,(_q,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
  const admin={role:'manager'},call=async(path,{session=admin,method='GET',body,origin}={})=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(session?{'x-test-session':JSON.stringify(session)}:{}),...(origin?{origin}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};};
  try{
    assert.equal((await call('/api/manager-accounts',{session:null})).status,401);
    const departments=(await call('/api/manager-accounts')).body.departments,fruit=Number(departments.find(d=>d.name.includes('Fruits')).id),meat=Number(departments.find(d=>d.name.includes('Viande')).id),service=Number(departments.find(d=>d.name==='Service').id);
    const body={name:'Gérant test',login:'gerant.test',password:'Example-password-123',active:true,departments:[fruit]};
    assert.equal((await call('/api/manager-accounts',{method:'POST',body,origin:'https://wrong.example'})).status,403);
    const created=await call('/api/manager-accounts',{method:'POST',body});assert.equal(created.status,200);let account=created.body.accounts[0];
    assert.equal('password_hash' in account,false);
    assert.equal((await call('/api/manager-accounts',{method:'POST',body})).status,409);
    const login=await call('/api/manager-login',{method:'POST',session:null,body:{login:'GERANT.TEST',password:body.password}});assert.equal(login.status,200);assert.match(login.cookie,/HttpOnly; SameSite=Strict/);assert.match(login.cookie,/Secure/);
    const session=JSON.parse(decodeURIComponent(login.cookie.split(';')[0].split('=').slice(1).join('=')));
    assert.equal((await call('/api/manager-accounts',{session})).status,403);
    assert.equal((await call('/api/manager-accounts/'+account.id,{method:'PUT',session,body:{...body,version:1,departments:[meat]}})).status,403);
    const meta=await call('/api/departments/meta',{session});assert.deepEqual(meta.body.departments.map(d=>d.id),[fruit]);
    assert.equal((await call(`/api/departments/${fruit}/weeks/2026-10-12`,{session})).status,200);
    for(const path of [`/api/departments/${meat}/weeks/2026-10-12`,`/api/departments/${meat}/mail`,`/api/departments/photos?departmentId=${meat}`,'/api/employees','/api/undo','/api/leave/access-settings','/api/unknown-admin-tool'])assert.equal((await call(path,{session})).status,403,path);
    assert.equal((await call(`/api/departments/${meat}/weeks/2026-10-12`,{session,method:'PUT',body:{}})).status,403);
    const p={name:'Personne test',email:'',group:'regular',active:true,availability:{},departments:[fruit]};
    assert.equal((await call('/api/departments/people',{session,method:'POST',body:{...p,departments:[meat]}})).status,403);
    const person=await call('/api/departments/people',{session,method:'POST',body:p});assert.equal(person.status,200);
    const other=await call('/api/departments/people',{method:'POST',body:{...p,name:'Personne autre',departments:[meat]}});assert.equal(other.status,200);
    const scopedPeople=(await call('/api/departments/meta',{session})).body.people;assert.equal(scopedPeople.some(p=>p.id===other.body.id),false);
    assert.equal((await call('/api/departments/people/'+other.body.id,{session,method:'PUT',body:{...p,version:1}})).status,403);
    const settings=(await call('/api/leave/departments',{session})).body.departments;assert.deepEqual(settings.map(d=>Number(d.id)),[fruit]);
    // Cross-department leave and availability collections, actions and photos.
    const leaveIds=[],availabilityIds=[];
    for(const [i,departmentId] of [fruit,meat].entries()){
      leaveIds.push((await f.pool.query(`INSERT INTO schedule_leave_requests(submission_key,employee_name,email,reason,periods,first_date,last_date,status,department_id) VALUES($1,'Test','test@example.com','Test',$2,'2026-11-02','2026-11-02','pending',$3) RETURNING id`,['11111111-1111-4111-8111-11111111111'+i,JSON.stringify([{date:'2026-11-02',startMinute:420,endMinute:960,allDay:false}]),departmentId])).rows[0].id);
      availabilityIds.push((await f.pool.query(`INSERT INTO schedule_availability_requests(submission_key,employee_name,email,effective_date,target_minutes,availability,acknowledged,rule_version,department_id) VALUES($1,'Test','test@example.com','2026-11-02',1200,'{}',TRUE,'test',$2) RETURNING id`,['22222222-2222-4222-8222-22222222222'+i,departmentId])).rows[0].id);
    }
    const leaves=await call('/api/leave/requests',{session});assert.equal(leaves.status,200);assert.deepEqual(leaves.body.requests.map(r=>Number(r.department_id)),[fruit]);
    const availability=await call('/api/leave/availability/requests',{session});assert.equal(availability.status,200);assert.deepEqual(availability.body.requests.map(r=>Number(r.department_id)),[fruit]);
    for(const [path,id] of [['/api/leave/requests/',leaveIds[1]],['/api/leave/availability/requests/',availabilityIds[1]]])assert.equal((await call(path+id,{session,method:'PATCH',body:{status:'refused',version:1,note:'test'}})).status,403);
    const photo=(await f.pool.query("INSERT INTO schedule_department_photos(department_id,week_start,name,data_url) VALUES($1,'2026-10-12','Test','data:image/png;base64,AA==') RETURNING id",[meat])).rows[0];
    assert.equal((await call('/api/departments/photos/'+photo.id,{session})).status,403);
    assert.equal((await call('/api/departments/photos/'+photo.id+'/analyze',{session,method:'POST',body:{}})).status,403);
    assert.equal((await call('/api/departments/document-mail/'+meat,{session,method:'POST',body:{}})).status,403);
    const week=(await call(`/api/departments/${fruit}/weeks/2026-10-12`,{session})).body;
    const draftSaved=await call(`/api/departments/${fruit}/weeks/2026-10-12`,{session,method:'PUT',body:{revision:week.revision,draft:week.draft}});assert.equal(draftSaved.status,200);
    const published=await call(`/api/departments/${fruit}/weeks/2026-10-12/publish`,{session,method:'POST',body:{revision:draftSaved.body.revision,verified:true,warningsReviewed:true}});assert.equal(published.status,200);
    const saved=await call('/api/manager-accounts/'+account.id,{method:'PUT',body:{...body,password:'',version:account.version,departments:[service]}});assert.equal(saved.status,200);
    assert.equal((await call('/api/departments/meta',{session})).status,401,'permission change revokes existing sessions');
    assert.equal((await call('/api/manager-accounts/'+account.id,{method:'PUT',body:{...body,version:1}})).status,409);
    const serviceLogin=await call('/api/manager-login',{method:'POST',session:null,body:{login:body.login,password:body.password}});assert.equal(serviceLogin.body.path,'/');
    const serviceSession=JSON.parse(decodeURIComponent(serviceLogin.cookie.split(';')[0].split('=').slice(1).join('=')));
    assert.equal((await call('/api/employees',{session:serviceSession})).status,200);
    account=saved.body.accounts[0];
    assert.equal((await call('/api/manager-accounts/'+account.id,{method:'PUT',body:{...body,password:'',version:account.version,active:false}})).status,200);
    assert.equal((await call('/api/employees',{session:serviceSession})).status,401);
    assert.equal((await call('/api/manager-login',{method:'POST',session:null,body:{login:body.login,password:body.password}})).status,401);
    assert.equal((await call('/api/manager-accounts')).status,200,'owner retains access');
  }finally{await new Promise(resolve=>server.close(resolve));await f.db.close();}
});
