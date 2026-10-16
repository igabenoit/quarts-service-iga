import test from 'node:test';
import assert from 'node:assert/strict';
import {BAKERY_POSTS,normalizeDraft,blankCell,validateAssignment,totalMinutes,grandMinutes,cellDetail,sheetHTML,publicSnapshot} from '../public/departments-core.js';
test('bakery posts persist, print below shifts and count as regular hours',()=>{
  const people=[{id:1,name:'Employée exemple',group:'regular',availability:{}}];
  const cells=Object.entries(BAKERY_POSTS).map(([post,label])=>{
    const c=validateAssignment({kind:'shift',start:480,end:960,breakMinutes:60,post,note:''},'boulangerie');
    assert.equal(cellDetail(c),label);
    assert.throws(()=>validateAssignment(c,'pam'),/Boulangerie/);
    assert.doesNotThrow(()=>validateAssignment({...c,workDepartment:'boulangerie'},'pam'));
    return c;
  });
  const draft=normalizeDraft({rows:[{personId:1,cells:[...cells,...Array.from({length:3},blankCell)]}]},people);
  assert.equal(totalMinutes(draft.rows[0]),28*60);
  assert.equal(grandMinutes(draft.rows[0]),28*60);
  assert.deepEqual(publicSnapshot(draft,people).rows[0].cells,draft.rows[0].cells);
  const html=sheetHTML({department:{key:'boulangerie',name:'Boulangerie'},weekStart:'2026-10-19',people,draft});
  for(const label of Object.values(BAKERY_POSTS))assert.ok(html.includes('<b>16:00</b><small class="assignment-label">'+label+'</small>'));
});

