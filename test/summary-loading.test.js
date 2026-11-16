import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/departments.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf("$('#buildControl').onclick="),source.indexOf("$('#saveSummary').onclick="));
for(const failure of [false,true])test('all-department loader serializes requests and '+(failure?'rejects incomplete totals':'renders every accessible department'),async()=>{
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
 $('#controlScope').value='all';
 let active=0,peak=0,rendered=0,requests=0;
 const context=vm.createContext({$,weekLocks:0,weekLoading:false,summaryDirty:new Set(),dirty:false,
 current:{weekStart:'2026-11-23'},meta:{departments:Array.from({length:10},(_,i)=>({id:i+1,name:'Department '+i,active:true})).concat({id:11,active:false})},controlReports:[],
 withWeekLock:async fn=>fn(),invalidateControl:()=>{context.controlReports=[];},
 api:async path=>{requests++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,1));active--;if(failure&&requests===4)throw Error('Test indisponible');return {path};},
 renderSummaryTable:()=>rendered++,refreshSummaryPreview:()=>rendered++});
 vm.runInContext(handler,context);await $('#buildControl').onclick();
 assert.equal(peak,1);
 assert.equal(requests,failure?4:10);assert.equal(rendered,failure?0:2);
 assert.equal(context.controlReports.length,failure?0:10);
 assert.match($('#controlStatus').textContent,failure?/pas été chargé/:/10 département/);
});
