import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as core from '../public/departments-core.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(file){
  const elements=new Map();const element=selector=>{if(!elements.has(selector)){let html='';elements.set(selector,{value:'',textContent:'',checked:false,disabled:false,hidden:false,inert:false,querySelectorAll:()=>[],querySelector:()=>element(selector+' child'),addEventListener(){},setAttribute(){},focus(){},close(){},get innerHTML(){return html;},set innerHTML(value){html=value;if(selector.endsWith('Picker'))this.value=/value="([^"]*)"/.exec(value)?.[1]||'';}});}return elements.get(selector);};
  const context=vm.createContext({...core,e:core.escapeHTML,console,URL,URLSearchParams,setTimeout,clearTimeout,confirm:()=>true,fetch:async()=>{throw Error('unexpected fetch');},window:{addEventListener(){}},document:{body:{className:''},querySelector:element,querySelectorAll:()=>[],addEventListener(){}}});
  let source=readFileSync(new URL('../public/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
  source=source.replace(/^try\{await loadMeta\(\);await loadWeek\(\);[\s\S]*$/m,'').replace(/load\(\)\.catch\(err=>status\(err.message\)\);\s*$/,'');
  vm.runInContext(source,context);
  return {context,$:element,run:code=>vm.runInContext(code,context),setFetch:fn=>context.fetch=fn};
}
const initial=()=>({department:{id:5,key:'pam',name:'Prêt-à-manger'},weekStart:'2026-10-19',revision:3,people:[],draft:{rows:[],notes:'Saisie conservée',manager:''},incoming:[],warnings:[],publishedAt:'2026-10-10'});
function manager(){const f=fixture('departments.js');f.context.seed=initial();f.run("current=seed;selectedDepartment=5;meta={departments:[seed.department],people:[]};dirty=true;renderSchedule=()=>{};renderPeople=()=>{};renderPrint=()=>{};renderNavigation=()=>{};renderWarnings=()=>{};");f.$('#weekPicker').value='2026-10-19';return f;}
const response=(body,status=200)=>({ok:status<400,status,json:async()=>structuredClone(body)});
test('navigation : une date effacée ne modifie pas la destination de sauvegarde',async()=>{const f=manager();f.$('#weekPicker').value='';await f.$('#weekPicker').onchange();assert.equal(f.$('#weekPicker').value,'2026-10-19');assert.equal(f.run('route()'),'/api/departments/5/weeks/2026-10-19');assert.equal(f.run('dirty'),true);});
test('navigation : échec réseau conserve la feuille, sa date et les modifications',async()=>{const f=manager();f.setFetch(async()=>{throw Error('Hors connexion');});f.$('#weekPicker').value='2026-10-26';await f.$('#weekPicker').onchange();assert.equal(f.$('#weekPicker').value,'2026-10-19');assert.equal(f.run('dirty'),true);assert.equal(f.run('current.draft.notes'),'Saisie conservée');assert.equal(f.run('route()'),'/api/departments/5/weeks/2026-10-19');});
test('sauvegarde : bloque les actions concurrentes et ignore le clic doublé',async()=>{const f=manager(),pending=deferred();let writes=0;f.setFetch(async(_url,options)=>{if(options.method==='PUT'){writes++;return pending.promise;}return response({...initial(),revision:4});});const first=f.run('saveDraft()');assert.equal(f.$('#managerContent').inert,true);assert.equal(f.run('mayLeave()'),false);const second=f.run('saveDraft()');pending.resolve(response({revision:4}));await Promise.all([first,second]);assert.equal(writes,1);assert.equal(f.$('#managerContent').inert,false);});
test('retrait de publication : sauvegarde les modifications avant le retrait',async()=>{const f=manager(),methods=[];f.setFetch(async(url,options)=>{methods.push(options.method||'GET');return response(options.method==='PUT'?{revision:4}:options.method==='POST'?{revision:5}:{...initial(),revision:4});});await f.$('#unpublishWeek').onclick();assert.equal(methods[0],'PUT');assert.ok(methods.includes('POST'));});
test('sauvegarde : une erreur réseau conserve les changements et libère les boutons',async()=>{const f=manager();f.setFetch(async()=>{throw Error('Hors connexion');});await assert.rejects(f.run('saveDraft()'),/Hors connexion/);assert.equal(f.run('dirty'),true);assert.equal(f.run('current.revision'),3);assert.equal(f.$('#managerContent').inert,false);});
test('sauvegarde réussie puis actualisation impossible : résultat annoncé sans perdre la nouvelle version',async()=>{const f=manager();f.setFetch(async(_url,options)=>{if(options.method==='PUT')return response({revision:4});throw Error('Hors connexion');});await assert.rejects(f.run('saveDraft()'),/brouillon est enregistré/);assert.equal(f.run('current.revision'),4);assert.equal(f.run('current.draft.notes'),'Saisie conservée');assert.equal(f.$('#managerContent').inert,false);});
test('fiche employé : double soumission bloquée et erreur après enregistrement affichée hors du dialogue',async()=>{const f=manager(),pending=deferred();let writes=0;f.setFetch(async(_url,options)=>{if(options.method==='POST'){writes++;return pending.promise;}throw Error('Hors connexion');});const event={preventDefault(){}};const first=f.$('#personForm').onsubmit(event);assert.equal(f.$('#personDialog').inert,true);await f.$('#personForm').onsubmit(event);pending.resolve(response({id:1}));await first;assert.equal(writes,1);assert.match(f.$('#appMessage').textContent,/fiche est enregistrée/);assert.equal(f.$('#personDialog').inert,false);assert.equal(f.run('dirty'),true);});
test('photos : une liste reçue après un changement de semaine est ignorée',async()=>{const f=manager(),pending=deferred();f.setFetch(()=>pending.promise);f.$('#photoList').innerHTML='Photos de la nouvelle semaine';const first=f.run('loadPhotos()');f.run('loadSequence++');pending.resolve(response({photos:[{id:99,name:'Ancienne photo'}]}));await first;assert.equal(f.$('#photoList').innerHTML,'Photos de la nouvelle semaine');});
test('historique : restauration verrouillée, double clic ignoré et version actualisée',async()=>{const f=manager(),pending=deferred();let writes=0;f.setFetch(async(_url,options)=>{if(options.method==='POST'){writes++;return pending.promise;}return response({...initial(),revision:4});});const first=f.run('restoreDraft(42)');assert.equal(f.$('#managerContent').inert,true);await f.run('restoreDraft(42)');pending.resolve(response({revision:4}));await first;assert.equal(writes,1);assert.equal(f.run('current.revision'),4);assert.equal(f.$('#managerContent').inert,false);});
test('historique : un échec d’actualisation après restauration conserve la protection contre un écrasement',async()=>{const f=manager();f.setFetch(async(_url,options)=>{if(options.method==='POST')return response({revision:4});throw Error('Hors connexion');});await f.run('restoreDraft(42)');assert.match(f.$('#appMessage').textContent,/rétablie sur le serveur/);assert.equal(f.run('current.revision'),3);});
test('la semaine chargée est conservée dans le lien pour un rechargement cohérent',async()=>{const f=manager();let saved;f.context.window.location={href:'http://localhost/departements'};f.context.window.history={replaceState:(_a,_b,url)=>saved=String(url)};f.setFetch(async()=>response(initial()));await f.run('loadWeek()');assert.equal(saved,'http://localhost/departements?department=5&week=2026-10-19');});

test('consultations : le changement de semaine recharge le suivi du département',async()=>{
 const f=manager(),calls=[];f.run("view='views';dirty=false;");
 f.setFetch(async url=>{calls.push(url);return response(url.endsWith('/views')?{publishedAt:'2026-10-20',employees:[{name:'Employé témoin',lastViewedAt:null}]}:{...initial(),weekStart:'2026-10-26'});});
 await f.run("loadWeek({weekStart:'2026-10-26'})");
 assert.ok(calls.includes('/api/departments/5/weeks/2026-10-26/views'));
 assert.match(f.$('#departmentViews').innerHTML,/26 oct\. 2026/);
 assert.match(f.$('#departmentViews').innerHTML,/Horaires ouverts : 0 \/ 1/);
});
test('consultations : une réponse de la semaine précédente ne remplace pas le suivi courant',async()=>{
 const f=manager(),pending=deferred();f.setFetch(()=>pending.promise);
 const first=f.run('loadViews()');f.run("current={...current,weekStart:'2026-10-26'}");f.$('#departmentViews').innerHTML='Semaine courante';
 pending.resolve(response({publishedAt:'2026-10-10',employees:[{name:'Ancienne semaine',lastViewedAt:null}]}));await first;
 assert.equal(f.$('#departmentViews').innerHTML,'Semaine courante');
});
