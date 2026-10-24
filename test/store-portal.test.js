import {publishServiceWeek} from '../service-publication.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {departmentFixture} from './department-fixture.js';
import {installManagerAccess} from '../manager-access.js';
import * as core from '../public/departments-core.js';
import * as weeks from '../public/portal-weeks.js';
import {storeSelection} from '../public/store-portal-core.js';
import {scrollToToday} from '../public/portal-current-day.js';

const week='2026-10-19',cells=(values={})=>Array.from({length:7},(_,i)=>values[i]||core.blankCell());
const shift=(extra={})=>({kind:'shift',start:420,end:960,breakMinutes:60,note:'',...extra});

test('store portal: existing admin only, published Service and departments, shared identities, no consultations or secrets',async()=>{
  const f=await departmentFixture(),app=express();app.use(express.json());
  const access=await installManagerAccess(app,f.pool,{readSession:req=>JSON.parse(req.headers['x-test-session']||'null'),issueSession:JSON.stringify,sameOrigin:(_q,_s,next)=>next(),production:false,credentialSecret:'test-only-store-access'});
  const guard=async(req,res,next)=>{try{await access.authorize(req);next();}catch(error){res.status(error.status||500).json({error:error.message});}};
  for(const [key,handlers] of f.routes){const [method,path]=key.split(' ');if(path.startsWith('/api/store-portal'))app[method](path,guard,handlers.at(-1));}
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
  const call=async(path,session={role:'manager'})=>{const r=await fetch(base+path,{headers:session?{'x-test-session':JSON.stringify(session)}:{}});return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};};
  try{
    const serviceId=Number((await f.pool.query("INSERT INTO schedule_employees(name,area,role) VALUES('Camille Exemple','front','cashier') RETURNING id")).rows[0].id);
    const meta=(await f.call('get','/api/departments/meta')).body,dept=key=>meta.departments.find(d=>d.key===key);
    const owner=meta.people.find(p=>p.serviceEmployeeId===serviceId);
    await f.pool.query("UPDATE schedule_store_people SET employee_code='001234',email='private@example.com' WHERE id=$1",[owner.id]);
    async function person(name,keys,extra={}){return (await f.call('post','/api/departments/people',{body:{name,group:'regular',active:true,availability:{},departments:keys.map(k=>dept(k).id),...extra}})).body.id;}
    const alias=await person('Camille fiche Fruits',['fruits']),jo=await person('Johanne Exemple',['pam','charcuterie'],{buffetPamPriority:true}),night=await person('Employé Nuit',['epicerie']),privatePerson=await person('Brouillon uniquement',['viande']);
    await f.pool.query('UPDATE schedule_store_people SET portal_person_id=$1 WHERE id=$2',[owner.id,alias]);
    async function publish(key,rows,published=true){const value=JSON.stringify({rows,notes:'Team-private-note'});await f.pool.query('INSERT INTO schedule_department_weeks(department_id,week_start,draft,published,published_at) VALUES($1,$2,$3,$4,clock_timestamp())',[dept(key).id,week,value,published?value:null]);}
    const buffet={personId:jo,name:'Johanne Exemple',cells:cells(Object.fromEntries([0,1,2,3,4].map(i=>[i,shift({kind:'buffet'})])))};
    await publish('pam',[buffet]);await publish('charcuterie',[buffet]);
    await publish('fruits',[{personId:alias,name:'Camille fiche Fruits',cells:cells({0:shift({workDepartment:'pam'})})}]);
    await publish('epicerie',[{personId:night,name:'Employé Nuit',cells:cells({6:shift({start:1320,end:1830,breakMinutes:30,post:'night'})})}]);
    await publish('viande',[{personId:privatePerson,name:'Brouillon uniquement',cells:cells({0:shift()})}],false);
    await f.pool.query('INSERT INTO schedule_weeks(week_start) VALUES($1)',[week]);
    const sid=(await f.pool.query("INSERT INTO schedule_shifts(week_start,area,role,day_index,start_minute,end_minute) VALUES($1,'front','cashier',1,480,960) RETURNING id",[week])).rows[0].id;
    await f.pool.query('INSERT INTO schedule_assignments(shift_id,employee_id) VALUES($1,$2)',[sid,serviceId]);
    await f.pool.query("INSERT INTO schedule_public_links(week_start,token,access_code_hash) VALUES($1,$2,'legacy-secret')",[week,'x'.repeat(43)]);
    await publishServiceWeek(f.pool,week);
    const account=await fetch(base+'/api/manager-accounts',{method:'POST',headers:{'Content-Type':'application/json','x-test-session':JSON.stringify({role:'manager'})},body:JSON.stringify({name:'Gérant Fruits',login:'fruit.test',password:'Example-password-123',departments:[dept('fruits').id],active:true,personId:owner.id})});
    const a=(await account.json()).accounts[0];
    for(const path of ['/api/store-portal','/api/store-portal/weeks/'+week]){
      assert.equal((await call(path,null)).status,401);
      assert.equal((await call(path,{role:'manager',accountId:a.id,accountVersion:a.version,personVersion:1})).status,403);
    }
    const listing=await call('/api/store-portal');assert.equal(listing.status,200);assert.equal(listing.cache,'no-store');assert.equal(listing.body.departments.length,10);assert.ok(listing.body.departments.some(d=>d.key==='administration'));assert.deepEqual(listing.body.weeks,[week]);
    const before=(await f.pool.query('SELECT * FROM schedule_department_weeks ORDER BY department_id')).rows;
    const result=await call('/api/store-portal/weeks/'+week);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.cache,'no-store');
    const camille=result.body.employees.find(p=>p.id===owner.id);assert.equal(result.body.employees.some(p=>p.id===alias),false);assert.equal(camille.days[0].entries.length,1,'transfer only once');assert.equal(camille.days[1].entries[0].department,'Service');assert.equal(camille.days[1].entries[0].minutes,420);
    const johanne=result.body.employees.find(p=>p.id===jo);assert.equal(johanne.days.flatMap(d=>d.entries).length,5);assert.equal(johanne.days.flatMap(d=>d.entries).reduce((n,c)=>n+c.minutes,0),2400);assert.deepEqual(johanne.days[0].entries[0].departmentKeys,['pam']);assert.deepEqual(johanne.days[4].entries[0].departmentKeys,['charcuterie']);
    assert.match(result.body.employees.find(p=>p.id===night).days[6].entries[0].hours,/06:30 \+1/);
    assert.equal(result.body.employees.find(p=>p.id===privatePerson).published,false);assert.equal(result.body.publications.find(d=>d.key==='viande').published,false);
    for(const secret of ['001234','private@example.com','legacy-secret','Team-private-note','x'.repeat(43)])assert.ok(!JSON.stringify(result.body).includes(secret));
    assert.equal((await f.pool.query('SELECT * FROM schedule_department_views')).rows.length,0);assert.equal((await f.pool.query('SELECT * FROM schedule_schedule_views')).rows.length,0);
    assert.deepEqual((await f.pool.query('SELECT * FROM schedule_department_weeks ORDER BY department_id')).rows,before);
    assert.equal((await call('/api/store-portal/weeks/2026-10-20')).status,400);
    await f.pool.query('DELETE FROM schedule_public_links WHERE week_start=$1',[week]);
    assert.equal((await call('/api/store-portal/weeks/'+week)).body.employees.find(p=>p.id===owner.id).days[1].entries.length,0,'unpublished Service disappears');
  }finally{await new Promise(resolve=>server.close(resolve));await f.db.close();}
});

