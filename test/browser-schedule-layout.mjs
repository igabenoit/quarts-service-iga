import {createRequire} from 'node:module';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import express from 'express';
import vm from 'node:vm';
import {serviceDayPortions} from '../public/shared-service.js';
import {shiftWithApprovedLeave} from '../public/approved-shift-leave.js';
import {absenceLabel,workingIntervals} from '../public/shift-absence.js';
import {serviceShiftTiming} from '../public/service-rules.js';
import {installPdfAssets} from '../pdf-assets.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const source=readFileSync('public/app.js','utf8').replace(/^import .*;\r?\n/gm,'');
const context=vm.createContext({serviceDayPortions,shiftWithApprovedLeave,absenceLabel,workingIntervals,serviceShiftTiming});
vm.runInContext(source.slice(0,source.indexOf('function render(){')),context);
context.data={weekStart:'2026-10-19',employees:Array.from({length:30},(_,i)=>({id:i+1,name:`Employé Service ${i+1} avec un nom composé très long`,role:'cashier',active:true,displayRank:i+1,seniority:'2020-01-01',availability:{0:[[480,600],[660,720],[780,900],[960,1020]]}})),shifts:Array.from({length:30},(_,i)=>({id:i+1,role:'cashier',dayIndex:0,startMinute:480,endMinute:1020,breakMinutes:60,absence:{start:750,end:810,includesMeal:false}})),assignments:Array.from({length:30},(_,i)=>({shiftId:i+1,employeeId:i+1})),approvedLeaves:[],timeOff:[]};
const serviceHTML=vm.runInContext('servicePrintHTML(data)',context);
const app=express();installPdfAssets(app);app.use(express.static('public'));
app.get('/service-fixture',(_q,res)=>res.send(serviceHTML));
app.get('/layout-test',(_q,res)=>res.send('<link rel="stylesheet" href="/departments.css"><link rel="stylesheet" href="/service-print.css"><link rel="stylesheet" href="/department-control.css"><div id="fixture"></div>'));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
mkdirSync('tmp/pdf-layout',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:1450}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/layout-test`);
 const result=await page.evaluate(async()=>{
  const {sheetHTML,DEPARTMENT_STYLES,blankCell}=await import('/departments-core.js');
  const {prepareSchedulePages}=await import('/schedule-layout.js');
  const {schedulePagesPDF}=await import('/department-pdf.js');
  const {controlReport,controlPages}=await import('/department-control.js');
  const {summaryPage}=await import('/department-summary.js');
  const people=Array.from({length:26},(_,i)=>({id:i+1,name:i===0?'Pascal Colard':`Employé ${i+1} nom composé très long pour vérifier le retour à la ligne`,active:true,group:i<10?'regular':'part_time',jobTitle:'Assistant responsable des opérations et du réapprovisionnement',specification:i>20?'Équipe de nuit : réception des marchandises et préparation du magasin':'Responsable des commandes spéciales et soutien aux autres départements',availability:{}}));
  const draft={rows:people.map(p=>({personId:p.id,cells:Array.from({length:7},()=>({...blankCell(),kind:'shift',start:480,end:1020,breakMinutes:60}))})),notes:'Notes complètes à conserver. '.repeat(14)};
  const results=[];
  const verify=prepared=>{
   for(const p of prepared.pages){
    const b=p.getBoundingClientRect(),bottom=b.bottom-parseFloat(getComputedStyle(p).paddingBottom);
    for(const el of p.children)if(el.getBoundingClientRect().bottom>bottom+2)throw Error('Page overflow '+el.className);
    for(const el of p.querySelectorAll('.sheet-work,.sheet-person-label,.sheet-day-detail span,td,th'))if(el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2)throw Error('Text overflow '+el.className);
   }
  };
  const normalPeople=people.slice(0,14).map(p=>({...p,name:'Employé '+p.id,jobTitle:'',specification:''}));
  document.querySelector('#fixture').innerHTML=sheetHTML({department:DEPARTMENT_STYLES[0],weekStart:'2026-10-19',people:normalPeople,draft:{rows:draft.rows.slice(0,14),notes:''}});
  const normal=prepareSchedulePages([document.querySelector('#fixture article')]);verify(normal);
  if(normal.pages.length!==1)throw Error('Normal schedule must stay on one page');
  const ordinary=normal.pages[0].querySelector('.printed-shift');
  if(!ordinary.classList.contains('simple-shift')||parseFloat(getComputedStyle(ordinary).borderTopWidth)!==0||getComputedStyle(ordinary.querySelector('.printed-shift-range')).flexDirection!=='column')throw Error('Ordinary shift must use stacked hours without a box');
  normal.cleanup();
  document.querySelector('#fixture').innerHTML=sheetHTML({department:DEPARTMENT_STYLES[0],weekStart:'2026-10-19',people:normalPeople,draft:{rows:draft.rows.slice(0,14),notes:''},related:[{personId:1,day:0,sourceDepartment:'service',cell:{kind:'shift',start:1020,end:1140,breakMinutes:0}}]});
  const shared=prepareSchedulePages([document.querySelector('#fixture article')]);verify(shared);
  const blocks=shared.pages.flatMap(p=>[...p.querySelectorAll('.printed-shift:not(.simple-shift)')]);
  if(blocks.length!==2||blocks.some(el=>parseFloat(getComputedStyle(el).borderTopWidth)===0))throw Error('Shared portions must remain distinct');
  shared.cleanup();
  for(const department of DEPARTMENT_STYLES){
   for(const blank of [false,true]){
    const fixture=document.querySelector('#fixture');fixture.innerHTML=sheetHTML({department,weekStart:'2026-10-19',people,draft,blank});
    await document.fonts.ready;await Promise.all([...fixture.querySelectorAll('img')].map(i=>i.decode()));
    const original=fixture.innerHTML,source=fixture.querySelector('article');
    const prepared=prepareSchedulePages([source]);verify(prepared);
    const names=prepared.pages.flatMap(p=>[...p.querySelectorAll('.sheet-person-label')].map(n=>n.childNodes[0].textContent));
    const clips=prepared.pages.flatMap(p=>[...p.querySelectorAll('.sheet-work,.sheet-person-label,.sheet-day-detail span')].filter(n=>n.scrollHeight>n.clientHeight+2||n.scrollWidth>n.clientWidth+2).map(n=>n.className));
    if(names.length!==26||new Set(names).size!==26||clips.length)throw Error(JSON.stringify({department:department.key,blank,names:names.length,clips}));
    if(original!==fixture.innerHTML)throw Error('Source mutated');
    if(department.key==='epicerie'&&!blank){
     window.sample=prepared.pages.map(p=>p.outerHTML).join('');
    }
    results.push({department:department.key,blank,pages:prepared.pages.length});prepared.cleanup();
   }
  }
  const fixture=document.querySelector('#fixture');
  fixture.innerHTML=await (await fetch('/service-fixture')).text();
  await Promise.all([...fixture.querySelectorAll('img')].map(i=>i.decode()));
  const preparedService=prepareSchedulePages([...fixture.querySelectorAll('article')]);
  verify(preparedService);
  const serviceNames=preparedService.pages.flatMap(p=>[...p.querySelectorAll('[data-person]')].map(n=>n.dataset.person));
  if(serviceNames.length!==30||new Set(serviceNames).size!==30)throw Error('Service names lost');
  for(const p of preparedService.pages)for(const n of p.querySelectorAll('.sheet-work,.sheet-person-label,.sheet-day-detail span'))if(n.scrollHeight>n.clientHeight+2||n.scrollWidth>n.clientWidth+2)throw Error('Service clip '+n.outerHTML);
  results.push({department:'service',pages:preparedService.pages.length});
  window.serviceSample=preparedService.pages.map(p=>p.outerHTML).join('');preparedService.cleanup();
  const report=controlReport({department:DEPARTMENT_STYLES[0],weekStart:'2026-10-19',people,draft});
  fixture.innerHTML=controlPages([report]);
  const control=prepareSchedulePages([...fixture.querySelectorAll('article')]);
  verify(control);
  if(control.pages.reduce((n,p)=>n+p.querySelectorAll('.control-detail tbody tr').length,0)!==26)throw Error('Control names lost');
  results.push({department:'control',pages:control.pages.length});control.cleanup();
  fixture.innerHTML=summaryPage(DEPARTMENT_STYLES.map(department=>({...report,department,actual:{minutes:null,note:'Justification conservée intégralement. '.repeat(6)}})));
  const summary=prepareSchedulePages([...fixture.querySelectorAll('article')]);verify(summary);
  if(summary.pages.reduce((n,p)=>n+p.querySelectorAll('.summary-print-table tbody tr').length,0)!==8)throw Error('Summary rows lost');
  results.push({department:'summary',pages:summary.pages.length});summary.cleanup();
  fixture.innerHTML=window.sample;
  const blob=await schedulePagesPDF([...document.querySelectorAll('#fixture article')]);
  const data=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(blob);});
  return {results,data,pages:blob.pageCount};
 });
 writeFileSync('tmp/pdf-layout/epicerie.pdf',Buffer.from(result.data,'base64'));delete result.data;
 await page.locator('#fixture article').first().screenshot({path:'tmp/pdf-layout/epicerie.png'});
 await page.evaluate(()=>document.querySelector('#fixture').innerHTML=window.serviceSample);
 await page.locator('#fixture article').nth(1).screenshot({path:'tmp/pdf-layout/service.png'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify(result));
}finally{await browser.close();server.close();}

