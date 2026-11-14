import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {liveAppFixture} from './live-app-fixture.mjs';
import {token,digest} from '../passkey-store.js';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await liveAppFixture({passkeyMode:'required',directionPasskeys:true});let browser;
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
  assert.equal((await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).status,401);
  await director.page.goto(f.base+'/connexion-employe?retour=%2Fcles-employes#activation='+secret);
  await director.page.locator('#continue').click();await director.page.waitForURL('**/cles-employes').catch(async e=>{console.log('Activation status:',await director.page.locator('#status').innerText());throw e;});
  await director.page.locator('#invitationForm').waitFor({state:'visible'});
  assert.match(await director.page.locator('#selfState').innerText(),/Ta clé de direction est active/);
  assert.equal(await director.page.locator('#person option[value="1"]').count(),0);
  // Add a distinct phone authenticator through the same QR workflow used on iPhone.
  await director.page.locator('#addMyDevice').click();await director.page.locator('#myDeviceResult').waitFor({state:'visible'});
  assert.match(await director.page.locator('#myDeviceQR').getAttribute('src'),/^data:image\/png;base64,/);
  const phone=await client({width:390,height:844});await phone.page.goto(await director.page.locator('#myDeviceLink').getAttribute('href'));
  assert.match(await phone.page.locator('#intro').innerText(),/Face ID/);
  await phone.page.locator('#continue').click();await phone.page.waitForURL('**/index.html');
  assert.equal((await (await phone.page.request.get(f.base+'/api/session')).json()).user.kind,'admin');
  assert.equal((await (await director.page.request.get(f.base+'/api/session')).json()).user.kind,'admin');
  await director.page.locator('#myDeviceResult').evaluate(e=>e.hidden=true);
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
  // Unauthenticated visitors see the strong direction entry, never the master-code form.
  const guest=await client({width:390,height:844});await guest.page.goto(f.base+'/');
  await guest.page.getByRole('link',{name:'Direction — Face ID ou clé d’accès',exact:true}).waitFor({state:'visible'});
  assert.equal(await guest.page.locator('#loginCode').isVisible(),false);
  await guest.page.screenshot({path:'test-artifacts/direction-connexion-cellulaire.png',fullPage:false});
  assert.deepEqual(errors,[]);
  console.log('Browser E2E passed: master code rejected, desktop and separate phone direction keys, QR generated locally, existing PC session preserved, employee role isolated, shared-device session expiration, no horizontal overflow or JavaScript errors. Face ID hardware confirmation remains a user-device check.');
}finally{await browser?.close();await f.close();}
