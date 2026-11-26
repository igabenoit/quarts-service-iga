import assert from 'node:assert/strict';
import express from 'express';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {campusEmailPayload} from '../campus-training.js';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=express();app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
 const page=await browser.newPage();
 for(const width of [390,900])for(const service of [false,true]){
  await page.setViewportSize({width,height:844});
  const title=service?'Formation GO Service - Rayon du Service':'Formation GO Service';
  const mail=campusEmailPayload({employee_name:'Camille — exemple fictif',due_date:'2027-01-10'},'m08327e001234',[{title,platform:'campus'}],'test@example.invalid');
  await page.setContent(mail.html.replaceAll('https://quartservice.igabenoit.com','http://127.0.0.1:'+server.address().port),{waitUntil:'networkidle'});
  assert.equal(await page.locator('img').count(),service?3:2);
  assert.equal(await page.evaluate(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0)),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(width===390)await page.screenshot({path:'../campus-email-'+(service?'service':'general')+'.png',fullPage:true});
 }
 console.log('Illustrated Campus email: all images loaded; general and Service layouts fit mobile and desktop.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
