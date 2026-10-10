import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {normalizeAvailability,minimumEffectiveDate,appendAvailability,profileAt,employeeAvailability,localDate} from '../availability-rules.js';
import {installLeave} from '../leave.js';
import {installUndoSchema,undoLast} from '../undo.js';
import {availabilityConflicts,availabilityRevision,recordManualAvailability} from '../availability.js';
import {installAvailabilityMail,availabilityMailPayload} from '../availability-mail.js';
import {loadContactDirectory} from '../employee-contacts.js';
import {assignmentConflict,generateAssignments} from '../scheduler.js';
import {addDays} from '../leave-rules.js';

const grid=()=>({0:[],1:[[1020,1290]],2:[],3:[[1020,1290]],4:[],5:[[450,1290]],6:[[450,1290]]});
const body=(extra={})=>({submissionKey:randomUUID(),employeeId:1,employeeName:'Camille Exemple',email:'camille@example.com',effectiveDate:'2030-01-14',targetMinutes:1020,availability:grid(),acknowledged:true,comments:'',...extra});
const baseline=()=>Object.fromEntries(Array.from({length:7},(_,d)=>[d,[[480,1020]]]));
const response=()=>({code:200,body:null,set(){return this;},status(n){this.code=n;return this;},json(b){this.body=b;return this;}});

test('règles : champs obligatoires, journées fixes, deux soirs entiers et jeudi/vendredi',()=>{
 const valid=body();assert.equal(normalizeAvailability(valid,{today:'2030-01-01'}).targetMinutes,1020);
 for(const [change,pattern] of [[{effectiveDate:''},/date effective/],[{effectiveDate:'2029-12-31'},/date effective/],[{effectiveDate:'2030-02-30'},/date effective/],[{targetMinutes:0},/heures souhaitées/],[{targetMinutes:1019},/heures souhaitées/],[{targetMinutes:'1020'},/heures souhaitées/],[{employeeName:''},/nom complet/],[{email:'a@'},/courriel/],[{acknowledged:false},/cocher/],[{acknowledged:'true'},/cocher/]])assert.throws(()=>normalizeAvailability({...valid,...change},{today:'2030-01-01'}),pattern);
 const changed=structuredClone(valid);delete changed.availability[0];assert.throws(()=>normalizeAvailability(changed,{today:'2030-01-01'}),/chaque jour/);
 for(const day of [5,6]){const b=body();b.availability[day]=[];assert.throws(()=>normalizeAvailability(b,{today:'2030-01-01'}),/samedi et le dimanche/);}
 const late=body();late.availability[1]=[[1035,1290]];assert.throws(()=>normalizeAvailability(late,{today:'2030-01-01'}),/deux soirs/);
 const short=body();short.availability[1]=[[1020,1275]];assert.throws(()=>normalizeAvailability(short,{today:'2030-01-01'}),/deux soirs/);
 const noFriday=body();noFriday.availability[0]=[[1020,1290]];noFriday.availability[3]=[];assert.throws(()=>normalizeAvailability(noFriday,{today:'2030-01-01'}),/jeudi ou le vendredi/);
 const earlier=body();earlier.availability[1]=[[450,1290]];assert.doesNotThrow(()=>normalizeAvailability(earlier,{today:'2030-01-01'}));
 assert.throws(()=>normalizeAvailability(body({targetMinutes:1200}),{today:'2030-01-01',maxMinutes:1020}),/17 h/);
});

