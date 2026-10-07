import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/undo-control.js',import.meta.url),'utf8');
async function fixture(){
  let action={id:'12',label:'Supprimer un quart',week_start:'2026-10-12'},key;
  const button={disabled:true},status={textContent:''},calls=[];
  const context={window:{addEventListener(){}},document:{querySelector:s=>s==='#undoLastAction'?button:status,addEventListener:(_event,handler)=>key=handler},
    fetch:async(url,options={})=>{calls.push({url,options});if(options.method==='POST'){const old=action;action=null;return {ok:true,json:async()=>({action:old})};}return {ok:true,json:async()=>({action})};}};
  vm.runInNewContext(source,context);
  const undone=[];const control=context.window.createUndoControl({onUndo:async a=>undone.push(a)});await control.refresh();
  button.click=()=>button.onclick();
  return {button,status,calls,undone,key,control};
}
test('la touche annule directement une seule commande sans aperçu',async()=>{
  const f=await fixture();assert.equal(f.button.disabled,false);assert.match(f.status.textContent,/Supprimer un quart/);
  await f.button.onclick();
  const posts=f.calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,1);
  assert.deepEqual(JSON.parse(posts[0].options.body),{actionId:'12'});
  assert.equal(f.undone.length,1);assert.equal(f.button.disabled,true);assert.match(f.status.textContent,/Action annulée/);
});
test('Ctrl+Z respecte les champs de saisie et les commandes en cours',async()=>{
  const f=await fixture();let clicks=0,prevented=0;f.button.click=()=>clicks++;
  const event={ctrlKey:true,key:'z',preventDefault:()=>prevented++,target:{closest:()=>({})}};
  f.key(event);assert.equal(clicks,0);assert.equal(prevented,0);
  event.target.closest=()=>null;f.key(event);assert.equal(clicks,1);assert.equal(prevented,1);
  f.button.disabled=true;f.key(event);assert.equal(clicks,1);
});
