import test from 'node:test';
import assert from 'node:assert/strict';
import {trainingDraftGroups,trainingDraftInventory} from '../public/training-drafts.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const entry=(id,employee,equipment,status='draft',supersedes)=>({id,kind:'training_form',equipment_id:equipment,supersedes,data:{status,employeeKeys:[employee],tasks:['Utilisation']}});
test('inventory groups all equipment by employee and only includes current drafts',()=>{
 const state={employees:[{key:'a',name:'Alice'},{key:'b',name:'Benoît'}],equipment:[{id:'one',title:'Couteaux'},{id:'two',title:'Trancheur'}],entries:[entry('old','a','one'),entry('new','a','one','draft','old'),entry('other','a','two'),entry('pending','b','two'),entry('done-old','b','one'),entry('done','b','one','completed','done-old')]};
 const groups=trainingDraftGroups(state);
 assert.deepEqual(groups.map(g=>[g.name,g.drafts.map(d=>d.entry.id)]),[['Alice',['new','other']],['Benoît',['pending']]]);
 const html=trainingDraftInventory(state);
 assert.match(html,/\(3\)/);assert.match(html,/data-open-form="other"/);assert.doesNotMatch(html,/data-open-form="(?:old|done-old|done)"/);
});
test('empty inventory and archived equipment remain understandable and escape stored text',()=>{
 assert.match(trainingDraftInventory({entries:[],employees:[],equipment:[]}),/Aucun brouillon/);
 const state={entries:[entry('draft','missing','archived')],employees:[],equipment:[{id:'archived',title:'<script>test</script>',archived_at:'2026-01-01'}]};
 assert.equal(trainingDraftGroups(state)[0].drafts.length,1);
 assert.match(trainingDraftInventory(state),/&lt;script&gt;/);assert.doesNotMatch(trainingDraftInventory(state),/<script>/);
});
test('resume switches employee, equipment and task before supplying the form context',async()=>{
 const source=await readFile(new URL('../public/equipment-training.js',import.meta.url),'utf8');
 const prior=entry('resume','b','two');prior.data.tasks=['Nettoyage'];
 const state={equipment:[{id:'one',department_id:1},{id:'two',department_id:2}],employees:[],departments:[{id:2,name:'Charcuterie'}],entries:[prior],actor:{name:'Admin'}};
 const selection={equipment:'one',employee:'a',task:'Utilisation',department:'1'};
 let opened,drawn=false;
 const sandbox={currentGuide:()=>null,state,selection,canLeave:()=>true,draw:()=>{drawn=true;},equipment:()=>state.equipment.find(e=>e.id===selection.equipment),procedures:()=>[selection.equipment,selection.task],openTrainingForm:options=>{opened=options;},api:()=>{},banner:()=>{}};
 vm.createContext(sandbox);vm.runInContext(source.slice(source.indexOf('function openForm(')),sandbox);sandbox.openForm(prior);
 assert.ok(drawn);assert.equal(opened.equipment.id,'two');assert.equal(opened.employeeKey,'b');assert.equal(opened.task,'Nettoyage');assert.equal(opened.department,'Charcuterie');assert.deepEqual(opened.procedures,['two','Nettoyage']);assert.equal(selection.department,'');
 opened=null;sandbox.canLeave=()=>false;sandbox.openForm(prior);assert.equal(opened,null);
});
