import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {liveAppFixture} from './live-app-fixture.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await liveAppFixture();let browser;
try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  const {departments}=(await f.call('GET','/api/departments/meta',{cookie})).body;
  const cuisine=departments.find(d=>d.key==='cuisine');
  await f.call('POST','/api/departments/people',{cookie,body:{name:'Renfort Test',group:'regular',active:true,departments:[cuisine.id],availability:{}}});
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:f.base}]);
  const week='2026-11-23';
  await page.goto(f.base+`/departements?department=${cuisine.id}&week=${week}`);
  for(const [day,assignment] of [['Lundi','service'],['Mardi','delivery']]){
    await page.getByRole('button',{name:new RegExp('Renfort Test, '+day+',')}).click();
    await page.locator('#cellKind').selectOption(assignment);
    assert.equal(await page.locator('#cellStart').isVisible(),true);
    assert.equal(await page.locator('#cellWorkDepartment').isVisible(),false);
    await page.locator('#cellStart').fill('8');await page.locator('#cellEnd').fill('5');
    assert.match(await page.locator('#resolvedShift').innerText(),/8 h au total séparé/);
    await page.getByRole('button',{name:'Enregistrer cette journée',exact:true}).click();
  }
  assert.match(await page.locator('.department-hours').innerText(),/Service : 8 h/);
  assert.match(await page.locator('.department-hours').innerText(),/Livraison : 8 h/);
  assert.match(await page.locator('.department-hours').innerText(),/Régulier : 0 h/);
  const saving=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().includes('/weeks/'));
  await page.locator('#saveDraft').click();assert.equal((await saving).status(),200);
  await page.reload();await page.getByRole('button',{name:/Renfort Test, Mardi,/}).click();
  assert.equal(await page.locator('#cellKind').inputValue(),'delivery');
  await page.locator('#cellDialog button[data-close]').click();
  const response=await f.call('GET',`/api/weeks/${week}`,{cookie});
  assert.equal(response.status,200);assert.equal(response.body.departmentSupport.length,2);
  await page.goto(f.base+'/');
  await page.locator('#weekPicker').fill(week);await page.locator('#weekPicker').dispatchEvent('change');
  await page.waitForFunction(()=>document.querySelector('#scheduleBoard')?.textContent.includes('Renfort Test'));
  assert.match(await page.locator('#scheduleBoard').textContent(),/Service : 8 h · Livraison : 8 h/);
  assert.match(await page.locator('#printSheet').textContent(),/Renfort Test/);
  await page.locator('#previewBtn').click();
  const supportSheet=page.locator('#previewPages .service-sheet').last();
  assert.match(await supportSheet.textContent(),/Service : 8 h · Livraison : 8 h/);
  await supportSheet.screenshot({path:'../support-print.png'});
  await page.locator('#previewPdf').click();
  await page.locator('#servicePdfDownload').waitFor({state:'visible',timeout:30000});
  assert.match(await page.locator('#servicePdfStatus').innerText(),/PDF prêt : 4 feuilles légales/);
  assert.deepEqual(errors,[]);
  console.log('Browser verified: save/reopen, separate totals, Service API, main schedule and printable support sheets.');
}finally{await browser?.close();await f.close();}
