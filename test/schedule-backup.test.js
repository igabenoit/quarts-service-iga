import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {backupBeforeRegeneration,installScheduleBackup,restorationPreview} from '../schedule-backup.js';
import {beginUndo} from '../undo.js';

const week='2026-10-12';
const shift=(id,day=0)=>({id:String(id),area:'front',role:'cashier',day_index:day,start_minute:675,end_minute:1035,break_minutes:0});
const assignment=(shiftId,employeeId)=>({shift_id:String(shiftId),employee_id:String(employeeId)});
const original=()=>({shifts:[shift(1),shift(2,6)],assignments:[assignment(1,7),assignment(2,8)]});
const regenerated=()=>({shifts:[shift(1),shift(2,6)],assignments:[assignment(1,8)]});
const people=[{id:'7',name:'Raphaël',active:true},{id:'8',name:'Autre employé',active:true}];
const context=()=>({weekStart:week,employees:people,leaves:[],timeOff:[]});
const saved=()=>({id:'9',week_start:week,snapshot:original(),created_at:'2026-10-07T15:00:00Z',restored_at:null});

test('aperçu : noms, cases à couvrir et date; JSONB peut réordonner les clés',()=>{
  const b=saved();b.snapshot=JSON.parse(JSON.stringify(b.snapshot, Object.keys({shifts:0,assignments:0,...shift(1),...assignment(1,7)}).reverse()));
  const p=restorationPreview(b,regenerated(),context());
  assert.equal(p.canRestore,true);
  assert.deepEqual(p.changes.map(c=>[c.current,c.restored]),[['Autre employé','Raphaël'],['À couvrir','Autre employé']]);
  assert.equal(p.changes[1].date,'2026-10-18');
  assert.equal(p.token,restorationPreview(saved(),regenerated(),context()).token);
});
test('les quarts modifiés, les employés inactifs et les congés empêchent une restauration incompatible',()=>{
  const changed=regenerated();changed.shifts[0].end_minute=1050;
  assert.equal(restorationPreview(saved(),changed,context()).canRestore,false);
  const ctx=context();ctx.employees=people.map(p=>({...p,active:false}));
  assert.equal(restorationPreview(saved(),regenerated(),ctx).canRestore,false);
  ctx.employees=people;ctx.leaves=[{employee_id:'8',periods:[{date:'2026-10-18',startMinute:0,endMinute:1440}]}];
  assert.match(restorationPreview(saved(),regenerated(),ctx).issues[0],/congé le 2026-10-18/);
  ctx.leaves=[];ctx.timeOff=[{employee_id:'7',day_index:0}];
  assert.equal(restorationPreview(saved(),regenerated(),ctx).canRestore,false);
});

test('une restauration respecte les disponibilités datées et son jeton change avec la grille',()=>{
  const before=restorationPreview(saved(),regenerated(),context());
  const ctx=context();ctx.employees=people.map(e=>({...e,availability:{},target_minutes:900,availability_history:[{effectiveDate:'2026-10-01',availability:{},targetMinutes:900}]}));
  const after=restorationPreview(saved(),regenerated(),ctx);assert.equal(after.canRestore,false);assert.notEqual(after.token,before.token);assert.match(after.issues.join(' '),/n’est plus disponible/);
});

