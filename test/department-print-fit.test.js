import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetHTML,blankCell,DEPARTMENT_STYLES} from '../public/departments-core.js';
import {sheetOverflowMessage} from '../public/department-pdf.js';

test('legal layout keeps all 17 PAM employees in blank and filled sheets',()=>{
  const people=Array.from({length:17},(_,i)=>({id:i+1,name:`Employé ${i+1}`,active:true,group:i<8?'regular':'part_time',availability:{}}));
  const draft={rows:people.map(p=>({personId:p.id,cells:Array.from({length:7},blankCell)})),notes:'À conserver'};
  for(const blank of [false,true]){
    const html=sheetHTML({department:DEPARTMENT_STYLES.find(d=>d.key==='pam'),weekStart:'2026-10-12',people,draft,blank});
    assert.match(html,/compact-sheet/);
    assert.equal((html.match(/class="sheet-person"/g)||[]).length,17);
    for(const p of people)assert.ok(html.includes(`>${p.name}</div>`));
  }
  const html=sheetHTML({department:DEPARTMENT_STYLES[0],weekStart:'2026-10-12',people:[],draft:{rows:[],notes:''},blank:true});
  assert.doesNotMatch(html,/compact-sheet/);
  assert.equal((html.match(/class="sheet-person"/g)||[]).length,14);
});

test('PDF eligibility follows measured content, not employee count; real overflow is refused',()=>{
  const previous=globalThis.getComputedStyle;
  globalThis.getComputedStyle=()=>({paddingBottom:'29'});
  try{
    let bottom=1300,footerBottom=1300;
    const text={scrollHeight:40,clientHeight:40,scrollWidth:90,clientWidth:90};
    const table={getBoundingClientRect:()=>({bottom})};
    const totals={getBoundingClientRect:()=>({bottom:footerBottom})};
    const sheet={scrollHeight:1344,clientHeight:1344,children:[table,totals],getBoundingClientRect:()=>({width:816,height:1344,top:0,bottom:1344}),querySelectorAll:()=>Array(17).fill(text)};
    assert.equal(sheetOverflowMessage(sheet),'');
    bottom=1320;assert.match(sheetOverflowMessage(sheet),/dépasse la page/);bottom=1300;
    footerBottom=1400;assert.match(sheetOverflowMessage(sheet),/dépasse la page/);footerBottom=1300;
    text.scrollHeight=50;assert.match(sheetOverflowMessage(sheet),/dépasse une case/);
    text.closest=()=>({querySelector:()=>({childNodes:[{textContent:' Alexandra Exemple '}]})});
    assert.match(sheetOverflowMessage(sheet),/pour « Alexandra Exemple »/);text.scrollHeight=40;
    text.scrollWidth=100;assert.match(sheetOverflowMessage(sheet),/dépasse une case/);text.scrollWidth=90;
    sheet.scrollHeight=1400;assert.match(sheetOverflowMessage(sheet),/dépasse la page/);
  }finally{if(previous===undefined)delete globalThis.getComputedStyle;else globalThis.getComputedStyle=previous;}
});
