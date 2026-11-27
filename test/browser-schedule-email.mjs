import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {liveAppFixture} from './live-app-fixture.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await liveAppFixture({employeeVault:true});let browser;
try{
 const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
 const meta=(await f.call('GET','/api/departments/meta',{cookie:admin})).body,dep=meta.departments.find(d=>d.key==='charcuterie').id;
 assert.equal((await f.call('POST','/api/departments/people',{cookie:admin,body:{name:'Camille — horaire fictif',group:'regular',active:true,departments:[dep],availability:{},employeeCode:'770031'}})).status,200);
 const state=(await f.call('GET','/api/employee-files/state?view=direction',{cookie:admin})).body;
 const employee=state.employees.find(e=>e.name==='Camille — horaire fictif');assert.ok(employee);
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true}),errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.context().addCookies([{name:admin.split('=')[0],value:admin.slice(admin.indexOf('=')+1),url:f.base}]);
 let email='';
 await page.route('**/api/employee-files/schedule-email**',async route=>{
  if(route.request().method()==='GET'){const response=await route.fetch();assert.equal(response.status(),200);const data=await response.json();await route.fulfill({json:{...data,email,emailReady:true}});}
  else{posts.push({url:route.request().url(),body:route.request().postDataJSON()});await route.fulfill({json:{status:'pending',to:route.request().url().includes('/test?')?'igabenoit@gmail.com':email}});}
 });
 await page.goto(f.base+'/dossiers-employes?vue=direction#dossiers/'+employee.key);
 const send=page.getByRole('button',{name:'Envoyer les instructions d’horaire',exact:true}),test=page.getByRole('button',{name:'M’envoyer un test à igabenoit@gmail.com',exact:true});
 await test.waitFor();assert.equal(await send.isDisabled(),true);await test.click();await page.getByText('Courriel mis en file d’envoi pour igabenoit@gmail.com.',{exact:true}).waitFor();assert.equal(posts[0].body.email,undefined);
 email='employee@example.invalid';await page.getByRole('button',{name:'Actualiser le destinataire et les envois'}).click();await page.waitForFunction(()=>document.querySelector('[data-email]').value==='employee@example.invalid');assert.equal(await page.locator('[data-email]').getAttribute('readonly'),'');await send.click();await page.getByText('Courriel mis en file d’envoi pour employee@example.invalid.',{exact:true}).waitFor();assert.equal(posts[1].body.email,email);
 await page.getByText('Aperçu du courriel en couleur',{exact:true}).click();const frame=page.frameLocator('iframe[title="Aperçu du courriel horaire"]');assert.equal(await frame.getByRole('link',{name:'Voir mon horaire →'}).getAttribute('href'),'https://quartservice.igabenoit.com/horaires-departements?vue=employe');

 const oldLink=await f.call('GET','/horaire');assert.equal(oldLink.status,302);assert.equal(oldLink.headers.get('location'),'/horaires-departements?vue=employe');
 assert.equal((await f.call('GET','/horaire.html')).status,302);
 const employeePage=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
 const badCalls=[];employeePage.on('request',r=>{if(r.url().includes('/api/public-schedules/horaire'))badCalls.push(r.url());});
 await employeePage.goto(f.base+'/horaire');await employeePage.locator('#staffCode').waitFor({state:'visible'});await employeePage.locator('#staffCode').fill('770031');await employeePage.locator('#accessForm button').click();await employeePage.locator('#staffContent').waitFor({state:'visible'});assert.match(await employeePage.locator('#employeeName').innerText(),/Camille/);assert.doesNotMatch(await employeePage.locator('#status').innerText(),/invalide|désactivé/);assert.deepEqual(badCalls,[]);await employeePage.close();
 assert.equal(await frame.locator('body').evaluate(e=>e.scrollWidth<=e.ownerDocument.documentElement.clientWidth),true);assert.deepEqual(errors,[]);
 console.log('Mobile 390px: dossier panel, missing email blocked, test isolated, readonly recipient refreshed, employee send and colored preview verified. No real email.');
}finally{await browser?.close();await f.close();}