async function fixture({backup=saved(),failInsert=false}={}){
  let current=regenerated(),rollback=null;
  const calls=[],routes=new Map(),otherWeek=[assignment(99,7)];
  const client={release(){},async query(sql,args=[]){
    calls.push({sql,args});
    if(sql==='BEGIN')rollback=structuredClone({current,backup});
    if(sql==='ROLLBACK'){current=rollback.current;backup=rollback.backup;}
    if(sql.includes('SELECT * FROM schedule_regeneration_backups')){assert.equal(args[0],week);return {rows:backup?[backup]:[]};}
    if(sql.includes('FROM schedule_shifts WHERE week_start=$1 ORDER BY id'))return {rows:current.shifts};
    if(sql.includes('JOIN schedule_shifts s ON s.id=a.shift_id WHERE'))return {rows:current.assignments};
    if(sql==='SELECT id,name,active,availability,target_minutes,availability_history FROM schedule_employees ORDER BY id')return {rows:people};
    if(sql.startsWith('INSERT INTO schedule_regeneration_backups')){backup={...saved(),snapshot:JSON.parse(args[1])};}
    if(sql.startsWith('DELETE FROM schedule_assignments')){assert.equal(args[0],week);current.assignments=[];}
    if(sql.startsWith('INSERT INTO schedule_assignments')){
      if(failInsert)throw new Error('database write failed');
      current.assignments.push(assignment(...args));
    }
    if(sql.startsWith('UPDATE schedule_regeneration_backups')){backup.restored_at='now';backup.replaced_snapshot=JSON.parse(args[0]);}
    return {rows:[]};
  }};
  const manager=()=>{},origin=()=>{};
  const app={get(path,...handlers){routes.set('get '+path,handlers);},post(path,...handlers){routes.set('post '+path,handlers);}};
  await installScheduleBackup(app,{query:async()=>({rows:[]}),connect:async()=>client},{requireManager:manager,sameOrigin:origin});
  const run=async(method,body={},requestedWeek=week)=>{
    const res={code:200,set(){return this;},status(code){this.code=code;return this;},json(value){this.body=value;return this;}};
    await routes.get(method+' /api/weeks/:weekStart/regeneration-backup'+(method==='post'?'/restore':'')).at(-1)({params:{weekStart:requestedWeek},body},res);
    return res;
  };
  return {client,calls,routes,manager,origin,run,otherWeek,get current(){return current;},get backup(){return backup;}};
}
test('la sauvegarde conserve les choix avant la recréation et la lecture ne change rien',async()=>{
  const f=await fixture();await backupBeforeRegeneration(f.client,week);
  assert.deepEqual(f.backup.snapshot,regenerated());
  const preview=await f.run('get');assert.equal(preview.code,200);
  assert.equal(f.calls.some(c=>c.sql.startsWith('DELETE')),false);
});
test('restauration exacte, isolée à la semaine, sous transaction, avec sauvegarde de l’état remplacé',async()=>{
  const f=await fixture();const preview=(await f.run('get')).body.backup;
  assert.deepEqual(f.routes.get('get /api/weeks/:weekStart/regeneration-backup').slice(0,1),[f.manager]);
  assert.deepEqual(f.routes.get('post /api/weeks/:weekStart/regeneration-backup/restore').slice(0,2),[f.manager,f.origin]);
  const res=await f.run('post',{backupId:preview.id,token:preview.token});
  assert.equal(res.code,200);assert.deepEqual(f.current,original());
  assert.deepEqual(f.otherWeek,[assignment(99,7)]);
  assert.deepEqual(f.backup.replaced_snapshot,regenerated());
  assert.equal(f.calls.at(-1).sql,'COMMIT');
  assert.equal((await f.run('post',{backupId:preview.id,token:preview.token})).code,409);
});
test('aperçu périmé, mauvaise sauvegarde et semaines invalides ne modifient rien',async()=>{
  const f=await fixture();const preview=(await f.run('get')).body.backup;
  f.current.assignments.push(assignment(2,7));
  assert.equal((await f.run('post',{backupId:preview.id,token:preview.token})).code,409);
  assert.equal((await f.run('post',{backupId:'999',token:preview.token})).code,409);
  assert.equal((await f.run('get',{},'2026-10-13')).code,400);
  assert.equal(f.calls.some(c=>c.sql.startsWith('DELETE')),false);
});
test('absence de sauvegarde, historique déjà restauré et rollback après échec',async()=>{
  for(const backup of [null,{...saved(),restored_at:'now'}]){
    const f=await fixture({backup});assert.equal((await f.run('get')).body.backup,null);
    assert.equal((await f.run('post')).code,409);
  }
  const f=await fixture({failInsert:true});const preview=(await f.run('get')).body.backup;
  assert.equal((await f.run('post',{backupId:preview.id,token:preview.token})).code,500);
  assert.deepEqual(f.current,regenerated());assert.equal(f.backup.restored_at,null);
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});

test('la véritable route de recréation sauvegarde avant le retrait; un échec annule aussi la sauvegarde',async()=>{
  const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const route=source.slice(source.indexOf('app.post("/api/weeks/:weekStart/generate"'),source.indexOf('await installLeave(app,pool'));
  for(const fail of [false,true]){
    let handler,stored=null,current=original().assignments;
    const client={release(){},async query(sql,args=[]){
      if(sql.startsWith('INSERT INTO schedule_undo_actions'))return {rows:[{id:'1'}]};
      if(sql==='ROLLBACK'){stored=null;current=original().assignments;}
      if(sql.startsWith('SELECT')&&sql.includes('FROM schedule_shifts WHERE week_start='))return {rows:original().shifts};
      if(sql.includes('SELECT a.shift_id, a.employee_id'))return {rows:current};
      if(sql.startsWith('INSERT INTO schedule_regeneration_backups'))stored=JSON.parse(args[1]);
      if(sql.includes('DELETE FROM schedule_assignments')){assert.deepEqual(stored,original());current=[];}
      if(sql.startsWith('INSERT INTO schedule_assignments')){
        if(fail)throw Error('Simulated write failure');
        current.push(assignment(...args));
      }
      return {rows:[]};
    }};
    const context=vm.createContext({app:{post(_path,...handlers){handler=handlers.at(-1);}},pool:{connect:async()=>client},requireManager(){},sameOrigin(){},validDate:()=>true,
      mapShift:r=>r,mapEmployee:r=>r,approvedLeave:async()=>[],backupBeforeRegeneration,beginUndo,generateAssignments:()=>({assignments:[{shiftId:1,employeeId:8}],unfilled:[]})});
    vm.runInContext(route,context);
    const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({params:{weekStart:week},body:{replaceAll:true}},res);
    assert.equal(res.code,fail?400:200);
    assert.deepEqual(stored,fail?null:original());
    assert.deepEqual(current,fail?original().assignments:[assignment(1,8)]);
  }
});
