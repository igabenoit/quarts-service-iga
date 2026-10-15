import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {departmentFixture} from './department-fixture.js';
import {installManagerAccess} from '../manager-access.js';
import {leadershipRoster,presenceWeek,presencePages,dailyPacket} from '../public/leadership-presence-core.js';
import {blankCell,DAY_NAMES,addDays} from '../public/departments-core.js';
const week='2026-10-19';
test('presence includes named leadership and Service supervisors, explicit links only, and no ordinary clerks',()=>{
  const people=[{id:1,name:'Émile',jobTitle:'Assistant-gérant',departments:[1],active:true},{id:2,portalPersonId:1,name:'Émile second',jobTitle:'Assistant',departments:[2],active:true},{id:3,name:'Alexandre',jobTitle:'Directeur',departments:[1],active:true},{id:4,name:'Badia',serviceEmployeeId:1,departments:[3],active:true},{id:5,name:'Commis',jobTitle:'Commis',departments:[1],active:true},{id:6,name:'Inactif',jobTitle:'Gérant',departments:[1],active:false}];
  const roster=leadershipRoster(people,[{id:1,key:'fruits'},{id:2,key:'pam'},{id:3,key:'service'}],[{id:1,role:'supervisor',shifts:[]}]);
  assert.equal(roster.length,3);assert.deepEqual(roster.find(p=>p.id===1).departmentKeys,['fruits','pam']);assert.ok(roster.some(p=>p.name==='Badia'));
});
test('seven daily pages distinguish off, missing, blank and overnight carry-over; packet alternates by day',()=>{
  const roster=[{id:1,name:'Émile <test>',title:'Assistant',departmentKeys:['fruits']},{id:2,name:'Sana',title:'Gérante',departmentKeys:['boulangerie']}];
  const employee={id:1,days:DAY_NAMES.map((name,i)=>({name,date:addDays(week,i),entries:i===0?[{start:1320,end:1830,minutes:480,department:'Fruits & Légumes',departmentKeys:['fruits']}]:i===3?[{hours:'Congé',minutes:null}]:[]}))};
  const previous=structuredClone(employee);previous.days[6].entries=[{start:1320,end:1830,minutes:480,department:'Fruits & Légumes',departmentKeys:['fruits']}];
  const data=presenceWeek(week,roster,{employees:[employee],publications:[{key:'fruits',name:'Fruits & Légumes',published:true},{key:'boulangerie',name:'Boulangerie',published:false}]},{employees:[previous]});
  assert.equal(data.days[0].people[0].shifts.length,2);assert.equal(data.days[1].people[0].shifts[0].end,390);assert.equal(data.days[3].people[0].status,'Congé');assert.equal(data.days[2].people[0].status,'Aucun quart indiqué');assert.match(data.days[0].people[1].status,/non publié/);
  const pages=presencePages(data);assert.equal(pages.length,7);assert.match(pages[0],/Émile &lt;test&gt;/);assert.match(pages[0],/Depuis la veille/);assert.match(pages[0],/06:30 \+1/);assert.ok(pages.every(p=>p.includes('presence-box')||p.includes('Aucun quart indiqué')||p.includes('Congé')));
  const p=Array.from({length:7},(_,i)=>`P${i}`),r=p.map((_,i)=>`R${i}`);assert.equal(dailyPacket(p,r),'P0R0P1R1P2R2P3R3P4R4P5R5P6R6');assert.equal(dailyPacket(p,r,{mode:'presence',day:'2'}),'R2');assert.equal(dailyPacket(p,r,{mode:'planogram',day:'all'}),p.join(''));
});
test('attendance API protects all-store data, returns only leaders and published departments, and leaves consultations intact',async()=>{
  const f=await departmentFixture(),app=express();app.use(express.json());
  const auth=await installManagerAccess(app,f.pool,{readSession:q=>JSON.parse(q.headers['x-test-session']||'null'),issueSession:JSON.stringify,sameOrigin:(_q,_r,n)=>n(),production:false,credentialSecret:'test-presences'});
  const guard=async(q,r,n)=>{try{await auth.authorize(q);n();}catch(e){r.status(e.status||500).json({error:e.message});}};
  const path='/api/weeks/:week/leadership-presence';app.get(path,guard,f.routes.get('get '+path).at(-1));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const call=async(session={role:'manager'},date=week)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/weeks/${date}/leadership-presence`,{headers:session?{'x-test-session':JSON.stringify(session)}:{}});return {status:r.status,body:await r.json()};};
  try{
    const serviceId=Number((await f.pool.query("INSERT INTO schedule_employees(name,area,role) VALUES('Superviseure Service','front','supervisor') RETURNING id")).rows[0].id);
    const meta=(await f.call('get','/api/departments/meta')).body,dept=k=>meta.departments.find(d=>d.key===k);
    async function person(name,title,key){return (await f.call('post','/api/departments/people',{body:{name,jobTitle:title,group:'regular',active:true,departments:[dept(key).id],availability:{},email:'private@example.com',sourceNote:'Secret'}})).body.id;}
    const leader=await person('Gérante Fruits','Gérante','fruits'),clerk=await person('Commis Fruits','Commis','fruits'),missing=await person('Gérant Viande','Gérant','viande');
    const cells=Array.from({length:7},(_,i)=>i===0?{kind:'shift',start:420,end:960,breakMinutes:60,note:'Note privée'}:blankCell());
    for(const [key,ids,pub] of [['fruits',[leader,clerk],true],['viande',[missing],false]]){const draft=JSON.stringify({rows:ids.map(personId=>({personId,name:'Test',cells})),notes:'Notes privées'});await f.pool.query('INSERT INTO schedule_department_weeks(department_id,week_start,draft,published) VALUES($1,$2,$3,$4)',[dept(key).id,week,draft,pub?draft:null]);}
    await f.pool.query('INSERT INTO schedule_weeks(week_start) VALUES($1)',[week]);const shift=(await f.pool.query("INSERT INTO schedule_shifts(week_start,area,role,day_index,start_minute,end_minute) VALUES($1,'front','supervisor',0,480,1020) RETURNING id",[week])).rows[0].id;await f.pool.query('INSERT INTO schedule_assignments(shift_id,employee_id) VALUES($1,$2)',[shift,serviceId]);
    const account=async key=>{const id=(await f.pool.query("INSERT INTO schedule_manager_accounts(name,login,password_hash,departments) VALUES($1,$1,'unused',$2) RETURNING id",[key,JSON.stringify([dept(key).id])])).rows[0].id;return {role:'manager',accountId:Number(id),accountVersion:1};};
    assert.equal((await call(null)).status,401);assert.equal((await call(await account('fruits'))).status,403);
    const serviceResponse=await call(await account('service'));assert.equal(serviceResponse.status,200,JSON.stringify(serviceResponse.body));assert.equal(serviceResponse.body.days.length,7);
    const data=(await call()).body;assert.equal(data.days[0].people.length,3);assert.equal(data.days[0].people.find(p=>p.id===leader).shifts.length,1);assert.equal(data.days[0].people.find(p=>p.id===missing).shifts.length,0);assert.ok(data.days[0].people.some(p=>p.name==='Superviseure Service'&&p.shifts.length));
    assert.doesNotMatch(JSON.stringify(data),/Commis Fruits|private@example|Note privée|Notes privées|Secret/);assert.equal((await f.pool.query('SELECT * FROM schedule_department_views')).rows.length,0);assert.equal((await f.pool.query('SELECT * FROM schedule_schedule_views')).rows.length,0);assert.equal((await call(undefined,'2026-10-20')).status,400);
  }finally{await new Promise(r=>server.close(r));await f.db.close();}
});
