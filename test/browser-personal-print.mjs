import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {signedPersonalInformation} from '../onboarding/personal-information.js';
import PDFLib from '../onboarding/tuac/pdf-lib.min.cjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../public/',import.meta.url));
const bytes=await signedPersonalInformation({lastName:'Exemple',firstName:'Camille',birthDate:'2000-02-29',sin:'000 000 000',street:'123, rue Exemple',apartment:'',city:'Ville Exemple',province:'Québec',postalCode:'H0H 0H0',homePhone:'',mobilePhone:'514-555-0100',email:'camille@example.invalid',signatureDate:'2026-11-23',employerDepartment:'Boulangerie',employerPosition:'Commis',employerStartDate:'2026-11-23',employerSalary:'18,50 $ / heure',employerScale:'Échelon 1'},[[[0,.8],[.2,.1],[.4,.6],[1,.3]]]);
const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css'};
let includeKind=true,browser;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/employee-files/originals/')){
   res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'private, no-store','Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent('Informations personnelles · Embauche.pdf'),'Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'self'",...(includeKind?{'X-Onboarding-Kind':'renseignements'}:{})});res.end(bytes);return;
  }
  const path=resolve(root,'.'+url.pathname);
  if(!path.startsWith(resolve(root)+sep))throw Error('path');
  const data=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'});res.end(data);
 }catch{res.writeHead(404);res.end('Not found');}
});
try{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.htmlPrintCalls=0;window.print=()=>{window.htmlPrintCalls++;};});
 for(const typed of [true,false]){
  includeKind=typed;
  await page.goto(base+'/lecture-pdf.html#id=11111111-1111-4111-8111-111111111111&view=direction');
  const link=page.getByRole('link',{name:'Ouvrir le PDF pour imprimer',exact:true});
  await link.waitFor({state:'visible'});
  await page.locator('canvas').waitFor({state:'visible'});
  assert.equal(await page.locator('#page').innerText(),'Page 1 sur 1');
  assert.match(await link.getAttribute('href'),/^blob:/);
  const exported=Buffer.from(await link.evaluate(async a=>Array.from(new Uint8Array(await(await fetch(a.href)).arrayBuffer()))));
  assert.deepEqual(exported,bytes,'l’impression utilise le PDF signé exact, sans page Web ni informations de fichier');
  const pdf=await PDFLib.PDFDocument.load(exported);
  assert.equal(pdf.getPageCount(),1);
  assert.deepEqual(pdf.getPage(0).getSize(),{width:612,height:792});
  const popupPromise=page.waitForEvent('popup');await link.click();const popup=await popupPromise;
  await popup.waitForLoadState('domcontentloaded');assert.match(popup.url(),/^blob:/);await popup.close();
  assert.equal(await page.evaluate(()=>window.htmlPrintCalls),0,'ne jamais lancer window.print sur la page HTML');
  assert.equal(await page.locator('#printPages canvas').count(),0);
 }
 assert.deepEqual(errors,[]);
 console.log('Informations personnelles : impression PDF native, une page Lettre, original signé intact, sans impression HTML; reconnaissance par type et ancien nom vérifiée.');
}finally{await browser?.close();await new Promise(done=>server.close(done));}