const data=start=>({today:'2026-10-14',weekStart:start,publications:[{key:'pam',name:'Prêt-à-manger',published:true}],employees:[{id:1,name:'Édouard <exemple>',departmentKeys:['pam','fruits'],published:true,days:core.DAY_NAMES.map((name,i)=>({name,date:core.addDays(start,i),entries:i===0?[{department:'Prêt-à-manger',departmentKeys:['pam'],hours:'07:00 – 16:00',detail:'Buffet',minutes:480,start:420}]:i===1?[{department:'Fruits & Légumes',departmentKeys:['fruits'],hours:'Congé',minutes:null}]:[]}))}]});
test('store filters: accent-insensitive names, work department, complete personal week and no duplicate totals',()=>{
  const d=data(week);assert.equal(storeSelection(d,{search:'edouard'}).count,1);assert.equal(storeSelection(d,{department:'fruits'}).count,0);assert.equal(storeSelection(d,{department:'pam'}).minutes,480);
  const personal=storeSelection(d,{department:'fruits',personId:1});assert.equal(personal.count,1);assert.equal(personal.days[1].entries[0].hours,'Congé');assert.equal(personal.selected.id,1);
});

function ui(){
  const scrolls=[],elements=new Map(),$=s=>{if(!elements.has(s))elements.set(s,{value:'',innerHTML:'',textContent:'',hidden:false,inert:false,setAttribute(k,v){this[k]=v;},getBoundingClientRect:()=>({height:150}),querySelector(){return this.innerHTML.includes(' is-today')?{style:{},scrollIntoView:options=>scrolls.push({selector:s,options})}:null;}});return elements.get(s);};
  const context=vm.createContext({...core,...weeks,storeSelection,scrollToToday,e:core.escapeHTML,console,fetch:async()=>{throw Error('Unexpected fetch');},document:{querySelector:$,querySelectorAll:()=>[]}});
  const source=readFileSync(new URL('../public/store-portal.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function startStorePortal','function startStorePortal');vm.runInContext(source,context);
  context.seed={today:'2026-10-14',departments:[{key:'pam',name:'Prêt-à-manger'}],weeks:['2026-10-12',week]};vm.runInContext("listing=seed;week='2026-10-12'",context);
  return {$,context,scrolls,run:s=>vm.runInContext(s,context),fetch:f=>context.fetch=f};
}
const response=(body,status=200)=>({ok:status<400,status,json:async()=>structuredClone(body)});

test('store portal opens on today and repositions only on reopening, current-week navigation or date change',async()=>{
  const f=ui();f.run('listing=null;week=null');f.context.seed.today='2026-10-18';
  f.fetch(async path=>response(path==='/api/store-portal'?f.context.seed:{...data(path.split('/').at(-1)),today:f.context.seed.today}));
  await f.run('load({reset:true})');assert.equal(f.scrolls.length,1);assert.equal(f.scrolls[0].selector,'#storeSchedule');
  assert.match(f.$('#storeSchedule').innerHTML,/<article class="store-day is-today"><header><div><h3>Dimanche/);
  await f.run('load()');f.run('render()');assert.equal(f.scrolls.length,1,'refresh and filters preserve reading position');
  await f.run("chooseWeek('2026-10-19')");assert.equal(f.scrolls.length,1);
  await f.run('load({reset:true})');assert.equal(f.scrolls.length,2);
  await f.run("chooseWeek('2026-10-19')");await f.run("chooseWeek('2026-10-12')");assert.equal(f.scrolls.length,3);
  f.context.seed.today='2026-10-19';await f.run('load()');assert.equal(f.scrolls.length,4);assert.match(f.$('#storeSchedule').innerHTML,/<article class="store-day is-today"><header><div><h3>Lundi/);
  f.fetch(async()=>response({error:'Indisponible'},500));await f.run('load({reset:true})');assert.equal(f.scrolls.length,4);
});
test('store UI ignores late week responses and clears data on errors; admin reads never post a consultation',async()=>{
  const f=ui(),paths=[];let release;const delayed=new Promise(r=>release=r);
  f.fetch(async(path,opts)=>{paths.push({path,opts});return path.endsWith('2026-10-12')?delayed:response(data(week));});
  const first=f.run('loadWeek()');await f.run("chooseWeek('2026-10-19')");release(response(data('2026-10-12')));await first;
  assert.match(f.$('#storeWeekBanner').innerHTML,/Semaine prochaine/);assert.match(f.$('#storeSchedule').innerHTML,/19 octobre/);assert.doesNotMatch(f.$('#storeSchedule').innerHTML,/<exemple>/);assert.match(f.$('#storeSchedule').innerHTML,/&lt;exemple&gt;/);
  assert.ok(paths.every(p=>!p.path.endsWith('/views')&&!p.opts?.method));
  f.fetch(async()=>response(data('2026-10-12')));await f.run('loadWeek()');assert.equal(f.$('#storeSchedule').innerHTML,'');assert.match(f.$('#status').textContent,/ne correspond pas/);
  f.fetch(async()=>response({error:'Reconnectez-vous'},401));await f.run('loadWeek()');assert.equal(f.$('#storeContent').hidden,true);assert.equal(f.$('#adminSignIn').hidden,false);
});
test('store UI starts on current week, preserves manual refresh and resets on week rollover',async()=>{
  const f=ui();f.fetch(async path=>response(path==='/api/store-portal'?f.context.seed:data(path.split('/').at(-1))));
  await f.run('load({reset:true})');assert.equal(f.run('week'),'2026-10-12');await f.run("chooseWeek('2026-10-19')");await f.run('load()');assert.equal(f.run('week'),week);
  await f.run('load({reset:true})');assert.equal(f.run('week'),'2026-10-12');f.context.seed.today='2026-10-19';await f.run('load()');assert.equal(f.run('week'),week);
});
