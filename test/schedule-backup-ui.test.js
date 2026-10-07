import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const handlers=source.slice(source.indexOf('let restoration=null'),source.indexOf('api("/api/session").then'));
const fixture=()=>({id:'9',createdAt:'2026-10-07T12:00:00Z',token:'revision',canRestore:true,issues:[],changes:[{date:'2026-10-18',startMinute:675,endMinute:1035,current:'<nom>',restored:'Raphaël'}]});
function page(backup){
  const nodes=new Map(),calls=[];
  const $=id=>{
    if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',disabled:false,opened:false,addEventListener(){},showModal(){this.opened=true;},close(){this.opened=false;}});
    return nodes.get(id);
  };
  const state={weekStart:'2026-10-12'};
  const context=vm.createContext({$,state,Intl,Date,formatWeek:w=>w,timeText:m=>String(m),escapeHtml:s=>s.replaceAll('<','&lt;').replaceAll('>','&gt;'),toast(){},loadWeek:async w=>calls.push(['load',w]),
    api:async(url,options)=>{calls.push([url,options]);return options?{ok:true}:{backup};}});
  vm.runInContext(handlers,context);
  return {$,calls,state};
}
test('aperçu seulement au premier clic; restauration uniquement après confirmation',async()=>{
  const p=page(fixture());await p.$('#undoRegeneration').onclick();
  assert.equal(p.$('#restorePreview').opened,true);
  assert.match(p.$('#restoreChanges').innerHTML,/&lt;nom&gt;/);
  assert.equal(p.calls.length,1);
  await p.$('#confirmRestore').onclick();
  const [url,options]=p.calls[1];assert.equal(url,'/api/weeks/2026-10-12/regeneration-backup/restore');
  assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{backupId:'9',token:'revision'});
  assert.equal(p.$('#restorePreview').opened,false);
  assert.match(p.$('#restoreStatus').textContent,/rétablies/);
});
test('absence de sauvegarde et congé incompatible sont expliqués',async()=>{
  const empty=page(null);await empty.$('#undoRegeneration').onclick();
  assert.equal(empty.$('#restorePreview').opened,false);assert.match(empty.$('#restoreStatus').textContent,/Aucune recréation/);
  const blocked=page({...fixture(),canRestore:false,issues:['Congé incompatible']});await blocked.$('#undoRegeneration').onclick();
  assert.equal(blocked.$('#confirmRestore').disabled,true);assert.equal(blocked.$('#restoreError').textContent,'Congé incompatible');
});
