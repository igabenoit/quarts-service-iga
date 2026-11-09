import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {liveAppFixture} from './live-app-fixture.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const trial=process.argv.includes('--single-trial');
const f=await liveAppFixture({employeeVault:!trial,singleTrial:trial,trialDirectoryKey:'store:987651'});let browser;
try{
 if(trial)await f.query("INSERT INTO schedule_store_people(id,name,job_title) VALUES (987651,'Jo blo',''),(987652,'Jo Blo','Gérante')");
 const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
 const headers={Origin:f.base,'X-Employee-Files':'1'};
 if(!trial)await f.call('POST','/api/employee-files/policy?view=direction',{cookie,headers,body:{text:'Politique fictive. '.repeat(24),confirmed:true}});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 const manager=await browser.newPage();
 const [name,value]=cookie.split('=');await manager.context().addCookies([{name,value,url:f.base}]);
 await manager.goto(f.base+'/dossiers-employes?vue=direction');
 if(trial){
  await manager.getByRole('heading',{name:/Essai d’accueil/}).waitFor();
  assert.equal(await manager.getByLabel('Courriel de l’employé').inputValue(),'employee@example.invalid');
  await manager.getByLabel(/J’approuve cette politique/).check();
 }else{
 await manager.getByRole('link',{name:'Créer un employé'}).click();
 await manager.locator('#personName').fill('Camille Exemple');
 await manager.locator('#personEmployeeCode').fill('887551');
 await manager.locator('#personForm button[type=submit], #personForm button:not([type])').last().click();
 await manager.waitForURL(/dossiers-employes#accueil\/store:\d+$/);
 await manager.getByRole('heading',{name:'Camille Exemple'}).waitFor();
 await manager.getByLabel('Courriel de l’employé').fill('camille@example.invalid');
 await manager.getByLabel('Courriel du gestionnaire').fill('rh@example.invalid');
 }
 await manager.getByLabel('Échéance',{exact:true}).fill('2030-11-10');
 await manager.getByRole('button',{name:'Inviter l’employé'}).click();
 const link=await manager.getByLabel('Lien individuel à transmettre').inputValue();
 const employee=await browser.newPage();
 for(const width of [390,768,1280]){
  await employee.setViewportSize({width,height:900});
  await employee.goto(link);await employee.getByRole('button',{name:/Remplir/}).click();
  assert.ok(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await employee.getByLabel('Nom',{exact:true}).fill('Exemple');
 await employee.getByRole('checkbox').check();
 await employee.getByRole('button',{name:/Enregistrer et reprendre/}).click();
 await employee.getByText(/Brouillon enregistré/).waitFor();
 await employee.reload();await employee.getByRole('button',{name:/Reprendre/}).click();
 assert.equal(await employee.getByLabel('Nom',{exact:true}).inputValue(),'Exemple');
 for(const i of await employee.locator('input:not([type=checkbox])').all()){
  const type=await i.getAttribute('type');await i.fill(type==='date'?'2000-01-01':type==='email'?'test@example.invalid':'Exemple');
 }
 await employee.getByRole('checkbox').check();
 const canvas=employee.locator('canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
 await employee.mouse.move(box.x+8,box.y+10);await employee.mouse.down();await employee.mouse.move(box.x+50,box.y+40,{steps:4});await employee.mouse.up();
 await employee.getByRole('button',{name:'Signer et classer le PDF'}).click();await employee.getByText(/Votre dossier est complet/).waitFor();
 await manager.goto(f.base+'/dossiers-employes?vue=direction');
 const card=manager.getByRole('article').filter({has:manager.getByRole('heading',{name:trial?'Jo blo':'Camille Exemple',exact:true})});
 await card.getByText(/1 \/ 1 document/).waitFor();
 await card.getByRole('button',{name:'Ouvrir le dossier'}).click();
 const section=manager.getByRole('heading',{name:'Documents reçus'}).locator('..');
 const pdf=await manager.request.get(await section.getByRole('link',{name:'Ouvrir le PDF signé'}).getAttribute('href').then(path=>new URL(path,f.base).href));
 assert.equal(pdf.status(),200);assert.equal(pdf.headers()['content-type'],'application/pdf');
 console.log('Invitation, trois largeurs, reprise et signature vérifiées.');
}finally{await browser?.close();await f.close();}
