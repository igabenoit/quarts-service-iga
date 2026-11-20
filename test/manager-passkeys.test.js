import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {liveAppFixture} from './live-app-fixture.mjs';
import {authenticator} from './passkey-authenticator.mjs';
import {token,digest} from '../passkey-store.js';
import {passwordHash} from '../manager-access.js';

test('manager passkeys retain existing department limits and live revocation',async()=>{
  const f=await liveAppFixture({passkeyMode:'pilot',directionPasskeys:true,employeeVault:true});
  const jar=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');
  const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r;};
  const call=(path,body={},cookie='')=>f.call('POST','/api/employee-passkeys/'+path,{body,cookie,headers:{Origin:f.base,'X-Passkey-Request':'1'}});
  const who=async cookie=>ok(await f.call('GET','/api/session',{cookie})).body;
  async function register(id){
    const s=token(),a=authenticator();
    await f.query('INSERT INTO schedule_passkey_users(person_id,handle) VALUES($1,$2)',[id,token()]);
    await f.query("INSERT INTO schedule_passkey_invitations(hash,person_id,access_version,expires_at) VALUES($1,$2,1,clock_timestamp()+interval '15 minutes')",[digest(s),id]);
    const o=ok(await call('register/options',{token:s}));
    const r=ok(await call('register/verify',{response:a.register(o.body,f.base)},jar(o)));
    return {a,cookie:jar(r)};
  }
  try{
    await f.query("INSERT INTO schedule_store_people(id,name,employee_code) VALUES(1,'Direction fictive','000001'),(2,'Employé fictif','000002'),(3,'Gérant fictif','000003')");
    const departments=(await f.query('SELECT id,code FROM schedule_leave_departments ORDER BY id')).rows;
    const service=Number(departments.find(d=>d.code==='service').id),other=Number(departments.find(d=>d.code!=='service').id);
    const password=randomUUID();
    const account=Number((await f.query('INSERT INTO schedule_manager_accounts(name,login,password_hash,departments,person_id) VALUES($1,$2,$3,$4,3) RETURNING id',['Gérant fictif','manager.test',await passwordHash(password),JSON.stringify([other])])).rows[0].id);
    // A legacy employee code, even for an existing manager, must not grant management.
    const legacy=ok(await f.call('POST','/api/employee-portal/access',{body:{code:'000003'}}));
    assert.equal((await who(legacy.cookie)).user,null);
    const direction=await register(1),employee=await register(2),manager=await register(3);
    assert.equal((await who(direction.cookie)).user.kind,'admin');
    assert.equal((await who(direction.cookie)).path,'/index.html');
    let identity=await who(manager.cookie);
    assert.equal(identity.user.kind,'account');assert.equal(identity.user.id,account);
    assert.deepEqual(identity.user.departments,[other]);assert.equal(identity.path,'/departements');
    assert.equal((await who(employee.cookie)).user,null);
    const options=ok(await call('authenticate/options',{shared:false}));
    manager.cookie=jar(ok(await call('authenticate/verify',{response:manager.a.authenticate(options.body,f.base),role:'admin',personId:1},jar(options))));
    assert.equal((await who(manager.cookie)).user.kind,'account');
    ok(await f.call('GET',`/api/departments/${other}/weeks/2026-11-09`,{cookie:manager.cookie}));
    assert.equal((await f.call('GET',`/api/departments/${service}/weeks/2026-11-09`,{cookie:manager.cookie})).status,403);
    assert.equal((await f.call('GET','/api/manager-accounts',{cookie:manager.cookie})).status,403);
    assert.equal((await f.call('GET','/api/employee-files/privacy',{cookie:manager.cookie})).status,403);
    const legacyManager=ok(await f.call('POST','/api/manager-login',{body:{login:'manager.test',password}}));
    assert.equal((await who(employee.cookie+'; '+legacyManager.cookie)).user,null,'a regular employee key cannot borrow another signed-in manager');
    await f.stop();await f.start({managerIndexHomePersonIds:'3'});
    assert.equal((await who(manager.cookie)).path,'/departements','home preference cannot grant Service access');
    await f.query('UPDATE schedule_manager_accounts SET departments=$1 WHERE id=$2',[JSON.stringify([service]),account]);
    identity=await who(manager.cookie);assert.deepEqual(identity.user.departments,[service]);assert.equal(identity.path,'/index.html');
    assert.equal((await f.call('GET',`/api/departments/${other}/weeks/2026-11-09`,{cookie:manager.cookie})).status,403);
    await f.query('UPDATE schedule_manager_accounts SET active=FALSE WHERE id=$1',[account]);
    assert.equal((await who(manager.cookie)).user,null);
    await f.query('UPDATE schedule_manager_accounts SET active=TRUE WHERE id=$1',[account]);
    assert.equal((await who(manager.cookie)).user.kind,'account');
    await f.query('UPDATE schedule_passkey_credentials SET revoked_at=clock_timestamp() WHERE id=$1',[manager.a.id]);
    assert.equal((await who(manager.cookie)).user,null);
    assert.equal((await f.call('GET','/api/departments/meta',{cookie:manager.cookie})).status,401);
  }finally{await f.close();}
});
