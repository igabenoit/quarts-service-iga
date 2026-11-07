import test from 'node:test';
import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';
import {authenticator} from './passkey-authenticator.mjs';
import {token,digest} from '../passkey-store.js';

test('direction: master-code shutdown, named authorization, second device and revocation',async t=>{
  const f=await liveAppFixture({passkeyMode:'pilot',employeeVault:true});
  const jar=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');
  const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r;};
  const headers={Origin:f.base,'X-Passkey-Request':'1'};
  const call=(path,body={},cookie='')=>f.call('POST','/api/employee-passkeys/'+path,{body,cookie,headers});
  async function bootstrap(id){const s=token();await f.query('INSERT INTO schedule_passkey_users(person_id,handle) VALUES($1,$2)',[id,token()]);await f.query("INSERT INTO schedule_passkey_invitations(hash,person_id,access_version,expires_at) VALUES($1,$2,1,clock_timestamp()+interval '15 minutes')",[digest(s),id]);return s;}
  async function register(s){const a=authenticator(),o=ok(await call('register/options',{token:s}));const r=ok(await call('register/verify',{response:a.register(o.body,f.base)},jar(o)));return {a,cookie:jar(r)};}
  async function login(a){const o=ok(await call('authenticate/options',{shared:false}));return call('authenticate/verify',{response:a.authenticate(o.body,f.base)},jar(o));}
  try{
    await f.query("INSERT INTO schedule_store_people(id,name,employee_code) VALUES(1,'Direction fictive','000001'),(2,'Employé fictif','000002')");
    const oldAdmin=ok(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
    let pc=await register(await bootstrap(1)),employee=await register(await bootstrap(2)),phone,addition;
    await f.stop();await f.start({directionPasskeys:true});
    await t.test('correct master code and a previously valid admin cookie cannot grant access',async()=>{
      const result=await f.call('POST','/api/login',{body:{code:'audit-admin-test'}});
      assert.equal(result.status,401);assert.equal(result.body.passkeyRequired,true);assert.equal(result.headers.get('set-cookie'),null);
      assert.equal((await f.call('GET','/api/session',{cookie:oldAdmin})).body.user,null);
      for(const path of ['/api/employees','/api/manager-accounts','/api/store-portal','/api/sst/state','/api/sst/export','/api/sst/documents/00000000-0000-4000-8000-000000000001','/api/employee-files/state','/api/employee-files/export']){
        const r=await f.call('GET',path,{cookie:oldAdmin});assert.ok([401,403].includes(r.status),path+': '+r.status);
      }
      // An employee key cannot acquire the old master cookie's authority either.
      assert.equal((await f.call('GET','/api/session',{cookie:oldAdmin+'; '+employee.cookie})).body.user,null);
    });
    await t.test('named direction passkey alone grants the existing role on each request',async()=>{
      for(const path of ['/api/employees','/api/manager-accounts','/api/store-portal','/api/sst/state'])ok(await f.call('GET',path,{cookie:pc.cookie}));
      const who=ok(await f.call('GET','/api/session',{cookie:pc.cookie})).body.user;
      assert.equal(who.kind,'admin');assert.equal(who.personId,1);assert.equal(who.name,'Direction fictive');
      const fresh=jar(ok(await login(pc.a)));pc.cookie=fresh;
      addition=ok(await call('admin/my-device',{personId:2,recover:true},fresh));
      assert.match(addition.body.qr,/^data:image\/png;base64,/);
      const invite=(await f.query('SELECT person_id,add_device FROM schedule_passkey_invitations WHERE used_at IS NULL')).rows;
      assert.deepEqual(invite.map(i=>[Number(i.person_id),i.add_device]),[[1,true]]);
      assert.equal((await call('admin/my-device',{},employee.cookie)).status,401);
      assert.equal((await call('admin/my-device',{},oldAdmin)).status,401);
    });
    await t.test('adding the phone preserves the PC key and session, then both work independently',async()=>{
      const secret=new URLSearchParams(new URL(addition.body.url).hash.slice(1)).get('activation');
      phone=await register(secret);
      assert.equal((await f.query('SELECT count(*)::int AS n FROM schedule_passkey_credentials WHERE person_id=1 AND revoked_at IS NULL')).rows[0].n,2);
      ok(await f.call('GET','/api/manager-accounts',{cookie:pc.cookie}));
      for(const device of [pc,phone]){device.cookie=jar(ok(await login(device.a)));ok(await f.call('GET','/api/sst/state',{cookie:device.cookie}));}
      assert.equal((await call('register/options',{token:secret})).status,400);
      assert.equal((await f.query("SELECT count(*)::int AS n FROM schedule_passkey_audit WHERE person_id=1 AND action='additional_device_registered'")).rows[0].n,1);
    });
    await t.test('old confirmation cannot add a device; logged out or revoked keys cannot administer',async()=>{
      await f.query("UPDATE schedule_passkey_sessions SET created_at=clock_timestamp()-interval '6 minutes' WHERE credential_id=$1",[phone.a.id]);
      assert.equal((await call('admin/my-device',{},phone.cookie)).status,401);
      ok(await f.call('POST','/api/logout',{body:{},cookie:pc.cookie}));
      assert.equal((await f.call('GET','/api/session',{cookie:pc.cookie})).body.user,null);
      phone.cookie=jar(ok(await login(phone.a)));
      const pending=ok(await call('admin/my-device',{},phone.cookie));
      await f.query('UPDATE schedule_passkey_credentials SET revoked_at=clock_timestamp() WHERE id=$1',[phone.a.id]);
      assert.equal((await f.call('GET','/api/session',{cookie:phone.cookie})).body.user,null);
      const secret=new URLSearchParams(new URL(pending.body.url).hash.slice(1)).get('activation');
      assert.equal((await call('register/options',{token:secret})).status,400);
      pc.cookie=jar(ok(await login(pc.a)));
      await f.query('UPDATE schedule_store_people SET active=FALSE WHERE id=1');
      assert.equal((await f.call('GET','/api/session',{cookie:pc.cookie})).body.user,null);
    });
  }finally{await f.close();}
});
