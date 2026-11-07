import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {liveAppFixture} from './live-app-fixture.mjs';
import {token,digest} from '../passkey-store.js';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await liveAppFixture({passkeyMode:'required'});let browser;
try{
  await mkdir('test-artifacts',{recursive:true});
  await f.query("INSERT INTO schedule_store_people(id,name,employee_code) VALUES(1,'Direction fictive','000001'),(2,'Alice fictive','000002'),(3,'Bob fictif','000003')");
  const secret=token();await f.query('INSERT INTO schedule_passkey_users(person_id,handle) VALUES(1,$1)',[token()]);
  await f.query("INSERT INTO schedule_passkey_invitations(hash,person_id,access_version,expires_at) VALUES($1,1,1,clock_timestamp()+interval '15 minutes')",[digest(secret)]);
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  const errors=[];
  async function client(viewport){
    const context=await browser.newContext({viewport});
    await context.route('**/*',route=>new URL(route.request().url()).origin===f.base?route.continue():route.abort());
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
    return {context,page};
  }
  const director=await client({width:1440,height:1000});
  const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  await director.context.addCookies([{name:'schedule_session',value:admin.slice(admin.indexOf('=')+1),url:f.base}]);
  await director.page.goto(f.base+'/connexion-employe?retour=%2Fcles-employes#activation='+secret);
  await director.page.locator('#continue').click();await director.page.waitForURL('**/cles-employes').catch(async e=>{console.log('Activation status:',await director.page.locator('#status').innerText());throw e;});
  await director.page.locator('#invitationForm').waitFor({state:'visible'});
  await director.page.locator('#person').selectOption('2');await director.page.locator('#reason').fill('Identité fictive vérifiée pour cet essai isolé');await director.page.locator('#verified').check();
  await director.page.locator('#invitationForm button').click();await director.page.locator('#result').waitFor({state:'visible'});
  const invitation=await director.page.locator('#activationLink').getAttribute('href');assert.ok(invitation.includes('#activation='));
  // Do not put the temporary enrollment bearer link in a screenshot.
  await director.page.locator('#result').evaluate(e=>e.hidden=true);
  await director.page.screenshot({path:'test-artifacts/direction-ordinateur.png',fullPage:true});
  const employee=await client({width:390,height:844});await employee.page.goto(invitation);
  assert.equal(new URL(employee.page.url()).hash,'');await employee.page.locator('#continue').click();await employee.page.waitForURL('**/horaires-departements?vue=employe');
  assert.equal((await employee.page.request.get(f.base+'/api/access-session?mode=employee')).status(),200);
  assert.equal((await f.call('POST','/api/employee-portal/access',{body:{code:'000002'}})).status,401);
  await employee.page.request.post(f.base+'/api/employee-portal/logout',{data:{},headers:{Origin:f.base}});
  await employee.page.goto(f.base+'/connexion-employe');await employee.page.locator('#controls').waitFor({state:'visible'});
  assert.equal(await employee.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await employee.page.screenshot({path:'test-artifacts/connexion-cellulaire.png',fullPage:true});
  await employee.page.locator('#continue').click();await employee.page.waitForURL('**/horaires-departements?vue=employe');
  const session=await (await employee.page.request.get(f.base+'/api/employee-passkeys/session')).json();assert.equal(session.authenticated,true);
  await employee.page.request.post(f.base+'/api/employee-portal/logout',{data:{},headers:{Origin:f.base}});
  await employee.page.goto(f.base+'/horaires-departements?vue=employe');
  const link=employee.page.getByRole('link',{name:'Me connecter avec ma clé d’accès'});await link.waitFor({state:'visible'});
  assert.equal(await employee.page.locator('#staffCode').isVisible(),false);
  await link.click();await employee.page.locator('#shared').check();await employee.page.locator('#continue').click();await employee.page.waitForURL('**/horaires-departements?vue=employe');
  assert.equal((await (await employee.page.request.get(f.base+'/api/employee-passkeys/session')).json()).shared,true);
  await f.query("UPDATE schedule_passkey_sessions SET last_seen_at=clock_timestamp()-interval '6 minutes' WHERE person_id=2");
  assert.equal((await employee.page.request.get(f.base+'/api/access-session?mode=employee')).status(),401);
  assert.deepEqual(errors,[]);
  console.log('Browser E2E passed: desktop direction activation, mobile registration and login with real WebAuthn, legacy rejection, shared-device session expiration, no horizontal overflow or JavaScript errors.');
}finally{await browser?.close();await f.close();}
