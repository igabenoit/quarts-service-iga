import test from 'node:test';
import assert from 'node:assert/strict';
import {storeSelection,groupDepartmentEntries} from '../public/store-portal-core.js';
import {DAY_NAMES,addDays} from '../public/departments-core.js';

const week='2026-10-12';
const publications=[{key:'boulangerie',name:'Boulangerie',published:true},{key:'fruits',name:'Fruits & Légumes',published:true},{key:'service',name:'Service',published:true}];
const shift=(key,start=420,extra={})=>({departmentKeys:[key],department:publications.find(d=>d.key===key)?.name||key,start,minutes:480,hours:'07:00 – 16:00',...extra});
const person=(id,name,department,entries)=>({id,name,departmentKeys:[department],published:true,days:DAY_NAMES.map((name,i)=>({name,date:addDays(week,i),entries:i===6?entries:[]}))});

test('store groups keep a department together despite mixed employees and start times',()=>{
  const data={weekStart:week,publications,employees:[person(1,'Alice','service',[shift('service')]),person(2,'Béatrice','boulangerie',[shift('boulangerie',540)]),person(3,'Claire','fruits',[shift('fruits')]),person(4,'Zoé','boulangerie',[shift('boulangerie')])]};
  const result=storeSelection(data),groups=result.days[6].groups;
  assert.deepEqual(groups.map(g=>g.key),['boulangerie','fruits','service']);
  assert.deepEqual(groups[0].entries.map(e=>e.personName),['Zoé','Béatrice']);
  assert.equal(groups[0].count,2);assert.equal(groups[0].minutes,960);
  assert.equal(result.count,4);assert.equal(result.minutes,1920);
  assert.equal(groups.flatMap(g=>g.entries).length,4);
});

test('groups use the department worked and preserve filters and complete employee schedules',()=>{
  const data={weekStart:week,publications,employees:[person(1,'Camille','boulangerie',[shift('fruits'),shift('service',1020)]),person(2,'Béatrice','boulangerie',[shift('boulangerie')])]};
  assert.deepEqual(storeSelection(data,{search:'camille'}).days[6].groups.map(g=>g.key),['fruits','service']);
  const filtered=storeSelection(data,{department:'fruits'});assert.equal(filtered.count,1);assert.equal(filtered.days[6].groups[0].name,'Fruits & Légumes');
  const personal=storeSelection(data,{department:'fruits',personId:1});assert.equal(personal.count,2);assert.equal(personal.selected.name,'Camille');
});

test('shared department shifts appear only once and empty days have no groups',()=>{
  const entry=shift('boulangerie',420,{departmentKeys:['service','boulangerie'],department:'Boulangerie / Service'});
  const groups=groupDepartmentEntries([entry],publications);
  assert.equal(groups.length,1);assert.equal(groups[0].key,'boulangerie|service');assert.equal(groups[0].name,'Boulangerie / Service');
  assert.equal(groups[0].count,1);assert.equal(groups[0].minutes,480);
  assert.deepEqual(groupDepartmentEntries([],publications),[]);
});
