import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePhotoCell,applyPhotoRules,transcribePhoto} from '../department-photo.js';
import {blankCell,cellMinutes,DAY_NAMES} from '../public/departments-core.js';
import {departmentFixture} from './department-fixture.js';

const dayShift={kind:'shift',start:600,end:1110,breakMinutes:60,note:''};
const nightShift={...dayShift,post:'night'};
const weekCells=(...cells)=>[...cells,...Array.from({length:7-cells.length},blankCell)];

test('photo Nuit : 1000 et 1100 deviennent 22 h et 23 h, fin le lendemain et pause de 30 minutes',()=>{
  for(const [reading,start,end,paid] of [
    ['1000 / 630',1320,1830,480],['1100 / 730',1380,1890,480],
    ['1100 / 630',1380,1830,420],['1030 / 700',1350,1860,480],
    ['11h30 / 8h00',1410,1920,480],['10 / 6h30',1320,1830,480],
    ['1000\n630',1320,1830,480],['22:00 / 06:30',1320,1830,480],
    ['01:00 / 06:30',60,390,300],['1 / 6',60,360,270]
  ]){
    const cell=normalizePhotoCell(nightShift,reading);
    assert.equal(cell.start,start,reading);assert.equal(cell.end,end,reading);
    assert.equal(cell.breakMinutes,30,reading);assert.equal(cellMinutes(cell),paid,reading);
    assert.equal(cell.post,'night');
  }
  for(const raw of ['1000 / 630 Nuit','Nuit : 1000 / 630']){
    assert.deepEqual(normalizePhotoCell(dayShift,raw),{...nightShift,start:1320,end:1830,breakMinutes:30});
  }
  assert.equal(normalizePhotoCell({...dayShift,note:'Poste Nuit'},'1100 / 730').start,1380);
  const alreadyRead={...nightShift,start:1320,end:1830,breakMinutes:30};
  assert.deepEqual(normalizePhotoCell(alreadyRead,'1000 / 630'),alreadyRead,'literal shorthand must not undo a correct model reading');
  assert.equal(normalizePhotoCell({...alreadyRead,kind:'training'},'1000 / 630').kind,'training');
  assert.equal(normalizePhotoCell({...alreadyRead,breakMinutes:60,breakOverride:true},'1000 / 630').breakMinutes,60);
});

test('photo : les mêmes chiffres restent des heures de jour sans contexte Nuit',()=>{
  for(const [reading,start,end] of [['1000 / 630',600,1110],['1100 / 730',660,1170],['1000 / 1830',600,1110],['6 / 3',360,900],['4 / 8',960,1200]]){
    const cell=normalizePhotoCell(dayShift,reading);
    assert.equal(cell.start,start,reading);assert.equal(cell.end,end,reading);assert.equal(cell.post,undefined);
  }
});

test('proposition Nuit enregistrée : reprise sans nouvelle IA, sans mutation et sans double ajout de 12 heures',()=>{
  const candidate={warnings:['Camille : total manuscrit 16 h, heures payées calculées 15 h.'],rows:[{name:'Camille',writtenTotal:'16 h',readings:['1000 / 630','1100 / 730'],days:weekCells(nightShift,{...nightShift,start:660,end:1170})}]};
  const original=structuredClone(candidate),corrected=applyPhotoRules(candidate);
  assert.deepEqual(candidate,original);
  assert.deepEqual(corrected.rows[0].days.slice(0,2).map(c=>[c.start,c.end,cellMinutes(c)]),[[1320,1830,480],[1380,1890,480]]);
  assert.deepEqual(corrected.warnings,[]);assert.deepEqual(applyPhotoRules(corrected),corrected);
  const uncertain={...blankCell(),kind:'review',note:'1000 ou 1100 : chiffre illisible'};
  candidate.rows[0].days[0]=uncertain;
  assert.deepEqual(applyPhotoRules(candidate).rows[0].days[0],uncertain);
});

test('transcription Nuit : première lecture et relecture conservent les chiffres et les heures corrigées',async()=>{
  const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ3sAAAAASUVORK5CYII=';
  const proposal={weekText:'19 au 25 octobre 2026',departmentText:'Épicerie — Nuit',warnings:[],rows:[{name:'Camille Exemple',writtenTotal:'16 h',days:weekCells(nightShift,{...nightShift,start:1380,end:1890}).map((cell,i)=>({...cell,day:DAY_NAMES[i],rawText:['1000 / 630','1100 / 730'][i]||'',uncertain:false}))}]};
  const sent=[],firstPass=[];
  const result=await transcribePhoto({dataUrl:photo,department:'Épicerie',weekStart:'2026-10-19'}, {key:'test',onFirstPass:async c=>firstPass.push(c),fetchImpl:async(_url,options)=>{
    sent.push(JSON.parse(options.body));
    return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(proposal)}]}]})};
  }});
  assert.equal(sent.length,2);assert.equal(firstPass.length,1);
  for(const c of [firstPass[0],result]){
    assert.deepEqual(c.rows[0].days.slice(0,2).map(cell=>[cell.start,cell.end,cellMinutes(cell)]),[[1320,1830,480],[1380,1890,480]]);
    assert.deepEqual(c.rows[0].readings.slice(0,2),['1000 / 630','1100 / 730']);assert.deepEqual(c.warnings,[]);
  }
  for(const request of sent){assert.match(request.instructions,/1000 ou 10 signifie 22:00/);assert.match(request.instructions,/1100 ou 11 signifie 23:00/);}
  assert.equal(result.analysis.verification,'complete');
});

test('API photo Nuit : ouverture, suivi et report corrigent aussi une ancienne proposition',async()=>{
  let calls=0;const f=await departmentFixture({fetchImpl:async()=>{calls++;throw Error('No AI expected');}});
  try{
    const dept=(await f.call('get','/api/departments/meta')).body.departments.find(d=>d.key==='epicerie');
    const person=(await f.call('post','/api/departments/people',{body:{name:'Camille Nuit',group:'regular',active:true,departments:[dept.id],availability:{}}})).body.id;
    const week='2026-10-19',candidate={warnings:[],rows:[{name:'Camille Nuit',writtenTotal:'16 h',readings:['1000 / 630 Nuit','1100 / 730'],days:weekCells(dayShift,{...nightShift,start:660,end:1170})}]};
    const id=(await f.pool.query("INSERT INTO schedule_department_photos(department_id,week_start,name,data_url,candidate,attempts,state) VALUES($1,$2,'Nuit exemple','example',$3,1,'ready') RETURNING id",[dept.id,week,JSON.stringify(candidate)])).rows[0].id;
    const open=(await f.call('get','/api/departments/photos/:id',{params:{id}})).body,status=(await f.call('get','/api/departments/photos/:id/status',{params:{id}})).body;
    assert.deepEqual(open.candidate,status.candidate);assert.equal(status.attempts,1);
    assert.deepEqual(status.candidate.rows[0].days.slice(0,2).map(c=>[c.start,c.end,cellMinutes(c)]),[[1320,1830,480],[1380,1890,480]]);
    const applied=await f.call('post','/api/departments/photos/:id/apply',{params:{id},body:{revision:0,mapping:[person],departmentId:dept.id,weekStart:week,weekConfirmed:true,replaceConfirmed:true}});
    assert.equal(applied.code,200);
    const saved=(await f.call('get','/api/departments/:id/weeks/:week',{params:{id:dept.id,week}})).body;
    assert.deepEqual(saved.draft.rows.find(r=>r.personId===person).cells,status.candidate.rows[0].days);
    assert.equal(saved.published,null);assert.equal(calls,0);
  }finally{await f.db.close();}
});
