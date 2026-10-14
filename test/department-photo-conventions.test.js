import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePhotoCell,applyPhotoRules} from '../department-photo.js';
import {blankCell,cellMinutes,automaticBreakMinutes,cellDetail,parseAvailability} from '../public/departments-core.js';
import {departmentFixture} from './department-fixture.js';

const shift={kind:'shift',start:420,end:960,breakMinutes:0,note:''};
test('conventions photo : heures abrégées, pause de 60 minutes dès 8 heures et postes spéciaux',()=>{
  for(const [reading,start,end,paid] of [['6-3',360,900,480],['4-8 BBQ',960,1200,240],['430 / 8',990,1200,210],['7 3',420,900,420],['7-330',420,930,450],['7-430',420,990,510],['6-1',360,780,420],['04:00 / 08:00',240,480,240]]){
    const cell=normalizePhotoCell(shift,reading);assert.equal(cell.start,start,reading);assert.equal(cell.end,end,reading);assert.equal(cellMinutes(cell),paid,reading);
  }
  for(const kind of ['shift','training','buffet','kitchen']){const c=normalizePhotoCell({...shift,kind},'7-4');assert.equal(c.kind,kind);assert.equal(c.breakMinutes,60);assert.equal(cellMinutes(c),480);}
  assert.equal(automaticBreakMinutes(360,840),60);assert.equal(automaticBreakMinutes(360,839),0);
  assert.equal(normalizePhotoCell({...shift,breakMinutes:30},'6-1').breakMinutes,30,'a written pause on a shorter shift is retained');
  assert.equal(parseAvailability('4-8'),'04:00-08:00','existing availability meaning is independent of shift shorthand');
});

test('RS-SS reconnu dans le texte lu et rendu comme Commandes Sandwich',()=>{
  for(const raw of ['630-330 RS-SS','630 / 330 RS SS','630 330 RS/SS']){
    const cell=normalizePhotoCell({...shift,kind:'kitchen'},raw);assert.equal(cell.kind,'shift');assert.equal(cell.post,'rs_ss');assert.equal(cellDetail(cell),'Commandes Sandwich');assert.equal(cellMinutes(cell),480);
  }
  assert.equal(normalizePhotoCell({...shift,kind:'training'},'7-4 RS-SS').kind,'training');
});

test('propositions enregistrées : recalcul sans IA, sans mutation et sans anciennes alertes sur les heures brutes',()=>{
  const legacy={warnings:['La seconde vérification n’a pas abouti.','Aucune pause non écrite n’a été déduite.','Camille : total manuscrit 40 h, quarts lus 45 h. Vérifiez les heures et les pauses; aucune pause n’a été déduite automatiquement.','Un nom est masqué.'],rows:[{name:'Camille',writtenTotal:'40 h',readings:Array(7).fill('7-4'),days:[...Array.from({length:5},()=>({...shift})),blankCell(),blankCell()]}]};
  const original=structuredClone(legacy),result=applyPhotoRules(legacy);assert.deepEqual(legacy,original);assert.equal(result.rows[0].days.reduce((n,c)=>n+cellMinutes(c),0),2400);assert.deepEqual(result.warnings,['La seconde vérification n’a pas abouti.','Un nom est masqué.']);assert.deepEqual(applyPhotoRules(result),result);
  const incomplete=structuredClone(legacy);incomplete.rows[0].days[0]={...blankCell(),kind:'review',note:'Chiffre masqué'};assert.equal(applyPhotoRules(incomplete).rows[0].days[0].kind,'review');
  const mismatch=structuredClone(legacy);mismatch.rows[0].writtenTotal='30 h';assert.match(applyPhotoRules(mismatch).warnings.at(-1),/heures payées calculées 40 h/);
  const split={warnings:[],rows:[{name:'Camille',writtenTotal:'24 h.',days:[...Array.from({length:3},()=>({...shift})),...Array.from({length:2},()=>({...shift,kind:'buffet'})),blankCell(),blankCell()]}]};
  assert.deepEqual(applyPhotoRules(split).warnings,[],'regular subtotal is not compared with the grand total');
  split.rows[0].writtenTotal='16 h Buffet';assert.deepEqual(applyPhotoRules(split).warnings,[]);
  split.rows[0].writtenTotal='24 h Buffet';assert.match(applyPhotoRules(split).warnings[0],/heures payées calculées 16 h/,'explicit category totals still flag a mismatch');
});

test('API : même proposition corrigée à l’ouverture, au suivi et au report; ligne terminée exclue sans désactiver sa fiche',async()=>{
  let calls=0;const f=await departmentFixture({fetchImpl:async()=>{calls++;throw Error('No AI expected');}});
  try{
    const dept=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='pam'),ids=[];
    for(const name of ['Camille Exemple','Ancien Exemple'])ids.push((await f.call('post','/api/departments/people',{body:{name,group:'regular',active:true,email:'',departments:[dept.id],availability:{}}})).body.id);
    const week='2026-10-19',candidate={warnings:[],rows:[{name:'Camille Exemple',writtenTotal:'8 h',readings:['6-3 RS-SS'],days:[{...shift,start:360,end:900},...Array.from({length:6},blankCell)]},{name:'Ancien Exemple',writtenTotal:'',days:Array.from({length:7},blankCell)}]};
    const id=(await f.pool.query("INSERT INTO schedule_department_photos(department_id,week_start,name,data_url,candidate,attempts,state) VALUES($1,$2,'Exemple','example',$3,1,'ready') RETURNING id",[dept.id,week,JSON.stringify(candidate)])).rows[0].id;
    const open=(await f.call('get','/api/departments/photos/:id',{params:{id}})).body,status=(await f.call('get','/api/departments/photos/:id/status',{params:{id}})).body;
    assert.deepEqual(open.candidate,status.candidate);assert.equal(status.attempts,1);assert.equal(status.candidate.rows[0].days[0].breakMinutes,60);assert.equal(status.candidate.rows[0].days[0].post,'rs_ss');assert.equal(calls,0);
    const applied=await f.call('post','/api/departments/photos/:id/apply',{params:{id},body:{revision:0,mapping:[ids[0],null],departmentId:dept.id,weekStart:week,weekConfirmed:true,replaceConfirmed:true}});assert.equal(applied.code,200);
    const saved=(await f.call('get','/api/departments/:id/weeks/:week',{params:{id:dept.id,week}})).body;assert.deepEqual(saved.draft.rows.find(r=>r.personId===ids[0]).cells[0],status.candidate.rows[0].days[0]);assert.equal(saved.published,null);assert.equal(saved.people.find(p=>p.id===ids[1]).active,true);assert.equal(calls,0);
  }finally{await f.db.close();}
});
