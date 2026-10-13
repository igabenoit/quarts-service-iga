import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Run the actual mail/navigation handlers with a small DOM and simulated services.
const source=readFileSync(new URL('../public/departments.js',import.meta.url),'utf8');
const start=source.lastIndexOf('\n}',source.indexOf('let departmentMailSettings'))+2;
const handlers=source.slice(start,source.indexOf("$('#weekPicker').value=monday(today())"));
function fixture(){
  const elements=new Map();
  const $=id=>{if(!elements.has(id))elements.set(id,{value:'',disabled:false,open:false,events:{},addEventListener(type,fn){(this.events[type]??=[]).push(fn);},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);};
  const close={dataset:{close:'documentMailDialog'}};
  const sheet={clientHeight:100,scrollHeight:100,getBoundingClientRect:()=>({bottom:100}),querySelectorAll:()=>[],querySelector:()=>({getBoundingClientRect:()=>({bottom:90})})};
  elements.set('#printPreview .department-sheet',sheet);
  let resolveSend,rejectSend,calls=0;
  const context=vm.createContext({$,document:{querySelectorAll:s=>s==='[data-close]'?[close]:[]},view:'',selectedDepartment:1,current:{weekStart:'2026-10-12'},PRINT_ROW_CAPACITY:14,e:String,
    api:async()=>({recipients:['test@example.com'],configured:true,version:1,history:[]}),
    post:()=>{calls++;return new Promise((resolve,reject)=>{resolveSend=resolve;rejectSend=reject;});},
    renderPrint(){},message(){},getComputedStyle:()=>({paddingBottom:'0'}),schedulePDF:async()=>({}),
    FileReader:class{readAsDataURL(){this.result='data:application/pdf;base64,JVBERi0=';this.onload();}},
    crypto:{randomUUID:()=> 'test-id'},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}}
  });
  vm.runInContext(handlers,context);
  return {$,close,context,get calls(){return calls;},resolve:()=>resolveSend({}),reject:()=>rejectSend(Error('Envoi non confirmé'))};
}
for(const failure of [false,true])test(`mail dialog closes after ${failure?'failed':'successful'} send and across navigation`,async()=>{
  const f=fixture(),dialog=f.$('#documentMailDialog');
  await vm.runInContext("switchView('print')",f.context);
  await f.$('#emailDocument').onclick();
  f.close.onclick();assert.equal(dialog.open,false,'close before preparation');
  await f.$('#emailDocument').onclick();
  await f.$('#prepareMailPdf').onclick();
  const sending=f.$('#sendDocumentMail').onclick();
  f.close.onclick();assert.equal(dialog.open,true,'keep open while request is pending');
  if(failure)f.reject();else f.resolve();await sending;
  assert.match(f.$('#documentMailStatus').textContent,failure?/non confirmé/:/transmis au service/);
  f.close.onclick();assert.equal(dialog.open,false,'close after settled request');
  await vm.runInContext("switchView('mail'); switchView('print')",f.context);
  await f.$('#emailDocument').onclick();f.close.onclick();
  assert.equal(dialog.open,false);
  assert.equal(dialog.events.cancel.length,1,'navigation must not accumulate cancel handlers');
  assert.equal(f.calls,1,'closing and reopening must never send again');
});
