import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import crypto from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));

test('complete startup, signed sessions for every department, publication and persistence across process restart',{timeout:90000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'quart-reliability-'));
  const socket=net.createServer();socket.listen(0,'127.0.0.1');await new Promise(r=>socket.once('listening',r));
  const port=socket.address().port;await new Promise(r=>socket.close(r));
  const base=`http://127.0.0.1:${port}`,secret='test-session-secret-do-not-use-in-production';
  let child,output='';
  async function start(){
    output='';
    child=spawn(process.execPath,['test/startup-fixture.mjs'],{cwd:root,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,
      NODE_ENV:'test',PORT:String(port),DATABASE_URL:'postgres://unused.test/test',SESSION_SECRET:secret,MANAGER_CODE:'test-admin-123',
      TEST_STARTUP_DB:join(directory,'database'),RENDER_GIT_COMMIT:'a'.repeat(40),RESEND_API_KEY:'',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{cleanup();reject(Error('Startup timeout: '+output));},25000);
      const onData=()=>{if(output.includes('"phase":"ready"')){cleanup();resolve();}};
      const onExit=code=>{cleanup();reject(Error('Startup exited '+code+': '+output));};
      const cleanup=()=>{clearTimeout(timer);child.stdout.off('data',onData);child.off('exit',onExit);};
      child.stdout.on('data',onData);child.once('exit',onExit);
    });
  }
  async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}child=null;}
  async function call(path,cookie='',body,method=body===undefined?'GET':'POST'){
    const r=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    await start();assert.equal((await call('/health')).body.database,'ok');
    const admin=(await call('/api/login','',{code:'test-admin-123'})).cookie;assert.ok(admin);
    const departments=(await call('/api/manager-accounts',admin)).body.departments;
    assert.equal(departments.length,9);
    const bakery=departments.find(d=>d.name==='Boulangerie');let bakeryCookie;
    for(const department of departments){
      const account={name:'Gestionnaire fictif '+department.id,login:'test.'+department.id,password:'Test-password-123!',active:true,departments:[Number(department.id)]};
      assert.equal((await call('/api/manager-accounts',admin,account)).status,200);
      const login=await call('/api/manager-login','',{login:'  '+account.login.toUpperCase()+'  ',password:account.password});
      assert.equal(login.status,200);const cookie=login.cookie;
      assert.equal((await call('/api/manager-accounts',cookie)).status,403);
      const other=departments.find(d=>d.id!==department.id);
      assert.equal((await call(`/api/departments/${other.id}/weeks/2026-10-19`,cookie)).status,403);
      const ownPath=department.name==='Service'?'/api/weeks/2026-10-19':`/api/departments/${department.id}/weeks/2026-10-19`;
      const own=await call(ownPath,cookie);assert.equal(own.status,200,JSON.stringify(own.body));
      assert.equal((await call('/api/departments/publication-status?weekStart=2026-10-19',cookie)).status,200);
      if(department.id===bakery.id)bakeryCookie=cookie;
    }
    assert.equal((await call('/api/departments/meta')).status,401);
    const person=await call('/api/departments/people',bakeryCookie,{name:'Employé fictif audit',group:'regular',active:true,departments:[Number(bakery.id)],availability:{},email:'',employeeCode:'009876'});
    assert.equal(person.status,200,JSON.stringify(person.body));
    const employee=(await call('/api/employee-portal/access','',{code:'009876'})).cookie;assert.ok(employee);
    assert.equal((await call('/api/manager-accounts',employee)).status,401);
    const path=`/api/departments/${bakery.id}/weeks/2026-10-19`,published=`/api/leave/department-schedules/${bakery.id}/2026-10-19`;
    const initial=await call(path,bakeryCookie);
    const draft=initial.body.draft;
    draft.rows=[{personId:person.body.id,cells:[{kind:'shift',start:480,end:960,breakMinutes:60,note:''},...Array.from({length:6},()=>({kind:'blank',note:''}))]}];
    const saved=await call(path,bakeryCookie,{revision:initial.body.revision,draft},'PUT');assert.equal(saved.status,200,JSON.stringify(saved.body));
    assert.equal((await call(path,bakeryCookie,{revision:initial.body.revision,draft},'PUT')).status,409,'stale writer cannot overwrite the schedule');
    const before=await call(published,employee);assert.equal(before.body.schedule??null,null,'draft stays private');
    assert.equal((await call(path+'/publish',bakeryCookie,{revision:saved.body.revision,verified:true,warningsReviewed:true})).status,200);
    const visible=await call(published,employee);assert.equal(visible.status,200);assert.equal(visible.body.schedule.rows[0].cells[0].start,480);
    await stop();await start();
    assert.equal((await call(path,bakeryCookie)).status,200,'real signed manager session survives restart');
    assert.equal((await call(published,employee)).body.schedule.rows[0].cells[0].start,480,'published schedule and personal session survive restart');
    const payload=Buffer.from(JSON.stringify({role:'manager',expiresAt:Date.now()-1000})).toString('base64url');
    const expired='schedule_session='+payload+'.'+crypto.createHmac('sha256',secret).update(payload).digest('base64url');
    assert.equal((await call(path,expired)).status,401,'expired signed session is rejected');
    assert.ok((await call('/api/login','',{code:'test-admin-123'})).cookie,'reconnection succeeds');
    assert.equal((await call('/health')).body.commit,'a'.repeat(40));
  }finally{await stop();await rm(directory,{recursive:true,force:true});}
});
