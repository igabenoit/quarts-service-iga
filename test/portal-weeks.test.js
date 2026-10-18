import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import crypto from 'node:crypto';
import * as core from '../public/departments-core.js';
import * as weeks from '../public/portal-weeks.js';
import {scrollToToday} from '../public/portal-current-day.js';
import {departmentFixture} from './department-fixture.js';
const response=(body,status=200)=>({ok:status<400,status,json:async()=>structuredClone(body)});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const item=weekStart=>({departmentId:1,name:'Fruits & Légumes',weekStart});
const published=weekStart=>({department:{key:'fruits',name:'Fruits & Légumes'},weekStart,schedule:{rows:[{name:'Camille Exemple',cells:[{kind:'shift',start:1320,end:1830,breakMinutes:30,post:'night'},...Array.from({length:6},core.blankCell)]}]}});
function fixture(){
 const elements=new Map(),events={},scrolls=[];
 const $=s=>{if(!elements.has(s))elements.set(s,{value:'',innerHTML:'',textContent:'',hidden:false,inert:false,setAttribute(k,v){this[k]=v;},getBoundingClientRect:()=>({height:150}),querySelector(){return this.innerHTML.includes(' is-today')?{style:{},scrollIntoView:options=>scrolls.push({selector:s,options})}:null;}});return elements.get(s);};
 const context=vm.createContext({...core,...weeks,scrollToToday,e:core.escapeHTML,console,setInterval(){},fetch:async()=>{throw Error('Unexpected fetch');},window:{addEventListener(k,f){events[k]=f;}},document:{querySelector:$,visibilityState:'visible',addEventListener(k,f){events[k]=f;}}});
 const source=readFileSync(new URL('../public/horaires-departements.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\r?\nload\(\);\s*$/,'');
 vm.runInContext(source,context);
 return {$,events,context,scrolls,run:s=>vm.runInContext(s,context),fetch:f=>context.fetch=f};
}
const listing=(today='2026-10-14')=>({today,employeeName:'Camille Exemple',schedules:[item('2026-10-12'),item('2026-10-19')],service:[]});

test('personal portal opens on today, preserves manual browsing and returns to today on reopening or date change',async()=>{
 const f=fixture();let date='2026-10-18';
 f.fetch(async path=>response(path.endsWith('department-schedules')?listing(date):published(path.split('/').at(-1))));
 await f.run('load()');assert.equal(f.scrolls.length,1);assert.equal(f.scrolls[0].selector,'#personalSchedule');
 assert.match(f.$('#personalSchedule').innerHTML,/<article class="portal-day is-today"><header><h3>Dimanche/);
 await f.run('load()');assert.equal(f.scrolls.length,1,'manual refresh does not move the reader');
 await f.run("chooseWeek('2026-10-19')");assert.equal(f.scrolls.length,1,'future week does not jump to a day');
 await f.run('load({reset:true})');assert.equal(f.scrolls.length,2,'reopening returns to today');
 await f.run("chooseWeek('2026-10-19')");await f.run("chooseWeek('2026-10-12')");assert.equal(f.scrolls.length,3,'returning to current week shows today');
 date='2026-10-19';await f.run('load()');assert.equal(f.scrolls.length,4);assert.match(f.$('#personalSchedule').innerHTML,/<article class="portal-day is-today"><header><h3>Lundi/);
 f.fetch(async()=>{throw Error('Hors connexion');});await f.run('load({reset:true})');assert.equal(f.scrolls.length,4,'errors do not scroll to stale content');
});
test('current week always opens, including when only a future publication exists',async()=>{
 const f=fixture();f.fetch(async()=>response({...listing(),schedules:[item('2026-10-19')]}));await f.run('load()');
 assert.equal(f.run('week'),'2026-10-12');assert.match(f.$('#weekBanner').innerHTML,/Cette semaine/);assert.match(f.$('#personalSchedule').innerHTML,/pas encore publié/);assert.match(f.$('#personalSchedule').innerHTML,/ne signifie pas.*congé/);
});
test('manual refresh retains deliberate week; reopening and Monday rollover reset to current',async()=>{
 const f=fixture();let data=listing();f.fetch(async path=>response(path.endsWith('department-schedules')?data:published(path.split('/').at(-1))));await f.run('load()');await f.run("chooseWeek('2026-10-19')");await f.run('load()');assert.equal(f.run('week'),'2026-10-19');
 await f.run('load({reset:true})');assert.equal(f.run('week'),'2026-10-12');data=listing('2026-10-19');await f.run('load()');assert.equal(f.run('week'),'2026-10-19');assert.match(f.$('#weekBanner').innerHTML,/Cette semaine/);
});
test('a late response cannot put the previous week under the new week banner',async()=>{
 const f=fixture(),slow=deferred();f.context.seed=listing();f.run("listing=seed;week='2026-10-12'");f.fetch(async path=>path.endsWith('2026-10-12')?slow.promise:response(published('2026-10-19')));
 const first=f.run('loadSchedule()');await f.run("chooseWeek('2026-10-19')");slow.resolve(response(published('2026-10-12')));await first;
 assert.match(f.$('#personalSchedule').innerHTML,/19 octobre/);assert.doesNotMatch(f.$('#personalSchedule').innerHTML,/12 octobre/);assert.match(f.$('#weekBanner').innerHTML,/Semaine prochaine/);
});
test('failed refresh and wrong-week payload clear displayed shifts instead of retaining stale data',async()=>{
 const f=fixture();f.fetch(async path=>response(path.endsWith('department-schedules')?listing():published('2026-10-12')));await f.run('load()');assert.match(f.$('#personalSchedule').innerHTML,/22:00/);
 f.fetch(async()=>{throw Error('Hors connexion');});await f.run('load()');assert.equal(f.$('#personalSchedule').innerHTML,'');assert.match(f.$('#status').textContent,/Hors connexion/);
 f.fetch(async()=>response(published('2026-10-19')));await f.run("chooseWeek('2026-10-19')");assert.equal(f.$('#weekBanner').hidden,false);assert.match(f.$('#weekBanner').innerHTML,/Semaine prochaine/);
 f.run("week='2026-10-12'");
 f.fetch(async()=>response(published('2026-10-19')));await f.run('loadSchedule()');assert.equal(f.$('#personalSchedule').innerHTML,'');assert.match(f.$('#status').textContent,/ne correspond pas/);
});
test('all departments and Service are loaded only for the selected week; partial failures show no incomplete schedule',async()=>{
 const f=fixture(),paths=[];const list={...listing(),service:[{weekStart:'2026-10-12',path:'/h/current'},{weekStart:'2026-10-19',path:'/h/next'}]};
 f.fetch(async path=>{paths.push(path);if(path.endsWith('/views'))return response({ok:true});return response(path.endsWith('department-schedules')?list:path.includes('/public-schedules/')?{weekStart:'2026-10-12',employees:[{shifts:[{dayIndex:2,startMinute:600,endMinute:900,breakMinutes:0,role:'cashier'}]}]}:published('2026-10-12'));});
 await f.run('load()');assert.match(f.$('#personalSchedule').innerHTML,/Service/);assert.match(f.$('#personalSchedule').innerHTML,/Fruits/);assert.ok(!paths.some(p=>p.includes('next')||p.includes('2026-10-19')));
 f.fetch(async path=>path.includes('/public-schedules/')?response({error:'Service indisponible'},500):response(published('2026-10-12')));await f.run('loadSchedule()');assert.equal(f.$('#personalSchedule').innerHTML,'');
});
test('week labels stay correct at year change, leap days and DST',()=>{
 assert.equal(weeks.weekInfo('2026-12-28','2027-01-01').kind,'current');assert.equal(weeks.weekInfo('2027-01-04','2027-01-01').kind,'next');assert.equal(weeks.weekInfo('2026-10-05','2026-10-14').kind,'past');
 assert.match(weeks.weekRange('2026-12-28'),/28 décembre 2026 au 3 janvier 2027/);assert.equal(weeks.weekInfo('2026-10-26','2026-11-01').kind,'current');assert.equal(weeks.weekInfo('2028-02-28','2028-02-29').kind,'current');
});
test('transferred shifts appear once, night has 30 minute break, and returned weeks must match',()=>{
 const source=published('2026-10-12');source.schedule.rows[0].cells[0].workDepartment='pam';const target=structuredClone(source);target.department={key:'pam',name:'Prêt-à-manger'};target.schedule.rows[0].cells[0].sourceDepartment='fruits';
 const days=weeks.personalDays(source.weekStart,[{kind:'department',data:source},{kind:'department',data:target}]);assert.equal(days[0].entries.length,1);assert.equal(days[0].entries[0].minutes,480);assert.match(days[0].entries[0].hours,/06:30 \+1/);assert.equal(days[0].entries[0].department,'Prêt-à-manger');
 assert.throws(()=>weeks.personalDays('2026-10-19',[{kind:'department',data:source}]),/semaine/);
});
test('Service publication needs no shared code and keeps existing links and credentials unchanged',async()=>{
 const f=await departmentFixture();try{
  const source=readFileSync(new URL('../server.js',import.meta.url),'utf8'),start=source.indexOf('async (request, response) => {',source.indexOf('app.put("/api/weeks/:weekStart/share-link"')),end=source.indexOf('\n});',start);
  const ensureWeek=week=>f.pool.query('INSERT INTO schedule_weeks(week_start) VALUES($1) ON CONFLICT DO NOTHING',[week]);
  const handler=new Function('pool','crypto','validDate','ensureWeek','return ('+source.slice(start,end)+'\n});')(f.pool,crypto,core.isDate,ensureWeek);
  const reply=()=>({code:200,status(n){this.code=n;return this;},set(){return this;},json(body){this.body=body;return this;}});
  let res=reply();await handler({params:{weekStart:'2026-10-12'},body:{}},res);assert.equal(res.code,200);const path=res.body.path;
  await f.pool.query("UPDATE schedule_public_links SET access_code_hash='previous-hash'");res=reply();await handler({params:{weekStart:'2026-10-12'},body:{}},res);assert.equal(res.body.path,path);assert.equal((await f.pool.query('SELECT access_code_hash FROM schedule_public_links')).rows[0].access_code_hash,'previous-hash');
 }finally{await f.db.close();}
});
