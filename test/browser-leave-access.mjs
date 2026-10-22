import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {liveAppFixture} from './live-app-fixture.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await liveAppFixture();let browser;
try{
  const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  const meta=(await f.call('GET','/api/departments/meta',{cookie:admin})).body;
  const department=meta.departments.find(d=>d.key==='boulangerie');
  const created=await f.call('POST','/api/departments/people',{cookie:admin,body:{name:'Employé fictif congés',group:'regular',active:true,departments:[department.id],availability:{},employeeCode:'001234'}});
  assert.equal(created.status,200,JSON.stringify(created.body));
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(f.base+'/conges');
  const code=page.getByLabel('Code employé (6 derniers chiffres)',{exact:true});
  await code.waitFor({state:'visible'});
  assert.equal(await code.getAttribute('pattern'),'[0-9]{6}');
  assert.equal(await code.getAttribute('maxlength'),'6');
  assert.ok(!(await page.locator('body').innerText()).includes('Code commun'));
  await code.fill('001234');
  const login=page.waitForResponse(r=>r.url()===f.base+'/api/employee-portal/access'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Ouvrir le formulaire'}).click();
  assert.equal((await login).status(),200);
  await page.locator('#leaveForm').waitFor({state:'visible'});
  assert.equal(await page.locator('#accessForm').isVisible(),false);
  const cookies=await context.cookies();
  assert.ok(cookies.some(c=>c.name==='employee_portal'));
  assert.ok(!cookies.some(c=>c.name==='leave_access'));

  // Repeat the exact mobile path from the report in a clean browser session.
  await context.clearCookies();
  await page.goto(f.base+'/horaires-departements?vue=employe');
  await page.locator('#accessForm').waitFor({state:'visible'});
  await page.locator('#staffCode').fill('001234');
  await page.getByRole('button',{name:'Voir mon horaire',exact:true}).click();
  await page.locator('#staffContent').waitFor({state:'visible'});
  await page.getByRole('link',{name:'Demander un congé',exact:true}).click();
  await page.locator('#leaveForm').waitFor({state:'visible'});
  assert.equal(await page.locator('#accessForm').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('Mobile leave flow passed: personal code on direct entry; no second code from the schedule.');
}finally{await browser?.close();await f.close();}
