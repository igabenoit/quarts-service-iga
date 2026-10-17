import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {leadershipRoster,presenceWeek,presencePages} from '../public/leadership-presence-core.js';

const departments=[{id:1,key:'administration',name:'Administration',published:true},{id:6,key:'boulangerie',name:'Boulangerie',published:true},{id:7,key:'service',name:'Service',published:true}];
const names=['Cassandra Benoit','Dany Exemple','Martine Exemple','Nicole Exemple','Lyne Michaud','Mouna Exemple','Marc-André Benoit','Responsable boulangerie','Responsable Service','En congé','Lyne Autre'];
const people=names.map((name,i)=>({id:i+1,name,active:true,jobTitle:'Gérant',departments:[i===7?6:i===8?7:1]}));
const roster=leadershipRoster(people,departments,[]);
const current={publications:departments,employees:people.map(p=>({id:p.id,days:Array.from({length:7},(_,day)=>({entries:day===0?[p.name==='En congé'?{hours:'Congé',minutes:null,start:null,end:null}:{start:420,end:960,minutes:480,department:departments.find(d=>d.id===p.departments[0]).name,departmentKeys:[departments.find(d=>d.id===p.departments[0]).key]}]:[]}))}))};
const week=presenceWeek('2026-10-19',roster,current);
const page=presencePages(week)[0];

test('exclude only the named people from presence roster and rendered pages',()=>{
  for(const name of names.slice(0,6)){assert.ok(!roster.some(p=>p.name===name));assert.ok(!page.includes(name));}
  assert.ok(page.includes('Lyne Autre'));
  const legacy={...week,days:[{...week.days[0],people:[...week.days[0].people,{name:'Cassandra Benoit',departmentKeys:['service'],title:'Gérante',shifts:[{start:420,end:960,departmentKeys:['service']}]}]}]};
  assert.ok(!presencePages(legacy)[0].includes('Cassandra'));
});
test('Marc-André is present only when scheduled and has no printed times',()=>{
  const row=page.match(/<tr class="presence-row"><td[^]*?Marc-André[^]*?<\/tr>/)?.[0].split('<tr class="presence-row">').at(-1);
  assert.ok(row);assert.match(row,/Présent/);assert.doesNotMatch(row,/07:00|16:00/);
  assert.ok(!presencePages(week)[1].includes('Marc-André'));
});
test('omit off and unscheduled rows, count visible people and separate departments',()=>{
  assert.ok(!page.includes('En congé'));assert.match(page,/4 personne\(s\) prévue\(s\)/);
  assert.equal((page.match(/class="presence-department-gap"/g)||[]).length,2);
  assert.match(page,/07:00 – 16:00/);
  assert.match(presencePages(week)[1],/Aucun responsable prévu en magasin/);
});
test('overnight presence continues on the next day',()=>{
  const person=roster.find(p=>p.name==='Responsable Service');
  const overnight={publications:departments,employees:[{id:person.id,days:Array.from({length:7},(_,day)=>({entries:day===0?[{start:1320,end:1560,minutes:240,department:'Service',departmentKeys:['service']}]:[]}))}]};
  const pages=presencePages(presenceWeek('2026-10-19',[person],overnight));
  assert.match(pages[1],/00:00 – 02:00/);assert.match(pages[1],/Depuis la veille/);
});

if(process.env.WRITE_PRESENCE_FIXTURE)writeFileSync('public/presence-preview.html',`<!doctype html><html lang="fr"><meta charset="utf-8"><link rel="stylesheet" href="leadership-presence.css"><body>${page}</body></html>`);
