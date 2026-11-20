import test from 'node:test';
import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';

test('deux magasins publient et retirent indépendamment leur horaire du même lundi',async()=>{
  const f=await liveAppFixture(),week='2027-01-04',sheet='/api/weeks/'+week;
  try{
    const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r;};
    const admin=ok(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
    const read=async store=>ok(await f.call('GET',sheet,{cookie:admin,headers:{'X-Service-Store':store}})).body;
    const publish=async(store,method,revision)=>ok(await f.call(method,sheet+'/share-link',{cookie:admin,
      headers:{'X-Service-Week':week,'X-Service-Store':store,'X-Service-Revision':revision}})).body.path;
    const employees={},links={},revisions={},times={A:480,B:720};
    for(const store of ['A','B']){
      await f.query('INSERT INTO schedule_stores(id) VALUES($1)',[store]);
      const id=(await f.query("INSERT INTO schedule_employees(store_id,name,area,role) VALUES($1,$2,'front','cashier') RETURNING id",[store,'Fictif '+store])).rows[0].id;
      const code=store==='A'?'304001':'304002';
      await f.query('INSERT INTO schedule_store_people(name,employee_code,service_employee_id) VALUES($1,$2,$3)',['Fictif '+store,code,id]);
      await f.query('INSERT INTO schedule_weeks(week_start,store_id) VALUES($1,$2)',[week,store]);
      const shift=(await f.query("INSERT INTO schedule_shifts(week_start,store_id,area,role,day_index,start_minute,end_minute) VALUES($1,$2,'front','cashier',0,$3,1020) RETURNING id",[week,store,times[store]])).rows[0].id;
      await f.query('INSERT INTO schedule_assignments(shift_id,employee_id) VALUES($1,$2)',[shift,id]);
      employees[store]=ok(await f.call('POST','/api/employee-portal/access',{body:{code}})).cookie;
      revisions[store]=(await read(store)).revision;
    }
    for(const store of ['A','B'])links[store]=await publish(store,'PUT',revisions[store]);
    assert.notEqual(links.A,links.B);
    const detail=(cookie,path)=>f.call('GET','/api/public-schedules/'+path.split('/').pop(),{cookie});
    for(const [own,other] of [['A','B'],['B','A']]){
      const schedules=ok(await f.call('GET','/api/leave/department-schedules',{cookie:employees[own]})).body.service;
      assert.deepEqual(schedules.filter(s=>s.weekStart===week).map(s=>s.path),[links[own]]);
      const ownPeople=ok(await detail(employees[own],links[own])).body.employees;
      assert.deepEqual(ownPeople.map(p=>p.name),['Fictif '+own]);
      assert.deepEqual(ownPeople[0].shifts.map(s=>s.startMinute),[times[own]]);
      assert.equal((await detail(employees[own],links[other])).status,404);
    }
    const before=await read('A');
    await publish('B','DELETE',(await read('B')).revision);
    assert.equal((await detail(employees.B,links.B)).status,404);
    assert.equal((await read('A')).revision,before.revision);
    ok(await detail(employees.A,links.A));
  }finally{await f.close();}
});
