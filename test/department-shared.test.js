import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {blankCell,mergeIncoming,sheetHTML,buffetMinutes,totalMinutes,grandMinutes} from '../public/departments-core.js';
import {prepareSharedDraft} from '../public/department-buffet.js';
import {crossDepartmentWarnings} from '../department-transfers.js';
import {personalDays} from '../public/portal-weeks.js';
const week='2026-10-19',shift=(start=420,end=960,extra={})=>({kind:'shift',start,end,breakMinutes:60,note:'',...extra});
const cells=(entries={})=>Array.from({length:7},(_,i)=>entries[i]||blankCell());
const person={id:1,name:'Johanne Exemple',active:true,group:'regular',availability:{},departments:[1,2],buffetPamPriority:true};
const own=entries=>({rows:[{personId:1,cells:cells(entries)}],notes:''});
test('Buffet: 40 h uniques réparties 24 PAM + 16 Charcuterie; autres postes indépendants',()=>{
 const days=Object.fromEntries([0,1,2,3,4].map(d=>[d,shift(420,960,{kind:'buffet'})]));days[5]=shift(420,960,{post:'rs_ss'});
 const draft=own(days),related=Object.entries(days).filter(([d])=>Number(d)<5).map(([day,cell])=>({personId:1,day:Number(day),cell,sourceDepartment:'pam'}));
 const c=prepareSharedDraft(draft,related,[person],'charcuterie'),p=prepareSharedDraft(draft,related.map(i=>({...i,sourceDepartment:'charcuterie'})),[person],'pam');
 assert.equal(c.related.length,0);assert.equal(p.related.length,0);
 assert.equal(buffetMinutes(c.draft.rows[0]),960);assert.equal(buffetMinutes(p.draft.rows[0]),1440);
 assert.equal(totalMinutes(p.draft.rows[0]),480,'Sandwich shift does not consume Buffet cap');
 const html=sheetHTML({department:{id:1,key:'charcuterie',name:'Charcuterie'},weekStart:week,people:[person],...c});
 assert.match(html,/PAM · Buffet/);assert.match(html,/Charcuterie · Buffet/);assert.match(html,/Sem\. 48 h/);
 const results=[{kind:'department',data:{weekStart:week,department:{key:'charcuterie'},schedule:{rows:[{...c.draft.rows[0],cells:c.draft.rows[0].cells.map((v,d)=>d===5?blankCell():v)}]}}},{kind:'department',data:{weekStart:week,department:{key:'pam'},schedule:p.draft}}];
 const portal=personalDays(week,results);assert.equal(portal.flatMap(d=>d.entries).reduce((n,c)=>n+c.minutes,0),2880);assert.equal(portal[0].entries.length,1);assert.equal(portal[0].entries[0].detail,'Buffet');assert.equal(portal[5].entries[0].detail,'Commandes Sandwich');
 assert.equal(draft.rows[0].cells[0].buffetAllocation,undefined,'projection never edits saved shifts');
});
test('Buffet cap splits paid minutes, includes related-only days, excludes training and normal posts',()=>{
 const draft=own({0:shift(420,1020,{kind:'buffet'}),1:shift(420,1020,{kind:'buffet'}),2:shift(420,1020,{kind:'buffet'})});
 const a=prepareSharedDraft(draft,[],[person],'pam');assert.equal(buffetMinutes(a.draft.rows[0]),1440);assert.equal(a.draft.rows[0].cells[2].buffetAllocation.charcuterie,180);
 const related=[0,1,2].map(day=>({personId:1,day,cell:draft.rows[0].cells[day],sourceDepartment:'pam'}));
 const c=prepareSharedDraft(own({}),related,[person],'charcuterie');assert.equal(buffetMinutes(c.draft.rows[0]),180);assert.equal(grandMinutes(c.draft.rows[0]),180);
 const noRule=prepareSharedDraft(draft,[],[{...person,buffetPamPriority:false}],'pam');assert.equal(buffetMinutes(noRule.draft.rows[0]),1620);
});
test('conflicts include drafts, distinct posts, linked IDs, midnight and week boundaries; no false transfer/mirror/end boundary',()=>{
 const current={weekStart:week,department:{key:'charcuterie'}},display=own({0:shift(),6:shift(1320,1830,{breakMinutes:30})});
 const other=(draft,published=null,week_start=week)=>({week_start,key:'pam',name:'PAM',draft,published});
 assert.equal(crossDepartmentWarnings(current,display,[other(own({0:shift(960,1200)}))],[person]).length,0);
 const warnings=crossDepartmentWarnings(current,display,[other(own({0:shift(600,1020,{post:'rs_ss'})}))],[person]);assert.equal(warnings.length,1);assert.match(warnings[0],/brouillon/);assert.match(warnings[0],/Commandes Sandwich/);
 assert.equal(crossDepartmentWarnings(current,display,[other(own({0:shift(360,600)}),null,'2026-10-26')],[person]).length,1);
 const buffet=own({0:shift(420,960,{kind:'buffet'})});assert.equal(crossDepartmentWarnings(current,buffet,[other(buffet)],[person]).length,0);
 assert.equal(crossDepartmentWarnings(current,buffet,[other(own({0:shift(420,960,{post:'rs_ss'})}))],[person]).length,1);
 assert.equal(crossDepartmentWarnings(current,display,[other({rows:[{personId:2,cells:cells({0:shift()})}]})],[person,{id:2,portalPersonId:1}]).length,1);
 const received=own({0:{...shift(),sourceDepartment:'pam'}});assert.equal(crossDepartmentWarnings(current,received,[other(own({0:shift()}))],[person]).length,0);
});
test('PostgreSQL: same employee full print schedule, draft warnings, published-only portal, no unrelated employees',async()=>{
 const f=await departmentFixture();try{
  const meta=(await f.call('get','/api/departments/meta')).body,c=meta.departments.find(d=>d.key==='charcuterie'),p=meta.departments.find(d=>d.key==='pam');
  const body={name:'Johanne Exemple',group:'regular',active:true,departments:[c.id,p.id],availability:{},buffetPamPriority:true};
  const id=(await f.call('post','/api/departments/people',{body})).body.id;
  const outsider=(await f.call('post','/api/departments/people',{body:{...body,name:'Autre personne',buffetPamPriority:false,departments:[p.id]}})).body.id;
  const route='/api/departments/:id/weeks/:week',get=async d=>(await f.call('get',route,{params:{id:d.id,week}})).body;
  const save=(d,draft)=>f.call('put',route,{params:{id:d.id,week},body:{revision:0,draft}});
  assert.equal((await save(c,{rows:[{personId:id,cells:cells({0:shift(420,960,{kind:'buffet'})})}]})).code,200);
  assert.equal((await save(p,{rows:[{personId:id,cells:cells({0:shift(420,960,{kind:'buffet'}),1:shift(390,930,{post:'rs_ss'})})},{personId:outsider,cells:cells({0:shift()})}]})).code,200);
  const current=await get(c);assert.equal(current.people[0].buffetPamPriority,true);assert.ok(current.related.every(r=>r.personId===id));assert.equal(current.warnings.filter(w=>w.includes('chevauchement')).length,0);
  const display=prepareSharedDraft(mergeIncoming(current.draft,current.incoming),current.related,current.people,c.key);
  const html=sheetHTML({department:c,weekStart:week,people:current.people,...display});assert.match(html,/Commandes Sandwich/);assert.doesNotMatch(html,/Autre personne/);assert.match(html,/Sem\. 16 h/);assert.match(html,/sheet-person multi-shift-row/,'long department/post labels receive flexible height');
  assert.equal(buffetMinutes(display.draft.rows[0]),0);assert.equal(totalMinutes(display.draft.rows[0]),0);
  assert.equal((await f.call('get','/api/leave/department-schedules/:id/:week',{params:{id:c.id,week}})).code,404);
  for(const d of [c,p])assert.equal((await f.call('post',route+'/publish',{params:{id:d.id,week},body:{revision:1,verified:true,warningsReviewed:true}})).code,200);
  const results=[];for(const d of [c,p]){const result=await f.call('get','/api/leave/department-schedules/:id/:week',{params:{id:d.id,week},employee:{id}});assert.equal(result.code,200);results.push({kind:'department',data:result.body});}
  const portal=personalDays(week,results);assert.equal(portal[0].entries.length,1);assert.equal(portal[1].entries[0].detail,'Commandes Sandwich');assert.equal(portal.flatMap(d=>d.entries).reduce((n,c)=>n+c.minutes,0),960);
  const changed=(await get(p)).draft;changed.rows[0].cells[0]=shift(420,960,{post:'rs_ss'});await f.call('put',route,{params:{id:p.id,week},body:{revision:2,draft:changed}});
  assert.ok((await get(c)).warnings.some(w=>w.includes('chevauchement')&&w.includes('Commandes Sandwich')));
  const stillPublished=(await f.call('get','/api/leave/department-schedules/:id/:week',{params:{id:p.id,week},employee:{id}})).body;assert.equal(stillPublished.schedule.rows[0].cells[0].kind,'buffet');
 }finally{await f.db.close();}
});
