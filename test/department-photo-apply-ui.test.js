import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/departments.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('let photoApplying='),source.indexOf('function renderCandidate(){'));
function fixture(){
  const elements=new Map(),selects=['1','2'].map(value=>({value,setAttribute(k,v){this[k]=v;}}));
  const $=id=>{if(!elements.has(id))elements.set(id,{textContent:'',checked:true,disabled:false,inert:false,focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;}});return elements.get(id);};
  $('#candidate').querySelectorAll=()=>selects;
  let resolve,reject,calls=0,saves=0,payload;
  const context=vm.createContext({$,activePhoto:{id:3,candidate:{rows:[{name:'Camille'},{name:'Nom mal lu'}]}},analyzingPhotoId:null,selectedDepartment:5,current:{weekStart:'2026-10-12',revision:1,people:[{id:1,name:'Camille'},{id:2,name:'Sam'}]},dirty:false,view:'photos',
    post:async(_path,body)=>{calls++;payload=body;return new Promise((yes,no)=>{resolve=yes;reject=no;});},
    saveDraft:async()=>{saves++;context.current.revision=2;selects[1].value='';$('#photoWeekConfirmed').checked=false;},
    loadWeek:async()=>{},switchView:async next=>context.view=next,message:text=>$('#appMessage').textContent=text
  });vm.runInContext(handler,context);
  return {$,selects,context,click:()=>vm.runInContext('applyPhotoCandidate()',context),get calls(){return calls;},get saves(){return saves;},get payload(){return payload;},resolve:()=>resolve({revision:3}),reject:()=>reject(Error('La feuille a changé. Rechargez-la.'))};
}
test('report photo : les validations apparaissent près du bouton sans toucher au brouillon',async()=>{
  const f=fixture();f.selects[1].value='';f.$('#photoWeekConfirmed').checked=false;f.$('#photoReplaceConfirmed').checked=false;f.context.dirty=true;
  await f.click();assert.equal(f.calls,0);assert.equal(f.saves,0);assert.match(f.$('#photoApplyStatus').textContent,/Nom mal lu/);assert.match(f.$('#photoApplyStatus').textContent,/Coche/);assert.equal(f.$('#photoApplyStatus').focused,true);assert.equal(f.selects[1]['aria-invalid'],'true');
  f.selects[1].value='1';await f.click();assert.match(f.$('#photoApplyStatus').textContent,/plusieurs lignes : Camille/);
  assert.equal(f.$('#applyCandidate').disabled,false);assert.equal(f.$('#managerContent').inert,false);
});
test('report photo : clic doublé ignoré, choix capturés avant sauvegarde et horaire ouvert après réussite',async()=>{
  const f=fixture();f.context.dirty=true;const pending=f.click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.saves,1);assert.equal(f.calls,1);assert.deepEqual(Array.from(f.payload.mapping),[1,2]);assert.equal(f.payload.weekConfirmed,true);assert.equal(f.payload.revision,2);
  assert.equal(f.$('#applyCandidate').disabled,true);assert.equal(f.$('#managerContent').inert,true);
  await f.click();assert.equal(f.calls,1);f.resolve();await pending;
  assert.equal(f.context.view,'schedule');assert.match(f.$('#appMessage').textContent,/reportée en brouillon/);assert.equal(f.$('#appMessage').scrolled,true);assert.equal(f.$('#managerContent').inert,false);
});
test('report photo : erreur serveur visible près du bouton et nouvelle tentative possible',async()=>{
  const f=fixture(),pending=f.click();f.reject();await pending;
  assert.equal(f.context.view,'photos');assert.match(f.$('#photoApplyStatus').textContent,/feuille a changé/);assert.equal(f.$('#photoApplyStatus').focused,true);assert.equal(f.$('#applyCandidate').disabled,false);
  const retry=f.click();assert.equal(f.calls,2);f.resolve();await retry;assert.equal(f.context.view,'schedule');
});
test('report photo : un échec d’affichage après sauvegarde ne prétend pas que le report a échoué',async()=>{
  const f=fixture();f.context.loadWeek=async()=>{throw Error('network');};const pending=f.click();f.resolve();await pending;
  assert.match(f.$('#photoApplyStatus').textContent,/transcription est enregistrée/);assert.equal(f.calls,1);
});

test('report photo : une ligne barrée peut être ignorée explicitement, mais un choix vide reste bloquant',async()=>{
  const f=fixture();f.selects[1].value='skip';const pending=f.click();assert.equal(f.calls,1);assert.deepEqual(Array.from(f.payload.mapping),[1,null]);f.resolve();await pending;
  const none=fixture();none.selects.forEach(s=>s.value='skip');await none.click();assert.equal(none.calls,0);assert.match(none.$('#photoApplyStatus').textContent,/au moins un/);
});
