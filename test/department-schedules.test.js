import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentFixture} from './department-fixture.js';
import {installDepartmentSchedules} from '../department-schedules.js';
import {beginUndo,undoLast} from '../undo.js';
import {validateCandidate,validatePhoto,transcribePhoto} from '../department-photo.js';
import {blankCell,totalMinutes,tenure,normalizeAvailability,sheetHTML,DEPARTMENT_STYLES,draftWarnings} from '../public/departments-core.js';
const start='2030-10-14',shift={kind:'shift',start:480,end:960,breakMinutes:30,note:''},cells=()=>[shift,...Array.from({length:6},blankCell)];
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ3sAAAAASUVORK5CYII=';
const candidate={departmentText:'Boulangerie',weekText:'14 au 20',warnings:['Pause à confirmer'],rows:[{name:'Camille Exemple',writtenTotal:'7,5',days:cells().map(c=>({...c,uncertain:false}))}]};
test('heures nettes, ancienneté calculée et cases quotidiennes séparées',()=>{
  assert.equal(totalMinutes({cells:cells()}),450);assert.equal(tenure('2020-10-15','2026-10-14'),'5 ans 11 mois');assert.equal(tenure('2020-10-15','2026-10-15'),'6 ans');
  assert.throws(()=>normalizeAvailability({0:'17:00-08:00'}));assert.equal(normalizeAvailability({0:'8:00-24:00'})[0],'08:00-24:00');
  assert.deepEqual(Object.values(normalizeAvailability({0:'j',1:'0',2:'LIBRE',3:'NON'})),['J','0','J','0','','','']);
  assert.equal(draftWarnings({rows:[{personId:1,cells:cells()}]},[{id:1,name:'Camille',active:true,availability:{0:'J'}}]).length,0);
  assert.match(draftWarnings({rows:[{personId:1,cells:cells()}]},[{id:1,name:'Camille',active:true,availability:{0:'0'}}])[0],/en dehors/);
  const html=sheetHTML({department:DEPARTMENT_STYLES[1],weekStart:start,people:[{id:1,name:'<Camille>',jobTitle:'Gérante <équipe>',group:'regular',seniorityDate:'2020-01-01',availability:{0:'LIBRE'}}],draft:{rows:[{personId:1,cells:cells()}],notes:'',manager:''}});
  assert.match(html,/sheet-daily-hours">7,5/);assert.match(html,/sheet-availability">J/);assert.match(html,/&lt;Camille&gt;/);assert.match(html,/sheet-job-title">Gérante &lt;équipe&gt;/);
  const paper=sheetHTML({department:DEPARTMENT_STYLES[1],weekStart:start,blank:true,people:[{id:2,name:'Nouvelle employée',seniorityDate:'2021-03-04',group:'regular',active:true,availability:{0:'J'}}],draft:{rows:[],notes:'',manager:''}});
  assert.match(paper,/Nouvelle employée/);assert.match(paper,/4 mars 2021/);assert.doesNotMatch(paper,/Responsable|Heures prévues|Date reconnue|<footer>/);
});
test('lecture des photos : type vérifié, sortie structurée et ambiguïtés bloquées',async()=>{
  assert.equal(validatePhoto(photo),photo);assert.throws(()=>validatePhoto('data:image/svg+xml;base64,PHN2Zz4='));assert.throws(()=>validatePhoto(photo.replace('png','jpeg')));
  const uncertain=structuredClone(candidate);uncertain.rows[0].days[0].uncertain=true;assert.equal(validateCandidate(uncertain).rows[0].days[0].kind,'review');
  uncertain.rows[0].days.pop();assert.throws(()=>validateCandidate(uncertain));
  await assert.rejects(()=>transcribePhoto({dataUrl:photo},{key:''}),/connexion IA/);
  let sent;const result=await transcribePhoto({dataUrl:photo,names:['Camille']},{key:'mock-only',fetchImpl:async(url,opt)=>{sent=JSON.parse(opt.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(candidate)}]}]})};}});
  assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);assert.equal(result.rows[0].days[0].kind,'shift');
});
test('PostgreSQL : répertoire, brouillons, publication privée et photos',async t=>{
  const oldKey=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
  let calls=0;const f=await departmentFixture({fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(candidate)}]}]})};}});
  const {pool,call}=f;let dept,other,id,body,draft,rev=0,photoId;
  const req=(extra={})=>({params:{id:dept,week:start},...extra});
  const get=()=>call('get','/api/departments/:id/weeks/:week',req());
  const save=()=>call('put','/api/departments/:id/weeks/:week',req({body:{revision:rev,draft}}));
  const publish=(extra={})=>call('post','/api/departments/:id/weeks/:week/publish',req({body:{revision:rev,verified:true,...extra}}));
  const pub=()=>call('get','/api/leave/department-schedules/:id/:week',req());
  try{
    await t.test('migration réexécutable et routes protégées',async()=>{
      await installDepartmentSchedules(f.app,pool,f.options);
      const meta=(await call('get','/api/departments/meta')).body;assert.equal(meta.departments.length,8);assert.equal(meta.visionConfigured,false);dept=meta.departments.find(d=>d.key==='boulangerie').id;other=meta.departments.find(d=>d.key==='fruits').id;
      for(const [path,handlers] of f.routes){if(path.includes('/api/departments/')){assert.equal(handlers[0],f.options.requireManager,path);if(!path.startsWith('get'))assert.equal(handlers[1],f.options.sameOrigin,path);}if(path.includes('/api/leave/department-schedules'))assert.equal(handlers[0],f.options.requireStaff);}
    });
    await t.test('dates confirmées, aucune identité inventée, départements partagés',async()=>{
      body={name:'Camille Exemple',jobTitle:'  Gérante  ',seniorityDate:'2020-01-01',birthday:'1990-05-06',email:'camille@example.com',group:'regular',active:true,departments:[dept,other],availability:{0:'08:00-17:00'}};
      assert.equal((await call('post','/api/departments/people',{body})).code,400);
      body={...body,seniorityVerified:true,sourceNote:'Dossier vérifié'};let r=await call('post','/api/departments/people',{body});assert.equal(r.code,200,JSON.stringify(r.body));id=r.body.id;
      assert.equal((await call('post','/api/departments/people',{body})).code,409);
      assert.equal((await call('post','/api/departments/people',{body:{...body,name:'Date impossible',birthday:'2025-02-30'}})).code,400);
      const people=(await call('get','/api/departments/meta')).body.people;assert.equal(people.length,1);assert.equal(people[0].jobTitle,'Gérante');assert.deepEqual(people[0].departments.sort(),[dept,other].sort());
      assert.equal((await call('put','/api/departments/people/:id',{params:{id},body:{...body,version:0}})).code,409);
    });
    await t.test('brouillon distinct, protection des mises à jour, validation avant publication',async()=>{
      let r=await get();assert.equal(r.code,200,JSON.stringify(r.body));draft=r.body.draft;draft.rows[0].cells=cells();r=await save();assert.equal(r.code,200,JSON.stringify(r.body));rev=r.body.revision;
      assert.equal((await pub()).code,404);assert.equal((await call('put','/api/departments/:id/weeks/:week',req({body:{revision:0,draft}}))).code,409);
      assert.equal((await publish({verified:false})).code,400);r=await publish();assert.equal(r.code,200,JSON.stringify(r.body));rev=r.body.revision;
      const published=(await pub()).body;assert.equal(published.schedule.rows[0].name,'Camille Exemple');assert.equal(published.schedule.rows[0].jobTitle,'Gérante');
      assert.doesNotMatch(JSON.stringify(published),/camille@example|1990-05-06|2020-01-01|availability|sourceNote|seniority/);
      draft.rows[0].cells[0]={...shift,end:1020};r=await save();rev=r.body.revision;assert.equal((await pub()).body.schedule.rows[0].cells[0].end,960);
      const h=(await call('get','/api/departments/:id/weeks/:week/history',req())).body.history;r=await call('post','/api/departments/:id/weeks/:week/restore',req({body:{revision:rev,historyId:h.at(-1).id}}));assert.equal(r.code,200);rev=r.body.revision;assert.equal((await pub()).body.schedule.rows[0].cells[0].end,960);
    });
    await t.test('photo privée, IA inactive sans clé, import explicite sans publication',async()=>{
      const r=await call('post','/api/departments/photos',{body:{departmentId:dept,weekStart:start,name:'exemple.png',dataUrl:photo}});assert.equal(r.code,201);photoId=r.body.id;
      assert.equal((await call('post','/api/departments/photos/:id/analyze',{params:{id:photoId}})).code,503);assert.equal(calls,0);
      process.env.OPENAI_API_KEY='mock-only';const analyzed=await call('post','/api/departments/photos/:id/analyze',{params:{id:photoId}});assert.equal(analyzed.code,200,JSON.stringify(analyzed.body));assert.equal(calls,1);
      const apply=body=>call('post','/api/departments/photos/:id/apply',{params:{id:photoId},body});
      assert.equal((await apply({revision:rev,mapping:[id]})).code,400);
      assert.equal((await apply({revision:rev,weekConfirmed:true,replaceConfirmed:true,mapping:[999]})).code,400);
      const saved=await apply({revision:rev,weekConfirmed:true,replaceConfirmed:true,mapping:[id]});assert.equal(saved.code,200,JSON.stringify(saved.body));rev=saved.body.revision;
      assert.equal((await pub()).body.schedule.rows[0].cells[0].end,960);
      for(let n=0;n<3;n++)assert.equal((await call('post','/api/departments/photos',{body:{departmentId:dept,weekStart:start,name:'autre.png',dataUrl:photo}})).code,201);
      assert.equal((await call('post','/api/departments/photos',{body:{departmentId:dept,weekStart:start,dataUrl:photo}})).code,400);
    });
    await t.test('incertitudes et conflits exigent une correction ou vérification',async()=>{
      draft=(await get()).body.draft;draft.rows[0].cells[1]={kind:'review',note:'Heure illisible'};let r=await save();rev=r.body.revision;assert.equal((await publish({warningsReviewed:true})).code,400);
      draft.rows[0].cells[1]={...shift};r=await save();rev=r.body.revision;assert.equal((await publish()).code,400);r=await publish({warningsReviewed:true});assert.equal(r.code,200);rev=r.body.revision;
      const otherWeek=(await call('get','/api/departments/:id/weeks/:week',{params:{id:other,week:start}})).body;otherWeek.draft.rows[0].cells=cells();const saved=await call('put','/api/departments/:id/weeks/:week',{params:{id:other,week:start},body:{revision:0,draft:otherWeek.draft}});assert.equal(saved.code,200);
      const warning=(await call('get','/api/departments/:id/weeks/:week',{params:{id:other,week:start}})).body.warnings;assert.ok(warning.some(w=>w.includes('chevauchement')));
      const removed=await call('post','/api/departments/:id/weeks/:week/unpublish',req({body:{revision:rev}}));assert.equal(removed.code,200);rev=removed.body.revision;assert.equal((await pub()).code,404);
    });
    await t.test('fiche Service reliée à sa source, retrait de département sans erreur de lecture',async()=>{
      await pool.query("INSERT INTO schedule_employees(id,name,area,role,seniority,availability) VALUES(99,'Service Exemple','front','cashier','2010-01-01','{}')");
      let people=(await call('get','/api/departments/meta')).body.people,p=people.find(p=>p.serviceEmployeeId===99);assert.equal(p.seniorityDate,'2010-01-01');assert.equal(p.jobTitle,'');
      await pool.query("UPDATE schedule_employees SET seniority='2009-01-01',name='Nom corrigé' WHERE id=99");p=(await call('get','/api/departments/meta')).body.people.find(p=>p.serviceEmployeeId===99);assert.equal(p.name,'Nom corrigé');assert.equal(p.seniorityDate,'2009-01-01');
      assert.equal((await call('put','/api/departments/people/:id',{params:{id},body:{...body,version:1,departments:[other]}})).code,200);
      const r=await get();assert.equal(r.code,200,JSON.stringify(r.body));assert.ok(r.body.warnings.some(w=>w.includes('retiré')));
    });
    await t.test('Annuler un nouvel employé Service reste possible après lecture du répertoire',async()=>{
      await pool.query('BEGIN');await beginUndo(pool,'Ajouter une fiche de test');await pool.query("INSERT INTO schedule_employees(id,name,area,role) VALUES(101,'Fiche à annuler','front','cashier')");await pool.query('COMMIT');
      const action=(await pool.query('SELECT MAX(id) AS id FROM schedule_undo_actions')).rows[0].id;
      await call('get','/api/departments/meta');
      await pool.query('BEGIN');await undoLast(pool,action);await pool.query('COMMIT');
      assert.equal((await pool.query('SELECT id FROM schedule_employees WHERE id=101')).rows.length,0);
      const inactive=(await call('get','/api/departments/meta')).body.people.find(p=>p.serviceEmployeeId===101);assert.equal(inactive.active,false);
    });
  }finally{if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;await f.db.close();}
});
