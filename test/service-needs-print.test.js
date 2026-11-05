import test from 'node:test';import assert from 'node:assert/strict';
import {serviceNeedsHTML,serviceNeedsReport} from '../public/service-needs-print.js';
const shift=(id,extra={})=>({id,role:'cashier',dayIndex:0,startMinute:480,endMinute:960,...extra});
test('besoins : quantité, repas et totaux indépendants des affectations et absences',()=>{
 const data={weekStart:'2030-12-30',employees:[{name:'Nom confidentiel'}],assignments:[{shiftId:1,employeeId:3}],shifts:[shift(1),shift(2,{absence:{start:720,end:780}}),shift(3,{role:'packer',dayIndex:1,endMinute:720})]},before=structuredClone(data);
 const report=serviceNeedsReport(data);assert.equal(report.count,3);assert.equal(report.totalMinutes,1080);assert.equal(report.days[0].length,1);assert.equal(report.days[0][0].quantity,2);assert.equal(report.days[0][0].paidMinutes,420);
 const html=serviceNeedsHTML(data);assert.match(html,/30 décembre 2030/);assert.match(html,/5 janvier 2031/);assert.match(html,/3 quart\(s\) · 18 h/);assert.match(html,/repas 60 min/);assert.doesNotMatch(html,/Nom confidentiel/);assert.equal((html.match(/class="service-sheet service-needs-sheet"/g)||[]).length,3);assert.equal((html.match(/scope="col"/g)||[]).length,21);assert.deepEqual(data,before);
});
test('besoins : fonctions et départements distincts, texte échappé et journées vides',()=>{
 const data={weekStart:'2030-10-14',shifts:[shift(1,{role:'support',sourceDepartment:'Épicerie <script>'}),shift(2,{role:'support',sourceDepartment:'Cuisine'}),shift(3,{role:'orders'}),shift(4,{role:'supervisor'})]};
 assert.equal(serviceNeedsReport(data).days[0].length,4);const html=serviceNeedsHTML(data);assert.match(html,/Épicerie &lt;script&gt;/);assert.match(html,/Commandes téléphoniques/);assert.match(html,/Superviseur/);assert.equal((html.match(/class="needs-entry"/g)||[]).length,4);
 const empty=serviceNeedsHTML({weekStart:data.weekStart,shifts:[]});assert.match(empty,/0 quart\(s\) · 0 h/);
});

test('grille hebdomadaire : gérants et superviseurs ensemble, caissières et emballeurs séparés',()=>{
 const html=serviceNeedsHTML({weekStart:'2030-10-14',shifts:[shift(1,{role:'manager'}),shift(2,{role:'supervisor'}),shift(3),shift(4,{role:'packer'}),shift(5,{role:'orders'})]});
 const sections=html.match(/<article[\s\S]*?<\/article>/g);assert.equal(sections.length,4);
 assert.match(sections[0],/>Gérante<|>Gérante<\/strong>/);assert.match(sections[0],/>Superviseur<\/strong>/);assert.doesNotMatch(sections[0],/>Caissière<\/strong>|>Emballeur<\/strong>/);
 assert.match(sections[1],/>Caissière<\/strong>/);assert.doesNotMatch(sections[1],/>Gérante<\/strong>|>Emballeur<\/strong>/);
 assert.match(sections[2],/>Emballeur<\/strong>/);assert.match(sections[3],/Commandes téléphoniques/);
 for(const section of sections)assert.equal((section.match(/scope="col"/g)||[]).length,7);
});
