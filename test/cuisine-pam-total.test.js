import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as core from '../public/departments-core.js';
import {prepareSharedDraft} from '../public/department-buffet.js';
const person={id:1,name:'Employé exemple',group:'regular',availability:{},active:true};
const shift=(extra={})=>({kind:'shift',start:420,end:960,breakMinutes:60,note:'',...extra});
const row=(cells)=>({personId:1,cells:[...cells,...Array.from({length:7-cells.length},core.blankCell)]});
test('Cuisine employee column counts PAM transfers and related shifts once, excluding kitchen and other departments',()=>{
 const own=row([shift({kind:'kitchen'}),shift({post:'bbq',workDepartment:'pam'}),shift({workDepartment:'viande'})]);
 const related=[{personId:1,day:1,cell:own.cells[1],sourceDepartment:'cuisine'},{personId:1,day:3,cell:shift({post:'rs_ss',trainingMinutes:60}),sourceDepartment:'pam'},{personId:2,day:4,cell:shift(),sourceDepartment:'pam'}];
 assert.equal(core.pamAccountedMinutes(own,related),960);
 assert.equal(core.grandMinutes(own),480,'Cuisine accounting remains separate');
 assert.equal(core.pamAccountedMinutes(row([shift({kind:'kitchen'})])),0);
});
test('Cuisine PAM display respects buffet allocation and paid-hour overrides',()=>{
 const people=[{...person,buffetPamPriority:true}];
 const related=[0,1,2,3].map(day=>({personId:1,day,cell:shift({kind:'buffet'}),sourceDepartment:'pam'}));
 const projected=prepareSharedDraft({rows:[row([])]},related,people,'cuisine');
 assert.equal(core.pamAccountedMinutes(projected.draft.rows[0],projected.related),1440,'only 24 h allocated to PAM');
 assert.equal(core.grandMinutes(projected.draft.rows[0]),0);
 assert.equal(core.pamAccountedMinutes(row([shift({workDepartment:'pam',paidMinutesOverride:90})])),90);
});
test('Cuisine print employee total and subtotal explicitly show PAM hours; other departments stay unchanged',()=>{
 const own=row([shift({kind:'kitchen'}),shift({post:'bbq',workDepartment:'pam'})]);
 const args={department:{key:'cuisine',name:'Cuisine'},weekStart:'2026-11-23',people:[person],draft:{rows:[own],notes:''}};
 const html=core.sheetHTML(args);
 assert.match(html,/<th>Total<br><small>comptabilisé au PAM<\/small>/);
 assert.match(html,/<td class="sheet-total"><span class="regular-hours">8<\/span>/);
 assert.match(html,/Sous-total réguliers<\/td><td><span class="regular-hours">8<\/span>/);
 assert.match(html,/Cuisine : 8 h/);
 const blank=core.sheetHTML({...args,blank:true});assert.doesNotMatch(blank,/<span class="regular-hours">8/);
 const other=core.sheetHTML({...args,department:{key:'pam',name:'PAM'}});assert.match(other,/<small>régulier<\/small>/);
});
test('Cuisine editor puts PAM hours in the existing total column',()=>{
 const own=row([shift({kind:'kitchen'}),shift({post:'bbq',workDepartment:'pam'})]);
 const elements=new Map();const $=key=>{if(!elements.has(key))elements.set(key,{querySelectorAll:()=>[]});return elements.get(key);};
 const context=vm.createContext({...core,e:core.escapeHTML,$,current:{department:{key:'cuisine'},weekStart:'2026-11-23',people:[person],draft:{rows:[own]},incoming:[]},displayDraft:()=>({rows:[own]}),sharedDisplay:()=>({related:[]}),renderCopyBar(){},sharedDepartmentDay:()=>'',copiedShift:null,salesForecasts:{dayHTML:()=>''},formatCell:()=>''});
 const source=readFileSync(new URL('../public/departments.js',import.meta.url),'utf8');
 vm.runInContext(source.slice(source.indexOf('function renderSchedule(){'),source.indexOf('function openCell('))+'\nrenderSchedule();',context);
 assert.match($('#scheduleGrid').innerHTML,/<td class="editor-total"><strong>8 h<\/strong><small>Comptabilisées au PAM<\/small>/);
 assert.match($('#scheduleGrid').innerHTML,/Cuisine<br><b>8 h/);
});
