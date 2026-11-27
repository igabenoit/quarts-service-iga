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

 await page.goto(f.base+'/dossiers-employes?vue=direction#dossiers/'+employee.key);
 const input=page.getByLabel('Fichiers à ajouter'),button=page.getByRole('button',{name:'Ajouter les fichiers au dossier'});
 await input.waitFor();
 const file={name:'attestation-fictive.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nFichier fictif\n%%EOF')};
 await input.setInputFiles([file,{name:'notes-fictives.docx',mimeType:'application/octet-stream',buffer:Buffer.from('PK-fichier-fictif')}]);await button.click();await page.getByText('2 fichier(s) ajouté(s) au dossier.',{exact:true}).waitFor();
 await page.waitForFunction(n=>[...document.querySelectorAll('a')].filter(a=>a.textContent==='Télécharger').length===n,2);
 const link=await page.getByRole('link',{name:'Ouvrir',exact:true}).getAttribute('href');
 const download=await f.call('GET',link,{cookie:admin});assert.equal(download.status,200);assert.match(download.body,/Fichier fictif/);assert.match(download.headers.get('cache-control'),/no-store/);
 assert.notEqual((await f.call('GET',link)).status,200);
 assert.notEqual((await f.call('GET',link.replace(encodeURIComponent(employee.key),'store%3A999999'),{cookie:admin})).status,200);
 await input.setInputFiles(file);await button.click();await page.getByText('1 fichier(s) ajouté(s) au dossier.',{exact:true}).waitFor();await page.waitForFunction(n=>[...document.querySelectorAll('a')].filter(a=>a.textContent==='Télécharger').length===n,2);
 await page.reload();await page.getByRole('link',{name:'Ouvrir',exact:true}).waitFor();await page.waitForFunction(n=>[...document.querySelectorAll('a')].filter(a=>a.textContent==='Télécharger').length===n,2);
 await page.getByLabel('Fichiers à ajouter').setInputFiles({name:'script.html',mimeType:'text/html',buffer:Buffer.from('<script>bad</script>')});await page.getByRole('button',{name:'Ajouter les fichiers au dossier'}).click();await page.getByText(/Formats acceptés/).waitFor();await page.waitForFunction(n=>[...document.querySelectorAll('a')].filter(a=>a.textContent==='Télécharger').length===n,2);

 const removeUrl=link.replace('?', '/remove?');
 assert.equal((await f.call('POST',removeUrl,{cookie:admin,headers:{'X-Employee-Files':'1',Origin:f.base},body:{confirmed:false}})).status,400);
 page.once('dialog',d=>d.dismiss());await page.locator('[data-remove]').first().click();await page.waitForFunction(n=>[...document.querySelectorAll('a')].filter(a=>a.textContent==='Télécharger').length===n,2);
 const pdfRemove=page.locator('[data-remove]').filter({hasText:'Supprimer'});const id=new URL(link,f.base).pathname.split('/').at(-1);
 page.once('dialog',d=>d.accept());await page.locator('[data-remove="'+id+'"]').click();await page.getByText('Fichier retiré du dossier.',{exact:true}).waitFor();await page.waitForFunction(n=>[...document.querySelectorAll('a')].filter(a=>a.textContent==='Télécharger').length===n,1);
 assert.equal((await f.call('GET',link,{cookie:admin})).status,404);await page.reload();await page.getByRole('link',{name:'Télécharger',exact:true}).waitFor();await page.waitForFunction(n=>[...document.querySelectorAll('a')].filter(a=>a.textContent==='Télécharger').length===n,1);
 await page.getByLabel('Fichiers à ajouter').setInputFiles(file);await page.getByRole('button',{name:'Ajouter les fichiers au dossier'}).click();await page.getByText('1 fichier(s) ajouté(s) au dossier.',{exact:true}).waitFor();await page.waitForFunction(n=>[...document.querySelectorAll('a')].filter(a=>a.textContent==='Télécharger').length===n,2);
 assert.deepEqual(errors,[]);console.log('Employee attachments: multi-upload, duplicate prevention, reload, protected download, cross-employee rejection and invalid format checked on mobile.');
}finally{await browser?.close();await f.close();}
