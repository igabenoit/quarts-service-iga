import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {departmentFixture} from './department-fixture.js';
import {installServiceChat} from '../service-chat.js';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await departmentFixture();let browser,server;
try{
  await f.pool.query('CREATE TABLE schedule_manager_accounts(id BIGINT PRIMARY KEY,name TEXT,active BOOLEAN,departments JSONB)');
  const employee=(await f.pool.query("INSERT INTO schedule_employees(name,area,role) VALUES('Employé test','front','cashier') RETURNING id")).rows[0];
  const person=(await f.pool.query("INSERT INTO schedule_store_people(name,service_employee_id,employee_code) VALUES('Employé test',$1,'123456') RETURNING id",[employee.id])).rows[0];
  const department=(await f.pool.query("SELECT id,code FROM schedule_leave_departments WHERE code='service'")).rows[0];
  const leave=(await f.pool.query(`INSERT INTO schedule_leave_requests(submission_key,employee_id,employee_name,email,reason,periods,first_date,last_date,status,department_id,department_name)
    VALUES($1,$2,'Employé test','test@example.test','Test','[]','2026-12-01','2026-12-01','pending',$3,'Service') RETURNING id,employee_id,department_id`,[crypto.randomUUID(),employee.id,department.id])).rows[0];
  const app=express();app.use(express.json());
  await installServiceChat(app,f.pool,{employeePortal:{identity:async req=>req.get('x-test-user')==='employee'?{id:person.id,name:'Employé test'}:null},managerAccess:{identity:async req=>req.get('x-test-user')==='manager'?{kind:'admin',name:'Administration'}:null},sameOrigin:(_q,_s,next)=>next()});
  app.get('/discussion',(_q,res)=>res.sendFile(fileURLToPath(new URL('../public/discussion.html',import.meta.url))));
  app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  const manager=await browser.newPage({extraHTTPHeaders:{'x-test-user':'manager'}}),employeePage=await browser.newPage({viewport:{width:390,height:844},extraHTTPHeaders:{'x-test-user':'employee'}}),errors=[];
  for(const page of [manager,employeePage])page.on('pageerror',e=>errors.push(e.message));
  await manager.goto(base+'/discussion?mode=manager');
  await manager.locator('#privateChat summary').click();await manager.locator('#privateChat select').selectOption('employee:'+person.id);
  await manager.locator('#privateChat textarea').fill('Bonjour en privé');await manager.getByRole('button',{name:'Envoyer en privé',exact:true}).click();
  await employeePage.goto(base+'/discussion');await employeePage.locator('#privateChat summary').click();await employeePage.locator('#privateChat select').selectOption('admin');
  await employeePage.getByText('Bonjour en privé',{exact:true}).waitFor();assert.equal(await employeePage.locator('#messages').innerText(),'');
  // Exercise the actual leave-card component against the real private-question API.
  await manager.evaluate(async({leave,department})=>{
    const {addLeaveQuestions}=await import('/leave-private-question.js');const container=document.createElement('section');container.id='test-leave';
    container.innerHTML=`<article class="request" data-id="${leave.id}"><a href="mailto:test@example.test">Répondre par courriel</a></article>`;document.querySelector('main').append(container);
    const api=async(path,options)=>{const response=await fetch(path,options),data=await response.json();if(!response.ok)throw Error(data.error);return data;};
    addLeaveQuestions(container,[leave],[department],[],api);
  },{leave,department});
  await manager.locator('#test-leave summary').click();await manager.locator('#test-leave textarea').fill('Peux-tu confirmer les heures de ton congé ?');
  await manager.getByRole('button',{name:'Envoyer la question en privé',exact:true}).click();await manager.getByText('Ouvrir l’échange privé et consulter la réponse').waitFor();
  assert.equal(await manager.getByRole('link',{name:'Répondre par courriel'}).count(),1);
  await employeePage.bringToFront();await employeePage.locator('.leave-question').waitFor();assert.equal(await employeePage.locator('.leave-question').evaluate(e=>getComputedStyle(e).borderTopColor),'rgb(185, 28, 28)');
  if(process.env.PRIVATE_CHAT_SCREENSHOT)await employeePage.screenshot({path:process.env.PRIVATE_CHAT_SCREENSHOT,fullPage:true});
  await employeePage.locator('.leave-question button').click();await employeePage.locator('#privateChat textarea').fill('De 9 h à midi.');await employeePage.getByRole('button',{name:'Envoyer en privé',exact:true}).click();
  await employeePage.locator('.leave-question').waitFor({state:'detached'});
  await manager.bringToFront();await manager.getByText('De 9 h à midi.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log('Browser passed: private exchange, leave question, red mobile alert, reply, email option preserved.');
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await f.db.close();}
