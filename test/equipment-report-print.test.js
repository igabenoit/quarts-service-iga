import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/equipment-training.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function entryHTML('),source.indexOf('function editor('))+source.slice(source.indexOf('function reportHTML('),source.indexOf('function sheetBody('));
test('printed training report retains training facts and excludes administrative metadata and original index',()=>{
 const entry={id:'private-entry-id',kind:'session',equipment_id:'machine',created_at:'2026-11-08',actor:{name:'Admin privé',kind:'admin'},data:{employeeKeys:['person'],tasks:['Utilisation'],date:'2026-08-15',trainer:'Formateur témoin',procedureId:'procedure',content:'Utiliser le poussoir',attendance:[],enteredBy:'Compte privé'}};
 const report={scope:{equipmentId:'machine'},cutoff:'2026-08-15',generatedAt:'2026-11-08',equipment:[{id:'machine',title:'Trancheur'}],beforeState:[],current:[],before:[],documentsSince:[],statementsSince:[],interventionsSince:[entry],entries:[entry,{id:'procedure',data:{version:'Octobre 2025'}}],index:[{id:'private-document-id',name:'Original.pdf',sha256:'private-hash',created_at:'2026-11-08'}],open:[]};
 const context={esc:String,stamp:String,name:()=> 'Employé témoin',entryLabels:{session:'Formation donnée'},eventDate:d=>d.date,state:{documents:[]}};
 vm.createContext(context);vm.runInContext(functions,context);
 const screen=context.reportHTML(report),printed=context.reportHTML(report,true);
 for(const marker of ['Saisi le','Admin privé','Compte privé','private-entry-id','Index des pièces originales','Date de dépôt','private-document-id','SHA-256','private-hash','Rapport produit le']){
  assert.ok(screen.includes(marker),marker+' remains in administrative view');
  assert.ok(!printed.includes(marker),marker+' excluded from print');
 }
 for(const fact of ['2026-08-15','Formateur témoin','Employé témoin','Utiliser le poussoir','Suivis ouverts'])assert.ok(printed.includes(fact),fact+' retained');
 assert.match(source,/innerHTML=reportHTML\(report,true\);if\(d.emailPrint\)emailPaper\('Rapport de formation'\);else window.print\(\)/);
});