test('dates : 28 jours calendaires, changement d’année et d’heure, disponibilité exacte par jour',()=>{
 const row={availability:baseline(),target_minutes:900};row.availability_history=appendAvailability(row,{effectiveDate:'2030-01-16',availability:grid(),targetMinutes:1020,source:'request',requestId:'1'});
 assert.equal(minimumEffectiveDate(row,'2030-01-01'),'2030-02-13');assert.equal(minimumEffectiveDate(row,'2030-03-01'),'2030-03-01');
 assert.deepEqual(profileAt(row,'2030-01-15').availability,baseline());assert.deepEqual(profileAt(row,'2030-01-16').availability,grid());
 assert.notEqual(availabilityRevision(row,'2030-01-15'),availabilityRevision(row,'2030-01-16'));
 const mixed=employeeAvailability(row,{date:'2030-01-01',weekStart:'2030-01-14'});
 assert.deepEqual(mixed.availability[1],[[480,1020]]);assert.deepEqual(mixed.availability[2],[]);assert.deepEqual(mixed.availability[3],[[1020,1290]]);assert.equal(mixed.targetMinutes,1020);assert.equal(mixed.profileTargetMinutes,900);
 row.availability_history.push({effectiveDate:'2030-12-20',source:'request'});assert.equal(minimumEffectiveDate(row,'2030-12-20'),'2031-01-17');
 assert.equal(localDate('2026-11-01T03:30:00Z'),'2026-10-31');
 const next={availability_history:[{source:'request',effectiveDate:'2026-10-18'}]};assert.equal(minimumEffectiveDate(next,'2026-10-19'),'2026-11-15');
});

test('génération et attribution respectent la version de la semaine sans déplacer les affectations',()=>{
 const row={availability:baseline(),target_minutes:900};row.availability_history=appendAvailability(row,{effectiveDate:'2030-01-16',availability:grid(),targetMinutes:1020,source:'request'});
 const person={id:1,role:'cashier',roles:['cashier'],active:true,maxMinutes:2400,seniority:'2020-01-01',...employeeAvailability(row,{weekStart:'2030-01-14'})};
 const shifts=[{id:1,weekStart:'2030-01-14',dayIndex:1,startMinute:480,endMinute:960,paidMinutes:480,role:'cashier'},{id:2,weekStart:'2030-01-14',dayIndex:3,startMinute:480,endMinute:960,paidMinutes:480,role:'cashier'},{id:3,weekStart:'2030-01-14',dayIndex:3,startMinute:1020,endMinute:1290,paidMinutes:270,role:'cashier'}];
 assert.equal(assignmentConflict(person,shifts[0],shifts,[]),null);assert.match(assignmentConflict(person,shifts[1],shifts,[]),/disponibilités/);assert.equal(assignmentConflict(person,shifts[2],shifts,[]),null);
 assert.deepEqual(generateAssignments(shifts,[person]).assignments.map(a=>a.shiftId).sort(),[1,3]);
 const existing=[{shiftId:2,employeeId:1}],before=structuredClone(existing);generateAssignments(shifts,[person],existing);assert.deepEqual(existing,before);
});

