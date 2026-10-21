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
  const readSession=req=>{try{const session=JSON.parse(req.headers['x-test-session']||'null');return session?.role==='manager'||session?.accountId?session:null;}catch{return null;}};
  const origin=(req,res,next)=>req.headers.origin&&req.headers.origin!=='https://same.example'?res.status(403).json({error:'origin'}):next();
  const access=await installManagerAccess(app,f.pool,{readSession,issueSession:JSON.stringify,sameOrigin:origin,production:true,credentialSecret:'test-only-secret-for-recoverable-passwords'});
  const guard=async(req,res,next)=>{try{await access.authorize(req);next();}catch(e){res.status(e.status||500).json({error:e.message});}};
  for(const [key,handlers] of f.routes){const space=key.indexOf(' '),method=key.slice(0,space),path=key.slice(space+1);if(path.startsWith('/api/departments')||path.startsWith('/api/leave/'))app[method](path,guard,handlers.at(-1));}
  for(const path of ['/api/employees','/api/undo','/api/leave/access-settings','/api/unknown-admin-tool','/api/sales-forecasts/:weekStart'])app.get(path,guard,(_q,res)=>res.json({ok:true}));
  app.post('/api/sales-forecasts/:weekStart',guard,(_q,res)=>res.json({ok:true}));
  app.post('/api/departments/publication-status',guard,(_q,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
  const admin={role:'manager'},call=async(path,{session=admin,method='GET',body,origin}={})=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(session?{'x-test-session':JSON.stringify(session)}:{}),...(origin?{origin}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};};
  try{
    assert.equal((await call('/api/manager-accounts',{session:null})).status,401);
    const departments=(await call('/api/manager-accounts')).body.departments,fruit=Number(departments.find(d=>d.name.includes('Fruits')).id),meat=Number(departments.find(d=>d.name.includes('Viande')).id),service=Number(departments.find(d=>d.name==='Service').id);
    const body={name:'Gérant test',login:'gerant.test',password:'Example-password-123',active:true,departments:[fruit]};
    assert.equal((await call('/api/manager-accounts',{method:'POST',body,origin:'https://wrong.example'})).status,403);
    const created=await call('/api/manager-accounts',{method:'POST',body});assert.equal(created.status,200);let account=created.body.accounts[0];
    assert.equal('password_hash' in account,false);
    assert.equal('password_encrypted' in account,false);assert.equal(account.passwordAvailable,true);
    const reveal='/api/manager-accounts/'+account.id+'/password';
    assert.equal((await call(reveal,{method:'POST',session:null})).status,401);
    assert.equal((await call(reveal,{method:'POST',origin:'https://wrong.example'})).status,403);
    assert.equal((await call(reveal,{method:'POST'})).body.password,body.password);
    const stored=(await f.pool.query('SELECT password_encrypted FROM schedule_manager_accounts WHERE id=$1',[account.id])).rows[0].password_encrypted;
    assert.ok(stored.startsWith('v1.'));assert.ok(!stored.includes(body.password));
    await f.pool.query('UPDATE schedule_manager_accounts SET password_encrypted=NULL WHERE id=$1',[account.id]);
    assert.equal((await call(reveal,{method:'POST'})).status,409);
    assert.equal((await call('/api/manager-accounts',{method:'POST',body})).status,409);
    const login=await call('/api/manager-login',{method:'POST',session:null,body:{login:'GERANT.TEST',password:body.password}});assert.equal(login.status,200);assert.match(login.cookie,/HttpOnly; SameSite=Strict/);assert.match(login.cookie,/Secure/);
    assert.equal(login.body.path,'/departements');
    const session=JSON.parse(decodeURIComponent(login.cookie.split(';')[0].split('=').slice(1).join('=')));
    assert.equal((await call('/api/sales-forecasts/2026-10-19',{session:null})).status,401);
    assert.equal((await call('/api/sales-forecasts/2026-10-19',{session:{role:'employee'}})).status,401);
    assert.equal((await call('/api/sales-forecasts/2026-10-19',{session})).status,200);
    assert.equal((await call('/api/sales-forecasts/2026-10-19',{session,method:'POST'})).status,403);
    assert.equal((await call(reveal,{method:'POST'})).body.password,body.password,'successful legacy login enables recovery');
    assert.equal((await call(reveal,{method:'POST',session})).status,403);
    assert.equal((await call('/api/manager-accounts',{session})).status,403);
    assert.equal((await call('/api/manager-accounts/'+account.id,{method:'PUT',session,body:{...body,version:1,departments:[meat]}})).status,403);
    const meta=await call('/api/departments/meta',{session});assert.deepEqual(meta.body.departments.map(d=>d.id),[fruit]);
    // The department page loads its sheet and publication status together.
    // Both must succeed for a scoped manager, without exposing other departments.
    const publicationPath='/api/departments/publication-status?weekStart=2026-10-12';
    assert.equal((await call(publicationPath,{session:null})).status,401);
    assert.equal((await call(publicationPath,{session:{role:'employee'}})).status,401);
    const unpublished=await call(publicationPath,{session});
    assert.equal(unpublished.status,200,JSON.stringify(unpublished.body));
    assert.deepEqual(unpublished.body,{weekStart:'2026-10-12',publications:[]});
    assert.equal((await call(publicationPath,{session,method:'POST'})).status,403);
    assert.equal((await call('/api/departments/publication-status?weekStart=invalid',{session})).status,400);
    assert.equal((await call(`/api/departments/${fruit}/weeks/2026-10-12`,{session})).status,200);
    assert.equal((await call(`/api/departments/${fruit}/weeks/2026-10-12/views`,{session})).status,200);
    assert.equal((await call(`/api/departments/${meat}/weeks/2026-10-12/views`,{session})).status,403);
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
    assert.equal((await call('/api/departments/photos/'+photo.id+'/status',{session})).status,403);
    assert.equal((await call('/api/departments/photos/'+photo.id+'/extend-attempts',{session,method:'POST',body:{attemptLimit:5}})).status,403);
    assert.equal((await call('/api/departments/document-mail/'+meat,{session,method:'POST',body:{}})).status,403);
    const week=(await call(`/api/departments/${fruit}/weeks/2026-10-12`,{session})).body;
    const draftSaved=await call(`/api/departments/${fruit}/weeks/2026-10-12`,{session,method:'PUT',body:{revision:week.revision,draft:week.draft}});assert.equal(draftSaved.status,200);
    const published=await call(`/api/departments/${fruit}/weeks/2026-10-12/publish`,{session,method:'POST',body:{revision:draftSaved.body.revision,verified:true,warningsReviewed:true}});assert.equal(published.status,200);
    const otherWeek=(await call(`/api/departments/${meat}/weeks/2026-10-12`)).body;
    assert.equal((await call(`/api/departments/${meat}/weeks/2026-10-12/publish`,{method:'POST',body:{revision:otherWeek.revision,verified:true,warningsReviewed:true}})).status,200);
    const ownPublications=await call(publicationPath+'&departmentId='+meat,{session});
    assert.equal(ownPublications.status,200);assert.deepEqual(ownPublications.body.publications.map(p=>p.departmentId),[fruit]);
    assert.equal((await call(publicationPath)).body.publications.length,2);
    const saved=await call('/api/manager-accounts/'+account.id,{method:'PUT',body:{...body,password:'',version:account.version,departments:[service]}});assert.equal(saved.status,200);
    assert.equal((await call('/api/departments/meta',{session})).status,401,'permission change revokes existing sessions');
    assert.equal((await call(publicationPath,{session})).status,401);
    assert.equal((await call('/api/manager-accounts/'+account.id,{method:'PUT',body:{...body,version:1}})).status,409);
    const serviceLogin=await call('/api/manager-login',{method:'POST',session:null,body:{login:body.login,password:body.password}});assert.equal(serviceLogin.body.path,'/');
    const serviceSession=JSON.parse(decodeURIComponent(serviceLogin.cookie.split(';')[0].split('=').slice(1).join('=')));
    assert.equal((await call('/api/employees',{session:serviceSession})).status,200);
    account=saved.body.accounts[0];
    assert.equal((await call(reveal,{method:'POST'})).body.password,body.password,'blank password preserves recoverability');
    assert.equal((await call('/api/manager-accounts/'+account.id,{method:'PUT',body:{...body,password:'',version:account.version,active:false}})).status,200);
    assert.equal((await call('/api/employees',{session:serviceSession})).status,401);
    assert.equal((await call('/api/manager-login',{method:'POST',session:null,body:{login:body.login,password:body.password}})).status,401);
    assert.equal((await call('/api/manager-accounts')).status,200,'owner retains access');
  }finally{await new Promise(resolve=>server.close(resolve));await f.db.close();}
});
