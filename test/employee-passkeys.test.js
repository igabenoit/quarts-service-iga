import test from 'node:test';
import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';
import {authenticator} from './passkey-authenticator.mjs';
import {token,digest} from '../passkey-store.js';

test('passkeys: enrollment, real signatures, ownership, recovery and session boundaries',async t=>{
  const f=await liveAppFixture({passkeyMode:'pilot'});
  const jar=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');
  const headers={Origin:f.base,'X-Passkey-Request':'1'};
  const call=(path,body={},cookie='')=>f.call('POST','/api/employee-passkeys/'+path,{body,cookie,headers});
  const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r;};
  async function bootstrap(id){const secret=token();await f.query('INSERT INTO schedule_passkey_users(person_id,handle) VALUES($1,$2)',[id,token()]);await f.query("INSERT INTO schedule_passkey_invitations(hash,person_id,access_version,expires_at) VALUES($1,$2,1,clock_timestamp()+interval '15 minutes')",[digest(secret),id]);return secret;}
  async function register(secret,a=authenticator()){
    const opts=ok(await call('register/options',{token:secret}));
    const result=ok(await call('register/verify',{response:a.register(opts.body,f.base)},jar(opts)));
    return {a,cookie:jar(result),response:result};
  }
  async function login(a,shared=false){const options=ok(await call('authenticate/options',{shared}));return call('authenticate/verify',{response:a.authenticate(options.body,f.base)},jar(options));}
  try{
    await f.query("INSERT INTO schedule_store_people(id,name,employee_code) VALUES(1,'Direction fictive','000001'),(2,'Alice fictive','000002'),(3,'Bob fictif','000003')");
    const admin=ok(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
    const legacy=ok(await f.call('POST','/api/employee-portal/access',{body:{code:'000002'}})).cookie;
    let director,alice,secret;
    await t.test('direction cannot enroll anyone with shared admin code alone',async()=>{
      assert.equal((await call('admin/invitations',{personId:2,identityConfirmed:true,reason:'Identité vérifiée en personne',recover:false},admin)).status,403);
      director=await register(await bootstrap(1));
      const identity=ok(await f.call('GET','/api/employee-passkeys/admin',{cookie:admin+'; '+director.cookie}));
      assert.deepEqual(identity.body.currentPerson,{id:1,name:'Direction fictive'});
      assert.equal((await call('admin/invitations',{personId:1,identityConfirmed:true,reason:'Essai de récupération de soi-même',recover:true},admin+'; '+director.cookie)).status,400);
      assert.equal((await f.query('SELECT count(*)::int AS n FROM schedule_passkey_credentials WHERE person_id=1 AND revoked_at IS NULL')).rows[0].n,1);
      const r=ok(await call('admin/invitations',{personId:2,identityConfirmed:true,reason:'Identité vérifiée en personne',recover:false},admin+'; '+director.cookie));
      secret=new URLSearchParams(new URL(r.body.url).hash.slice(1)).get('activation');
      assert.equal((await f.query('SELECT count(*)::int AS n FROM schedule_passkey_audit WHERE person_id=2 AND actor=$1',['direction:1'])).rows[0].n,1);
    });
    await t.test('missing or ambiguous payroll identities block enrollment on the server',async()=>{
      await f.query("INSERT INTO schedule_store_people(id,name) VALUES(4,'Fiche fictive à rapprocher')");
      const body={personId:4,identityConfirmed:true,reason:'Identité vérifiée en personne',recover:false},both=admin+'; '+director.cookie;
      assert.equal((await call('admin/invitations',body,both)).status,409);
      await assert.rejects(f.query("UPDATE schedule_store_people SET employee_code='000002' WHERE id=4"),/unique/);
      await f.query('UPDATE schedule_store_people SET employee_code=NULL WHERE id=2');
      assert.equal((await call('register/options',{token:secret})).status,409);
      assert.equal((await f.query('SELECT count(*)::int AS n FROM schedule_passkey_invitations WHERE person_id=4')).rows[0].n,0);
      await f.query("UPDATE schedule_store_people SET employee_code='000002' WHERE id=2");
      await f.query("UPDATE schedule_store_people SET employee_code='000004' WHERE id=4");
    });
    await t.test('origin and user verification required, expired links and browser binding enforced',async()=>{
      assert.equal((await f.call('POST','/api/employee-passkeys/register/options',{body:{token:secret}})).status,403);
      assert.equal((await call('register/options',{token:secret,shared:true})).status,400);
      const options=ok(await call('register/options',{token:secret})),a=authenticator();
      assert.equal((await call('register/verify',{response:a.register(options.body,f.base) /* no flow cookie */})).status,400);
      assert.equal((await call('register/verify',{response:a.register(options.body,f.base,{uv:false})},jar(options))).status,400);
      assert.equal((await call('register/verify',{response:a.register(options.body,f.base)},jar(options))).status,400);
      const again=ok(await call('register/options',{token:secret}));
      assert.equal((await call('register/verify',{response:a.register(again.body,'https://attacker.invalid')},jar(again))).status,400);
      const expired=await bootstrap(3);await f.query("UPDATE schedule_passkey_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE person_id=3");
      assert.equal((await call('register/options',{token:expired})).status,400);
    });
    await t.test('enrollment disables matricule-only login and old copied cookies',async()=>{
      alice=await register(secret);
      assert.equal((await f.call('POST','/api/employee-portal/access',{body:{code:'000002'}})).status,401);
      assert.equal((await f.call('GET','/api/access-session?mode=employee',{cookie:legacy})).status,401);
      assert.equal((await f.call('GET','/api/access-session?mode=employee',{cookie:alice.cookie})).status,200);
      assert.equal((await call('register/options',{token:secret})).status,400);
      const keys=(await f.query('SELECT person_id,public_key FROM schedule_passkey_credentials WHERE person_id=2')).rows;assert.equal(keys.length,1);
    });
    await t.test('real signatures reject wrong RP, origin, user handle, UV and cross-origin frames',async()=>{
      for(const options of [{rpID:'attacker.invalid'},{userHandle:'wrong-user'},{uv:false},{extra:{crossOrigin:true}},{extra:{challenge:'bad'}}]){
        const opts=ok(await call('authenticate/options',{shared:false}));
        assert.equal((await call('authenticate/verify',{response:alice.a.authenticate(opts.body,f.base,options)},jar(opts))).status,400);
      }
      const opts=ok(await call('authenticate/options',{shared:false}));
      assert.equal((await call('authenticate/verify',{response:alice.a.authenticate(opts.body,'https://attacker.invalid')},jar(opts))).status,400);
      const tamper=ok(await call('authenticate/options',{shared:false})),response=alice.a.authenticate(tamper.body,f.base);response.response.signature='AAAA';
      assert.equal((await call('authenticate/verify',{response},jar(tamper))).status,400);
    });
    await t.test('one challenge is usable once and cannot choose another employee',async()=>{
      const opts=ok(await call('authenticate/options',{shared:false})),response=alice.a.authenticate(opts.body,f.base),r=ok(await call('authenticate/verify',{response,personId:3},jar(opts)));
      alice.cookie=jar(r);
      const session=(await f.query('SELECT person_id FROM schedule_passkey_sessions WHERE hash=$1',[digest(alice.cookie.split('pk_')[1])])).rows[0];assert.equal(Number(session.person_id),2);
      assert.equal((await call('authenticate/verify',{response},jar(opts))).status,400);
      assert.equal((await f.call('GET','/api/employee-passkeys/admin',{cookie:admin+'; '+alice.cookie})).status,403);
      const expired=ok(await call('authenticate/options',{shared:false}));await f.query("UPDATE schedule_passkey_flows SET expires_at=clock_timestamp()-interval '1 second'");
      assert.equal((await call('authenticate/verify',{response:alice.a.authenticate(expired.body,f.base)},jar(expired))).status,400);
    });
    await t.test('shared sessions expire even if background session checks keep polling',async()=>{
      await f.query('DELETE FROM schedule_passkey_limits');
      const r=ok(await login(alice.a,true)),c=jar(r);assert.match(c,/employee_portal=pk_/);
      await f.query("UPDATE schedule_passkey_sessions SET last_seen_at=clock_timestamp()-interval '6 minutes' WHERE person_id=2");
      assert.equal((await f.call('GET','/api/access-session?mode=employee',{cookie:c})).status,401);
      assert.equal((await call('activity',{},c)).status,401);
      const personal=ok(await login(alice.a)),p=jar(personal);assert.equal((await call('activity',{},p)).status,200);
      await f.query("UPDATE schedule_passkey_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE person_id=2");
      assert.equal((await f.call('GET','/api/access-session?mode=employee',{cookie:p})).status,401);
    });
    await t.test('verified direction recovery revokes every old key and session without code fallback',async()=>{
      const old=jar(ok(await login(alice.a))),both=admin+'; '+director.cookie;
      assert.equal((await call('admin/invitations',{personId:2,identityConfirmed:false,reason:'Téléphone perdu vérifié en personne',recover:true},both)).status,400);
      const r=ok(await call('admin/invitations',{personId:2,identityConfirmed:true,reason:'Téléphone perdu vérifié en personne',recover:true},both));
      assert.equal((await f.call('GET','/api/access-session?mode=employee',{cookie:old})).status,401);
      assert.equal((await login(alice.a)).status,400);
      assert.equal((await f.call('POST','/api/employee-portal/access',{body:{code:'000002'}})).status,401);
      const secret=new URLSearchParams(new URL(r.body.url).hash.slice(1)).get('activation'),replacement=await register(secret);
      assert.equal((await login(replacement.a)).status,200);alice=replacement;
    });
    await t.test('logout, deactivation and restart preserve revocation and keys',async()=>{
      let c=jar(ok(await login(alice.a)));
      ok(await f.call('POST','/api/employee-portal/logout',{cookie:c,body:{}}));
      assert.equal((await f.call('GET','/api/access-session?mode=employee',{cookie:c})).status,401);
      await f.stop();await f.start();c=jar(ok(await login(alice.a)));
      await f.query('UPDATE schedule_store_people SET active=FALSE WHERE id=2');
      assert.equal((await f.call('GET','/api/access-session?mode=employee',{cookie:c})).status,401);
      assert.equal((await login(alice.a)).status,400);
    });
    await t.test('rate limit survives a restart; server cleanup does not reset active buckets',async()=>{
      await f.query('UPDATE schedule_passkey_limits SET count=300');
      await f.stop();await f.start();
      assert.equal((await call('authenticate/options',{shared:false})).status,429);
    });
  }finally{await f.close();}
});

test('required mode rejects every matricule-only login, including public schedule aliases',async()=>{
  const f=await liveAppFixture({passkeyMode:'required'});
  try{
    await f.query("INSERT INTO schedule_store_people(name,employee_code) VALUES('Employé fictif sans clé','001234')");
    for(const path of ['/api/employee-portal/access','/api/public-schedules/fictitious/access']){
      const r=await f.call('POST',path,{body:{code:'001234'}});assert.equal(r.status,401);assert.equal(r.body.passkeyRequired,true);
    }
    assert.deepEqual((await f.call('GET','/api/employee-passkeys/config')).body,{enabled:true,required:true});
  }finally{await f.close();}
});
