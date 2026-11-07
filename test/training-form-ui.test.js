import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {emptyTrainingForm,FORM_SIGNERS} from '../public/training-form-schema.js';
const source=(await readFile(new URL('../public/training-form.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'').replace(/export /g,'');
function fixture(){
 const status={textContent:'',setAttribute(){},scrollIntoView(){}};
 const dates={employeeDate:{value:''},trainerDate:{value:''}};
 const pads=Object.fromEntries(['employee','trainer'].map(key=>[key,{closest:()=>({dataset:{tfSignature:key}}),getContext:()=>new Proxy({},{get:()=>()=>{}}),getBoundingClientRect:()=>({left:0,top:0,width:800,height:208}),setPointerCapture(){}}]));
 const dialog={innerHTML:'',querySelector:s=>s==='[data-tf-message]'?status:s.includes('employeeDate')?dates.employeeDate:s.includes('trainerDate')?dates.trainerDate:null,querySelectorAll:s=>s==='canvas'?Object.values(pads):[],showModal(){},setAttribute(){},addEventListener(){}};
 const sandbox={emptyTrainingForm,FORM_SIGNERS,topics:{},trainingTasks:[],structuredClone,crypto:{randomUUID:()=>Math.random().toString()},Intl,Date,confirm:()=>false,window:{addEventListener(){},print(){}},document:{querySelector:()=>true,createElement:()=>dialog,body:{append(){}}}};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 sandbox.options={equipment:{id:'test',title:'Appareil fictif',fields:{}},employees:[{key:'test',name:'Employé fictif'}],employeeKey:'test',task:'Utilisation',department:'Test',procedures:[],actorName:'Test',save:async body=>({entry:{id:'saved',data:structuredClone(body.data)}}),onSaved:async()=>{}};
 vm.runInContext('openTrainingForm(options)',sandbox);
 const run=code=>vm.runInContext(code,sandbox);
 const stroke=key=>{const e={button:0,pointerId:1,clientX:10,clientY:10,preventDefault(){}};pads[key].onpointerdown(e);pads[key].onpointermove({...e,clientX:80});pads[key].onpointerup(e);};
 return {run,dialog,status,stroke,sandbox};
}
test('touches, dates et champs inchangés préservent les deux signatures',()=>{
 const f=fixture();f.stroke('employee');f.stroke('trainer');
 assert.equal(f.run('model.signatures.employee.length'),1);assert.equal(f.run('model.signatures.trainer.length'),1);
 const before=f.run('JSON.stringify(model.signatures)');
 const value=f.run('model.employeeDate');
 f.dialog.oninput({target:{dataset:{tf:'employeeDate'},type:'date',value,hasAttribute:()=>false}});
 f.dialog.onclick({target:{closest:()=>null}});
 assert.equal(f.run('JSON.stringify(model.signatures)'),before);
 const changed={dataset:{tf:'trainer'},type:'text',value:'Modification refusée',hasAttribute:()=>false};f.dialog.oninput({target:changed});
 assert.equal(changed.value,'');assert.equal(f.run('JSON.stringify(model.signatures)'),before);
});
test('finalisation, erreurs et réouverture : signatures conservées et aucun brouillon',async()=>{
 const f=fixture();f.stroke('employee');f.stroke('trainer');
 await f.run("save('completed')");assert.match(f.status.textContent,/Pour finaliser/);assert.equal(f.run('model.signatures.employee.length'),1);
 f.run("Object.assign(model,{date:today(),trainer:'Formateur fictif',reference:'Méthode test',content:'Contenu test'})");
 f.sandbox.options.onSaved=async()=>{throw Error('refresh failed');};
 await f.run("save('completed')");assert.equal(f.run('model.status'),'completed');assert.equal(f.run('dirty'),false);
 assert.doesNotMatch(f.dialog.innerHTML,/Brouillon|brouillon/);assert.match(f.dialog.innerHTML,/Signature manuscrite/);assert.match(f.dialog.innerHTML,/Corriger cette fiche/);
 f.run('openTrainingForm({...options,prior})');assert.doesNotMatch(f.dialog.innerHTML,/Brouillon|brouillon/);
});

test('choisir et compléter les dates après les deux signatures ne perd aucun tracé',async()=>{
 const f=fixture();f.stroke('employee');f.stroke('trainer');const before=f.run('JSON.stringify(model.signatures)');
 f.sandbox.confirm=()=>{throw Error('Un choix de date du brouillon ne doit pas demander de refaire les signatures');};
 for(const key of ['date','observationDate','dueDate','employeeDate','trainerDate'])for(const value of ['', '2026-11-06','2026-11-07']){
  f.dialog.oninput({target:{dataset:{tf:key},type:'date',value,hasAttribute:()=>false}});
  assert.equal(f.run('JSON.stringify(model.signatures)'),before);
  assert.equal(f.run('model.'+key),value);
 }
 f.run("Object.assign(model,{trainer:'Formateur test',content:'Contenu test',reference:'Source test'})");
 await f.run("save('draft')");
 f.dialog.oninput({target:{dataset:{tf:'date'},type:'date',value:'2026-11-06',hasAttribute:()=>false}});
 await f.run("save('completed')");assert.equal(f.run('model.status'),'completed');assert.equal(f.run('JSON.stringify(model.signatures)'),before);
});
