import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {liveAppFixture} from './live-app-fixture.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await liveAppFixture();let browser;
try{
 const login=await f.call('POST','/api/login',{body:{code:'audit-admin-test'}});assert.equal(login.status,200);const cookie=login.cookie;
 const create=await f.call('POST','/api/leave/test-requests',{cookie,body:{submissionKey:randomUUID(),email:'test@example.com',reason:'Essai de correction',periods:[{startDate:'2030-10-14',endDate:'2030-10-14',allDay:true}]}});assert.equal(create.status,201,JSON.stringify(create.body));const id=create.body.id;
 const approve=await f.call('PATCH','/api/leave/requests/'+id,{cookie,body:{status:'approved',version:1}});assert.equal(approve.status,200,JSON.stringify(approve.body));
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await context.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:f.base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(f.base+'/conges-gestion');await page.locator('#mode').selectOption('true');await page.locator('#start').fill('2030-10-01');await page.locator('#end').fill('2030-10-31');await page.locator('#filters button').click();
 const card=page.locator(`.request[data-id="${id}"]`);await card.waitFor();assert.equal(await card.locator('.badge').innerText(),'Approuvée');
 await card.getByRole('button',{name:'Enregistrer la correction',exact:true}).click();assert.match(await card.locator('.decision-message').innerText(),/modifiez les périodes/);
 await card.getByText('Corriger les journées et les heures du congé accepté',{exact:true}).click();
 await card.locator('.period-date').fill('2030-10-15');await card.locator('.period-all-day').uncheck();await card.locator('.period-start').fill('12:30');await card.locator('.period-end').fill('14:00');await card.locator('textarea').first().fill('Erreur dans la journée acceptée.');
 const patched=page.waitForResponse(r=>r.url()===f.base+'/api/leave/requests/'+id&&r.request().method()==='PATCH');await card.getByRole('button',{name:'Enregistrer la correction',exact:true}).click();const result=await patched;assert.equal(result.status(),200,await result.text());await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('Congé corrigé.'));
 const data=await f.call('GET','/api/leave/requests?test=true&start=2030-10-01&end=2030-10-31',{cookie});const saved=data.body.requests.find(r=>r.id===id);assert.equal(saved.status,'approved');assert.equal(saved.version,3);assert.deepEqual(saved.periods,[{date:'2030-10-15',allDay:false,startMinute:750,endMinute:840}]);assert.ok(saved.events.some(e=>e.note.includes('Avant : 2030-10-14')&&e.note.includes('Après : 2030-10-15')));
 await card.getByText('Historique',{exact:true}).click();await page.screenshot({path:'/tmp/quarts-correction-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('Parcours mobile réussi : congé déjà approuvé, édition des dates/heures, raison obligatoire, enregistrement et historique.');
}finally{await browser?.close();await f.close();}
