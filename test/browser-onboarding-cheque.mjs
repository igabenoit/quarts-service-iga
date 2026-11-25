import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {chequeFixture} from './cheque-fixture.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const {f,cookie,must,admin,createCase}=await chequeFixture();let browser;
try{
 const photoCase=await createCase(),linkCase=await createCase(),pdfCase=await createCase();
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
 const employee=await browser.newPage({viewport:{width:390,height:1000}}),manager=await browser.newPage({viewport:{width:1360,height:1050}}),errors=[];
 for(const page of [employee,manager])page.on('pageerror',error=>errors.push(error.message));
 const [name,value]=cookie.split('=');await manager.context().addCookies([{name,value,url:f.base}]);
 await employee.goto(f.base+photoCase.path);
 await employee.getByRole('button',{name:'Transmettre mon spécimen de chèque',exact:true}).click();
 const form=employee.locator('#editor form');assert.equal(await form.locator('canvas').count(),0);
 assert.ok(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const png=Buffer.from(await employee.evaluate(()=>{
  const c=document.createElement('canvas');c.width=900;c.height=380;const x=c.getContext('2d');x.fillStyle='#fff9ea';x.fillRect(0,0,900,380);x.fillStyle='#192c45';x.font='bold 38px Arial';x.fillText('SPÉCIMEN FICTIF — TEST',40,70);x.font='26px Arial';x.fillText('Camille Exemple',40,145);x.fillText('Institution : 000    Transit : 00000',40,230);x.fillText('Compte : 0000000',40,290);return c.toDataURL('image/png').split(',')[1];
 }),'base64');
 await form.getByLabel('Photo ou PDF du spécimen de chèque',{exact:true}).setInputFiles({name:'specimen-fictif.png',mimeType:'image/png',buffer:png});
 await form.getByRole('checkbox').check();
 await form.screenshot({path:'../specimen-cheque-mobile.png'});
 await form.getByRole('button',{name:'Transmettre mon spécimen de chèque',exact:true}).click();
 await employee.getByText('Votre spécimen de chèque a été reçu et conservé dans votre dossier.',{exact:true}).waitFor();
 await employee.reload();await employee.getByText('Reçu · specimen-fictif.png',{exact:true}).waitFor();
 assert.equal(await employee.getByText('Signée et complétée',{exact:true}).count(),0);
 await manager.goto(f.base+'/dossiers-employes?vue=direction#dossiers/'+photoCase.key);
 await manager.locator('#onboardingPanel [name=doc][value=cheque]').waitFor({state:'attached'});
 assert.equal(await manager.locator('#onboardingPanel [name=doc]').count(),7);
 assert.equal(await manager.locator('#onboardingPanel [name=doc][value=cheque]').isChecked(),true);
 const photoLink=manager.getByRole('link',{name:'Voir le spécimen',exact:true}).first();await photoLink.waitFor();
 await manager.goto(new URL(await photoLink.getAttribute('href'),f.base).href);
 const image=manager.getByRole('img',{name:'Spécimen de chèque transmis par l’employé'});await image.waitFor();
 await manager.waitForFunction(()=>document.querySelector('.cheque-attachment img')?.naturalWidth===900);
 await manager.screenshot({path:'../specimen-cheque-direction.png',fullPage:true});
 // A link remains private and is opened only by an explicit click by the reader.
 await employee.goto('about:blank');await employee.goto(f.base+linkCase.path);await employee.getByRole('button',{name:'Transmettre mon spécimen de chèque',exact:true}).click();
 await form.getByLabel('Comment souhaitez-vous transmettre le document?').selectOption('link');
 await form.getByLabel('Lien vers le spécimen de chèque',{exact:true}).fill('http://example.invalid/specimen');await form.getByRole('checkbox').check();
 await form.getByRole('button',{name:'Transmettre mon spécimen de chèque',exact:true}).click();await employee.getByText(/Utilisez un lien HTTPS/).waitFor();
 await form.getByLabel('Lien vers le spécimen de chèque',{exact:true}).fill('https://example.invalid/specimen-partage');
 await form.getByRole('button',{name:'Transmettre mon spécimen de chèque',exact:true}).click();await employee.getByText('Reçu · Lien transmis',{exact:true}).waitFor();
 const linkId=must(await admin('GET',linkCase.route(''))).documents[0].original_id;
 await manager.goto('about:blank');await manager.goto(f.base+'/lecture-pdf.html#id='+linkId+'&view=direction&key='+linkCase.key);
 const external=manager.getByRole('link',{name:'https://example.invalid/specimen-partage',exact:true});await external.waitFor();assert.equal(await external.getAttribute('rel'),'noopener noreferrer');
 // PDF upload and existing native print route work without altering the source.
 await employee.goto('about:blank');await employee.goto(f.base+pdfCase.path);await employee.getByRole('button',{name:'Transmettre mon spécimen de chèque',exact:true}).click();
 await form.getByLabel('Photo ou PDF du spécimen de chèque',{exact:true}).setInputFiles({name:'specimen-fictif.pdf',mimeType:'application/pdf',buffer:await readFile(new URL('./fixtures/tuac-three-copy-before-alignment.pdf',import.meta.url))});
 await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Transmettre mon spécimen de chèque',exact:true}).click();await employee.getByText('Reçu · specimen-fictif.pdf',{exact:true}).waitFor();
 const pdfId=must(await admin('GET',pdfCase.route(''))).documents[0].original_id;
 await manager.goto('about:blank');await manager.goto(f.base+'/lecture-pdf.html#id='+pdfId+'&view=direction&key='+pdfCase.key);
 await manager.getByText('Page 1 sur 1',{exact:true}).waitFor();assert.match(await manager.getByRole('link',{name:'Ouvrir le PDF pour imprimer',exact:true}).getAttribute('href'),/^blob:/);
 assert.deepEqual(errors,[]);
 console.log('Chrome : dépôt photo/PDF/lien sans signature, statut après rechargement, sept documents proposés, lecture privée direction et affichage mobile vérifiés.');
}catch(error){
 for(const context of browser?.contexts()||[])for(const page of context.pages())if(await page.locator('#status').count())console.log('État du navigateur fictif :',await page.locator('#status').textContent());
 throw error;
}finally{await browser?.close();await f.close();}
