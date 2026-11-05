import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {liveAppFixture} from './live-app-fixture.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await liveAppFixture();let browser;
try{
 const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie,week='2030-10-14';
 const revision=(await f.call('GET','/api/weeks/'+week,{cookie})).body.revision;
 const created=await f.call('POST','/api/weeks/'+week+'/shifts',{cookie,headers:{'X-Service-Week':week,'X-Service-Revision':revision},body:{role:'cashier',days:[0],startMinute:480,endMinute:960}});assert.equal(created.status,201);
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:f.base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(f.base+'/');await page.locator('#appView').waitFor({state:'visible'});await page.locator('#weekPicker').fill(week);await page.locator('#weekPicker').dispatchEvent('change');await page.waitForFunction(w=>document.querySelector('#weekPicker').value===w&&document.querySelector('#saveStatus').textContent==='Tout est enregistré',week);
 await page.locator('#needsPrintBtn').click();await page.locator('#printPreview').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>document.querySelector('#printPreview').matches(':modal')),false);assert.match(await page.locator('#previewPages').innerText(),/1 quart\(s\) · 7 h/);
 // Work on the real editor while the same nonmodal preview remains open.
 await page.locator('#role').selectOption('packer');await page.locator('#startTime').fill('09:00');await page.locator('#endTime').fill('13:00');await page.locator('#submitShift').click();await page.waitForFunction(()=>document.querySelector('#previewPages').textContent.includes('2 quart(s) · 11 h'));assert.equal(await page.locator('#printPreview').isVisible(),true);
 await page.locator('#frontBoard .shift-card').first().click();await page.locator('#endTime').fill('14:00');await page.locator('#submitShift').click();await page.waitForFunction(()=>document.querySelector('#previewPages').textContent.includes('2 quart(s) · 10 h'));
 const pane=await page.locator('#printPreview').boundingBox(),main=await page.locator('main').boundingBox();assert.ok(main.x+main.width<=pane.x+1);await page.screenshot({path:'/tmp/quarts-live-preview-desktop.png'});
 // A change during PDF preparation must never expose an outdated downloadable file.
 let releaseLibrary;let librarySeen;const blocked=new Promise(resolve=>librarySeen=resolve);
 await page.route('**/vendor/html2canvas.js',route=>{releaseLibrary=()=>route.continue();librarySeen();});
 await page.locator('#previewPdf').click();await blocked;
 await page.locator('#frontBoard .shift-card').first().click();await page.locator('#endTime').fill('13:00');await page.locator('#submitShift').click();await page.waitForFunction(()=>document.querySelector('#frontBoard').textContent.includes('8 h à 13 h'));
 await releaseLibrary();await page.waitForFunction(()=>document.querySelector('#servicePdfStatus').textContent.includes('L’horaire a changé'),{},{timeout:60000});assert.equal(await page.locator('#servicePdfResult').isVisible(),false);assert.match(await page.locator('#previewPages').innerText(),/2 quart\(s\) · 9 h/);
 await page.locator('#servicePrintKind').selectOption('filled');assert.equal(await page.locator('#previewPages .print-start').count(),2);
 await page.locator('#previewExpand').click();assert.equal(await page.locator('#previewExpand').innerText(),'Revenir à côté');await page.locator('#previewExpand').click();
 await page.locator('#nextWeek').click();await page.waitForFunction(()=>document.querySelector('#weekPicker').value==='2030-10-21'&&document.querySelector('#servicePdfStatus').textContent.includes('21 octobre 2030'));assert.equal(await page.locator('#previewPages .print-start').count(),0);
 await page.setViewportSize({width:390,height:844});await page.locator('#weekNotes').fill('Notes enregistrées avec aperçu ouvert');await page.locator('#weekNotes').blur();await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent==='Tout est enregistré');const mobile=await page.locator('#printPreview').boundingBox();assert.ok(mobile.y>300&&mobile.x===0);await page.screenshot({path:'/tmp/quarts-live-preview-mobile.png'});
 await page.locator('#previewClose').click();await page.waitForFunction(()=>!document.body.classList.contains('service-preview-open'));assert.equal(await page.evaluate(()=>document.body.classList.contains('service-preview-open')),false);assert.equal(await page.locator('#printPreview').isVisible(),false);assert.deepEqual(errors,[]);
 console.log('Aperçu non bloquant vérifié : ajout/modification de quarts, rafraîchissement automatique, changement de semaine, agrandissement et écran mobile.');
}finally{await browser?.close();await f.close();}