test('PostgreSQL : demandes, approbation future, délai, conflits conservés, annulation et courriels',async t=>{
 const db=new PGlite(),pool={query:async(sql,args)=>args?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};pool.connect=async()=>pool;
 const previousKey=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='';
 try{
  const source=readFileSync(new URL('../server.js',import.meta.url),'utf8'),ddl=source.slice(source.indexOf('await pool.query(`'),source.indexOf('app.disable('));
  await new Function('pool','return (async()=>{'+ddl+'})();')(pool);
  const routes=new Map(),app={use(){}};for(const verb of ['get','post','put','patch'])app[verb]=(path,...handlers)=>routes.set(verb+' '+path,handlers);
  const manager=()=>{},origin=()=>{},interval=globalThis.setInterval;globalThis.setInterval=()=>({unref(){}});
  try{await installLeave(app,pool,{requireManager:manager,sameOrigin:origin,hasStaffAccess:()=>false});}finally{globalThis.setInterval=interval;}
  await installUndoSchema(pool);
  await pool.query("INSERT INTO schedule_employees(id,name,role,area,target_minutes,max_minutes,availability) VALUES(1,'Camille Exemple','cashier','front',900,2400,$1::jsonb),(2,'Autre Exemple','cashier','front',900,2400,$1::jsonb)",[JSON.stringify(baseline())]);
  const today=localDate((await pool.query('SELECT clock_timestamp() AS now')).rows[0].now);let effective=addDays(today,14);while(new Date(effective+'T12:00Z').getUTCDay()!==1)effective=addDays(effective,1);
  await pool.query('INSERT INTO schedule_weeks(week_start) VALUES($1)',[effective]);
  await pool.query("INSERT INTO schedule_shifts(id,week_start,area,role,day_index,start_minute,end_minute) VALUES(1,$1,'front','cashier',1,480,960),(2,$1,'front','cashier',3,480,960)",[effective]);
  await pool.query('INSERT INTO schedule_assignments(shift_id,employee_id) VALUES(1,1),(2,2)');
  const base='/api/leave/availability',call=async(method,path,req={})=>{const res=response();await routes.get(method+' '+base+path).at(-1)({headers:{},query:{},...req},res);return res;};
  const employee=async()=>(await pool.query('SELECT * FROM schedule_employees WHERE id=1')).rows[0];
  const request=body({effectiveDate:effective});let id;
  await t.test('autorisation, validation serveur et envoi idempotent sans modification de fiche',async()=>{
   assert.equal(routes.get('get '+base+'/requests')[0],manager);assert.equal(routes.get('patch '+base+'/requests/:id')[1],origin);assert.equal(routes.get('post '+base+'/submit')[1],origin);
   for(const bad of [{...request,acknowledged:false},{...request,employeeName:'Autre Exemple'},{...request,availability:{...grid(),5:[]}}])assert.equal((await call('post','/submit',{body:bad})).code,400);
   const submitted=await call('post','/submit',{body:request});assert.equal(submitted.code,201,JSON.stringify(submitted.body));id=submitted.body.id;
   const again=await call('post','/submit',{body:request});assert.equal(again.body.id,id);
   assert.equal((await pool.query('SELECT * FROM schedule_availability_requests')).rows.length,1);assert.equal((await employee()).target_minutes,900);
   assert.equal((await call('post','/submit',{body:{...request,submissionKey:randomUUID()}})).code,400);
  });
  await t.test('approbation met à jour la fiche datée et préserve tous les quarts déjà attribués',async()=>{
   const approved=await call('patch','/requests/:id',{params:{id},body:{status:'approved',version:1}});assert.equal(approved.code,200,JSON.stringify(approved.body));
   const row=await employee();assert.equal(profileAt(row,today).targetMinutes,900);assert.equal(profileAt(row,effective).targetMinutes,1020);assert.equal(row.availability_history.length,2);
   assert.equal((await pool.query('SELECT * FROM schedule_assignments')).rows.length,2);
   const conflicts=await availabilityConflicts(pool,today);assert.deepEqual(conflicts.map(c=>c.shiftId),[1]);
   const list=await call('get','/requests');assert.equal(list.body.requests[0].confirmation_status,'pending');assert.equal(list.body.requests[0].currentProfile.targetMinutes,900);
   const contacts=await loadContactDirectory(pool);assert.equal(contacts.employees.find(e=>e.id===1).email,'camille@example.com');
   assert.equal((await call('patch','/requests/:id',{params:{id},body:{status:'approved',version:1}})).code,409);
  });
  await t.test('Annuler rétablit la fiche, le délai et la demande, tout en invalidant l’envoi',async()=>{
   const last=(await pool.query('SELECT MAX(id) AS id FROM schedule_undo_actions')).rows[0].id;await pool.query('BEGIN');await undoLast(pool,last);await pool.query('COMMIT');
   assert.deepEqual((await employee()).availability_history,[]);const r=(await pool.query('SELECT * FROM schedule_availability_requests WHERE id=$1',[id])).rows[0];assert.equal(r.status,'pending');assert.equal(r.version,3);
   const calls=[],worker=await installAvailabilityMail(pool,{autoStart:false,fetchImpl:async()=>{calls.push(1);throw new Error('must not send');}});
   process.env.RESEND_API_KEY='mock';await worker.run();process.env.RESEND_API_KEY='';
   assert.equal(calls.length,0);assert.equal((await pool.query("SELECT status FROM schedule_availability_mail WHERE kind='approved'")).rows[0].status,'cancelled');
   assert.equal((await call('patch','/requests/:id',{params:{id},body:{status:'approved',version:3}})).code,200);
  });
  await t.test('27 jours refusés, 28 jours acceptés; validation réappliquée à l’approbation',async()=>{
   const blocked=await call('post','/submit',{body:body({effectiveDate:addDays(effective,27)})});assert.equal(blocked.code,400);assert.match(blocked.body.error,/4 semaines/);
   const second=await call('post','/submit',{body:body({effectiveDate:addDays(effective,28),targetMinutes:1200})});assert.equal(second.code,201);
   await pool.query('UPDATE schedule_employees SET max_minutes=1020 WHERE id=1');
   const rejected=await call('patch','/requests/:id',{params:{id:second.body.id},body:{status:'approved',version:1}});assert.equal(rejected.code,409);assert.equal((await employee()).availability_history.length,2);
   await pool.query('UPDATE schedule_employees SET max_minutes=2400 WHERE id=1');
   assert.equal((await call('patch','/requests/:id',{params:{id:second.body.id},body:{status:'approved',version:1}})).code,200);
   assert.equal((await call('patch','/requests/:id',{params:{id},body:{status:'cancelled',version:4,note:'Annulation ancienne'}})).code,409);
   assert.equal((await call('patch','/requests/:id',{params:{id:second.body.id},body:{status:'cancelled',version:2,note:'Correction'}})).code,200);
   assert.equal((await employee()).availability_history.length,2);
  });
  await t.test('édition gestionnaire préserve une grille future et bloque une fiche périmée',async()=>{
   const row=await employee(),current=profileAt(row,today);
   await assert.rejects(recordManualAvailability(pool,row,{availability:current.availability,targetMinutes:current.targetMinutes},{availabilityRevision:'old'}),/Actualisez/);
   assert.deepEqual(await recordManualAvailability(pool,row,current,{availabilityRevision:availabilityRevision(row)}),row.availability_history);
   await assert.rejects(recordManualAvailability(pool,row,{availability:grid(),targetMinutes:1200},{availabilityRevision:availabilityRevision(row)}),/future/);
  });
  await t.test('notification, confirmation, reprise figée et mode test isolé',async()=>{
   const testBody=body({employeeId:0,employeeName:'Employé test',effectiveDate:effective,email:'never-send@example.com'});
   const fake=await call('post','/test-submit',{body:testBody});assert.equal(fake.code,201);assert.equal((await call('patch','/requests/:id',{params:{id:fake.body.id},body:{status:'approved',version:1}})).code,200);
   await pool.query("UPDATE schedule_leave_departments SET recipient='manager@example.com',mail_enabled=TRUE WHERE code='service'; UPDATE schedule_leave_mail_settings SET test_recipient='test@example.com',copy_recipient='director@example.com' WHERE id=1; UPDATE schedule_availability_mail SET available_at=clock_timestamp()-interval '1 minute';");
   const sent=[];let fail=true;
   const worker=await installAvailabilityMail(pool,{autoStart:false,fetchImpl:async(_url,options)=>{sent.push({headers:options.headers,body:options.body});if(fail)throw new Error('timeout');return {ok:true,status:200,json:async()=>({id:'simulated-'+sent.length})};}});
   process.env.RESEND_API_KEY='mock';await worker.run();const first=sent.map(x=>structuredClone(x));assert.ok(first.length>=4);
   await pool.query("UPDATE schedule_availability_mail SET last_attempt_at=clock_timestamp()-interval '3 minutes' WHERE status='error'; UPDATE schedule_leave_mail_settings SET copy_recipient='changed@example.com' WHERE id=1;");fail=false;sent.length=0;await worker.run();assert.deepEqual(sent,first);
   const payloads=sent.map(x=>JSON.parse(x.body));assert.ok(payloads.some(p=>p.to[0]==='camille@example.com'&&!p.cc));assert.ok(payloads.some(p=>p.to[0]==='manager@example.com'&&p.cc[0]==='director@example.com'));
   for(const p of payloads.filter(p=>p.subject.startsWith('[TEST]'))){assert.deepEqual(p.to,['test@example.com']);assert.equal(p.cc,undefined);assert.equal(p.reply_to,undefined);}
   const count=sent.length;await worker.run();assert.equal(sent.length,count);process.env.RESEND_API_KEY='';
   const requests=(await call('get','/requests')).body.requests;assert.equal(requests.some(r=>r.is_test),false);assert.equal((await pool.query('SELECT * FROM schedule_assignments')).rows.length,2);
  });
 }finally{if(previousKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=previousKey;await db.close();}
});
