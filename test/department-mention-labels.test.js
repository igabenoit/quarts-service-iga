import test from 'node:test';
import assert from 'node:assert/strict';
import {blankCell,separateMentionTotals,sheetHTML,grandMinutes} from '../public/departments-core.js';
test('print groups inventory labels differing only by case without counting hours twice',()=>{
 const cell={kind:'shift',mentionHours:'separate',start:720,end:1020,breakMinutes:0};
 const rows=['Inventaire','inventaire'].map((note,i)=>({personId:i+1,cells:[{...cell,note},...Array.from({length:6},blankCell)]}));
 assert.deepEqual([...separateMentionTotals(rows)],[['Inventaire',600]]);
 assert.equal(rows.reduce((n,r)=>n+grandMinutes(r),0),600);
 const html=sheetHTML({department:{key:'fruits',name:'Fruits'},weekStart:'2026-11-23',people:rows.map(r=>({id:r.personId,name:'Test '+r.personId,group:'regular',availability:{}})),draft:{rows}});
 assert.match(html,/Inventaire : 10 h/);
 assert.doesNotMatch(html,/inventaire : 5 h/);
 assert.match(html,/Grand total : 10 h/);
 const subtotal=html.match(/<tr class="sheet-subtotal">([\s\S]*?)<\/tr>/)[1];
 assert.match(subtotal,/<td colspan="9">Sous-total r[^<]+<small class="mention-hours">Inventaire <b>10 h<\/b><\/small><\/td>/);
 assert.doesNotMatch(subtotal.split('</td><td>')[1],/mention-hours/);
 const other={cells:[{...cell,note:'Inventaire annuel'},{...cell,note:' Inventaire  annuel '},{...cell,note:'Livraison'},{...cell,note:'Inventaire annuel',workDepartment:'pam'}]};
 assert.deepEqual([...separateMentionTotals([other])],[['Inventaire annuel',600],['Livraison',300]]);
});
